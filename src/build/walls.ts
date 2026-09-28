import * as THREE from 'three';
import { PB, mat4 } from '../core/geom';
import { ALL_ROOMS, Door, DoorType, Room, Side, WallType } from '../data/rooms';
import { H } from '../data/spec';

/**
 * 室定義から壁を生成する。
 *  1) 各室の辺を「線（軸＋座標）」ごとに集める
 *  2) 同一線上の重なりは壁種の優先度で解決（RC > LGS > 可動 > フィルム > ガラス > 腰壁）
 *  3) 扉位置を開口として差し引き、扉・枠・欄間（ヘッダー）を生成
 */

const PRIORITY: Record<WallType, number> = { rc: 6, lgs: 5, movable: 4, film: 3, glass: 2, low: 1 };
const THICK: Record<WallType, number> = { rc: 0.2, lgs: 0.12, movable: 0.1, film: 0.012, glass: 0.012, low: 0.12 };

export interface WallPiece {
  axis: 'h' | 'v'; // h: z 一定（x 方向に延びる）、v: x 一定（z 方向に延びる）
  c: number;
  a: number;
  b: number;
  type: WallType;
}

export interface DoorInfo {
  door: Door;
  room: Room;
  axis: 'h' | 'v';
  c: number;
  a: number;
  b: number;
  /** 室内側（in）方向の法線 */
  inward: THREE.Vector2;
  wallType: WallType;
  height: number;
}

interface RawSeg {
  axis: 'h' | 'v';
  c: number;
  a: number;
  b: number;
  type: WallType;
}

const key = (axis: string, c: number) => `${axis}:${c.toFixed(3)}`;

function sideLine(r: Room, s: Side): { axis: 'h' | 'v'; c: number; a: number; b: number; inward: THREE.Vector2 } {
  const [x0, z0, x1, z1] = r.rect;
  switch (s) {
    case 'n':
      return { axis: 'h', c: z0, a: x0, b: x1, inward: new THREE.Vector2(0, 1) };
    case 's':
      return { axis: 'h', c: z1, a: x0, b: x1, inward: new THREE.Vector2(0, -1) };
    case 'w':
      return { axis: 'v', c: x0, a: z0, b: z1, inward: new THREE.Vector2(1, 0) };
    case 'e':
      return { axis: 'v', c: x1, a: z0, b: z1, inward: new THREE.Vector2(-1, 0) };
  }
}

export function doorHeight(t: DoorType): number {
  switch (t) {
    case 'steel':
    case 'steelDouble':
      return H.steelDoor;
    case 'glass':
    case 'glassSec':
    case 'glassDouble':
      return H.doorTall;
    case 'sliding':
      return 2.2;
    case 'ev':
      return 2.3;
    case 'counter':
      return 2.1;
    case 'opening':
      return 2.4;
    default:
      return H.door;
  }
}

export function solveWalls(rooms: Room[] = ALL_ROOMS): { pieces: WallPiece[]; doors: DoorInfo[] } {
  const lines = new Map<string, RawSeg[]>();
  const doorsByLine = new Map<string, DoorInfo[]>();

  for (const r of rooms) {
    if (r.walls) {
      for (const s of Object.keys(r.walls) as Side[]) {
        const t = r.walls[s]!;
        const L = sideLine(r, s);
        const k = key(L.axis, L.c);
        if (!lines.has(k)) lines.set(k, []);
        lines.get(k)!.push({ axis: L.axis, c: L.c, a: L.a, b: L.b, type: t });
      }
    }
    for (const d of r.doors ?? []) {
      const L = sideLine(r, d.side);
      const k = key(L.axis, L.c);
      if (!doorsByLine.has(k)) doorsByLine.set(k, []);
      doorsByLine.get(k)!.push({
        door: d,
        room: r,
        axis: L.axis,
        c: L.c,
        a: d.at - d.w / 2,
        b: d.at + d.w / 2,
        inward: L.inward,
        wallType: 'lgs',
        height: doorHeight(d.type),
      });
    }
  }

  const pieces: WallPiece[] = [];
  const doors: DoorInfo[] = [];

  for (const [k, segs] of lines) {
    const ds = doorsByLine.get(k) ?? [];
    const pts = new Set<number>();
    for (const s of segs) {
      pts.add(+s.a.toFixed(4));
      pts.add(+s.b.toFixed(4));
    }
    for (const d of ds) {
      pts.add(+d.a.toFixed(4));
      pts.add(+d.b.toFixed(4));
    }
    const sorted = [...pts].sort((p, q) => p - q);
    let cur: WallPiece | null = null;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (b - a < 1e-4) continue;
      const m = (a + b) / 2;
      let best: WallType | null = null;
      for (const s of segs) {
        if (m > s.a && m < s.b && (!best || PRIORITY[s.type] > PRIORITY[best])) best = s.type;
      }
      const inDoor = ds.find((d) => m > d.a && m < d.b);
      if (inDoor && best) inDoor.wallType = best;
      const type = inDoor ? null : best;
      if (type && cur && cur.type === type && Math.abs(cur.b - a) < 1e-4) {
        cur.b = b;
      } else {
        if (cur) pieces.push(cur);
        cur = type ? { axis: segs[0].axis, c: segs[0].c, a, b, type } : null;
      }
    }
    if (cur) pieces.push(cur);
    doors.push(...ds);
  }
  // 壁のない線上の扉（念のため）
  for (const [k, ds] of doorsByLine) if (!lines.has(k)) doors.push(...ds);
  return { pieces, doors };
}

