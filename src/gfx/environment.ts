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
 */

const hdrUrls = import.meta.glob<string>('../assets/baked/env_interior.hdr', { eager: true, query: '?url', import: 'default' });

interface Look {
  background: THREE.Color | THREE.Texture;
  backgroundIntensity: number;
  environment: THREE.Texture;
  environmentIntensity: number;
  hemi: number;
}

export class Lighting {
  readonly sky: SkyDome;
  private roomEnv: THREE.Texture;
  private interiorEnv: THREE.Texture | null = null;
  private mode: Mode = 'orbit';
  private gi = false;
  private orbitBg = new THREE.Color(0xe4e8ec);
  private planBg = new THREE.Color(0xf4f5f6);
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
    switch (this.mode) {
      case 'plan':
        return { background: this.planBg, backgroundIntensity: 1, environment: this.roomEnv, environmentIntensity: 0.5, hemi: 0.75 * giHemi };
      case 'walk':
        return {
          background: this.sky.background,
          backgroundIntensity: 0.62,
          environment: interior,
          environmentIntensity: this.interiorEnv ? 1 : this.gi ? 0.62 : 0.5,
          hemi: 0.75 * giHemi,
        };
      case 'exterior':
        return {
          background: this.sky.background,
          backgroundIntensity: 0.62,
          environment: this.sky.environment ?? this.roomEnv,
          environmentIntensity: 0.55,
          hemi: 0.45,
        };
      default:
        return {
          background: this.orbitBg,
          backgroundIntensity: 1,
          environment: interior,
          environmentIntensity: this.interiorEnv ? 1 : this.gi ? 0.62 : 0.5,
          hemi: 0.75 * giHemi,
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
