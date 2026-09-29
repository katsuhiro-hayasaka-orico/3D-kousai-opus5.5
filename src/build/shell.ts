import * as THREE from 'three';
import { PB, floorRectGeo } from '../core/geom';
import { Rng } from '../core/rng';
import { ALL_ROOMS, BALCONIES, Balcony, Side } from '../data/rooms';
import { COLUMN, CORE, CW, GROUND_Y, H, PLATE } from '../data/spec';

/**
 * 建築躯体：床（室ごとの仕上げ）、スラブ、外周柱、カーテンウォール、ブラインド、
 * 2 階外周の庇・バルコニー、階段。
 */

const UV_SCALE: Record<string, number> = {
  'floor.wood': 2,
  'floor.stone': 1.2,
  'floor.stoneDark': 1.2,
  'floor.tile': 1.2,
  'floor.vinyl': 1.2,
  'floor.deck': 2,
};

export function buildFloors(pb: PB): void {
  for (const r of ALL_ROOMS) {
    const [x0, z0, x1, z1] = r.rect;
    const y = r.kind === 'ev' || r.kind === 'shaft' ? 0.002 : 0;
    pb.add(floorRectGeo(x0, z0, x1, z1, y, UV_SCALE[r.floor] ?? 2), r.floor, new THREE.Matrix4(), true, 'floor');
  }
  // 躯体スラブ（厚み表現）
  pb.boxX('floor.slabEdge', PLATE.x0, -0.32, PLATE.z0, PLATE.x1, -0.005, PLATE.z1);
}

/** 外周柱の中心座標一覧（6.4m スパン） */
export function columnCenters(): [number, number][] {
  const out: [number, number][] = [];
  const i = COLUMN.inset;
  const xs: number[] = [];
  for (let x = PLATE.x0; x <= PLATE.x1 + 1e-6; x += COLUMN.span) xs.push(+x.toFixed(3));
  const zs: number[] = [];
  for (let z = PLATE.z0; z <= PLATE.z1 + 1e-6; z += COLUMN.span) zs.push(+z.toFixed(3));
  const clampX = (x: number) => Math.min(PLATE.x1 - i, Math.max(PLATE.x0 + i, x));
  const clampZ = (z: number) => Math.min(PLATE.z1 - i, Math.max(PLATE.z0 + i, z));
  // 南面
  for (const x of xs) out.push([clampX(x), PLATE.z1 - i]);
  // 北面（コア部分を除く）
  for (const x of xs) if (x <= CORE.x0 - 1 || x >= CORE.x1 + 1) out.push([clampX(x), PLATE.z0 + i]);
  // 東西面（隅柱は除く）
  for (const z of zs) {
    if (Math.abs(z - PLATE.z0) < 1e-3 || Math.abs(z - PLATE.z1) < 1e-3) continue;
    out.push([PLATE.x1 - i, clampZ(z)]);
    out.push([PLATE.x0 + i, clampZ(z)]);
  }
  return out;
}

export function buildColumns(pb: PB): number {
  const s = COLUMN.size;
  const cols = columnCenters();
  for (const [x, z] of cols) {
    pb.boxX('wall.core', x - s / 2, -0.1, z - s / 2, x + s / 2, H.ceiling, z + s / 2);
    pb.boxX('wall.cap', x - s / 2, H.ceiling, z - s / 2, x + s / 2, H.ceiling + 0.006, z + s / 2);
    pb.boxX('steel', x - s / 2 - 0.006, 0, z - s / 2 - 0.006, x + s / 2 + 0.006, 0.08, z + s / 2 + 0.006);
  }
  return cols.length;
}

interface FacadeRun {
  side: Side;
  a: number;
  b: number;
  glass: boolean;
}

export const FACADE_RUNS: FacadeRun[] = [
  { side: 's', a: PLATE.x0, b: PLATE.x1, glass: true },
  { side: 'e', a: PLATE.z0, b: PLATE.z1, glass: true },
  { side: 'w', a: PLATE.z0, b: PLATE.z1, glass: true },
  { side: 'n', a: PLATE.x0, b: CORE.x0, glass: true },
  { side: 'n', a: CORE.x0, b: CORE.x1, glass: false },
  { side: 'n', a: CORE.x1, b: PLATE.x1, glass: true },
];

