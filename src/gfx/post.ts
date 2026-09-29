import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { SelectiveBloomPass } from './bloom';

/**
 * ポストエフェクト（EffectComposer）。
 *
 *   ScenePass（MSAA・HalfFloat・深度テクスチャ）
 *     → AOPass（GTAO：シーン深度から法線を復元。追加のシーン描画なし）
 *     → SelectiveBloomPass（発光体だけ半解像度で再描画してにじませる）
 *     → CompositePass（シーン × AO ＋ ブルーム）
 *     → OutputPass（トーンマッピング・sRGB）
 *     → SMAAPass（画面へ）
 *
 * 画質プリセット：高＝GTAO＋ブルーム＋SMAA（MSAA 4x）、標準＝ブルーム＋SMAA、軽量＝直接描画。
 * ガラス等の半透明は深度を書かないので AO の対象外になる（ガラス越しの床・家具に AO が乗る）。
 */

export type Quality = 'high' | 'standard' | 'low';

export const QUALITIES: { key: Quality; label: string; title: string }[] = [
  { key: 'high', label: '高', title: 'GTAO（接地陰影）＋ブルーム＋SMAA（MSAA 4x）' },
  { key: 'standard', label: '標準', title: 'ブルーム＋SMAA' },
  { key: 'low', label: '軽量', title: 'ポストエフェクトなし（直接描画）' },
];

const STORE_KEY = 'kousai2f.quality';

/** モバイル・低メモリ端末は「標準」、それ以外は「高」。保存済みの選択があればそれを使う */
export function initialQuality(): Quality {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === 'high' || v === 'standard' || v === 'low') return v;
  } catch {
    // ストレージ不可（プライベートモード等）は既定値
  }
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return mobile || (mem !== undefined && mem <= 4) ? 'standard' : 'high';
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(STORE_KEY, q);
  } catch {
    // 保存できなくても動作に支障はない
  }
}

/** AO の効き（メートル単位）。視点の距離感に合わせてモードごとに切り替える */
export interface AOParams {
  radius: number;
  thickness: number;
  intensity: number;
}

// ------------------------------------------------------------
// シーン本体
// ------------------------------------------------------------

class ScenePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;

  constructor(
    private scene: THREE.Scene,
    public camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.target.texture.name = 'post.scene';
  }

  setSamples(n: number): void {
    if (this.target.samples === n) return;
    this.target.samples = n;
    this.target.dispose(); // 次の描画でフレームバッファを作り直す
  }

  setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
  }
}

// ------------------------------------------------------------
// GTAO（シーン深度を共有）
// ------------------------------------------------------------

/** 正射影では視線方向が一定。three の GTAO シェーダーは透視前提の式なので差し替える */
const VIEWDIR_SRC = 'vec3 viewDir = normalize(-viewPos.xyz);';
const VIEWDIR_FIX = `
#if PERSPECTIVE_CAMERA == 1
				vec3 viewDir = normalize(-viewPos.xyz);
#else
				vec3 viewDir = vec3(0.0, 0.0, 1.0);
#endif`;

class AOPass extends Pass {
  readonly gtao: GTAOPass;
  /** AO を計算する解像度の倍率（高 DPI では CSS 画素相当で十分） */
  scale = 1;

