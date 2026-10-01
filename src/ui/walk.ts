import * as THREE from 'three';
import { Box2 } from '../build/layout';

/**
 * ウォークスルー操作：WASD／矢印キーで移動、ドラッグで視点、Shift で早歩き。
 * 壁（扉開口を除く）・柱・大型家具と衝突判定し、壁沿いに滑らせる。
 */
export class WalkControls {
  pos = new THREE.Vector2(0, 5);
  yaw = 0; // 0 = 北（-z）を向く
  pitch = -0.05;
  eye = 1.55;
  enabled = false;
  private keys = new Set<string>();
  private drag: { x: number; y: number } | null = null;
  private moveIntent = new THREE.Vector2();
  // 毎フレームの計算用（割り当てを避ける）
  private tmpP = new THREE.Vector2();
  private tmpAB = new THREE.Vector2();
  private tmpAP = new THREE.Vector2();
  private tmpDir = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  radius = 0.28;

  constructor(
    private camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private colliders: { a: THREE.Vector2; b: THREE.Vector2; t: number }[],
    private obstacles: Box2[],
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.drag = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      this.yaw += dx * 0.0045;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0035, -1.2, 1.1);
    });
    const end = () => (this.drag = null);
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + e.deltaY * 0.03, 35, 90);
        this.camera.updateProjectionMatrix();
      },
      { passive: false },
    );
  }

  /** 画面ボタン（モバイル）からの移動入力 */
  setIntent(forward: number, strafe: number): void {
    this.moveIntent.set(forward, strafe);
  }
  turn(d: number): void {
    this.yaw += d;
  }

  place(x: number, z: number, yaw: number, pitch = -0.05): void {
    this.pos.set(x, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.apply();
  }

  /** その位置に立てるか（壁・柱・家具に当たらないか）。ツアーのカメラ移動量を決めるのに使う */
  free(x: number, z: number): boolean {
    return !this.blocked(this.tmpFree.set(x, z));
  }
  private tmpFree = new THREE.Vector2();

  private blocked(p: THREE.Vector2): boolean {
    const r = this.radius;
    for (const o of this.obstacles) {
      if (p.x > o[0] - r && p.x < o[2] + r && p.y > o[1] - r && p.y < o[3] + r) return true;
    }
    const ab = this.tmpAB;
    const ap = this.tmpAP;
    for (const c of this.colliders) {
      ab.subVectors(c.b, c.a);
      ap.subVectors(p, c.a);
      const t = THREE.MathUtils.clamp(ap.dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
      const cx = c.a.x + ab.x * t;
      const cy = c.a.y + ab.y * t;
      if (Math.hypot(p.x - cx, p.y - cy) < r + c.t / 2) return true;
    }
    return false;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    let f = this.moveIntent.x;
    let s = this.moveIntent.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyA')) s -= 1;
    if (this.keys.has('KeyD')) s += 1;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyQ')) this.yaw -= dt * 1.6;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyE')) this.yaw += dt * 1.6;
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3.2 : 1.5) * dt;
    if (f || s) {
      const fx = Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const dx = (fx * f + -fz * s) * speed;
      const dz = (fz * f + fx * s) * speed;
      const nx = this.tmpP.set(this.pos.x + dx, this.pos.y);
      if (!this.blocked(nx)) this.pos.x = nx.x;
      const nz = this.tmpP.set(this.pos.x, this.pos.y + dz);
      if (!this.blocked(nz)) this.pos.y = nz.y;
    }
    this.apply();
  }

  apply(): void {
    this.camera.position.set(this.pos.x, this.eye, this.pos.y);
    const dir = this.tmpDir.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.lookAt(this.tmpTarget.copy(this.camera.position).add(dir));
  }
}