/** 外壁線上の点（along）と外向き法線 */
function facadeFrame(side: Side, along: number): { p: THREE.Vector3; out: THREE.Vector3; ry: number } {
  switch (side) {
    case 's':
      return { p: new THREE.Vector3(along, 0, PLATE.z1), out: new THREE.Vector3(0, 0, 1), ry: 0 };
    case 'n':
      return { p: new THREE.Vector3(along, 0, PLATE.z0), out: new THREE.Vector3(0, 0, -1), ry: Math.PI };
    case 'e':
      return { p: new THREE.Vector3(PLATE.x1, 0, along), out: new THREE.Vector3(1, 0, 0), ry: Math.PI / 2 };
    case 'w':
      return { p: new THREE.Vector3(PLATE.x0, 0, along), out: new THREE.Vector3(-1, 0, 0), ry: -Math.PI / 2 };
  }
}

function balconyDoorAt(side: Side, center: number): boolean {
  return BALCONIES.some((b) => b.side === side && b.doors.some((d) => Math.abs(d - center) < 0.05));
}

/**
 * カーテンウォール（室内側：0〜天井高）。ガラス面は外壁線上、マリオンは室内側へ見付 60・見込 160。
 */
export function buildCurtainWall(pb: PB, rng: Rng): { bays: number } {
  let bays = 0;
  const top = H.ceiling;
  for (const run of FACADE_RUNS) {
    const len = run.b - run.a;
    if (!run.glass) {
      // コア北面：外壁（RC＋外装パネル）
      const f = facadeFrame(run.side, (run.a + run.b) / 2);
      pb.pushT(f.p.x, 0, f.p.z, f.ry);
      pb.boxX('wall.core', -len / 2, -0.1, -0.3, len / 2, top, 0.0);
      pb.boxX('wall.cap', -len / 2, top, -0.3, len / 2, top + 0.006, 0.0);
      pb.boxX('facade.panel', -len / 2, -0.1, 0.0, len / 2, top, 0.06);
      pb.pop();
      continue;
    }
    const n = Math.round(len / CW.mullionPitch);
    for (let i = 0; i < n; i++) {
      const a = run.a + i * CW.mullionPitch;
      const b = a + CW.mullionPitch;
      const c = (a + b) / 2;
      const f = facadeFrame(run.side, c);
      // ローカル：x = 外壁方向（右手系で ry 回転）、+z = 屋外
      pb.pushT(f.p.x, 0, f.p.z, f.ry);
      const w = CW.mullionPitch;
      pb.boxX('glass.cw', -w / 2 + 0.03, 0.05, -0.012, w / 2 - 0.03, top - 0.05, 0.012);
      // 無目（下・上）
      pb.boxX('alu', -w / 2, -0.1, -0.08, w / 2, 0.05, 0.03);
      pb.boxX('alu', -w / 2, top - 0.05, -0.1, w / 2, top, 0.03);
      const isDoor = balconyDoorAt(run.side, c);
      if (isDoor) {
        // バルコニー出入口（両開きガラス框扉）
        pb.boxX('alu.dark', -w / 2 + 0.03, 0.05, -0.04, -w / 2 + 0.09, 2.4, 0.02);
        pb.boxX('alu.dark', w / 2 - 0.09, 0.05, -0.04, w / 2 - 0.03, 2.4, 0.02);
        pb.boxX('alu.dark', -0.03, 0.05, -0.04, 0.03, 2.4, 0.02);
        pb.boxX('alu.dark', -w / 2 + 0.03, 2.36, -0.04, w / 2 - 0.03, 2.42, 0.02);
        pb.boxX('alu.dark', -w / 2 + 0.03, 0.05, -0.04, w / 2 - 0.03, 0.14, 0.02);
        pb.boxX('stainless', -0.12, 0.95, -0.07, -0.1, 1.25, -0.04);
        pb.boxX('stainless', 0.1, 0.95, -0.07, 0.12, 1.25, -0.04);
        pb.boxX('exitSign', -0.2, 2.5, -0.06, 0.2, 2.62, -0.02);
      } else if (run.side !== 'n') {
        // ロールスクリーン（南面は下げ気味）
        const drop = run.side === 's' ? rng.range(0.2, 0.95) : rng.range(0.0, 0.7);
        if (drop > 0.08) {
          pb.boxX('blind', -w / 2 + 0.05, top - 0.08 - drop, -0.16, w / 2 - 0.05, top - 0.08, -0.155);
          pb.boxX('alu', -w / 2 + 0.05, top - 0.1 - drop, -0.17, w / 2 - 0.05, top - 0.08 - drop, -0.145);
        }
        pb.boxX('alu', -w / 2 + 0.03, top - 0.12, -0.2, w / 2 - 0.03, top - 0.05, -0.12);
      }
      pb.pop();
      bays++;
    }
    // マリオン（見付 60・見込 160、室内側）
    for (let i = 0; i <= n; i++) {
      const fm = facadeFrame(run.side, run.a + i * CW.mullionPitch);
      pb.pushT(fm.p.x, 0, fm.p.z, fm.ry);
      pb.boxX('alu', -CW.mullionWidth / 2, -0.1, -CW.mullionDepth, CW.mullionWidth / 2, top, 0.03);
      pb.pop();
    }
  }
  return { bays };
}

