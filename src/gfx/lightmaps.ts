import * as THREE from 'three';
import { ATLASES, LmAtlas } from '../core/lightmap';
import { jst, sunPosition } from '../sun';
import type { World } from '../world';
import { constrainedDevice } from './device';
import { debugLightmap } from './lmdebug';

/**
 * Blender（Cycles）でベイクした GI ライトマップの適用。
 *
 * 契約（docs/GRAPHICS-PIPELINE.md §3）：
 *  - src/assets/baked/lightmaps.json の hash が world.lightmap.hash と一致するときだけ使う
 *  - 画像は uv1（channel 1）・flipY=false・sRGB 8bit。画素値 × scale = Blender の Diffuse 照度パス
 *  - three の lightMap は放射照度扱い（BRDF_Lambert で 1/π）なので lightMapIntensity = scale × π × gain
 *
 * gain は「自動露出 × 利用者の倍率（スライダー）」。ベイク値は Blender の物理単位（室内なので暗い）で、
 * リアルタイムの太陽光（画面の明るさ基準）と釣り合わないため、ベイク時の統計（平均輝度）から
 * 白い面が適正に見える露出を求める（統計が無ければ 1）。
 *
 * 対象メッシュのマテリアルはアトラスごとに複製して差し替える（家具等と共有しているため）。
 * 複製したマテリアルは、ベイクに含まれる環境光（半球光・IBL 拡散）を弱めて二重に明るくならないようにする。
 * 太陽の直達光はベイクしていないので、リアルタイムの DirectionalLight をそのまま受ける。
 * その照り返し（窓際の床に当たった日射が天井・壁を照らす分）もベイクに含まれないため、
 * 太陽の強さに比例した係数（SUN_BOUNCE）で天井・壁を持ち上げて近似する。
 *
 * ベイクの天空光は 10:30 の空なので、時刻スライダーに合わせて天空光の分だけを太陽高度から強弱させる
 * （LM_PATCH。夕方は窓際が暗くなり室内照明が主になる）。天空の明るさの方位による偏り（午後は西面が明るい等）は
 * 1 枚のベイクでは表せないため、10:30 の分布のまま強さだけを変える。
 */

interface AtlasEntry {
  file: string;
  w: number;
  h: number;
  scale: number;
}

/** アトラスごとのベイク記録（任意） */
interface AtlasBake {
  samples?: number;
  seconds?: number;
  quality?: string;
  stats?: { meanLum?: number };
}

export interface LightmapManifest {
  hash: string;
  atlases: Partial<Record<LmAtlas, AtlasEntry>>;
  encoding?: string;
  quality?: string;
  bake?: {
    blender?: string;
    samples?: number;
    seconds?: number;
    denoise?: string;
    quality?: string;
    atlases?: Partial<Record<LmAtlas, AtlasBake>>;
  };
}

export type LmStatus = 'none' | 'mismatch' | 'loading' | 'ready' | 'debug' | 'error';

const manifests = import.meta.glob<LightmapManifest>('../assets/baked/lightmaps.json', { eager: true, import: 'default' });
const images = import.meta.glob<string>('../assets/baked/lm_*.{webp,jpg,jpeg,png}', { eager: true, query: '?url', import: 'default' });

function imageUrl(file: string): string | undefined {
  for (const [path, url] of Object.entries(images)) if (path.endsWith('/' + file)) return url;
  return undefined;
}

/** 自動露出の基準：参照アトラスの平均輝度をこの値に合わせる（床 > 壁 > 天井の順に参照） */
const EXPOSURE_TARGET: [LmAtlas, number][] = [
  ['floor', 0.6],
  ['wall', 0.5],
  ['ceil', 0.42],
];

function autoExposure(man: LightmapManifest): number {
  for (const [a, target] of EXPOSURE_TARGET) {
    const lum = man.bake?.atlases?.[a]?.stats?.meanLum;
    if (man.atlases[a] && lum && lum > 0) return THREE.MathUtils.clamp(target / lum, 0.25, 12);
  }
  return 1;
}

