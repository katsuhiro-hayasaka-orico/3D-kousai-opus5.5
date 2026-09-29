import * as THREE from 'three';
import type { Part } from './geom';

/**
 * ライトマップ用 UV（uv1 = glTF TEXCOORD_1）。
 *
 * Blender（Cycles）でベイクした間接光・天井照明・天空光を、ブラウザ側で同じ UV に貼るため、
 * UV はコードから決定論的に生成する（ジオメトリの往復なし）。
 *
 *  - floor : 床面。XZ 平面投影（北が画像上端）
 *  - ceil  : 天井面。XZ 平面投影
 *  - wall  : 壁・柱（BoxGeometry）の各面を矩形チャートにしてシェルフパッキング
 *
 * UV の v は「画像上端 = 0」。three.js 側ではライトマップを flipY=false で読み込む。
 * 対象外の面（上下面・非平面・非ボックス）は各アトラスの予約ブロック中心に縮退させ、
 * ベイク後にそのブロックを一定値で塗りつぶす。
 */

export type LmAtlas = 'floor' | 'ceil' | 'wall';

export interface AtlasDef {
  w: number;
  h: number;
  /** 平面投影の範囲 [x0, z0, x1, z1]（floor/ceil のみ） */
  bounds?: [number, number, number, number];
  /** 対象外の面を集める予約ブロック（px, 左上原点）[x, y, size] */
  dummy: [number, number, number];
  /** 1 m あたりの px（wall のみ。パッキング時に決定） */
  density?: number;
}

export const ATLASES: Record<LmAtlas, AtlasDef> = {
  floor: { w: 4096, h: 2048, bounds: [-41.6, -20.8, 41.6, 22.8], dummy: [4, 2028, 16] },
  ceil: { w: 4096, h: 2048, bounds: [-38.8, -19.6, 38.8, 19.6], dummy: [4, 2028, 16] },
  wall: { w: 4096, h: 4096, dummy: [4076, 4076, 16] },
};

/** マテリアルキー → ライトマップアトラス（null = ライトマップなし） */
export function lmAtlasFor(mat: string): LmAtlas | null {
  if (mat.startsWith('floor.')) return 'floor';
  if (mat === 'ceiling') return 'ceil';
  if (mat === 'wall.white' || mat === 'wall.core' || mat === 'wall.movable') return 'wall';
  return null;
}

function dummyUV(a: LmAtlas): [number, number] {
  const d = ATLASES[a];
  return [(d.dummy[0] + d.dummy[2] / 2) / d.w, (d.dummy[1] + d.dummy[2] / 2) / d.h];
}

/** 世界座標（applyMatrix 済み）の非インデックスジオメトリに uv1 を付与 */
export function writeUV1(g: THREE.BufferGeometry, part: Part, atlas: LmAtlas | null): void {
  const pos = g.attributes.position;
  const n = pos.count;
  const uv1 = new Float32Array(n * 2);
  if (atlas && part.uv1 && part.uv1.length === n * 2) {
    uv1.set(part.uv1);
  } else if (atlas && part.lm === atlas && ATLASES[atlas].bounds) {
    const [x0, z0, x1, z1] = ATLASES[atlas].bounds!;
    for (let i = 0; i < n; i++) {
      uv1[i * 2] = (pos.getX(i) - x0) / (x1 - x0);
      uv1[i * 2 + 1] = (pos.getZ(i) - z0) / (z1 - z0);
    }
  } else if (atlas) {
    const [u, v] = dummyUV(atlas);
    for (let i = 0; i < n; i++) {
      uv1[i * 2] = u;
      uv1[i * 2 + 1] = v;
    }
  }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
}

// ------------------------------------------------------------
// 壁アトラス：ボックス面のシェルフパッキング
// ------------------------------------------------------------

interface Chart {
  part: Part;
  face: number; // BoxGeometry の面番号 0..5（px, nx, py, ny, pz, nz）
  uLen: number; // m
  vLen: number; // m
  pw: number; // px（パディング込み）
  ph: number;
  x: number;
  y: number;
}

const PAD = 3;

/**
 * 壁アトラス対象のボックスパーツに uv1（非インデックス 36 頂点分）を割り当てる。
 * 密度（px/m）は全チャートが収まる最大値を二分探索で決める。
 */