/** 2 階外周：連続庇（1.2m）と各バルコニー（2.4m、ガラス手すり・デッキ） */
export function buildLedgeAndBalconies(pb: PB): void {
  const e = CW.eave;
  // 連続庇（2F 床レベル）：四周
  pb.boxX('facade.panel', PLATE.x0 - e, -0.42, PLATE.z1, PLATE.x1 + e, -0.12, PLATE.z1 + e);
  pb.boxX('facade.panel', PLATE.x0 - e, -0.42, PLATE.z0 - e, PLATE.x1 + e, -0.12, PLATE.z0);
  pb.boxX('facade.panel', PLATE.x1, -0.42, PLATE.z0, PLATE.x1 + e, -0.12, PLATE.z1);
  pb.boxX('facade.panel', PLATE.x0 - e, -0.42, PLATE.z0, PLATE.x0, -0.12, PLATE.z1);
  for (const b of BALCONIES) buildBalcony(pb, b, -0.12);
}

function balconyRect(b: Balcony, depth: number): [number, number, number, number] {
  switch (b.side) {
    case 's':
      return [b.from, PLATE.z1, b.to, PLATE.z1 + depth];
    case 'n':
      return [b.from, PLATE.z0 - depth, b.to, PLATE.z0];
    case 'e':
      return [PLATE.x1, b.from, PLATE.x1 + depth, b.to];
    case 'w':
      return [PLATE.x0 - depth, b.from, PLATE.x0, b.to];
  }
}

function buildBalcony(pb: PB, b: Balcony, y: number): void {
  const d = CW.balcony;
  const [x0, z0, x1, z1] = balconyRect(b, d);
  pb.boxX('facade.panel', x0, y - 0.3, z0, x1, y, z1);
  pb.add(floorRectGeo(x0 + 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05, y + 0.06, 2), 'floor.deck', new THREE.Matrix4(), true, 'floor');
  pb.boxX('floor.concrete', x0, y, z0, x1, y + 0.05, z1);
  // 手すり：外側の辺と両端
  const railH = 1.1;
  const edges: [number, number, number, number][] = [];
  if (b.side === 's') edges.push([x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]);
  if (b.side === 'n') edges.push([x0, z0, x1, z0], [x0, z0, x0, z1], [x1, z0, x1, z1]);
  if (b.side === 'e') edges.push([x1, z0, x1, z1], [x0, z0, x1, z0], [x0, z1, x1, z1]);
  if (b.side === 'w') edges.push([x0, z0, x0, z1], [x0, z0, x1, z0], [x0, z1, x1, z1]);
  for (const [ax, az, bx, bz] of edges) {
    const horiz = Math.abs(az - bz) < 1e-4;
    const t = 0.012;
    if (horiz) {
      pb.boxX('rail.glass', ax, y + 0.1, az - t, bx, y + railH - 0.05, az + t);
      pb.boxX('alu', ax, y + railH - 0.05, az - 0.03, bx, y + railH, az + 0.03);
      pb.boxX('alu.dark', ax, y + 0.05, az - 0.03, bx, y + 0.1, az + 0.03);
    } else {
      pb.boxX('rail.glass', ax - t, y + 0.1, az, ax + t, y + railH - 0.05, bz);
      pb.boxX('alu', ax - 0.03, y + railH - 0.05, az, ax + 0.03, y + railH, bz);
      pb.boxX('alu.dark', ax - 0.03, y + 0.05, az, ax + 0.03, y + 0.1, bz);
    }
  }
}