/** 「Blender Cycles ベイク・プレビュー品質・16 サンプル・OIDN・5 分（床・天井）」形式の説明 */
function bakeNote(man: LightmapManifest): string {
  const b = man.bake ?? {};
  const keys = Object.keys(man.atlases) as LmAtlas[];
  const per = keys.map((a) => b.atlases?.[a] ?? {});
  const quality = man.quality ?? b.quality ?? per.find((p) => p.quality)?.quality;
  const samples = b.samples ?? Math.max(0, ...per.map((p) => p.samples ?? 0));
  const seconds = b.seconds ?? per.reduce((t, p) => t + (p.seconds ?? 0), 0);
  const parts = ['Blender Cycles ベイク'];
  if (quality) parts.push(quality === 'final' ? '最終品質' : 'プレビュー品質');
  if (samples) parts.push(`${samples} サンプル`);
  if (b.denoise) parts.push(b.denoise);
  if (seconds) parts.push(`${Math.max(1, Math.round(seconds / 60))} 分`);
  const names = keys.map((a) => ({ floor: '床', ceil: '天井', wall: '壁' })[a]);
  return `${parts.join('・')}（${names.join('・')}）`;
}

/** 日射の照り返しの近似：太陽が最も強いときの倍率の増分（天井は床からの反射を最も受ける） */
const SUN_BOUNCE: Record<LmAtlas, number> = { floor: 0.05, wall: 0.2, ceil: 0.55 };

/**
 * 天空光の強さ：太陽高度（度）→ 東西南北の鉛直面の平均天空照度（1.0 ≒ 1,000 lx）。
 * ベイクと同じ設定の Nishita 天空（太陽ディスクなし）を 2026-09-28 の 6:00〜18:00 で Blender により実測した値。
 * 窓はすべて鉛直面なので、室内に入る天空光はおおむねこれに比例する（午前と午後で差がなく、高度だけで決まる）。
 */
const SKY_VERTICAL: [number, number][] = [
  [-7, 0],
  [-3.9, 0.05],
  [-0.9, 0.53],
  [2.2, 2.47],
  [4.6, 4.26],
  [10.6, 6.87],
  [17, 7.7],
  [28, 7.61],
  [38.5, 7.1],
  [47, 6.65],
  [49.7, 6.5],
  [51.7, 6.38],
];

function skyVertical(elevation: number): number {
  const t = SKY_VERTICAL;
  if (elevation <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    const [e1, v1] = t[i];
    if (elevation <= e1) {
      const [e0, v0] = t[i - 1];
      return v0 + ((v1 - v0) * (elevation - e0)) / (e1 - e0);
    }
  }
  return t[t.length - 1][1];
}

/** ベイクした天空の太陽高度（Blender の 'bake' バリアント＝meta.json の sun.default。export.ts の 10:30） */
const BAKE_SKY_ELEVATION = sunPosition(jst(2026, 9, 28, 10.5)).elevation;
const BAKE_SKY = skyVertical(BAKE_SKY_ELEVATION);

/**
 * 室内の環境光（IBL・半球光）の内訳。室内 HDR の位置（IT 南・中央）の机上照度
 * （blender/README.md §5.1：室内照明のみ 741 lx、＋天空光 915 lx、＋日射 1,595 lx。HDR は日射ありの 10:30）から。
 */
const AMBIENT_SPLIT = { led: 0.46, sky: 0.11, sun: 0.43 };

/** 環境光の残し具合（0 = ベイクのみ）。全ライトマップ用マテリアルで共有 */
const ambientKeep = { value: 0.12 };
/** 天空光の倍率（ベイク時の天空 = 1）。全ライトマップ用マテリアルで共有 */
const skyLevel = { value: 1 };

/**
 * ライトマップは天空光と室内照明（LED）の和として 1 枚に焼いてあるので、画素ごとに分けて天空光の分だけを時刻に合わせる。
 * 室内照明だけで届く明るさをアトラスの平均輝度（lmKnee、画素値の単位）とみなし、それを超える分を天空光とする
 * （窓際ほど天空光の割合が大きい）。室内照明のみ／天空＋室内照明を別々に焼いて比べると、日没前後
 * （天空 ×0.06）のアトラス平均の誤差は床 +15%・天井 +8%・壁 −7%（補正なしでは +78%・+38%・+66%）。
 */
const LM_PATCH = /* glsl */ `
#include <lights_fragment_maps>
#ifdef USE_LIGHTMAP
  float lmLum = dot( lightMapTexel.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  float lmSkyShare = max( 1.0 - lmKnee / max( lmLum, 1e-6 ), 0.0 );
  vec3 lmIrradiance = lightMapIrradiance * ( 1.0 + lmSkyShare * ( lmSky - 1.0 ) );
  // ベイク済みの天空光・天井照明・相互反射があるので、リアルタイムの環境光は控えめに
  irradiance = lmIrradiance + ( irradiance - lightMapIrradiance ) * lmAmbientKeep;
  iblIrradiance *= lmAmbientKeep;
#endif
`;

