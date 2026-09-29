import * as THREE from 'three';
import { ATLASES, LmAtlas } from '../core/lightmap';
import type { World } from '../world';
import { debugLightmap } from './lmdebug';

/**
 * Blender（Cycles）でベイクした GI ライトマップの適用。
 *
 * 契約（docs/GRAPHICS-PIPELINE.md §3）：
 *  - src/assets/baked/lightmaps.json の hash が world.lightmap.hash と一致するときだけ使う
 *  - 画像は uv1（channel 1）・flipY=false・sRGB 8bit。画素値 × scale = Blender の Diffuse 照度パス
 *  - three の lightMap は放射照度扱い（BRDF_Lambert で 1/π）なので lightMapIntensity = scale × π × gain
 *
 * 対象メッシュのマテリアルはアトラスごとに複製して差し替える（家具等と共有しているため）。
 * 複製したマテリアルは、ベイクに含まれる環境光（半球光・IBL 拡散）を弱めて二重に明るくならないようにする。
 * 太陽の直達光はベイクしていないので、リアルタイムの DirectionalLight をそのまま受ける。
 */

interface AtlasEntry {
  file: string;
  w: number;
  h: number;
  scale: number;
}

export interface LightmapManifest {
  hash: string;
  atlases: Partial<Record<LmAtlas, AtlasEntry>>;
  encoding?: string;
  bake?: { blender?: string; samples?: number; seconds?: number; denoise?: string; quality?: string };
}

export type LmStatus = 'none' | 'mismatch' | 'loading' | 'ready' | 'debug' | 'error';

const manifests = import.meta.glob<LightmapManifest>('../assets/baked/lightmaps.json', { eager: true, import: 'default' });
const images = import.meta.glob<string>('../assets/baked/lm_*.{webp,jpg,jpeg,png}', { eager: true, query: '?url', import: 'default' });

function imageUrl(file: string): string | undefined {
  for (const [path, url] of Object.entries(images)) if (path.endsWith('/' + file)) return url;
  return undefined;
}

/** 環境光の残し具合（0 = ベイクのみ）。全ライトマップ用マテリアルで共有 */
const ambientKeep = { value: 0.12 };

const LM_PATCH = /* glsl */ `
#include <lights_fragment_maps>
#ifdef USE_LIGHTMAP
  // ベイク済みの天空光・天井照明・相互反射があるので、リアルタイムの環境光は控えめに
  irradiance = lightMapIrradiance + ( irradiance - lightMapIrradiance ) * lmAmbientKeep;
  iblIrradiance *= lmAmbientKeep;
#endif
`;

function bakedMaterial(base: THREE.MeshStandardMaterial, tex: THREE.Texture): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.name = base.name;
  m.lightMap = tex;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.lmAmbientKeep = ambientKeep;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lmAmbientKeep;')
      .replace('#include <lights_fragment_maps>', LM_PATCH);
  };
  m.customProgramCacheKey = () => 'lm-v1';
  return m;
}

/** 端末の制約（モバイル・低メモリ）ではライトマップを半分の解像度に落とす */
function constrained(): boolean {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return matchMedia('(pointer: coarse)').matches || (mem !== undefined && mem <= 4);
}

async function loadTexture(url: string, half: boolean): Promise<THREE.Texture> {
  let tex: THREE.Texture;
  if (half) {
    const img = await new THREE.ImageLoader().loadAsync(url);
    const c = document.createElement('canvas');
    c.width = Math.max(1, img.width >> 1);
    c.height = Math.max(1, img.height >> 1);
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    tex = new THREE.CanvasTexture(c);
  } else {
    tex = await new THREE.TextureLoader().loadAsync(url);
  }
  return tex;
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
  gain = 1;
  manifest: LightmapManifest | null = null;
  private tex: Partial<Record<LmAtlas, THREE.Texture>> = {};
  private scale: Partial<Record<LmAtlas, number>> = {};
  private swaps: { mesh: THREE.Mesh; base: THREE.Material; baked: THREE.MeshStandardMaterial; atlas: LmAtlas }[] = [];

  constructor(
    private world: World,
    private renderer: THREE.WebGLRenderer,
  ) {}

  get available(): boolean {
    return this.status === 'ready' || this.status === 'debug';
  }

  /** ライトマップを用意する。debug=true なら検証用の合成画像（lmdebug.ts）を使う */
  async load(debug: boolean): Promise<void> {
    if (debug) {
      for (const a of Object.keys(ATLASES) as LmAtlas[]) {
        const tex = new THREE.CanvasTexture(debugLightmap(a, this.world));
        setupTexture(tex, this.renderer);
        this.tex[a] = tex;
        this.scale[a] = 1;
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
    const half = constrained();
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
        }),
      );
    } catch (e) {
      console.warn('ライトマップの読み込みに失敗', e);
      this.status = 'error';
      this.note = 'ベイク GI の読み込みに失敗したため、通常の表示にしています';
      return;
    }
    this.status = 'ready';
    const b = man.bake ?? {};
    const parts = ['Blender Cycles ベイク'];
    if (b.quality) parts.push(b.quality === 'final' ? '最終品質' : 'プレビュー品質');
    if (b.samples) parts.push(`${b.samples} サンプル`);
    if (b.denoise) parts.push(b.denoise);
    if (b.seconds) parts.push(`${Math.round(b.seconds / 60)} 分`);
    this.note = parts.join('・') + (half ? '（端末に合わせて半解像度）' : '');
    this.build();
  }

  /** 対象メッシュごとにライトマップ付きマテリアルを用意（アトラス × 元マテリアルで共有） */
  private build(): void {
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    for (const mesh of this.world.lightmap.meshes) {
      const atlas = mesh.userData.lmAtlas as LmAtlas;
      const tex = this.tex[atlas];
      const base = mesh.material as THREE.MeshStandardMaterial;
      if (!tex || !base.isMeshStandardMaterial) continue;
      const key = `${atlas}|${base.uuid}`;
      let baked = cache.get(key);
      if (!baked) {
        baked = bakedMaterial(base, tex);
        cache.set(key, baked);
      }
      this.swaps.push({ mesh, base, baked, atlas });
    }
    this.setGain(this.gain);
  }

  setEnabled(on: boolean): void {
    this.enabled = on && this.available;
    for (const s of this.swaps) s.mesh.material = this.enabled ? s.baked : s.base;
  }

  setGain(g: number): void {
    this.gain = g;
    for (const s of this.swaps) s.baked.lightMapIntensity = (this.scale[s.atlas] ?? 1) * Math.PI * g;
  }

  /** 検証・計測用 */
  info(): Record<string, unknown> {
    return {
      status: this.status,
      enabled: this.enabled,
      gain: this.gain,
      hash: this.world.lightmap.hash,
      manifestHash: this.manifest?.hash ?? null,
      meshes: this.swaps.length,
      textures: Object.fromEntries(Object.entries(this.tex).map(([k, t]) => [k, t ? `${t.image.width}x${t.image.height}` : null])),
    };
  }
}