// ------------------------------------------------------------
// ジオメトリ生成
// ------------------------------------------------------------

const TOP = H.ceiling; // 断面カット高さ＝天井高

/** 軸・座標で指定した壁状の箱 */
function wallBox(pb: PB, mat: string, axis: 'h' | 'v', c: number, a: number, b: number, t: number, y0: number, y1: number, offset = 0): void {
  if (b - a < 1e-4 || y1 - y0 < 1e-4) return;
  if (axis === 'h') pb.boxX(mat, a, y0, c - t / 2 + offset, b, y1, c + t / 2 + offset);
  else pb.boxX(mat, c - t / 2 + offset, y0, a, c + t / 2 + offset, y1, b);
}

function wallMat(t: WallType): string {
  switch (t) {
    case 'rc':
      return 'wall.core';
    case 'movable':
      return 'wall.movable';
    default:
      return 'wall.white';
  }
}

function buildWallSpan(pb: PB, w: WallPiece, y0: number, y1: number, withCap: boolean): void {
  const t = THICK[w.type];
  if (w.type === 'glass' || w.type === 'film') {
    const gm = w.type === 'film' ? 'glass.film' : 'glass';
    wallBox(pb, gm, w.axis, w.c, w.a, w.b, 0.012, Math.max(y0, 0.04), Math.min(y1, TOP - 0.06));
    // 上下ランナー（アルミ）
    if (y1 >= TOP - 0.01) wallBox(pb, 'alu', w.axis, w.c, w.a, w.b, 0.05, TOP - 0.06, TOP);
    if (y0 <= 0.01) wallBox(pb, 'alu', w.axis, w.c, w.a, w.b, 0.05, 0, 0.04);
    // 衝突防止マーキング（すりガラス調帯）
    if (w.type === 'glass' && y0 <= 1.0 && y1 >= 1.4) {
      wallBox(pb, 'glass.film', w.axis, w.c, w.a, w.b, 0.016, 1.05, 1.12);
      wallBox(pb, 'glass.film', w.axis, w.c, w.a, w.b, 0.016, 1.3, 1.34);
    }
    // 突付けジョイント（1.2m ピッチ）
    if (y0 <= 0.01) {
      for (let p = w.a + 1.2; p < w.b - 0.3; p += 1.2) {
        if (w.axis === 'h') pb.boxX('alu', p - 0.006, 0.04, w.c - 0.012, p + 0.006, TOP - 0.06, w.c + 0.012);
        else pb.boxX('alu', w.c - 0.012, 0.04, p - 0.006, w.c + 0.012, TOP - 0.06, p + 0.006);
      }
    }
    return;
  }
  const h1 = w.type === 'low' ? Math.min(y1, 1.1) : y1;
  wallBox(pb, wallMat(w.type), w.axis, w.c, w.a, w.b, t, y0, h1);
  if (withCap) wallBox(pb, 'wall.cap', w.axis, w.c, w.a, w.b, t + 0.002, h1, h1 + 0.006);
  // 巾木
  if (y0 <= 0.01 && w.type !== 'rc') wallBox(pb, 'plastic.dark', w.axis, w.c, w.a, w.b, t + 0.012, 0, 0.06);
  if (y0 <= 0.01 && w.type === 'rc') wallBox(pb, 'steel', w.axis, w.c, w.a, w.b, t + 0.012, 0, 0.08);
  if (w.type === 'movable') {
    for (let p = w.a + 1.0; p < w.b - 0.1; p += 1.0) {
      if (w.axis === 'h') pb.boxX('alu.dark', p - 0.008, 0, w.c - 0.055, p + 0.008, TOP, w.c + 0.055);
      else pb.boxX('alu.dark', w.c - 0.055, 0, p - 0.008, w.c + 0.055, TOP, p + 0.008);
    }
    wallBox(pb, 'alu', w.axis, w.c, w.a, w.b, 0.14, TOP - 0.05, TOP);
  }
}