function bakedMaterial(base: THREE.MeshStandardMaterial, tex: THREE.Texture, knee: { value: number }): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.name = base.name;
  m.lightMap = tex;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.lmAmbientKeep = ambientKeep;
    shader.uniforms.lmSky = skyLevel;
    shader.uniforms.lmKnee = knee;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lmAmbientKeep;\nuniform float lmSky;\nuniform float lmKnee;')
      .replace('#include <lights_fragment_maps>', LM_PATCH);
  };
  m.customProgramCacheKey = () => 'lm-v2';
  return m;
}

/** half=true（モバイル・低メモリ端末）は半分の解像度に縮小して GPU メモリを 1/4 にする */
async function loadTexture(url: string, half: boolean): Promise<THREE.Texture> {
  if (!half) return new THREE.TextureLoader().loadAsync(url);
  const img = await new THREE.ImageLoader().loadAsync(url);
  const c = document.createElement('canvas');
  c.width = Math.max(1, img.width >> 1);
  c.height = Math.max(1, img.height >> 1);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return new THREE.CanvasTexture(c);
}

function setupTexture(tex: THREE.Texture, renderer: THREE.WebGLRenderer): void {
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.channel = 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
}

export class Lightmaps {
  status: LmStatus = 'none';
  /** UI に出す一行の説明 */
  note = '';
  enabled = false;
  /** 利用者の倍率（UI の「GI 強度」） */
  gain = 1;
  /** 自動露出（autoExposure） */
  exposure = 1;
  /** 太陽の強さ 0〜1（照り返しの近似に使う） */
  private sun = 0;
  /** 太陽高度（度。天空光の補正に使う） */
  private elevation = BAKE_SKY_ELEVATION;
  manifest: LightmapManifest | null = null;
  private tex: Partial<Record<LmAtlas, THREE.Texture>> = {};
  private scale: Partial<Record<LmAtlas, number>> = {};
  /** 室内照明だけで届く明るさ（画素値。これを超える分を天空光とみなす）。アトラスごとの uniform */
  private knee: Partial<Record<LmAtlas, { value: number }>> = {};
  private swaps: { mesh: THREE.Mesh; base: THREE.Material; baked: THREE.MeshStandardMaterial; atlas: LmAtlas }[] = [];
  /** withBaseMaterials の実行数（0 のときだけベイク用マテリアルを使う） */
  private holds = 0;

  constructor(
    private world: World,
    private renderer: THREE.WebGLRenderer,
  ) {}

  get available(): boolean {
    return this.status === 'ready' || this.status === 'debug';
  }

  /**
   * 室内の環境光に掛ける倍率（ベイク時の 10:30 = 1）。天空光の分は skyLevel、日射の分は太陽の強さで増減させ、
   * ライトマップと同じく夕方には室内照明の分だけが残るようにする。実ベイクがないときは 1。
   */
  get ambientDaylight(): number {
    if (this.status !== 'ready') return 1;
    return AMBIENT_SPLIT.led + AMBIENT_SPLIT.sky * skyLevel.value + AMBIENT_SPLIT.sun * this.sun;
  }

  /** ライトマップを用意する。debug=true なら検証用の合成画像（lmdebug.ts）を使う */
  async load(debug: boolean): Promise<void> {
    if (debug) {
      for (const a of Object.keys(ATLASES) as LmAtlas[]) {
        const tex = new THREE.CanvasTexture(debugLightmap(a, this.world));
        setupTexture(tex, this.renderer);
        this.tex[a] = tex;
        this.scale[a] = 1;
        this.knee[a] = { value: 1 };
      }
      this.status = 'debug';
      this.note = '検証用ライトマップ（?lmdebug=1）：床＝室の輪郭と 1m/3.2m グリッド、壁＝面の向き別の色と高さ 1m の赤線';
      ambientKeep.value = 0;
      this.build();
      return;
    }
    const man = Object.values(manifests)[0];
    if (!man) {
      this.status = 'none';
      this.note = 'ベイク GI は未生成です（Blender で生成すると自動で適用されます）';
      return;
    }
    this.manifest = man;
    if (man.hash !== this.world.lightmap.hash) {
      this.status = 'mismatch';
      this.note = `ベイク GI はレイアウト変更前のもののため使用していません（ハッシュ ${man.hash} ≠ ${this.world.lightmap.hash}）`;
      return;
    }
    this.status = 'loading';
    this.note = 'ベイク GI を読み込み中…';
    const half = constrainedDevice();
    try {
      await Promise.all(
        (Object.keys(man.atlases) as LmAtlas[]).map(async (a) => {
          const e = man.atlases[a]!;
          const url = imageUrl(e.file);
          if (!url) throw new Error(`${e.file} がありません`);
          const tex = await loadTexture(url, half);
          setupTexture(tex, this.renderer);
          this.tex[a] = tex;
          this.scale[a] = e.scale;
          // 平均輝度が記録されていなければ分けない（全体を室内照明とみなし、時刻で変えない）
          const lum = man.bake?.atlases?.[a]?.stats?.meanLum;
          this.knee[a] = { value: lum && lum > 0 ? lum / e.scale : 1 };
        }),
      );
    } catch (e) {
      console.warn('ライトマップの読み込みに失敗', e);
      this.status = 'error';
      this.note = 'ベイク GI の読み込みに失敗したため、通常の表示にしています';
      return;
    }
    this.status = 'ready';
    this.exposure = autoExposure(man);
    this.note = bakeNote(man) + (half ? '・端末に合わせて半解像度' : '');
    this.build();
  }