/** 3 階スラブの庇・バルコニー（木目調の軒天）。外観・歩行モードで表示。 */
export function buildUpperEaves(pb: PB): void {
  const e = CW.eave;
  const y = H.floorToFloor - 0.12; // 3F 外部床レベル
  const soffit = (x0: number, z0: number, x1: number, z1: number) => {
    pb.boxX('facade.panel', x0, y - 0.3, z0, x1, y, z1);
    pb.add(floorRectGeo(x0 + 0.02, z0 + 0.02, x1 - 0.02, z1 - 0.02, y - 0.305, 2, true), 'facade.soffit', new THREE.Matrix4(), true);
  };
  soffit(PLATE.x0 - e, PLATE.z1, PLATE.x1 + e, PLATE.z1 + e);
  soffit(PLATE.x0 - e, PLATE.z0 - e, PLATE.x1 + e, PLATE.z0);
  soffit(PLATE.x1, PLATE.z0, PLATE.x1 + e, PLATE.z1);
  soffit(PLATE.x0 - e, PLATE.z0, PLATE.x0, PLATE.z1);
  for (const b of BALCONIES) {
    const [x0, z0, x1, z1] = balconyRect(b, CW.balcony);
    const [ex0, ez0, ex1, ez1] = balconyRect(b, e);
    // 庇より外側に出る部分のみ追加
    if (b.side === 's') soffit(x0, ez1, x1, z1);
    if (b.side === 'n') soffit(x0, z0, x1, ez0);
    if (b.side === 'e') soffit(ex1, z0, x1, z1);
    if (b.side === 'w') soffit(x0, z0, ex0, z1);
  }
  // 天井高より上：スパンドレル・マリオン（外観用）
  const y0 = H.ceiling;
  const y1 = H.floorToFloor - 0.42;
  for (const run of FACADE_RUNS) {
    const len = run.b - run.a;
    const f = facadeFrame(run.side, (run.a + run.b) / 2);
    pb.pushT(f.p.x, 0, f.p.z, f.ry);
    pb.boxX(run.glass ? 'facade.spandrel' : 'facade.panel', -len / 2, y0, -0.05, len / 2, y1, 0.04);
    pb.pop();
    if (!run.glass) {
      const g = facadeFrame(run.side, (run.a + run.b) / 2);
      pb.pushT(g.p.x, 0, g.p.z, g.ry);
      pb.boxX('facade.panel', -len / 2, -0.1, 0.0, len / 2, y1, 0.06);
      pb.pop();
    }
  }
}

/** 階段（2F→3F 上り 1 段目の折返しまで。天井高でカット） */
export function buildStairs(pb: PB): void {
  for (const id of ['STAIR-W', 'STAIR-E']) {
    const r = ALL_ROOMS.find((q) => q.id === id)!;
    const [x0, z0, x1, z1] = r.rect;
    const westStair = id === 'STAIR-W';
    // 付室側（扉側）が上り 1 段目
    const runA: [number, number] = westStair ? [x1 - 1.55, x1 - 0.12] : [x0 + 0.12, x0 + 1.55];
    const runB: [number, number] = westStair ? [x0 + 0.12, x0 + 1.55] : [x1 - 1.55, x1 - 0.12];
    const landingZ = z1 - 2.1; // 階床の踊場（南側）
    const midZ = z0 + 1.75; // 中間踊場（北側）
    const half = H.floorToFloor / 2;
    const nSteps = 14;
    const rise = half / nSteps;
    const tread = (landingZ - midZ) / nSteps;
    // 上り（runA：南→北）
    for (let i = 0; i < nSteps; i++) {
      const yTop = rise * (i + 1);
      if (yTop > H.ceiling) break;
      const za = landingZ - tread * (i + 1);
      const zb = landingZ - tread * i;
      pb.boxX('floor.concrete', runA[0], yTop - 0.18, za, runA[1], yTop, zb);
      pb.boxX('plastic.dark', runA[0], yTop - 0.005, za - 0.005, runA[1], yTop + 0.003, za + 0.04);
    }
    // 中間踊場
    pb.boxX('floor.concrete', x0 + 0.12, half - 0.2, z0 + 0.12, x1 - 0.12, half, midZ);
    // 上り（runB：北→南）
    for (let i = 0; i < nSteps; i++) {
      const yTop = half + rise * (i + 1);
      if (yTop > H.ceiling) break;
      const za = midZ + tread * i;
      const zb = midZ + tread * (i + 1);
      pb.boxX('floor.concrete', runB[0], yTop - 0.18, za, runB[1], yTop, zb);
      pb.boxX('plastic.dark', runB[0], yTop - 0.005, zb - 0.04, runB[1], yTop + 0.003, zb + 0.005);
    }
    // 下り（runB 下部：1F へ）— 開口として暗色で表現
    pb.boxX('floor.shaft', runB[0], -0.02, midZ, runB[1], 0.001, landingZ);
    // 手すり
    const rx = (runA[0] + runA[1]) / 2 + (westStair ? -0.72 : 0.72);
    const hr = 0.85;
    pb.pipe('stainless', 0.02, new THREE.Vector3(rx, hr, landingZ), new THREE.Vector3(rx, half + hr, midZ));
    pb.boxX('steel', rx - 0.02, 0, midZ, rx + 0.02, half + hr, landingZ);
  }
}

