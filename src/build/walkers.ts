import * as THREE from 'three';
import { Rng } from '../core/rng';

/**
 * 通路を歩く人（アニメーション）。静止した在席者はインスタンス描画、歩行者のみ個別メッシュで動かす。
 */

interface Walker {
  root: THREE.Group;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  path: THREE.Vector2[];
  lengths: number[];
  total: number;
  s: number;
  speed: number;
  phase: number;
}

const PATHS: [number, number][][] = [
  [
    [13.6, 10.5],
    [37.0, 10.5],
  ],
  [
    [-13.6, 10.6],
    [-37.0, 10.6],
  ],
  [
    [23.2, -11.2],
    [23.2, 10.2],
    [30.0, 10.3],
  ],
  [
    [-23.2, -11.3],
    [-23.2, 10.2],
  ],
  [
    [17.0, -11.4],
    [36.4, -11.4],
    [36.8, -3.0],
  ],
  [
    [-17.0, -11.6],
    [-36.4, -11.6],
  ],
  [
    [-4.05, 10.4],
    [0, 11.0],
    [4.05, 10.4],
    [8.0, 10.6],
  ],
  [
    [-14.5, -11.3],
    [0, -11.3],
    [0, 1.5],
  ],
  [
    [36.8, -9.5],
    [36.8, 17.9],
    [20.0, 17.95],
  ],
  [
    [-36.8, -9.0],
    [-36.8, 1.4],
  ],
  [
    [-35.0, 17.95],
    [-14.0, 17.95],
  ],
];

const SKIN = [0xf1d3b8, 0xe8c3a0, 0xdcb08c, 0xf3dcc6];
const HAIR = [0x1a1512, 0x2e231b, 0x121212, 0x3b2c20];
const TOPS = [0xf5f5f2, 0xbcd0e6, 0x2f3b52, 0x4a4f57, 0x1f2a3a, 0xe9e1d3, 0x5b6f8f];
const BOTTOMS = [0x1f2633, 0x2b2b2e, 0x3a3f47, 0x5a5f66, 0x7d7466];

function std(color: number, rough = 0.9, key = 'person.misc'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough });
  // Blender 書き出し時にマテリアル種別を判別できるよう「キー#色」で命名
  m.name = `${key}#${color.toString(16).padStart(6, '0')}`;
  return m;
}

function makeFigure(rng: Rng): { root: THREE.Group; legs: THREE.Object3D[]; arms: THREE.Object3D[] } {
  const root = new THREE.Group();
  const skin = std(rng.pick(SKIN), 0.7, 'person.skin');
  const hair = std(rng.pick(HAIR), 0.9, 'person.hair');
  const top = std(rng.pick(TOPS), 0.95, 'person.top');
  const bot = std(rng.pick(BOTTOMS), 0.95, 'person.bottom');
  const shoe = std(0x1e1e1f, 0.6, 'person.shoe');
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    o.castShadow = false; // 影マップは日照変更時のみ更新するため、動く人物は影を落とさない
    return o;
  };
  const hipY = 0.93;
  root.add(mesh(new THREE.SphereGeometry(0.17, 14, 10), bot, 0, hipY + 0.02, 0, 1, 0.6, 0.8));
  root.add(mesh(new THREE.CapsuleGeometry(0.15, 0.3, 4, 12), top, 0, hipY + 0.33, 0, 1.12, 1, 0.72));
  root.add(mesh(new THREE.SphereGeometry(0.155, 14, 10), top, 0, hipY + 0.47, 0, 1.3, 0.5, 0.72));
  for (const s of [-1, 1]) root.add(mesh(new THREE.SphereGeometry(0.011, 8, 6), std(0x141414, 0.3, 'person.eye'), s * 0.032, hipY + 0.732, -0.088));
  root.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), skin, 0, hipY + 0.58, 0));
  root.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), skin, 0, hipY + 0.72, 0, 0.9, 1.05, 0.95));
  root.add(mesh(new THREE.SphereGeometry(0.104, 16, 12), hair, 0, hipY + 0.75, 0.02, 0.93, 0.85, 0.96));
  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.1, hipY, 0);
    leg.add(mesh(new THREE.CapsuleGeometry(0.068, 0.72, 4, 10), bot, 0, -0.42, 0));
    leg.add(mesh(new THREE.BoxGeometry(0.095, 0.07, 0.25), shoe, 0, -0.9, -0.05));
    root.add(leg);
    legs.push(leg);
    const arm = new THREE.Group();
    arm.position.set(s * 0.21, hipY + 0.47, 0);
    arm.add(mesh(new THREE.CapsuleGeometry(0.042, 0.48, 4, 10), top, s * 0.02, -0.28, 0));
    arm.add(mesh(new THREE.SphereGeometry(0.038, 8, 6), skin, s * 0.03, -0.56, 0));
    root.add(arm);
    arms.push(arm);
  }
  return { root, legs, arms };
}