  /** 対象メッシュごとにライトマップ付きマテリアルを用意（アトラス × 元マテリアルで共有） */
  private build(): void {
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    for (const mesh of this.world.lightmap.meshes) {
      const atlas = mesh.userData.lmAtlas as LmAtlas;
      const tex = this.tex[atlas];
      const knee = this.knee[atlas];
      const base = mesh.material as THREE.MeshStandardMaterial;
      if (!tex || !knee || !base.isMeshStandardMaterial) continue;
      const key = `${atlas}|${base.uuid}`;
      let baked = cache.get(key);
      if (!baked) {
        baked = bakedMaterial(base, tex, knee);
        cache.set(key, baked);
      }
      this.swaps.push({ mesh, base, baked, atlas });
    }
    this.setGain(this.gain);
  }

  setEnabled(on: boolean): void {
    this.enabled = on && this.available;
    this.assign();
  }

  /**
   * fn の実行中は元のマテリアルに戻しておく（enabled の設定は変えない）。GLB 書き出し用。
   * ベイク用の複製は元と同じ名前なので、差し替えたまま書き出すと同名のマテリアルが重複し、
   * Blender の読み込みで「wall.white.001」のように改名されて、キー名で照合するマテリアル規則から外れてしまう。
   * 書き出し中にライトマップの読み込みが終わって setEnabled が呼ばれても、終了時に正しい状態へ戻す。
   */
  async withBaseMaterials<T>(fn: () => Promise<T>): Promise<T> {
    this.holds++;
    this.assign();
    try {
      return await fn();
    } finally {
      this.holds--;
      this.assign();
    }
  }

  private assign(): void {
    const baked = this.enabled && this.holds === 0;
    for (const s of this.swaps) s.mesh.material = baked ? s.baked : s.base;
  }

  setGain(g: number): void {
    this.gain = g;
    this.updateIntensity();
  }

  /** 太陽の強さ k（0 = 夜・日没、1 = 日中）と高度（度）。検証用の合成ライトマップには掛けない */
  setSun(k: number, elevation: number): void {
    this.sun = k;
    this.elevation = elevation;
    this.updateIntensity();
  }

  private updateIntensity(): void {
    const real = this.status === 'ready';
    const sun = real ? this.sun : 0;
    skyLevel.value = real ? skyVertical(this.elevation) / BAKE_SKY : 1;
    for (const s of this.swaps) {
      const bounce = 1 + SUN_BOUNCE[s.atlas] * sun;
      s.baked.lightMapIntensity = (this.scale[s.atlas] ?? 1) * Math.PI * this.exposure * this.gain * bounce;
    }
  }

  /** 検証・計測用 */
  info(): Record<string, unknown> {
    return {
      status: this.status,
      enabled: this.enabled,
      gain: this.gain,
      exposure: this.exposure,
      sky: skyLevel.value,
      knee: Object.fromEntries(Object.entries(this.knee).map(([k, u]) => [k, u?.value])),
      hash: this.world.lightmap.hash,
      manifestHash: this.manifest?.hash ?? null,
      meshes: this.swaps.length,
      /** いまベイク用マテリアルを使っているメッシュ数（書き出し中は 0） */
      inUse: this.swaps.filter((s) => s.mesh.material === s.baked).length,
      textures: Object.fromEntries(Object.entries(this.tex).map(([k, t]) => [k, t ? `${t.image.width}x${t.image.height}` : null])),
    };
  }
}