/** 扉の局所座標系：u = 壁方向、n = 室内向き法線 */
function doorFrame(d: DoorInfo) {
  const along = d.axis === 'h' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const inward = new THREE.Vector3(d.inward.x, 0, d.inward.y);
  const center = d.axis === 'h' ? new THREE.Vector3((d.a + d.b) / 2, 0, d.c) : new THREE.Vector3(d.c, 0, (d.a + d.b) / 2);
  // 回転：ローカル x=壁方向、ローカル z=室内向き
  const ry = Math.atan2(inward.x, inward.z);
  return { along, inward, center, ry };
}

function buildDoor(pb: PB, d: DoorInfo): void {
  const t = THICK[d.wallType];
  const w = d.b - d.a;
  const h = d.height;
  const { center, ry } = doorFrame(d);
  const isGlassWall = d.wallType === 'glass' || d.wallType === 'film';

  // 欄間（開口上部）
  const header: WallPiece = { axis: d.axis, c: d.c, a: d.a, b: d.b, type: d.wallType };
  buildWallSpan(pb, header, h, TOP, true);

  pb.pushT(center.x, 0, center.z, ry);
  const leafT = 0.045;
  switch (d.door.type) {
    case 'wood': {
      // 三方枠
      pb.boxX('frame.silver', -w / 2 - 0.03, 0, -t / 2 - 0.01, -w / 2, h, t / 2 + 0.01);
      pb.boxX('frame.silver', w / 2, 0, -t / 2 - 0.01, w / 2 + 0.03, h, t / 2 + 0.01);
      pb.boxX('frame.silver', -w / 2 - 0.03, h - 0.03, -t / 2 - 0.01, w / 2 + 0.03, h, t / 2 + 0.01);
      pb.boxX('door.wood', -w / 2 + 0.005, 0.01, -leafT / 2, w / 2 - 0.005, h - 0.03, leafT / 2);
      lever(pb, w / 2 - 0.08, leafT);
      break;
    }
    case 'steel':
    case 'steelDouble': {
      pb.boxX('steel', -w / 2 - 0.04, 0, -t / 2 - 0.01, -w / 2, h + 0.04, t / 2 + 0.01);
      pb.boxX('steel', w / 2, 0, -t / 2 - 0.01, w / 2 + 0.04, h + 0.04, t / 2 + 0.01);
      pb.boxX('steel', -w / 2 - 0.04, h, -t / 2 - 0.01, w / 2 + 0.04, h + 0.04, t / 2 + 0.01);
      if (d.door.type === 'steel') {
        pb.boxX('steelDoor', -w / 2 + 0.005, 0.01, -leafT / 2, w / 2 - 0.005, h - 0.005, leafT / 2);
        lever(pb, w / 2 - 0.08, leafT);
      } else {
        pb.boxX('steelDoor', -w / 2 + 0.005, 0.01, -leafT / 2, -0.004, h - 0.005, leafT / 2);
        pb.boxX('steelDoor', 0.004, 0.01, -leafT / 2, w / 2 - 0.005, h - 0.005, leafT / 2);
        lever(pb, -0.08, leafT);
        lever(pb, 0.08, leafT);
      }
      break;
    }
    case 'glass':
    case 'glassSec': {
      if (!isGlassWall) {
        pb.boxX('alu', -w / 2 - 0.04, 0, -t / 2 - 0.01, -w / 2, h, t / 2 + 0.01);
        pb.boxX('alu', w / 2, 0, -t / 2 - 0.01, w / 2 + 0.04, h, t / 2 + 0.01);
      }
      pb.boxX('alu', -w / 2, h - 0.05, -0.03, w / 2, h, 0.03);
      pb.boxX(d.wallType === 'film' ? 'glass.film' : 'glass', -w / 2 + 0.01, 0.02, -0.006, w / 2 - 0.01, h - 0.05, 0.006);
      pb.boxX('alu', -w / 2 + 0.01, 0.0, -0.02, w / 2 - 0.01, 0.06, 0.02);
      // 縦長バーハンドル
      pb.boxX('stainless', w / 2 - 0.1, 0.7, 0.03, w / 2 - 0.08, 1.5, 0.05);
      pb.boxX('stainless', w / 2 - 0.1, 0.7, -0.05, w / 2 - 0.08, 1.5, -0.03);
      break;
    }
    case 'glassDouble': {
      pb.boxX('alu', -w / 2, h - 0.06, -0.035, w / 2, h, 0.035);
      for (const s of [-1, 1]) {
        pb.boxX('glass', s < 0 ? -w / 2 + 0.01 : 0.006, 0.02, -0.006, s < 0 ? -0.006 : w / 2 - 0.01, h - 0.06, 0.006);
        pb.boxX('stainless', s * 0.07 - 0.012, 0.6, 0.03, s * 0.07 + 0.012, 1.8, 0.055);
        pb.boxX('stainless', s * 0.07 - 0.012, 0.6, -0.055, s * 0.07 + 0.012, 1.8, -0.03);
      }
      pb.boxX('alu', -w / 2, 0, -0.03, w / 2, 0.02, 0.03);
      break;
    }
    case 'sliding': {
      pb.boxX('frame.silver', -w / 2 - 0.03, 0, -t / 2 - 0.01, -w / 2, h, t / 2 + 0.01);
      pb.boxX('frame.silver', w / 2, 0, -t / 2 - 0.01, w / 2 + 0.03, h, t / 2 + 0.01);
      pb.boxX('door.wood', -w / 2, 0.01, -t / 2 - 0.05, w / 2, h - 0.02, -t / 2 - 0.01);
      pb.boxX('stainless', w / 2 - 0.12, 0.9, -t / 2 - 0.07, w / 2 - 0.1, 1.2, -t / 2 - 0.05);
      pb.boxX('alu', -w / 2 - 0.1, h, -t / 2 - 0.06, w / 2 + w, h + 0.05, -t / 2 - 0.01);
      break;
    }
    case 'counter': {
      // 腰壁＋カウンター天板
      pb.boxX('wall.white', -w / 2, 0, -t / 2, w / 2, 0.95, t / 2);
      pb.boxX('wood.mid', -w / 2 - 0.02, 0.95, -t / 2 - 0.12, w / 2 + 0.02, 0.985, t / 2 + 0.32);
      pb.boxX('frame.silver', -w / 2 - 0.03, 0, -t / 2 - 0.01, -w / 2, h, t / 2 + 0.01);
      pb.boxX('frame.silver', w / 2, 0, -t / 2 - 0.01, w / 2 + 0.03, h, t / 2 + 0.01);
      break;
    }
    case 'ev': {
      buildEvDoor(pb, w, h, t);
      break;
    }
    case 'opening':
      pb.boxX('frame.silver', -w / 2 - 0.03, 0, -t / 2 - 0.01, -w / 2, h, t / 2 + 0.01);
      pb.boxX('frame.silver', w / 2, 0, -t / 2 - 0.01, w / 2 + 0.03, h, t / 2 + 0.01);
      break;
  }
  // カードリーダー（室外側・扉脇）
  if (d.door.reader) {
    pb.boxX('plastic.black', w / 2 + 0.14, 1.02, -t / 2 - 0.03, w / 2 + 0.22, 1.16, -t / 2 - 0.005);
    pb.boxX('light.ledBlue', w / 2 + 0.165, 1.13, -t / 2 - 0.035, w / 2 + 0.195, 1.145, -t / 2 - 0.029);
    pb.boxX('plastic.black', w / 2 + 0.14, 1.02, t / 2 + 0.005, w / 2 + 0.22, 1.16, t / 2 + 0.03);
  }
  pb.pop();
}