/** 外観用：地盤面・新宿通り・街路樹・向かいのビル（すべて概略） */
export function buildSite(pb: PB, trees: { x: number; z: number; s: number }[]): void {
  const y = GROUND_Y;
  pb.add(floorRectGeo(-160, -120, 160, 200, y - 0.02, 4), 'ground', new THREE.Matrix4(), true);
  // 1 階（ポディウム）：ガラスファサード＋コア。2F を地上に接地させる
  pb.boxX('facade.spandrel', PLATE.x0 + 1.6, y, PLATE.z0 + 0.4, PLATE.x1 - 1.6, -0.42, PLATE.z1 - 1.6);
  for (let x = PLATE.x0 + 1.6; x <= PLATE.x1 - 1.6 + 1e-6; x += 3.2) pb.boxX('alu', x - 0.05, y, PLATE.z1 - 1.72, x + 0.05, -0.42, PLATE.z1 - 1.5);
  pb.boxX('facade.panel', CORE.x0, y, PLATE.z0, CORE.x1, -0.42, PLATE.z0 + 0.6);
  for (const x of [PLATE.x0 + 0.55, PLATE.x1 - 0.55]) for (const z of [PLATE.z0 + 0.55, PLATE.z1 - 0.55]) pb.boxX('facade.panel', x - 0.4, y, z - 0.4, x + 0.4, -0.42, z + 0.4);
  for (let x = PLATE.x0 + 6.4; x < PLATE.x1 - 1; x += 6.4) pb.boxX('facade.panel', x - 0.4, y, PLATE.z1 - 0.95, x + 0.4, -0.42, PLATE.z1 - 0.15);
  // 敷地内：前庭・植栽
  pb.add(floorRectGeo(PLATE.x0 - 6, PLATE.z1 + 1.2, PLATE.x1 + 6, 25.5, y, 2), 'paving', new THREE.Matrix4(), true);
  for (const [a, b] of [
    [-34, -14],
    [14, 34],
  ]) {
    pb.boxX('hedge', a, y, 21.5, b, y + 0.9, 23.2);
  }
  // 歩道・車道（新宿通り、幅員約 22m と仮定）
  pb.add(floorRectGeo(-160, 25.5, 160, 30, y + 0.12, 2), 'paving', new THREE.Matrix4(), true);
  pb.boxX('facade.stone', -160, y, 29.85, 160, y + 0.15, 30.0);
  pb.add(floorRectGeo(-160, 30, 160, 52, y + 0.001, 6), 'asphalt', new THREE.Matrix4(), true);
  pb.add(floorRectGeo(-160, 52, 160, 57, y + 0.12, 2), 'paving', new THREE.Matrix4(), true);
  // 区画線
  for (let x = -158; x < 158; x += 8) {
    pb.boxX('lane', x, y + 0.004, 35.4, x + 4, y + 0.01, 35.55);
    pb.boxX('lane', x, y + 0.004, 46.45, x + 4, y + 0.01, 46.6);
  }
  pb.boxX('laneYellow', -160, y + 0.004, 40.9, 160, y + 0.01, 41.05);
  pb.boxX('laneYellow', -160, y + 0.004, 41.15, 160, y + 0.01, 41.3);
  pb.boxX('lane', -160, y + 0.004, 30.4, 160, y + 0.01, 30.55);
  pb.boxX('lane', -160, y + 0.004, 51.45, 160, y + 0.01, 51.6);
  // 街路樹
  for (let x = -150; x <= 150; x += 9) {
    trees.push({ x: x + 2, z: 27.8, s: 1 });
    trees.push({ x: x + 6, z: 54.6, s: 0.95 });
  }
  // 敷地内の植栽（四季折々の植栽：公開情報）
  for (const x of [-36, -30, -24, -18, 18, 24, 30, 36]) trees.push({ x, z: 24.0, s: 0.75 });
  for (const z of [-14, -6, 2, 10]) {
    trees.push({ x: PLATE.x1 + 5, z, s: 0.7 });
    trees.push({ x: PLATE.x0 - 5, z, s: 0.7 });
  }
}

