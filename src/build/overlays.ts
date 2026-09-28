import * as THREE from 'three';
import { floorRectGeo } from '../core/geom';
import { M } from '../core/materials';
import { ALL_ROOMS, TENANT_ROOMS } from '../data/rooms';
import { GRID, PLATE } from '../data/spec';
import { acZoneRects } from './ceiling';
import { DoorInfo, doorSwingLines } from './walls';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 平面図・分析用オーバーレイ（ゾーン着色、空調ゾーン、Wi-Fi、避難経路、通り芯） */

function lineMat(color: number, opacity = 1, dashed = false): THREE.LineBasicMaterial | THREE.LineDashedMaterial {
  const p = { color, transparent: opacity < 1, opacity, depthWrite: false };
  return dashed ? new THREE.LineDashedMaterial({ ...p, dashSize: 0.6, gapSize: 0.35 }) : new THREE.LineBasicMaterial(p);
}

function rectOutline(x0: number, z0: number, x1: number, z1: number, y: number): number[] {
  return [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0];
}

export function buildZoneOverlay(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'overlay:zones';
  const by = new Map<string, THREE.BufferGeometry[]>();
  for (const r of ALL_ROOMS) {
    if (r.kind === 'ev' || r.kind === 'shaft') continue;
    const [x0, z0, x1, z1] = r.rect;
    const k = r.group;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(floorRectGeo(x0 + 0.04, z0 + 0.04, x1 - 0.04, z1 - 0.04, 0.03, 2));
  }
  for (const [k, geos] of by) {
    const m = new THREE.Mesh(mergeGeometries(geos)!, M('ov.' + k));
    m.renderOrder = 3;
    g.add(m);
  }
  const pts: number[] = [];
  for (const r of TENANT_ROOMS) pts.push(...rectOutline(r.rect[0], r.rect[1], r.rect[2], r.rect[3], 0.035));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lg, lineMat(0x222222, 0.35)));
  return g;
}

export function buildAcOverlay(ac: { x: number; z: number; zone: number }[]): { group: THREE.Group; centers: { id: number; x: number; z: number; units: number }[] } {
  const g = new THREE.Group();
  g.name = 'overlay:ac';
  const rects = acZoneRects();
  const palette = [0x4e79a7, 0xf28e2b, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc948, 0xb07aa1, 0xff9da7, 0x9c755f, 0xbab0ac];
  const centers: { id: number; x: number; z: number; units: number }[] = [];
  for (const z of rects) {
    const [x0, z0, x1, z1] = z.rect;
    const color = palette[z.id % palette.length];
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false });
    const mesh = new THREE.Mesh(floorRectGeo(x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, 0.04 + (z.id > 28 ? 0.01 : 0), 2), mat);
    mesh.renderOrder = 3;
    g.add(mesh);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(rectOutline(x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, 0.05), 3));
    g.add(new THREE.LineSegments(lg, lineMat(color, 0.9)));
    centers.push({ id: z.id, x: (x0 + x1) / 2, z: (z0 + z1) / 2, units: ac.filter((a) => a.zone === z.id).length });
  }
  // カセット位置マーカー
  const mk = new THREE.MeshBasicMaterial({ color: 0x1565c0, transparent: true, opacity: 0.85, depthWrite: false });
  for (const a of ac) {
    const m = new THREE.Mesh(floorRectGeo(a.x - 0.48, a.z - 0.48, a.x + 0.48, a.z + 0.48, 0.06, 1), mk);
    m.renderOrder = 4;
    g.add(m);
  }
  return { group: g, centers };
}