function lever(pb: PB, x: number, leafT: number): void {
  for (const s of [-1, 1]) {
    pb.boxX('stainless', x - 0.02, 0.98, s * (leafT / 2) - 0.004 * s, x + 0.02, 1.06, s * (leafT / 2 + 0.03));
    pb.boxX('stainless', x - 0.12, 1.0, s * (leafT / 2 + 0.025) - 0.008, x + 0.02, 1.03, s * (leafT / 2 + 0.035));
  }
}

/** EV 扉（ホール側＝ローカル -z 側。シャフト室の外側がホール） */
function buildEvDoor(pb: PB, w: number, h: number, t: number): void {
  const zf = -t / 2 - 0.005; // ホール側の面
  // 三方枠（ステンレス）
  pb.boxX('stainless', -w / 2 - 0.12, 0, zf - 0.03, -w / 2, h + 0.12, zf + 0.01);
  pb.boxX('stainless', w / 2, 0, zf - 0.03, w / 2 + 0.12, h + 0.12, zf + 0.01);
  pb.boxX('stainless', -w / 2 - 0.12, h, zf - 0.03, w / 2 + 0.12, h + 0.12, zf + 0.01);
  // 戸（センターオープン 2 枚）
  pb.boxX('stainless', -w / 2, 0.01, zf - 0.015, -0.003, h, zf + 0.02);
  pb.boxX('stainless', 0.003, 0.01, zf - 0.015, w / 2, h, zf + 0.02);
  // 敷居
  pb.boxX('alu.dark', -w / 2 - 0.05, 0, zf - 0.08, w / 2 + 0.05, 0.005, zf);
  // インジケーター
  pb.boxX('plastic.black', -0.2, h + 0.2, zf - 0.02, 0.2, h + 0.34, zf + 0.005);
  pb.boxX('light.warm', -0.08, h + 0.24, zf - 0.024, 0.08, h + 0.3, zf - 0.018);
  // 乗場ボタン
  pb.boxX('stainless', w / 2 + 0.25, 1.05, zf - 0.015, w / 2 + 0.35, 1.3, zf);
  pb.boxX('light.warm', w / 2 + 0.28, 1.2, zf - 0.02, w / 2 + 0.32, 1.24, zf - 0.014);
  pb.boxX('light.warm', w / 2 + 0.28, 1.1, zf - 0.02, w / 2 + 0.32, 1.14, zf - 0.014);
  // ホールランタン
  pb.boxX('plastic.black', -0.25, h + 0.42, zf - 0.03, 0.25, h + 0.48, zf);
}

