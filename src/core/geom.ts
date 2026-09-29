import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M } from './materials';
import { LmAtlas, lmAtlasFor, writeUV1 } from './lightmap';

/** 1 パーツ = ジオメトリ + マテリアルキー + ローカル行列 */
export interface Part {
  geo: THREE.BufferGeometry;
  mat: string;
  m: THREE.Matrix4;
  noShadow?: boolean;
  /** 平面投影でライトマップを受ける面（床・天井） */
  lm?: LmAtlas;
  /** パッキング済みライトマップ UV（非インデックス頂点順） */
  uv1?: Float32Array;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export const G = {
  box: (w: number, h: number, d: number) =>
    cached(`b${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt: number, rb: number, h: number, seg = 16) =>
    cached(`c${rt.toFixed(4)},${rb.toFixed(4)},${h.toFixed(4)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  sphere: (r: number, ws = 16, hs = 12) => cached(`s${r.toFixed(4)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  capsule: (r: number, len: number, seg = 6) =>
    cached(`k${r.toFixed(4)},${len.toFixed(4)},${seg}`, () => new THREE.CapsuleGeometry(r, len, seg, 10)),
  torus: (r: number, tube: number, arc = Math.PI * 2, rs = 8, ts = 20) =>
    cached(`t${r},${tube},${arc.toFixed(3)},${rs},${ts}`, () => new THREE.TorusGeometry(r, tube, rs, ts, arc)),
  plane: (w: number, h: number) => cached(`p${w.toFixed(4)},${h.toFixed(4)}`, () => new THREE.PlaneGeometry(w, h)),
  ico: (r: number, detail = 1) => cached(`i${r.toFixed(4)},${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
};

const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export function mat4(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  tmpE.set(rx, ry, rz, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpP.set(x, y, z);
  tmpS.set(sx, sy, sz);
  return new THREE.Matrix4().compose(tmpP, tmpQ, tmpS);
}

/**
 * パーツビルダー。変換スタックを持ち、家具プロトタイプや静的ジオメトリを組み立てる。
 * 座標はすべて「中心」指定（box の y も中心）。boxB は底面基準。
 */
export class PB {
  parts: Part[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  private get top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  push(m: THREE.Matrix4): this {
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }
  pushT(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): this {
    return this.push(mat4(x, y, z, rx, ry, rz));
  }
  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }
  within(x: number, y: number, z: number, ry: number, fn: () => void): this {
    this.pushT(x, y, z, ry);
    fn();
    this.pop();
    return this;
  }

  add(geo: THREE.BufferGeometry, mat: string, local: THREE.Matrix4, noShadow = false, lm?: LmAtlas): this {
    this.parts.push({ geo, mat, m: this.top.clone().multiply(local), noShadow, lm });
    return this;
  }

  box(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    return this.add(G.box(w, h, d), mat, mat4(x, y, z, rx, ry, rz));
  }
  /** 底面 y0 基準の箱 */
  boxB(mat: string, w: number, h: number, d: number, x: number, y0: number, z: number, ry = 0): this {
    return this.add(G.box(w, h, d), mat, mat4(x, y0 + h / 2, z, 0, ry, 0));
  }
  /** 2 点間の箱（x0..x1, y0..y1, z0..z1） */
  boxX(mat: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return this;
    return this.add(G.box(w, h, d), mat, mat4((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  }
  cyl(mat: string, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 16, rx = 0, ry = 0, rz = 0): this {
    return this.add(G.cyl(rt, rb, h, seg), mat, mat4(x, y, z, rx, ry, rz));
  }
  sphere(mat: string, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ws = 14, hs = 10): this {
    return this.add(G.sphere(r, ws, hs), mat, mat4(x, y, z, 0, 0, 0, sx, sy, sz));
  }
  capsule(mat: string, r: number, len: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    return this.add(G.capsule(r, len), mat, mat4(x, y, z, rx, ry, rz));
  }
  /** 鉛直面の板（PlaneGeometry、+z 向き） */
  plane(mat: string, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0): this {
    return this.add(G.plane(w, h), mat, mat4(x, y, z, rx, ry, 0), true);
  }
  /** 2 点を結ぶ円柱（パイプ・手すり） */
  pipe(mat: string, r: number, a: THREE.Vector3, b: THREE.Vector3, seg = 8): this {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-5) return this;
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    return this.add(G.cyl(r, r, len, seg), mat, m);
  }
}

/** ジオメトリを position/normal/uv のみ・非インデックスに正規化 */
function normalizeGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.attributes.uv) {
    const n = out.attributes.position.count;
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  out.morphAttributes = {};
  return out;
}

/** パーツをマテリアルごとに 1 ジオメトリへマージ（lightmap=true なら uv1 を付与） */
export function mergeByMaterial(parts: Part[], lightmap = false): Map<string, { geo: THREE.BufferGeometry; noShadow: boolean }> {
  const byMat = new Map<string, { geos: THREE.BufferGeometry[]; noShadow: boolean }>();
  for (const p of parts) {
    const g = normalizeGeo(p.geo);
    g.applyMatrix4(p.m);
    if (lightmap) writeUV1(g, p, lmAtlasFor(p.mat));
    let e = byMat.get(p.mat);
    if (!e) {
      e = { geos: [], noShadow: true };
      byMat.set(p.mat, e);
    }
    e.geos.push(g);
    if (!p.noShadow) e.noShadow = false;
  }
  const out = new Map<string, { geo: THREE.BufferGeometry; noShadow: boolean }>();
  for (const [k, e] of byMat) {
    const merged = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    out.set(k, { geo: merged, noShadow: e.noShadow });
    for (const g of e.geos) if (g !== merged) g.dispose();
  }
  return out;
}

/** 静的ジオメトリ（建築躯体など）を Mesh 群にする */
export function buildStatic(pb: PB, name: string, opts: { cast?: boolean; receive?: boolean; lightmap?: boolean } = {}): THREE.Group {
  const grp = new THREE.Group();
  grp.name = name;
  for (const [mk, { geo, noShadow }] of mergeByMaterial(pb.parts, !!opts.lightmap)) {
    const mat = M(mk);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${name}:${mk}`;
    const isGlass = !!mat.userData.isGlass;
    mesh.castShadow = (opts.cast ?? true) && !isGlass && !noShadow;
    mesh.receiveShadow = opts.receive ?? true;
    if (isGlass) mesh.renderOrder = 2;
    mesh.userData.matKey = mk;
    if (opts.lightmap) {
      const atlas = lmAtlasFor(mk);
      if (atlas) mesh.userData.lmAtlas = atlas;
      else geo.deleteAttribute('uv1');
    }
    grp.add(mesh);
  }
  return grp;
}

/** 世界座標スケールの UV を持つ水平矩形（床・天井） */
export function floorRectGeo(x0: number, z0: number, x1: number, z1: number, y: number, uvScale: number, down = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
  const ny = down ? -1 : 1;
  const uv: number[] = [];
  for (let i = 0; i < 4; i++) uv.push(pos[i * 3] / uvScale, -pos[i * 3 + 2] / uvScale);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, ny, 0, 0, ny, 0, 0, ny, 0, 0, ny, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(down ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]); // 上向き: +y 法線で反時計回り
  return g;
}

/** ポリゴン（XZ 平面）の床 */
export function floorPolyGeo(pts: [number, number][], y: number, uvScale: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / uvScale;
    uv[i * 2 + 1] = -pos.getZ(i) / uvScale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
