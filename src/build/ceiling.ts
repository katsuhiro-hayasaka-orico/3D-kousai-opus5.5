import * as THREE from 'three';
import { PB, floorRectGeo } from '../core/geom';
import { Instancer, PickInfo } from '../core/instancer';
import { CORE_ROOMS, TENANT_ROOMS, Room } from '../data/rooms';
import { H, PLATE } from '../data/spec';
import { WallPiece } from './walls';

/**
 * 天井面と天井設備（LED ライン照明・個別空調カセット・無線 LAN AP・スプリンクラー・感知器・スピーカー等）。
 * 設備は壁との干渉を避けて配置する。
 */

const THICK: Record<string, number> = { rc: 0.2, lgs: 0.12, movable: 0.1, film: 0.02, glass: 0.02, low: 0.12 };

export class CeilingPlanner {
  constructor(private pieces: WallPiece[]) {}

  hitsWall(x0: number, z0: number, x1: number, z1: number, pad = 0.05): boolean {
    for (const w of this.pieces) {
      const t = (THICK[w.type] ?? 0.12) / 2 + pad;
      const r =
        w.axis === 'h' ? [w.a, w.c - t, w.b, w.c + t] : [w.c - t, w.a, w.c + t, w.b];
      if (x0 < r[2] && x1 > r[0] && z0 < r[3] && z1 > r[1]) return true;
    }
    return false;
  }

  inTenant(x: number, z: number): Room | undefined {
    return TENANT_ROOMS.find((r) => x > r.rect[0] + 0.3 && x < r.rect[2] - 0.3 && z > r.rect[1] + 0.3 && z < r.rect[3] - 0.3);
  }

  /** 候補点を壁と干渉しない位置まで少しずらす */
  nudge(x: number, z: number, hw: number, hd: number): [number, number] | null {
    const offs = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2];
    for (const dx of offs)
      for (const dz of offs) {
        const X = x + dx;
        const Z = z + dz;
        if (!this.inTenant(X, Z)) continue;
        if (!this.hitsWall(X - hw, Z - hd, X + hw, Z + hd, 0.15)) return [X, Z];
      }
    return null;
  }
}

export interface CeilingResult {
  pb: PB;
  ac: { x: number; z: number; zone: number }[];
  ap: { x: number; z: number }[];
  counts: Record<string, number>;
}