export function treeProto(pb: PB): void {
  pb.cyl('trunk', 0.12, 0.16, 3.2, 0, 1.6, 0, 8);
  pb.sphere('leaf', 1.6, 0, 4.2, 0, 1, 0.85, 1, 10, 8);
  pb.sphere('leaf', 1.2, 0.8, 3.7, 0.4, 1, 0.8, 1, 10, 8);
  pb.sphere('leaf', 1.1, -0.7, 3.8, -0.5, 1, 0.8, 1, 10, 8);
  pb.cyl('facade.stone', 0.6, 0.6, 0.12, 0, 0.06, 0, 16);
}

/** 建物全体のゴースト（他階）と周辺建物（概略） */
export function buildGhost(pb: PB): void {
  const f2f = H.floorToFloor;
  const e = CW.eave;
  // 1 階
  // 3〜11 階（基準階）
  for (let f = 3; f <= 11; f++) {
    const y = (f - 2) * f2f;
    pb.boxX('ghost', PLATE.x0 - e, y - 0.42, PLATE.z0 - e, PLATE.x1 + e, y - 0.12, PLATE.z1 + e);
    pb.boxX('ghost.glass', PLATE.x0, y - 0.12, PLATE.z0, PLATE.x1, y + f2f - 0.42, PLATE.z1);
    for (const b of BALCONIES) {
      const [x0, z0, x1, z1] = balconyRect(b, CW.balcony);
      pb.boxX('ghost', x0, y - 0.42, z0, x1, y - 0.12, z1);
    }
  }
  // 12 階（セットバック：北側ウイング上部は専用テラス）
  const y12 = 10 * f2f;
  pb.boxX('ghost', PLATE.x0 - e, y12 - 0.42, PLATE.z0 - e, PLATE.x1 + e, y12 - 0.12, PLATE.z1 + e);
  pb.boxX('ghost.glass', PLATE.x0, y12 - 0.12, -1.6, PLATE.x1, y12 + f2f - 0.42, PLATE.z1);
  pb.boxX('ghost.glass', CORE.x0, y12 - 0.12, CORE.z0, CORE.x1, y12 + f2f - 0.42, -1.6);
  // 屋上・塔屋（最高高さ 62.166m：公開）
  const roof = 11 * f2f;
  pb.boxX('ghost', PLATE.x0 - e, roof - 0.42, PLATE.z0 - e, PLATE.x1 + e, roof, PLATE.z1 + e);
  const top = 62.166 + GROUND_Y;
  pb.boxX('ghost', CORE.x0 + 2, roof, CORE.z0 + 1, CORE.x1 - 2, top, CORE.z1 - 3);
  // 向かい：麹町ミレニアムガーデン（オリコ本社）— 位置・形状は概略
  pb.boxX('ghost.city', -26, GROUND_Y, 64, 30, GROUND_Y + 88, 100);
  // 周辺街区（概略）
  pb.boxX('ghost.city', -120, GROUND_Y, -70, -52, GROUND_Y + 32, 18);
  pb.boxX('ghost.city', 52, GROUND_Y, -70, 120, GROUND_Y + 38, 18);
  pb.boxX('ghost.city', -40, GROUND_Y, -110, 40, GROUND_Y + 24, -34);
  pb.boxX('ghost.city', -120, GROUND_Y, 64, -34, GROUND_Y + 45, 110);
  pb.boxX('ghost.city', 38, GROUND_Y, 64, 120, GROUND_Y + 36, 110);
}