export interface WallBuild {
  pb: PB;
  pieces: WallPiece[];
  doors: DoorInfo[];
}

export function buildWalls(rooms: Room[] = ALL_ROOMS): WallBuild {
  const { pieces, doors } = solveWalls(rooms);
  const pb = new PB();
  for (const w of pieces) buildWallSpan(pb, w, -0.1, TOP, true);
  for (const d of doors) buildDoor(pb, d);
  return { pb, pieces, doors };
}

/** 平面図用：扉の開き軌跡（床上の線） */
export function doorSwingLines(doors: DoorInfo[]): THREE.BufferGeometry {
  const pts: number[] = [];
  const seg = 12;
  for (const d of doors) {
    const t = d.door.type;
    if (t === 'opening' || t === 'counter' || t === 'ev') continue;
    const w = d.b - d.a;
    const { center, ry } = doorFrame(d);
    const m = mat4(center.x, 0.012, center.z, 0, ry, 0);
    const dir = d.door.swing === 'out' ? -1 : 1; // +z ローカル = 室内
    const leaves: { hinge: number; len: number; sgn: number }[] =
      t === 'steelDouble' || t === 'glassDouble'
        ? [
            { hinge: -w / 2, len: w / 2, sgn: 1 },
            { hinge: w / 2, len: w / 2, sgn: -1 },
          ]
        : t === 'sliding'
          ? []
          : [{ hinge: -w / 2, len: w, sgn: 1 }];
    for (const L of leaves) {
      const v = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyMatrix4(m);
      let prev = v(L.hinge + L.sgn * L.len, 0);
      for (let i = 1; i <= seg; i++) {
        const a = (i / seg) * (Math.PI / 2);
        const p = v(L.hinge + L.sgn * Math.cos(a) * L.len, dir * Math.sin(a) * L.len);
        pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
      const hp = v(L.hinge, 0);
      pts.push(hp.x, hp.y, hp.z, prev.x, prev.y, prev.z);
    }
    if (t === 'sliding') {
      const a = new THREE.Vector3(-w / 2, 0, -0.15).applyMatrix4(m);
      const b = new THREE.Vector3(w * 1.5, 0, -0.15).applyMatrix4(m);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** 歩行モード用の衝突線分（扉開口は除く） */
export function wallColliders(pieces: WallPiece[]): { a: THREE.Vector2; b: THREE.Vector2; t: number }[] {
  return pieces.map((w) => ({
    a: w.axis === 'h' ? new THREE.Vector2(w.a, w.c) : new THREE.Vector2(w.c, w.a),
    b: w.axis === 'h' ? new THREE.Vector2(w.b, w.c) : new THREE.Vector2(w.c, w.b),
    t: THICK[w.type],
  }));
}

