import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { Mode } from '../data/presets';
import { SkyDome } from './sky';

/**
 * モードごとの背景・環境光（IBL）・半球光のバランスを一か所で管理する。
 *
 *  俯瞰・平面図 : 明るい無彩色の背景（図面として読みやすく）
 *  ウォークスルー: 窓の外に物理ベースの空、室内の映り込みは室内 HDR（Blender で撮影）または RoomEnvironment
 *  外観         : 空の背景＋空から作った PMREM 環境
 *
 * ベイク GI（ライトマップ）が有効なときは、床・壁・天井の環境光をシェーダー側で弱める
 * （lightmaps.ts）ほか、家具・人物が浮かないよう半球光をやや絞り、IBL を少し強める。
 *
 * 室内 HDR は Blender のシーン単位（輝度 1.0 ≒ 1,000 cd/m²）なので露出を掛けて使う。
 * ライトマップがあればその自動露出（×GI 強度）と揃え、無ければ HDR の平均輝度から決める。
 * 室内 HDR があるときは環境光の大半を HDR が担うので、半球光は補助程度に下げる。
 *
 * 室内 HDR・ライトマップはどちらも 10:30 の昼光で焼いてあるため、ベイク GI が有効なウォークスルーでは
 * 室内の環境光（IBL・半球光）にも時刻に応じた倍率（Lightmaps.ambientDaylight）を掛け、夕方に家具・人物だけが
 * 昼の明るさのまま残らないようにする。
 */

const hdrUrls = import.meta.glob<string>('../assets/baked/env_interior.hdr', { eager: true, query: '?url', import: 'default' });

/** 室内 HDR の立体角平均輝度をこの値に合わせる（ライトマップが無いときの露出） */
const HDR_TARGET = 1.5;

/** 正距円筒 HDR（RGBA）の立体角で重み付けした平均輝度（間引いて計算） */
function meanLuminance(tex: THREE.DataTexture): number {
  const { width: w, height: h, data } = tex.image as { width: number; height: number; data: Uint16Array | Float32Array };
  // HDRLoader の既定は HalfFloat
  const half = data instanceof Float32Array ? (v: number) => v : THREE.DataUtils.fromHalfFloat;
  let sum = 0;
  let wsum = 0;
  for (let y = 0; y < h; y += 4) {
    const k = Math.sin(((y + 0.5) / h) * Math.PI);
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      sum += k * (0.2126 * half(data[i]) + 0.7152 * half(data[i + 1]) + 0.0722 * half(data[i + 2]));
      wsum += k;
    }
  }
  return wsum > 0 ? sum / wsum : 0;
}

/** Khronos PBR Neutral（three.js の NeutralToneMapping と同じ式）を線形 RGB に掛ける */
function neutral(c: number[]): number[] {
  const start = 0.8 - 0.04;
  const desat = 0.15;
  const x = Math.min(...c);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  const v = c.map((k) => k - offset);
  const peak = Math.max(...v);
  if (peak < start) return v;
  const d = 1 - start;
  const np = 1 - (d * d) / (peak + d - start);
  const g = 1 - 1 / (desat * (peak - np) + 1);
  return v.map((k) => (k * np) / peak + (np - (k * np) / peak) * g);
}

/**
 * 単色背景は、ポストエフェクト経由（OutputPass でトーンマッピング）でも直接描画（クリア色はトーンマッピングされない）
 * でも同じ色に見えるよう、トーンマッピング後に target になる色を反復で求める
 */
function preToneMapped(target: THREE.Color): THREE.Color {
  const t = [target.r, target.g, target.b];
  const c = [...t];
  for (let i = 0; i < 40; i++) {
    const n = neutral(c);
    for (let k = 0; k < 3; k++) c[k] = Math.max(0, c[k] + (t[k] - n[k]));
  }
  return new THREE.Color(c[0], c[1], c[2]);
}

interface Look {
  background: THREE.Color | THREE.Texture;
  backgroundIntensity: number;
  environment: THREE.Texture;
  environmentIntensity: number;
  hemi: number;
}

export class Lighting {
  private sky: SkyDome;
  private roomEnv: THREE.Texture;
  private interiorEnv: THREE.Texture | null = null;
  /** HDR の平均輝度から求めた露出 */
  private interiorAuto = 1;
  /** ライトマップと揃えた露出（あれば優先） */
  private interiorExposure: number | null = null;
  private mode: Mode = 'orbit';
  private gi = false;
  /** 室内の環境光の昼光による倍率（setDaylight） */
  private daylight = 1;
  private orbitBg = new THREE.Color(0xe4e8ec);
  private planBg = new THREE.Color(0xf4f5f6);
  private orbitBgTM = preToneMapped(this.orbitBg);
  private planBgTM = preToneMapped(this.planBg);
  /** 画面がトーンマッピングのポストパスを通るか（画質「軽量」では通らない） */
  private toneMappedBg = true;
  /** 室内 HDR の有無と読み込み状態（UI 表示用） */
  interiorNote = '';

