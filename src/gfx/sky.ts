import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/**
 * 物理ベースの空（Preetham モデル、three の Sky シェーダー）。
 *
 * 毎フレーム空を描く代わりに、太陽が動いたときだけキューブマップへ焼き、
 *  - 背景（外観・ウォークスルーの窓の外）
 *  - PMREM 環境マップ（外観時のガラス・金属の映り込みと拡散光）
 * の両方に使う。背景の明るさは scene.backgroundIntensity で調整できる。
 */
export class SkyDome {
  private sky = new Sky();
  private skyScene = new THREE.Scene();
  private cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  private cubeCam = new THREE.CubeCamera(1, 1000, this.cubeRT);
  private envRT: THREE.WebGLRenderTarget | null = null;
  private dirty = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private pmrem: THREE.PMREMGenerator,
  ) {
    this.sky.scale.setScalar(500);
    const u = this.sky.material.uniforms;
    // 都心の晴天（やや霞あり）
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.78;
    this.skyScene.add(this.sky);
  }

  /** 太陽方向（three.js 座標の単位ベクトル） */
  setSun(dir: THREE.Vector3): void {
    this.sky.material.uniforms.sunPosition.value.copy(dir);
    this.dirty = true;
  }

  /** 必要なら空を焼き直す（太陽を動かしたフレームだけ実行される） */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.cubeCam.update(this.renderer, this.skyScene);
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
  }

  get background(): THREE.Texture {
    return this.cubeRT.texture;
  }

  /** PMREM 化した空。update() 前は null */
  get environment(): THREE.Texture | null {
    return this.envRT?.texture ?? null;
  }
}
