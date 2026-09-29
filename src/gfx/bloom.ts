import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * 選択的ブルーム：LED 照明・画面・表示灯などの「発光体」だけをにじませる。
 *
 * 発光マテリアルのシェーダーに「発光のみ出力」モードを差し込み、発光体だけを専用レイヤーで
 * 半解像度のターゲットへ描き直す（シーン本体の深度テクスチャで遮蔽判定するので、壁や人の
 * 向こうの画面は光らない）。追加の描画は発光体の数十ドローコールだけで、シーン全体の再描画は不要。
 */

/** 発光体を載せるレイヤー番号（通常描画はレイヤー 0） */
export const EMIT_LAYER = 5;

/** マテリアルキー → にじみの強さ（0 = 対象外） */
function emitGain(key: string): number {
  if (key.startsWith('light.panel') || key.startsWith('light.warm')) return 0.7;
  if (key.startsWith('light.led')) return 1.4;
  if (key.startsWith('exitSign')) return 1.2;
  if (key.startsWith('rack.front')) return 0.8;
  if (key.startsWith('screen.') && !key.startsWith('screen.off')) return 0.38;
  return 0;
}

/** 全発光マテリアルで共有するユニフォーム（参照を共有するので値の切替は 1 か所で済む） */
const shared = {
  uEmitPass: { value: 0 },
  tSceneDepth: { value: null as THREE.Texture | null },
  uEmitDepthScale: { value: new THREE.Vector2(2, 2) },
  uEmitNear: { value: 0.1 },
  uEmitFar: { value: 1000 },
};

const EMIT_PARS = /* glsl */ `
uniform float uEmitPass;
uniform float uEmitGain;
uniform highp sampler2D tSceneDepth;
uniform vec2 uEmitDepthScale;
uniform float uEmitNear;
uniform float uEmitFar;
`;

// 発光のみ出力モード：シーン深度より奥（遮蔽されている）なら捨てる。
// 半解像度で深度を 1 点参照するため、距離に比例した許容差を持たせる。
const EMIT_OUT = /* glsl */ `
if ( uEmitPass > 0.5 ) {
  ivec2 dp = min( ivec2( gl_FragCoord.xy * uEmitDepthScale ), textureSize( tSceneDepth, 0 ) - 1 );
  float sd = texelFetch( tSceneDepth, dp, 0 ).x;
  float sceneDist = isOrthographic ? - orthographicDepthToViewZ( sd, uEmitNear, uEmitFar ) : - perspectiveDepthToViewZ( sd, uEmitNear, uEmitFar );
  if ( vViewPosition.z > sceneDist * 1.004 + 0.015 ) discard;
  gl_FragColor = vec4( totalEmissiveRadiance * uEmitGain, 1.0 );
}
`;

const patched = new WeakSet<THREE.Material>();
const tmpColor = new THREE.Color();

function patchEmitter(mat: THREE.MeshStandardMaterial, gain: number): void {
  if (patched.has(mat)) return;
  patched.add(mat);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uEmitGain: { value: gain } });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${EMIT_PARS}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${EMIT_OUT}`);
  };
  // 全発光マテリアルで同じシェーダー差分なので 1 つのプログラムを共有させる
  mat.customProgramCacheKey = () => 'emit-v1';
}

/**
 * root 以下の発光メッシュを EMIT_LAYER に登録し、マテリアルにパッチを当てる。
 * 戻り値は登録したメッシュ数。
 */
export function registerEmitters(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat.isMeshStandardMaterial) return;
    const gain = emitGain(mat.name);
    if (gain <= 0) return;
    patchEmitter(mat, gain);
    mesh.layers.enable(EMIT_LAYER);
    n++;
  });
  return n;
}

/**
 * 発光体だけを描いて UnrealBloom の多段ぼかしをかけるパス。
 * 結果（ぼかし成分のみ）は `texture` に残り、合成パスが加算する。composer のバッファは触らない。
 */
export class SelectiveBloomPass extends Pass {
  readonly bloom: UnrealBloomPass;
  private emitRT: THREE.WebGLRenderTarget;
  camera: THREE.Camera;
  /** シーン本体の深度（ScenePass のターゲット） */
  depthTexture: THREE.DepthTexture | null = null;

  constructor(
    private scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    super();
    this.camera = camera;
    this.needsSwap = false;
    this.emitRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.emitRT.texture.name = 'bloom.emit';
    // 閾値 0：発光体しか描かないので、描かれたものはすべてにじませる
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0);
  }

  /** ぼかし成分（半解像度） */
  get texture(): THREE.Texture {
    return this.bloom.renderTargetsHorizontal[0].texture;
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.emitRT.setSize(w, h);
    this.bloom.setSize(width, height);
    shared.uEmitDepthScale.value.set(width / w, height / h);
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.depthTexture) return;
    const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    shared.uEmitNear.value = cam.near;
    shared.uEmitFar.value = cam.far;
    shared.tSceneDepth.value = this.depthTexture;
    shared.uEmitPass.value = 1;
    const bg = this.scene.background;
    this.scene.background = null;
    const mask = this.camera.layers.mask;
    this.camera.layers.set(EMIT_LAYER);

    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(tmpColor);
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.emitRT);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(tmpColor, clearAlpha);

    this.camera.layers.mask = mask;
    this.scene.background = bg;
    shared.uEmitPass.value = 0;
    // 通常描画中は深度テクスチャを外す（描画先と同じテクスチャを参照するとフィードバックループになる）
    shared.tSceneDepth.value = null;

    this.bloom.render(renderer, this.emitRT, this.emitRT, 0, false);
  }

  dispose(): void {
    this.emitRT.dispose();
    this.bloom.dispose();
  }
}