  constructor(
    private scene: THREE.Scene,
    private hemi: THREE.HemisphereLight,
    renderer: THREE.WebGLRenderer,
    private pmrem: THREE.PMREMGenerator,
  ) {
    this.roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.sky = new SkyDome(renderer, pmrem);
  }

  /** env_interior.hdr があれば PMREM 化して室内の環境マップにする（無ければ何もしない） */
  async loadInterior(): Promise<void> {
    const url = Object.values(hdrUrls)[0];
    if (!url) return;
    try {
      const tex = await new HDRLoader().loadAsync(url);
      const lum = meanLuminance(tex);
      if (lum > 0) this.interiorAuto = THREE.MathUtils.clamp(HDR_TARGET / lum, 0.1, 20);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      this.interiorEnv = this.pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
      this.interiorNote = '室内の映り込み：Blender 室内 HDR';
      this.apply();
    } catch (e) {
      console.warn('env_interior.hdr の読み込みに失敗', e);
    }
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.apply();
  }

  setGI(on: boolean): void {
    this.gi = on;
    this.apply();
  }

  /** 室内 HDR の露出をライトマップに揃える（null = HDR の平均輝度から自動） */
  setInteriorExposure(k: number | null): void {
    this.interiorExposure = k;
    this.apply();
  }

  /** 室内の環境光の倍率（10:30 = 1）。ベイク GI が有効なウォークスルーでだけ使う */
  setDaylight(k: number): void {
    this.daylight = k;
    this.apply();
  }

  /** ポストエフェクト（OutputPass のトーンマッピング）を通すかどうか。単色背景の補正を切り替える */
  setPostToneMapping(on: boolean): void {
    this.toneMappedBg = on;
    this.apply();
  }

  setSun(dir: THREE.Vector3): void {
    this.sky.setSun(dir);
  }

  /** 毎フレーム：空の再焼き込み（必要時のみ）と、初回焼き込み後の環境の差し替え */
  update(): void {
    const outdoor = this.mode === 'walk' || this.mode === 'exterior';
    if (!outdoor) return;
    const before = this.sky.environment;
    this.sky.update();
    if (before !== this.sky.environment) this.apply();
  }

  private look(): Look {
    const interior = this.interiorEnv ?? this.roomEnv;
    const giHemi = this.gi ? 0.55 : 1;
    // 室内の IBL と半球光（室内 HDR があれば HDR 主体）
    const envK = this.interiorEnv ? (this.interiorExposure ?? this.interiorAuto) : this.gi ? 0.62 : 0.5;
    const hemiK = this.interiorEnv ? 0.3 : 0.75 * giHemi;
    switch (this.mode) {
      case 'plan':
        return { background: this.toneMappedBg ? this.planBgTM : this.planBg, backgroundIntensity: 1, environment: this.roomEnv, environmentIntensity: 0.5, hemi: 0.75 * giHemi };
      case 'walk': {
        const day = this.gi ? this.daylight : 1;
        return {
          background: this.sky.background,
          backgroundIntensity: 0.62,
          environment: interior,
          environmentIntensity: envK * day,
          hemi: hemiK * day,
        };
      }
      case 'exterior':
        return {
          background: this.sky.background,
          backgroundIntensity: 0.62,
          environment: this.sky.environment ?? this.roomEnv,
          environmentIntensity: 0.55,
          hemi: 0.45,
        };
      default:
        // 俯瞰は外構も写るので、室内の露出のままだと屋外が白飛びする。室内 HDR は半分に抑え、半球光で補う
        return {
          background: this.toneMappedBg ? this.orbitBgTM : this.orbitBg,
          backgroundIntensity: 1,
          environment: interior,
          environmentIntensity: this.interiorEnv ? envK * 0.5 : envK,
          hemi: this.interiorEnv ? 0.45 : hemiK,
        };
    }
  }

  private apply(): void {
    const l = this.look();
    this.scene.background = l.background;
    this.scene.backgroundIntensity = l.backgroundIntensity;
    this.scene.environment = l.environment;
    this.scene.environmentIntensity = l.environmentIntensity;
    this.hemi.intensity = l.hemi;
  }
}