  constructor(scene: THREE.Scene, camera: THREE.Camera, depth: THREE.DepthTexture) {
    super();
    this.needsSwap = false;
    this.gtao = new GTAOPass(scene, camera, 1, 1);
    // G バッファを自前で描かず、ScenePass の深度を使う（法線は深度から復元）
    this.gtao.setGBuffer(depth);
    this.gtao.output = GTAOPass.OUTPUT.Off;
    const mat = this.gtao.gtaoMaterial;
    if (mat.fragmentShader.includes(VIEWDIR_SRC)) mat.fragmentShader = mat.fragmentShader.replace(VIEWDIR_SRC, VIEWDIR_FIX);
    this.gtao.updateGtaoMaterial({ samples: 16, distanceExponent: 1.4, distanceFallOff: 1, scale: 1 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  }

  get texture(): THREE.Texture {
    return this.gtao.gtaoMap;
  }

  setCamera(cam: THREE.Camera): void {
    if (this.gtao.camera === cam) return;
    this.gtao.camera = cam;
    const persp = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? 1 : 0;
    for (const m of [this.gtao.gtaoMaterial, this.gtao.depthRenderMaterial]) {
      if (m.defines.PERSPECTIVE_CAMERA !== persp) {
        m.defines.PERSPECTIVE_CAMERA = persp;
        m.needsUpdate = true;
      }
    }
  }

  setParams(p: AOParams): void {
    this.gtao.updateGtaoMaterial({ radius: p.radius, thickness: p.thickness });
  }

  setSize(w: number, h: number): void {
    this.gtao.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.gtao.render(renderer, writeBuffer, readBuffer);
  }

  dispose(): void {
    this.gtao.dispose();
  }
}

// ------------------------------------------------------------
// 合成（シーン × AO ＋ ブルーム）
// ------------------------------------------------------------

function solid(v: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

class CompositePass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  readonly white = solid(255);
  readonly black = solid(0);

  constructor(scene: THREE.Texture) {
    super();
    this.material = new THREE.ShaderMaterial({
      name: 'post.composite',
      uniforms: {
        tScene: { value: scene },
        tAO: { value: this.white },
        tBloom: { value: this.black },
        aoIntensity: { value: 0 },
        bloomIntensity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tAO;
        uniform sampler2D tBloom;
        uniform float aoIntensity;
        uniform float bloomIntensity;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tScene, vUv);
          c.rgb *= mix(1.0, texture2D(tAO, vUv).r, aoIntensity);
          c.rgb += texture2D(tBloom, vUv).rgb * bloomIntensity;
          gl_FragColor = c;
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
    this.white.dispose();
    this.black.dispose();
  }
}

// ------------------------------------------------------------
// パイプライン
// ------------------------------------------------------------

export class PostFX {
  quality: Quality = 'high';
  private composer: EffectComposer;
  private scenePass: ScenePass;
  private ao: AOPass;
  private bloom: SelectiveBloomPass;
  private composite: CompositePass;
  private smaa: SMAAPass;
  private camera: THREE.Camera;
  private aoIntensity = 0.85;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.camera = camera;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(renderer, rt);
    this.scenePass = new ScenePass(scene, camera);
    const depth = this.scenePass.target.depthTexture!;
    this.ao = new AOPass(scene, camera, depth);
    this.bloom = new SelectiveBloomPass(scene, camera);
    this.bloom.depthTexture = depth;
    this.composite = new CompositePass(this.scenePass.target.texture);
    this.smaa = new SMAAPass();
    for (const p of [this.scenePass, this.ao, this.bloom, this.composite, new OutputPass(), this.smaa]) this.composer.addPass(p);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const high = q === 'high';
    this.scenePass.setSamples(high ? Math.min(4, this.renderer.capabilities.maxSamples) : 0);
    this.ao.enabled = high;
    const u = this.composite.material.uniforms;
    u.tAO.value = high ? this.ao.texture : this.composite.white;
    u.aoIntensity.value = high ? this.aoIntensity : 0;
    u.tBloom.value = q === 'low' ? this.composite.black : this.bloom.texture;
    u.bloomIntensity.value = q === 'low' ? 0 : 1;
    this.bloom.enabled = q !== 'low';
  }

  setCamera(cam: THREE.Camera): void {
    this.camera = cam;
    this.scenePass.camera = cam;
    this.bloom.camera = cam;
    this.ao.setCamera(cam);
  }

  setAO(p: AOParams): void {
    this.ao.setParams(p);
    this.aoIntensity = p.intensity;
    if (this.quality === 'high') this.composite.material.uniforms.aoIntensity.value = p.intensity;
  }

  /** w, h は CSS 画素 */
  setSize(w: number, h: number, pixelRatio: number): void {
    this.ao.scale = 1 / Math.max(1, pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    if (this.quality === 'low') {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render(dt);
  }

  dispose(): void {
    for (const p of this.composer.passes) p.dispose();
    this.composer.dispose();
  }
}