export function buildWifiOverlay(ap: { x: number; z: number }[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'overlay:wifi';
  const disc = new THREE.CircleGeometry(7.5, 48);
  disc.rotateX(-Math.PI / 2);
  const inner = new THREE.CircleGeometry(4.0, 40);
  inner.rotateX(-Math.PI / 2);
  const mOuter = new THREE.MeshBasicMaterial({ color: 0x00a3a3, transparent: true, opacity: 0.1, depthWrite: false });
  const mInner = new THREE.MeshBasicMaterial({ color: 0x00a3a3, transparent: true, opacity: 0.16, depthWrite: false });
  const mDot = new THREE.MeshBasicMaterial({ color: 0x006d6d });
  const dot = new THREE.CircleGeometry(0.28, 16);
  dot.rotateX(-Math.PI / 2);
  for (const p of ap) {
    const a = new THREE.Mesh(disc, mOuter);
    a.position.set(p.x, 0.045, p.z);
    a.renderOrder = 3;
    const b = new THREE.Mesh(inner, mInner);
    b.position.set(p.x, 0.05, p.z);
    b.renderOrder = 3;
    const c = new THREE.Mesh(dot, mDot);
    c.position.set(p.x, 0.06, p.z);
    c.renderOrder = 4;
    g.add(a, b, c);
  }
  return g;
}

/** 避難経路：各エリア → 通用口 → 共用廊下 → 付室 → 特別避難階段 */
export const EVAC_ROUTES: [number, number][][] = [
  // 東：南執務 → 通路 A2 → A3 → 通用口（東）→ 廊下 → 付室東 → 階段東
  [
    [30, 10.5],
    [23.2, 10.5],
    [23.2, -11.5],
    [16, -11.5],
    [11.2, -11.3],
    [11.2, -14.2],
    [13.8, -14.2],
  ],
  [
    [36.8, -11.5],
    [16, -11.5],
  ],
  // 西
  [
    [-30, 10.5],
    [-23.2, 10.5],
    [-23.2, -11.5],
    [-16, -11.5],
    [-11.2, -11.3],
    [-11.2, -14.2],
    [-13.8, -14.2],
  ],
  [
    [-36.8, -11.5],
    [-16, -11.5],
  ],
  // ラウンジ → セキュリティドア → エントランス → EV ホール → 廊下
  [
    [0, 13.0],
    [4.05, 10.5],
    [4.05, 8.8],
    [0, 7.5],
    [0, 2.5],
    [0, -11.3],
  ],
  [
    [-4.05, 10.5],
    [-4.05, 8.8],
    [0, 7.5],
  ],
];

export function buildEvacOverlay(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'overlay:evac';
  const mat = new THREE.MeshBasicMaterial({ color: 0x1b9e3e, transparent: true, opacity: 0.9, depthWrite: false });
  const geos: THREE.BufferGeometry[] = [];
  for (const route of EVAC_ROUTES) {
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, az] = route[i];
      const [bx, bz] = route[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bx - ax, bz - az);
      // 矢印を 1.6m ごとに配置
      for (let d = 0.8; d < len; d += 1.6) {
        const t = d / len;
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.35);
        shape.lineTo(0.28, -0.1);
        shape.lineTo(0.1, -0.1);
        shape.lineTo(0.1, -0.35);
        shape.lineTo(-0.1, -0.35);
        shape.lineTo(-0.1, -0.1);
        shape.lineTo(-0.28, -0.1);
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        geo.rotateY(ang + Math.PI);
        geo.translate(ax + (bx - ax) * t, 0.07, az + (bz - az) * t);
        geos.push(geo);
      }
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
  mesh.renderOrder = 5;
  g.add(mesh);
  return g;
}

/** 通り芯（3.2m グリッド）＋扉の開き軌跡 */
export function buildPlanLines(doors: DoorInfo[]): { group: THREE.Group; axes: { name: string; x: number; z: number }[] } {
  const g = new THREE.Group();
  g.name = 'overlay:plan';
  const pts: number[] = [];
  const axes: { name: string; x: number; z: number }[] = [];
  const nx = Math.round((PLATE.x1 - PLATE.x0) / GRID);
  const nz = Math.round((PLATE.z1 - PLATE.z0) / GRID);
  for (let i = 0; i <= nx; i++) {
    const x = PLATE.x0 + i * GRID;
    pts.push(x, 0.02, PLATE.z0 - 3.2, x, 0.02, PLATE.z1 + 3.2);
    if (i % 2 === 0) axes.push({ name: `X${i / 2 + 1}`, x, z: PLATE.z1 + 4.4 });
  }
  for (let j = 0; j <= nz; j++) {
    const z = PLATE.z0 + j * GRID;
    pts.push(PLATE.x0 - 3.2, 0.02, z, PLATE.x1 + 3.2, 0.02, z);
    if (j % 2 === 0) axes.push({ name: `Y${nz / 2 - j / 2 + 1}`, x: PLATE.x0 - 4.6, z });
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(lg, lineMat(0xc0392b, 0.28, true));
  lines.computeLineDistances();
  g.add(lines);
  const sw = new THREE.LineSegments(doorSwingLines(doors), lineMat(0x333333, 0.8));
  g.add(sw);
  // 外形寸法線
  const dim: number[] = [];
  const zd = PLATE.z1 + 6.2;
  const xd = PLATE.x1 + 6.2;
  dim.push(PLATE.x0, 0.02, zd, PLATE.x1, 0.02, zd, xd, 0.02, PLATE.z0, xd, 0.02, PLATE.z1);
  for (const x of [PLATE.x0, PLATE.x1]) dim.push(x, 0.02, zd - 0.5, x, 0.02, zd + 0.5);
  for (const z of [PLATE.z0, PLATE.z1]) dim.push(xd - 0.5, 0.02, z, xd + 0.5, 0.02, z);
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dim, 3));
  g.add(new THREE.LineSegments(dg, lineMat(0x333333, 0.9)));
  return { group: g, axes };
}