export class Walkers {
  group = new THREE.Group();
  private list: Walker[] = [];
  /** 固定シードで決めた初期の進行度（書き出しを毎回同じにするため） */
  private initial: number[] = [];
  /** true の間は update で進めない（書き出し中） */
  paused = false;

  constructor(seed = 7) {
    this.group.name = 'walkers';
    const rng = new Rng(seed);
    for (const p of PATHS) {
      const f = makeFigure(rng);
      // 往復経路
      const pts = p.map(([x, z]) => new THREE.Vector2(x, z));
      const path = [...pts, ...pts.slice(0, -1).reverse()];
      const lengths: number[] = [];
      let total = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const l = path[i].distanceTo(path[i + 1]);
        lengths.push(l);
        total += l;
      }
      const w: Walker = { ...f, path, lengths, total, s: rng.range(0, total), speed: rng.range(1.05, 1.35), phase: rng.range(0, 6) };
      this.group.add(f.root);
      this.list.push(w);
    }
    this.initial = this.list.map((w) => w.s);
    this.update(0);
  }

  /** 止めて初期位置へ戻す（Blender への書き出し用）。戻す前の進行度を返す */
  rewind(): number[] {
    const prev = this.list.map((w) => w.s);
    this.list.forEach((w, i) => (w.s = this.initial[i]));
    this.update(0);
    this.paused = true;
    return prev;
  }

  /** rewind の前の状態に戻して再開する */
  resume(prev: number[]): void {
    this.list.forEach((w, i) => (w.s = prev[i] ?? w.s));
    this.paused = false;
    this.update(0);
  }

  get count(): number {
    return this.list.length;
  }

  update(dt: number): void {
    if (this.paused) return;
    for (const w of this.list) {
      w.s = (w.s + dt * w.speed) % w.total;
      let s = w.s;
      let i = 0;
      while (i < w.lengths.length - 1 && s > w.lengths[i]) {
        s -= w.lengths[i];
        i++;
      }
      const a = w.path[i];
      const b = w.path[i + 1];
      const t = w.lengths[i] > 0 ? Math.min(1, s / w.lengths[i]) : 0;
      w.root.position.set(a.x + (b.x - a.x) * t, 0, a.y + (b.y - a.y) * t);
      // 進行方向（人は -z を向くモデル）
      const ang = Math.atan2(b.x - a.x, b.y - a.y) + Math.PI;
      w.root.rotation.y = ang;
      const cyc = (w.s / 0.72) * Math.PI + w.phase;
      const sw = Math.sin(cyc) * 0.42;
      w.legs[0].rotation.x = sw;
      w.legs[1].rotation.x = -sw;
      w.arms[0].rotation.x = -sw * 0.8;
      w.arms[1].rotation.x = sw * 0.8;
      w.root.position.y = Math.abs(Math.cos(cyc)) * 0.025;
    }
  }
}