export function packWallCharts(parts: Part[]): { density: number; charts: number; fill: number } {
  const atlas = ATLASES.wall;
  const targets = parts.filter((p) => lmAtlasFor(p.mat) === 'wall' && p.geo.type === 'BoxGeometry');
  const charts: Chart[] = [];
  for (const p of targets) {
    const prm = (p.geo as THREE.BoxGeometry).parameters;
    const sizes: [number, number][] = [
      [prm.depth, prm.height],
      [prm.depth, prm.height],
      [prm.width, prm.depth],
      [prm.width, prm.depth],
      [prm.width, prm.height],
      [prm.width, prm.height],
    ];
    sizes.forEach(([u, v], face) => {
      // 上下面（笠木・床下で隠れる）は対象外
      if (face === 2 || face === 3) return;
      charts.push({ part: p, face, uLen: u, vLen: v, pw: 0, ph: 0, x: 0, y: 0 });
    });
  }

  const tryPack = (density: number): boolean => {
    for (const c of charts) {
      c.pw = Math.max(2, Math.ceil(c.uLen * density)) + PAD * 2;
      c.ph = Math.max(2, Math.ceil(c.vLen * density)) + PAD * 2;
    }
    const order = [...charts].sort((a, b) => b.ph - a.ph || b.pw - a.pw);
    const limitX = atlas.w;
    const limitY = atlas.h - (atlas.dummy[2] + 8); // 予約ブロックぶん下を空ける
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const c of order) {
      if (c.pw > limitX) return false;
      if (x + c.pw > limitX) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + c.ph > limitY) return false;
      c.x = x;
      c.y = y;
      x += c.pw;
      rowH = Math.max(rowH, c.ph);
    }
    return true;
  };

  let lo = 4;
  let hi = 200;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (tryPack(mid)) lo = mid;
    else hi = mid;
  }
  const density = Math.floor(lo * 100) / 100;
  tryPack(density);
  atlas.density = density;

  // uv1 書き込み（非インデックス化後の BoxGeometry：面ごと 6 頂点）
  const byPart = new Map<Part, Chart[]>();
  for (const c of charts) {
    if (!byPart.has(c.part)) byPart.set(c.part, []);
    byPart.get(c.part)!.push(c);
  }
  const [du, dv] = dummyUV('wall');
  let usedPx = 0;
  for (const p of targets) {
    const src = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const uv = src.attributes.uv;
    const out = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      out[i * 2] = du;
      out[i * 2 + 1] = dv;
    }
    for (const c of byPart.get(p) ?? []) {
      usedPx += c.pw * c.ph;
      const iw = c.pw - PAD * 2;
      const ih = c.ph - PAD * 2;
      for (let k = 0; k < 6; k++) {
        const vi = c.face * 6 + k;
        const u = uv.getX(vi);
        const v = uv.getY(vi); // BoxGeometry: v=1 が上端
        out[vi * 2] = (c.x + PAD + u * iw) / atlas.w;
        out[vi * 2 + 1] = (c.y + PAD + (1 - v) * ih) / atlas.h;
      }
    }
    p.uv1 = out;
    if (src !== p.geo) src.dispose();
  }
  return { density, charts: charts.length, fill: usedPx / (atlas.w * atlas.h) };
}

// ------------------------------------------------------------
// レイアウトハッシュ（ベイク画像と UV の対応確認用）
// ------------------------------------------------------------

export function lmHash(meshes: THREE.Mesh[]): string {
  let h = 0x811c9dc5;
  const mix = (x: number) => {
    h ^= x;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const sorted = [...meshes].sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const m of sorted) {
    for (const ch of m.name) mix(ch.charCodeAt(0));
    const uv = m.geometry.attributes.uv1 as THREE.BufferAttribute | undefined;
    if (!uv) continue;
    const arr = uv.array as Float32Array;
    mix(arr.length);
    // 量子化して浮動小数の揺れを吸収
    for (let i = 0; i < arr.length; i += 7) mix(Math.round(arr[i] * 65536));
  }
  for (const k of Object.keys(ATLASES) as LmAtlas[]) {
    mix(ATLASES[k].w);
    mix(ATLASES[k].h);
  }
  return h.toString(16).padStart(8, '0');
}