export function buildCeiling(I: Instancer, pieces: WallPiece[]): CeilingResult {
  const pb = new PB();
  const cp = new CeilingPlanner(pieces);
  const y = H.ceiling;
  const counts: Record<string, number> = {};
  const inc = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

  // --- 天井面（階段・EV・シャフトを除く） ---
  for (const r of [...CORE_ROOMS, ...TENANT_ROOMS]) {
    if (r.kind === 'stair' || r.kind === 'ev' || r.kind === 'shaft') continue;
    const [x0, z0, x1, z1] = r.rect;
    pb.add(floorRectGeo(x0, z0, x1, z1, y, 1.28, true), 'ceiling', new THREE.Matrix4(), true, 'ceil');
  }

  // --- LED ライン照明（1.6m ピッチ、E-W 方向） ---
  const lightPick: PickInfo = { title: 'LEDライン照明', lines: ['システム天井 640角グリッド', '照度 約750lx（机上面）・調光'] };
  for (let x = PLATE.x0 + 1.6; x < PLATE.x1; x += 3.2) {
    for (let z = PLATE.z0 + 0.8; z < PLATE.z1; z += 1.6) {
      if (!cp.inTenant(x, z)) continue;
      if (cp.hitsWall(x - 0.62, z - 0.06, x + 0.62, z + 0.06)) continue;
      I.add('ceil.line', x, y, z, 0, { pick: lightPick });
      inc('light');
    }
  }
  // コア：ダウンライト
  for (const r of CORE_ROOMS) {
    if (!['corridor', 'evhall', 'wc', 'pantry', 'vestibule'].includes(r.kind)) continue;
    const [x0, z0, x1, z1] = r.rect;
    for (let x = x0 + 0.9; x < x1 - 0.4; x += 1.8)
      for (let z = z0 + 0.9; z < z1 - 0.4; z += 1.8) {
        I.add('ceil.down', x, y, z, 0);
        inc('downlight');
      }
  }

  // --- 個別空調カセット（公開：1 フロア 30 ゾーン） ---
  const ac: CeilingResult['ac'] = [];
  const xs: number[] = [];
  for (let k = 0; k < 6; k++) xs.push(1.6 + 6.4 * k, -(1.6 + 6.4 * k));
  for (const x of xs)
    for (const z of [-15.2, -8.0, -1.2, 6.0, 14.4]) {
      const p = cp.nudge(x, z, 0.5, 0.5);
      if (!p) continue;
      ac.push({ x: p[0], z: p[1], zone: acZoneOf(p[0], p[1]) });
      I.add('ceil.ac', p[0], y, p[1], 0, { pick: { title: '個別空調 天井カセット（4方向）', lines: [`空調ゾーン AC-${String(acZoneOf(p[0], p[1])).padStart(2, '0')}`, '個別空調（公開情報：1フロア30ゾーン）'] } });
      inc('ac');
    }

  // --- 無線 LAN アクセスポイント（高密度：約 90㎡/台） ---
  const ap: CeilingResult['ap'] = [];
  for (const x of [-33.6, -24.0, -14.4, -4.8, 4.8, 14.4, 24.0, 33.6])
    for (const z of [-14.4, -4.8, 4.8, 14.4]) {
      const p = cp.nudge(x, z, 0.15, 0.15);
      if (!p) continue;
      ap.push({ x: p[0], z: p[1] });
      I.add('ceil.ap', p[0], y, p[1], 0, { pick: { title: '無線LANアクセスポイント', lines: ['Wi-Fi 6E / PoE給電', 'モバイルPC・Web会議の同時接続を想定した高密度配置'] } });
      inc('ap');
    }

  // --- スプリンクラー・感知器・スピーカー ---
  for (let x = PLATE.x0 + 3.0; x < PLATE.x1; x += 3.2)
    for (let z = PLATE.z0 + 1.6; z < PLATE.z1; z += 3.2) {
      if (!cp.inTenant(x, z) || cp.hitsWall(x - 0.05, z - 0.05, x + 0.05, z + 0.05)) continue;
      I.add('ceil.sp', x, y, z, 0);
      inc('sprinkler');
    }
  for (let x = PLATE.x0 + 4.8; x < PLATE.x1; x += 6.4)
    for (let z = PLATE.z0 + 4.0; z < PLATE.z1; z += 6.4) {
      if (cp.inTenant(x, z) && !cp.hitsWall(x - 0.06, z - 0.06, x + 0.06, z + 0.06)) {
        I.add('ceil.smoke', x, y, z, 0);
        inc('smoke');
      }
      const sx = x + 1.6;
      const sz = z + 1.6;
      if (cp.inTenant(sx, sz) && !cp.hitsWall(sx - 0.1, sz - 0.1, sx + 0.1, sz + 0.1)) {
        I.add('ceil.spk', sx, y, sz, 0);
        inc('speaker');
      }
    }

  // --- 監視カメラ・誘導灯・会議室マイク・ペンダント ---
  const cctv: [number, number][] = [
    [0, 4.0],
    [0, 8.8],
    [0, -9.0],
    [0, -11.3],
    [18.2, -11.6],
    [-18.2, -11.6],
    [-20.0, -11.6],
    [-22.9, -7.4],
    [23.0, -7.4],
    [14.4, -11.4],
    [-14.4, -11.4],
  ];
  for (const [x, z] of cctv) {
    I.add('ceil.cctv', x, y, z, 0, { pick: { title: '監視カメラ（ドーム型）', lines: ['入退室管理と連動した録画'] } });
    inc('cctv');
  }
  const exits: [number, number, number][] = [
    [16.35, -11.5, Math.PI / 2],
    [-16.35, -11.5, Math.PI / 2],
    [0, 3.45, 0],
    [-4.05, 9.85, 0],
    [4.05, 9.85, 0],
    [0, -12.65, 0],
    [-11.2, -12.65, 0],
    [11.2, -12.65, 0],
  ];
  for (const [x, z, ry] of exits) {
    I.add('ceil.exit', x, y, z, ry, { pick: { title: '避難口誘導灯', lines: ['共用廊下 → 付室 → 特別避難階段（東西2方向避難）'] } });
    inc('exit');
  }
  for (const [x, z] of [
    [-10.8, 5.9],
    [7.2, 5.9],
    [27.0, 7.1],
    [-19.4, -0.5],
    [-32.4, 6.3],
    [-26.8, 6.3],
  ])
    I.add('ceil.mic', x, y, z, 0, { pick: { title: '天井アレイマイク', lines: ['Web会議の集音（ハウリング抑制）'] } });
  for (const x of [-2.2, 0, 2.2]) I.add('ceil.pendant', x, y, 14.6, 0);
  I.add('ceil.linearPendant', -9.8, y, 13.7, 0);

  return { pb, ac, ap, counts };
}

/** 空調ゾーン番号（1〜30）。南バー 16（8 分割 × 窓際/内側）、東西ウイング各 6、専用系統 2。 */
export function acZoneOf(x: number, z: number): number {
  if (x >= 16 && x <= 22.4 && z >= -10.6 && z <= -4.2) return 29; // 検証ラボ（24h）
  if (x <= -16 && x >= -22.4 && z >= -10.6 && z <= -4.2) return 30; // モニタリング室
  if (z >= 3.2) {
    const col = Math.min(7, Math.max(0, Math.floor((x - PLATE.x0) / 9.6)));
    const peri = z >= 11.4 ? 0 : 1;
    return 1 + col * 2 + peri;
  }
  const east = x > 0;
  const outer = east ? x >= 27.2 : x <= -27.2;
  const band = z < -11.73 ? 0 : z < -4.27 ? 1 : 2;
  return 17 + (east ? 0 : 6) + band * 2 + (outer ? 0 : 1);
}

export interface AcZoneRect {
  id: number;
  rect: [number, number, number, number];
}

export function acZoneRects(): AcZoneRect[] {
  const out: AcZoneRect[] = [];
  for (let col = 0; col < 8; col++) {
    const x0 = PLATE.x0 + col * 9.6;
    out.push({ id: 1 + col * 2, rect: [x0, 11.4, x0 + 9.6, PLATE.z1] });
    out.push({ id: 2 + col * 2, rect: [x0, 3.2, x0 + 9.6, 11.4] });
  }
  const bands = [
    [PLATE.z0, -11.73],
    [-11.73, -4.27],
    [-4.27, 3.2],
  ];
  bands.forEach(([a, b], band) => {
    out.push({ id: 17 + band * 2, rect: [27.2, a, PLATE.x1, b] });
    out.push({ id: 18 + band * 2, rect: [16, a, 27.2, b] });
    out.push({ id: 23 + band * 2, rect: [PLATE.x0, a, -27.2, b] });
    out.push({ id: 24 + band * 2, rect: [-27.2, a, -16, b] });
  });
  out.push({ id: 29, rect: [16, -10.6, 22.4, -4.2] });
  out.push({ id: 30, rect: [-22.4, -10.6, -16, -4.2] });
  return out;
}
