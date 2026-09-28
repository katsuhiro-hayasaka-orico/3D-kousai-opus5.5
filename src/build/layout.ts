import { Instancer, PickInfo } from '../core/instancer';
import { Rng } from '../core/rng';
import { Pose } from './protos';
import { GROUP_LABEL, Group } from '../data/rooms';

/**
 * 専有部・共用部の家具／人物配置。
 * すべて実寸（m）で、座標は rooms.ts の室矩形に合わせてある。
 */

export type Box2 = [number, number, number, number];

export interface LayoutStats {
  desks: Record<'it' | 'risk' | 'common', number>;
  present: number;
  webMeeting: number;
  meetingSeats: number;
  booths1: number;
  booths2: number;
  lockers: number;
  mfp: number;
  displays: number;
  laptops: number;
  monitors: number;
  focus: number;
  lounge: number;
}

export interface LayoutResult {
  obstacles: Box2[];
  stats: LayoutStats;
  seatSpots: { x: number; z: number; ry: number; label: string }[];
}

// ---------------- 人物の外見パレット ----------------
const SKIN = [0xf1d3b8, 0xe8c3a0, 0xdcb08c, 0xf3dcc6, 0xe2b996, 0xd6a47f];
const HAIR = [0x1a1512, 0x241c16, 0x2e231b, 0x3b2c20, 0x121212, 0x4a3a2c, 0x6b6560];
const TOPS = [0xf5f5f2, 0xdfe8f2, 0xbcd0e6, 0x2f3b52, 0x4a4f57, 0x6d7780, 0x1f2a3a, 0xe9e1d3, 0x8a9a86, 0xa3485a, 0x5b6f8f, 0xffffff, 0x333333, 0xc9b99a];
const BOTTOMS = [0x1f2633, 0x2b2b2e, 0x3a3f47, 0x5a5f66, 0x7d7466, 0x1b1b1d, 0x2e3a52, 0xb9ab92];

type Occupancy = 'busy' | 'normal' | 'quiet';

export class Layout {
  I: Instancer;
  rng: Rng;
  obstacles: Box2[] = [];
  seatSpots: LayoutResult['seatSpots'] = [];
  stats: LayoutStats = {
    desks: { it: 0, risk: 0, common: 0 },
    present: 0,
    webMeeting: 0,
    meetingSeats: 0,
    booths1: 0,
    booths2: 0,
    lockers: 0,
    mfp: 0,
    displays: 0,
    laptops: 0,
    monitors: 0,
    focus: 0,
    lounge: 0,
  };

  constructor(I: Instancer, seed = 20250630) {
    this.I = I;
    this.rng = new Rng(seed);
  }

  // ---------- 汎用 ----------
  /** ローカル（lx, lz）→ 世界座標 */
  tf(ox: number, oz: number, ry: number, lx: number, lz: number): [number, number] {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    return [ox + lx * c + lz * s, oz - lx * s + lz * c];
  }

  add(name: string, x: number, z: number, ry = 0, pick?: PickInfo, y = 0, tints?: Record<string, number>): void {
    this.I.add(name, x, y, z, ry, { pick, tints });
  }

  obstacle(cx: number, cz: number, w: number, d: number, ry = 0): void {
    const c = Math.abs(Math.cos(ry));
    const s = Math.abs(Math.sin(ry));
    const W = w * c + d * s;
    const D = w * s + d * c;
    this.obstacles.push([cx - W / 2, cz - D / 2, cx + W / 2, cz + D / 2]);
  }

  personTints(): Record<string, number> {
    const r = this.rng;
    return {
      'person.skin': r.pick(SKIN),
      'person.hair': r.pick(HAIR),
      'person.top': r.pick(TOPS),
      'person.bottom': r.pick(BOTTOMS),
    };
  }

  person(x: number, z: number, ry: number, pose: Pose, headset = false, pick?: PickInfo, y = 0): void {
    this.add(`person.${pose}${headset ? '.hs' : ''}`, x, z, ry, pick, y, this.personTints());
    this.stats.present++;
    if (headset) this.stats.webMeeting++;
  }

  // ---------- 執務席 ----------
  screenFor(group: Group, web: boolean): string {
    const r = this.rng;
    if (web) return r.pick(['video1', 'video2', 'video3', 'video4']);
    if (group === 'it') return r.pick(['code1', 'code2', 'code3', 'dash1', 'dash2', 'code1', 'sheet1']);
    if (group === 'risk') return r.pick(['sheet1', 'sheet2', 'sheet3', 'dash1', 'dash2', 'dash3', 'sheet2']);
    return r.pick(['dash1', 'sheet1', 'slide1']);
  }

  /**
   * 1 席（椅子＋在席者＋PC＋モニター＋小物）。人は ry 方向（ローカル -z）を向き、机はローカル -z 側。
   */
  deskSeat(x: number, z: number, ry: number, group: Group, id: string, occ: boolean, opt: { monitor?: boolean; zoneName?: string } = {}): void {
    const r = this.rng;
    const web = occ && r.chance(0.28);
    const zoneName = opt.zoneName ?? GROUP_LABEL[group];
    const status = occ ? (web ? '在席（Web会議中・ヘッドセット使用）' : '在席') : '空席（フリーアドレス）';
    const pick: PickInfo = {
      title: `座席 ${id}`,
      lines: [
        `エリア：${zoneName}`,
        `状態：${status}`,
        '机：W1200×D700（ベンチデスク、中央スクリーンH400）',
        opt.monitor === false ? '機器：モバイルPC' : '機器：モバイルPC＋24型モニター＋USB-Cドック＋キーボード/マウス',
        '電源：天板上コンセント（OAフロア下配線）',
      ],
    };
    const T = (lx: number, lz: number) => this.tf(x, z, ry, lx, lz);
    if (occ) {
      const [cx, cz] = T(r.range(-0.04, 0.04), r.range(0.0, 0.08));
      this.add('chair.task', cx, cz, ry + r.range(-0.12, 0.12), pick);
      const pose: Pose = web ? r.pick(['sit', 'sitType'] as const) : r.pick(['sitType', 'sitType', 'sit', 'sitLean'] as const);
      const [px, pz] = T(0, 0.02);
      this.person(px, pz, ry + r.range(-0.08, 0.08), pose, web, pick);
      const scr = this.screenFor(group, web);
      const stand = r.chance(0.45);
      const [lx, lz] = T(-0.34, -0.66);
      this.add(`${stand ? 'laptopStand' : 'laptop'}.${web ? scr : this.screenFor(group, false)}`, lx, lz, ry + 0.22, pick);
      this.stats.laptops++;
      if (opt.monitor !== false) {
        const [mx, mz] = T(0.14, -0.98);
        this.add(`monitor.${web ? this.screenFor(group, false) : scr}`, mx, mz, ry, pick);
        this.stats.monitors++;
      }
      const [kx, kz] = T(0.12, -0.6);
      this.add('kbmouse', kx, kz, ry);
      if (r.chance(0.55)) {
        const [ux, uz] = T(0.46, -0.58);
        this.add(r.pick(['mug', 'bottle', 'mug']), ux, uz, 0);
      }
      if (r.chance(0.35)) {
        const [nx, nz] = T(-0.42, -0.35 - 0.05);
        this.add(r.pick(['notebook', 'smartphone', 'docs']), nx, nz, ry + r.range(-0.3, 0.3));
      }
      if (!web && r.chance(0.25)) {
        const [hx, hz] = T(0.48, -0.9);
        this.add('headset.desk', hx, hz, ry + 0.4);
      }
    } else {
      const [cx, cz] = T(r.range(-0.08, 0.08), r.range(-0.18, -0.05));
      this.add('chair.task', cx, cz, ry + r.range(-0.35, 0.35), pick);
      if (opt.monitor !== false) {
        const [mx, mz] = T(0.14, -0.98);
        this.add('monitor.off', mx, mz, ry, pick);
        this.stats.monitors++;
        const [kx, kz] = T(0.12, -0.72);
        this.add('kbmouse', kx, kz, ry);
      }
    }
    if (opt.monitor !== false) {
      const [dx, dz] = T(0.46, -0.98);
      this.add('dock', dx, dz, ry);
    }
    this.seatSpots.push({ x, z, ry, label: id });
  }

  /** デスク島：n 席 × 両面。axis='x' なら長手が x 方向。 */
  island(cx: number, cz: number, n: 2 | 3 | 4, axis: 'x' | 'z', group: 'it' | 'risk' | 'common', idPrefix: string, occ: Occupancy, zoneName?: string): void {
    const ry = axis === 'x' ? 0 : Math.PI / 2;
    const tag = group === 'risk' ? 'wood' : 'white';
    this.add(`island.${n}.${tag}`, cx, cz, ry, { title: `デスク島 ${idPrefix}`, lines: [`${n * 2}席（W${n * 1200}×D1400）`, zoneName ?? GROUP_LABEL[group]] });
    this.obstacle(cx, cz, n * 1.2, 1.4, ry);
    const L = n * 1.2;
    const p = occ === 'busy' ? 0.78 : occ === 'normal' ? 0.64 : 0.45;
    let k = 1;
    for (const side of [1, -1]) {
      for (let i = 0; i < n; i++) {
        const lx = -L / 2 + 0.6 + i * 1.2;
        const [sx, sz] = this.tf(cx, cz, ry, lx, side * 1.08);
        const sry = ry + (side > 0 ? 0 : Math.PI);
        this.deskSeat(sx, sz, sry, group, `${idPrefix}-${String(k).padStart(2, '0')}`, this.rng.chance(p), { zoneName });
        this.stats.desks[group]++;
        k++;
      }
    }
  }

  /** 会議用椅子（在席者・PC 付き） */
  mchair(x: number, z: number, ry: number, occ: boolean, mat = 'fabric.gray', opt: { laptop?: string | null; pick?: PickInfo; web?: boolean } = {}): void {
    const r = this.rng;
    const [cx, cz] = this.tf(x, z, ry, 0, occ ? 0.05 : -0.05);
    this.add('chair.meet.' + mat, cx, cz, ry + r.range(-0.1, 0.1), opt.pick);
    this.stats.meetingSeats++;
    if (occ) {
      this.person(x, z, ry + r.range(-0.15, 0.15), r.pick(['sit', 'sitLean', 'sit'] as const), !!opt.web, opt.pick);
      if (opt.laptop !== null && r.chance(0.7)) {
        const [lx, lz] = this.tf(x, z, ry, 0.05, -0.58);
        this.add(`laptop.${opt.laptop ?? r.pick(['slide1', 'dash1', 'sheet1', 'code1'])}`, lx, lz, ry + r.range(-0.15, 0.15));
        this.stats.laptops++;
      }
    }
  }

  /** 矩形テーブルの周囲に椅子 */
  tableChairs(cx: number, cz: number, ry: number, len: number, dep: number, perSide: number, ends: [boolean, boolean], occ: number, mat: string, pick?: PickInfo, opt: { laptopScreens?: string[]; web?: number } = {}): void {
    const r = this.rng;
    const pitch = len / perSide;
    for (const side of [1, -1]) {
      for (let i = 0; i < perSide; i++) {
        const lx = -len / 2 + pitch / 2 + i * pitch;
        const [x, z] = this.tf(cx, cz, ry, lx, side * (dep / 2 + 0.38));
        this.mchair(x, z, ry + (side > 0 ? 0 : Math.PI), r.chance(occ), mat, { pick, laptop: opt.laptopScreens ? r.pick(opt.laptopScreens) : undefined, web: r.chance(opt.web ?? 0) });
      }
    }
    if (ends[0]) {
      const [x, z] = this.tf(cx, cz, ry, -len / 2 - 0.42, 0);
      this.mchair(x, z, ry - Math.PI / 2, r.chance(occ), mat, { pick });
    }
    if (ends[1]) {
      const [x, z] = this.tf(cx, cz, ry, len / 2 + 0.42, 0);
      this.mchair(x, z, ry + Math.PI / 2, r.chance(occ), mat, { pick });
    }
  }

  display(inch: number, screen: string, x: number, z: number, ry: number, pick?: PickInfo): void {
    this.add(`display.${inch}.${screen}`, x, z, ry, pick);
    this.stats.displays++;
  }

  lockers(x0: number, z0: number, n: number, ry: number): void {
    // ry 方向（ローカル +z）に扉面が向く列。列はローカル x 方向に並ぶ。
    for (let i = 0; i < n; i++) {
      const [x, z] = this.tf(x0, z0, ry, i * 0.9, 0);
      this.add('locker.900', x, z, ry, { title: '個人ロッカー', lines: ['W900×D515×H1800、3列×4段＝12人分', '電子錠（ICカード）・PC充電用コンセント付', 'フリーアドレス運用：私物・モバイルPCを保管'] });
      this.obstacle(x, z, 0.9, 0.52, ry);
      this.stats.lockers += 12;
    }
  }

  booth1(x: number, z: number, ry: number, occ: boolean, green = false): void {
    const pick: PickInfo = { title: '1人用Webブース', lines: ['W1100×D1100×H2250（吸音フェルト・換気ファン・照明）', 'Web会議・電話・集中作業用', occ ? '使用中' : '空き'] };
    this.add(green ? 'booth.1p.g' : 'booth.1p', x, z, ry, pick);
    this.obstacle(x, z, 1.1, 1.1, ry);
    this.stats.booths1++;
    // 椅子と人（ブース内：カウンターはローカル -z 奥）
    const [cx, cz] = this.tf(x, z, ry, 0, 0.12);
    this.add('chair.task', cx, cz, ry, pick);
    if (occ) {
      this.person(cx, cz, ry, 'sitType', true, pick);
      const [lx, lz] = this.tf(x, z, ry, 0, -0.26);
      this.add(`laptop.${this.rng.pick(['video1', 'video2', 'video3', 'video4'])}`, lx, lz, ry, pick, 0.01);
      this.stats.laptops++;
    }
  }

  booth2(x: number, z: number, ry: number, occ: number): void {
    const pick: PickInfo = { title: '2人用Webブース', lines: ['W2200×D1350×H2250', '1on1・少人数のWeb会議用', occ ? `使用中（${occ}名）` : '空き'] };
    this.add('booth.2p', x, z, ry, pick);
    this.obstacle(x, z, 2.2, 1.35, ry);
    this.stats.booths2++;
    for (const s of [-1, 1]) {
      const [cx, cz] = this.tf(x, z, ry, s * 0.5, 0.2);
      this.add('chair.task', cx, cz, ry, pick);
      if (occ >= (s < 0 ? 1 : 2)) {
        this.person(cx, cz, ry, 'sitType', true, pick);
        const [lx, lz] = this.tf(x, z, ry, s * 0.5, -0.2);
        this.add(`laptop.${this.rng.pick(['video1', 'video2', 'video3'])}`, lx, lz, ry, pick, 0.01);
        this.stats.laptops++;
      }
    }
  }

  focusDesk(x: number, z: number, ry: number, group: Group, id: string, occ: boolean): void {
    this.add('desk.focus', x, z, ry, { title: `集中席 ${id}`, lines: ['W1200×D700、三方パネル（吸音フェルト）', '窓際・北面の安定した採光', occ ? '使用中' : '空き'] });
    this.obstacle(x, z, 1.26, 0.72, ry);
    const [sx, sz] = this.tf(x, z, ry, 0, 0.72);
    this.deskSeat(sx, sz, ry, group, id, occ, { zoneName: '集中エリア' });
    this.stats.focus++;
  }
}

// ============================================================
// 配置本体
// ============================================================

export function buildLayout(I: Instancer): LayoutResult {
  const L = new Layout(I);
  const r = L.rng;
  const PI = Math.PI;

  // ---------------- 執務エリア：デスク島 ----------------
  // IT 東ウイング：島は z 方向（東面外壁と平行）、3 列 × 2
  let n = 1;
  for (const x of [26.4, 30.2, 34.0])
    for (const z of [-7.6, -1.6]) L.island(x, z, 4, 'z', 'it', `E1-${n++}`, x > 33 ? 'normal' : 'busy', 'IT・システムG 執務エリア（東）');
  // IT 南：島は z 方向（南面外壁に直交）
  n = 1;
  for (const x of [15.2, 19.0, 22.8, 26.6, 30.4, 34.2]) L.island(x, 14.4, 4, 'z', 'it', `E2-${n++}`, x < 20 ? 'normal' : 'busy', 'IT・システムG 執務エリア（南）');
  // リスク 西ウイング
  n = 1;
  for (const x of [-26.4, -30.2, -34.0])
    for (const z of [-7.8, -1.8]) L.island(x, z, 4, 'z', 'risk', `W1-${n++}`, 'normal', 'リスク管理G 執務エリア（西）');
  // リスク 南
  n = 1;
  for (const x of [-15.2, -19.0, -22.8, -26.6, -30.4, -34.2]) L.island(x, 14.4, 4, 'z', 'risk', `W2-${n++}`, x > -20 ? 'quiet' : 'normal', 'リスク管理G 執務エリア（南）');

  // 島の間の観葉植物（ソフトな仕切り）
  for (const x of [28.3, 32.1]) L.add('plant.floor', x, -4.6, r.range(0, 6));
  for (const x of [-28.3, -32.1]) L.add('plant.floor', x, -4.8, r.range(0, 6));
  for (const x of [17.1, 24.7, 32.3, -17.1, -24.7, -32.3]) L.add('plant.floor', x, 17.5, r.range(0, 6));

  // ---------------- 集中エリア（北面窓際）＋ Web ブース ----------------
  for (const sgn of [1, -1]) {
    const group: Group = sgn > 0 ? 'it' : 'risk';
    for (let i = 0; i < 8; i++) {
      const x = sgn * (26.5 + i * 1.26);
      L.focusDesk(x, -17.75, 0, group, `${sgn > 0 ? 'FE' : 'FW'}-${i + 1}`, r.chance(0.5));
    }
    [26.6, 27.8, 29.0, 30.2].forEach((x, i) => L.booth1(sgn * x, -13.0, 0, r.chance(0.6), sgn < 0 && i % 2 === 1));
    [32.3, 34.8].forEach((x, i) => L.booth2(sgn * x, -13.125, 0, i === 0 ? 2 : r.chance(0.5) ? 1 : 0));
    L.add('plant.tall', sgn * 36.9, -13.2, 0);
    L.add('plant.tall', sgn * 36.9, -17.6, 1);
  }

  // ---------------- ロッカー ----------------
  for (const sgn of [1, -1]) {
    // アルコーブ：外側の壁沿い 6 台、内側 3 台
    if (sgn > 0) {
      L.lockers(13.11, 8.25, 6, PI / 2);
      L.lockers(15.69, 6.95, 3, -PI / 2);
      // ウイング南端（通路に面して南向き）6 台
      L.lockers(25.05, 1.45, 6, 0);
    } else {
      L.lockers(-13.11, 3.75, 6, -PI / 2);
      L.lockers(-15.69, 8.75, 3, PI / 2);
      // ウイング南端（大会議室の壁を背に北向き）6 台
      L.lockers(-25.05, 1.88, 6, PI);
    }
  }

  // ---------------- 複合機コーナー ----------------
  const mfpPick = (id: string): PickInfo => ({ title: `複合機 ${id}`, lines: ['A3カラー複合機（ICカード認証・セキュアプリント）', 'モバイルPCからクラウド印刷', '隣接：機密文書回収BOX・分別ゴミ箱'] });
  // 東：プロジェクトルーム東壁沿い（東向き）
  L.add('mfp', 30.85, 5.2, PI / 2, mfpPick('E-1'));
  L.add('mfp', 30.85, 6.0, PI / 2, mfpPick('E-2'));
  L.add('shred.box', 30.7, 6.75, PI / 2, { title: '機密文書回収BOX', lines: ['施錠式・溶解処理'] });
  L.add('trash.station', 30.72, 7.9, PI / 2, { title: '分別ゴミ箱', lines: ['可燃・プラ・缶ビン・紙'] });
  L.obstacle(30.9, 6.5, 0.8, 3.3);
  // 西：ウイング南端（南向き）
  L.add('mfp', -30.9, 1.79, PI, mfpPick('W-1'));
  L.add('mfp', -31.7, 1.79, PI, mfpPick('W-2'));
  L.add('shred.box', -32.5, 1.9, PI, { title: '機密文書回収BOX', lines: ['施錠式・溶解処理'] });
  L.add('trash.station', -33.9, 1.9, PI, { title: '分別ゴミ箱', lines: ['可燃・プラ・缶ビン・紙'] });
  L.obstacle(-32.4, 1.8, 4.0, 0.8);
  L.stats.mfp += 4;

  // ---------------- アジャイル開発エリア ----------------
  {
    const pick: PickInfo = { title: 'アジャイル開発エリア', lines: ['スタンディングテーブル・モバイルホワイトボード', 'デイリースクラム／スプリントレビュー'] };
    L.add('table.high', 34.0, 4.6, 0, pick);
    L.add('table.high', 34.0, 7.7, 0, pick);
    L.obstacle(34.0, 4.6, 1.8, 0.9);
    L.obstacle(34.0, 7.7, 1.8, 0.9);
    // スクラム中（5 名）
    L.person(33.3, 3.75, PI, 'standTalk');
    L.person(34.5, 3.75, PI, 'stand');
    L.person(33.2, 5.45, 0, 'standTalk');
    L.person(34.8, 5.45, 0.2, 'stand');
    L.person(35.25, 4.6, PI / 2, 'standTalk');
    L.add('laptop.dash1', 33.9, 4.6, 0.3, pick, 0.28);
    L.add('laptop.code2', 34.3, 7.7, -0.2, pick, 0.28);
    L.person(34.0, 8.55, 0, 'standTalk');
    L.add('whiteboard.mobile', 36.05, 4.4, -PI / 2, pick);
    L.add('whiteboard.mobile', 36.05, 6.5, -PI / 2, pick);
    L.add('whiteboard.mobile', 32.6, 9.1, 0, pick);
    L.person(35.45, 5.3, -PI / 2, 'standPoint');
    L.add('display.mobile', 35.8, 8.7, -PI / 2 - 0.4, { title: 'モバイルディスプレイ（65型）', lines: ['スプリントボード・バーンダウン表示'] });
    L.add('plant.tall', 35.7, 2.7, 0);
  }

  // ---------------- プロジェクトルーム ----------------
  {
    const pick: PickInfo = { title: 'プロジェクトルーム', lines: ['10名、75型ディスプレイ＋カメラバー、天井マイク', 'ホワイトボード、常設プロジェクト用'] };
    L.add('table.meet.3612', 27.0, 7.1, 0, pick);
    L.obstacle(27.0, 7.1, 3.6, 1.2);
    L.tableChairs(27.0, 7.1, 0, 3.6, 1.2, 4, [true, false], 0.72, 'fabric.blue', pick, { laptopScreens: ['code1', 'code2', 'dash2', 'video2'], web: 0.1 });
    L.display(75, 'video3', 30.34, 7.1, -PI / 2, pick);
    L.person(29.5, 6.1, -PI / 2 - 0.3, 'standPoint', false, pick);
    L.add('whiteboard.mobile', 25.0, 8.9, PI / 2 + 0.6, pick);
  }

  // ---------------- 会議室 E-1 / Web 会議室 ----------------
  {
    const p1: PickInfo = { title: '会議室 E-1（6名）', lines: ['65型ディスプレイ＋Web会議カメラバー', 'ハイブリッド会議（遠隔参加者を画面に表示）'] };
    L.add('table.meet.2410', 20.8, 6.7, PI / 2, p1);
    L.obstacle(20.8, 6.7, 2.4, 1.0, PI / 2);
    L.tableChairs(20.8, 6.7, PI / 2, 2.4, 1.0, 3, [true, false], 0.55, 'fabric.gray', p1, { laptopScreens: ['slide1', 'code1', 'dash1'] });
    L.display(65, 'video1', 20.8, 3.26, 0, p1);
    const w1: PickInfo = { title: 'Web会議室 E-1（2名）', lines: ['43型ディスプレイ＋Webカメラ、吸音パネル'] };
    L.add('table.web.1207', 17.6, 4.3, 0, w1);
    L.display(43, 'video2', 17.6, 3.26, 0, w1);
    L.mchair(17.3, 4.95, 0, true, 'fabric.navy', { laptop: 'video2', pick: w1, web: true });
    L.mchair(17.95, 4.95, 0, false, 'fabric.navy', { pick: w1 });
    const w2: PickInfo = { title: 'Web会議室 E-2（3名）', lines: ['43型ディスプレイ＋Webカメラ、吸音パネル'] };
    L.add('table.meet.1608', 17.6, 7.6, 0, w2);
    L.display(43, 'video4', 17.6, 6.46, 0, w2);
    L.mchair(17.1, 8.45, 0, true, 'fabric.navy', { laptop: 'video4', pick: w2 });
    L.mchair(18.1, 8.45, 0, true, 'fabric.navy', { laptop: null, pick: w2 });
    L.mchair(17.6, 8.45, 0, false, 'fabric.navy', { pick: w2 });
    // 吸音パネル（壁面）
    for (const [x, z, ry] of [
      [19.12, 4.8, -PI / 2],
      [16.08, 8.0, PI / 2],
      [-19.12, 4.8, PI / 2],
      [-16.08, 8.0, -PI / 2],
    ] as const) {
      L.add('whiteboard.wall.plain', x, z, ry);
    }
  }

  // ---------------- IT サポートデスク・キッティング ----------------
  {
    const pick: PickInfo = { title: 'ITサポートデスク・キッティング', lines: ['モバイルPCのキッティング・修理受付・貸出', '窓口カウンター（通路側）', 'ノートPC充電保管庫 ×3'] };
    L.add('bench.kitting', 16.62, -2.6, PI / 2, pick);
    L.add('bench.kitting', 18.6, -1.2, 0, pick);
    L.obstacle(16.62, -2.6, 2.4, 0.9, PI / 2);
    L.obstacle(18.6, -1.2, 2.4, 0.9);
    for (let i = 0; i < 5; i++) L.add(`laptop.${i % 2 ? 'lock' : 'code3'}`, 16.62, -3.5 + i * 0.45, PI / 2 + 0.1, pick, 0.145);
    for (let i = 0; i < 5; i++) L.add(`laptop.${i % 3 ? 'lock' : 'dash3'}`, 17.7 + i * 0.45, -1.0, 0, pick, 0.145);
    for (const x of [18.4, 19.5, 20.6]) L.add('pc.cabinet', x, -3.89, 0, { title: 'ノートPC充電保管庫', lines: ['40台収納・一括充電・施錠', '貸出用／予備機'] });
    L.add('shelf.pc', 16.35, 0.4, PI / 2, pick);
    L.add('shelf.pc', 16.35, 2.25, PI / 2, pick);
    for (const z of [0.8, 2.0]) {
      L.add('table.web.1207', 21.85, z, PI / 2, pick);
    }
    L.deskSeat(21.1, 0.8, -PI / 2, 'it', 'SUP-1', true, { zoneName: 'ITサポートデスク' });
    L.deskSeat(21.1, 2.0, -PI / 2, 'it', 'SUP-2', true, { zoneName: 'ITサポートデスク' });
    L.person(17.6, -2.0, -PI / 2 + 0.3, 'stand', false, pick);
    // 窓口に来た社員
    L.person(23.0, 1.5, PI / 2, 'standTalk');
    L.add('laptop.closed', 22.55, 1.5, PI / 2, pick, 0.27);
  }

  // ---------------- 検証ラボ ----------------
  {
    const pick: PickInfo = { title: '検証ラボ', lines: ['42Uラック ×5（検証環境・ネットワーク機器）', '静電対策作業台・帯電防止床', 'スマートフォン検証端末キャビネット'] };
    for (let i = 0; i < 5; i++) L.add('rack.42u', 16.65, -9.9 + i * 0.6, PI / 2, { title: `ラック R-${i + 1}（42U）`, lines: ['検証用サーバー・スイッチ', '前面パンチング扉'] });
    L.obstacle(16.65, -8.7, 1.07, 3.0);
    L.add('bench.lab', 19.3, -4.66, PI, pick);
    L.obstacle(19.3, -4.66, 2.4, 0.75);
    L.add('monitor.dash2', 18.7, -4.4, PI, pick);
    L.add('monitor.code2', 19.9, -4.4, PI, pick);
    L.add('laptop.code1', 18.6, -4.8, PI + 0.2, pick);
    for (let i = 0; i < 4; i++) L.add('smartphone', 20.3 + i * 0.12, -4.75, PI + 0.1 * i, pick);
    L.mchair(19.3, -5.5, PI, true, 'fabric.gray', { laptop: null, pick });
    L.add('device.cabinet', 20.9, -10.3, 0, { title: 'スマートフォン検証端末キャビネット', lines: ['iOS/Android 各世代の実機を充電保管', 'アプリ検証用'] });
    L.add('table.meet.1812', 20.4, -7.6, PI / 2, pick);
    L.add('laptop.code3', 20.1, -7.2, PI / 2, pick);
    L.add('laptop.dash1', 20.1, -8.0, PI / 2, pick);
    L.person(17.8, -8.1, -PI / 2, 'standTalk', false, pick);
  }

  // ---------------- SOC（セキュリティ監視室） ----------------
  {
    const pick: PickInfo = { title: 'セキュリティ監視室（SOC/CSIRT）', lines: ['55型×6面ビデオウォール', '監視卓 6席（トリプルモニター）', '生体認証＋ICカード入室、すりガラスフィルム'] };
    const scr = ['soc1', 'soc2', 'soc3', 'soc4', 'soc5', 'soc6'];
    let k = 0;
    for (const dz of [-1.225, 0, 1.225])
      for (const y of [1.18, 1.9]) L.add(`panel.55.${scr[k++ % 6]}`, 16.1, -15.9 + dz, PI / 2, pick, y);
    L.stats.displays += 6;
    for (const [cx, occs] of [
      [18.9, [true, true, false]],
      [21.5, [true, false, true]],
    ] as const) {
      [-17.4, -15.8, -14.2].forEach((z, i) => {
        L.add('soc.console', cx, z, PI / 2, pick);
        L.obstacle(cx, z, 1.6, 0.9, PI / 2);
        const T = (lx: number, lz: number) => L.tf(cx, z, PI / 2, lx, lz);
        for (const [lx, a] of [
          [-0.52, 0.35],
          [0, 0],
          [0.52, -0.35],
        ] as const) {
          const [mx, mz] = T(lx, -0.18 - Math.abs(lx) * 0.05);
          L.add(`monitor.${r.pick(scr)}`, mx, mz, PI / 2 + a, pick);
          L.stats.monitors++;
        }
        const [kx, kz] = T(0, 0.12);
        L.add('kbmouse', kx, kz, PI / 2);
        const [sx, sz] = T(0, 0.82);
        L.add('chair.task', sx, sz, PI / 2, pick);
        if (occs[i]) {
          L.person(sx, sz, PI / 2, 'sitType', r.chance(0.3), pick);
          const [lx, lz] = T(0.55, 0.2);
          L.add('laptop.soc3', lx, lz, PI / 2 + 0.3, pick);
          L.stats.laptops++;
        }
      });
    }
    L.add('table.round', 24.2, -17.0, 0, pick);
    L.mchair(24.2, -16.15, 0, true, 'fabric.navy', { laptop: 'soc2', pick });
    L.mchair(23.4, -17.4, -PI / 2 - 0.4, true, 'fabric.navy', { laptop: null, pick });
    L.mchair(25.0, -17.4, PI / 2 + 0.4, false, 'fabric.navy', { pick });
    L.add('whiteboard.wall.c', 25.54, -14.5, -PI / 2, pick);
    L.person(17.1, -15.3, PI / 2, 'standPoint', false, pick);
  }

  // ---------------- 書庫 ----------------
  {
    const pick: PickInfo = { title: '書庫・文書保管室', lines: ['電動式移動棚（集密書架）8連', '施錠・入退室ログ', '業務用シュレッダー・スキャナー'] };
    for (const x of [-24.85, -23.95, -23.05, -21.25, -20.35, -19.45, -18.55]) L.add('archive.carriage', x, -16.85, 0, pick);
    L.add('shred.box', -25.2, -14.2, 0, { title: '機密文書回収BOX', lines: ['施錠式・溶解処理'] });
    L.obstacle(-21.7, -16.85, 7.2, 4.5);
    L.add('table.web.1207', -23.6, -12.95, 0, pick);
    L.add('scanner', -23.9, -12.95, 0, pick);
    L.add('laptop.sheet2', -23.3, -12.85, 0.2, pick);
    L.mchair(-23.6, -13.7, PI, true, 'fabric.gray', { laptop: null, pick });
    L.add('shredder.big', -20.5, -13.0, PI, pick);
  }

  // ---------------- モニタリングルーム ----------------
  {
    const pick: PickInfo = { title: 'モニタリングルーム（入室制限）', lines: ['不正利用・与信モニタリング（想定）', '監視卓 6席（デュアルモニター）', '55型×4面 モニターウォール'] };
    let k = 0;
    for (const dz of [-0.62, 0.62]) for (const y of [1.25, 1.95]) L.add(`panel.55.${['dash1', 'soc4', 'dash2', 'soc5'][k++]}`, -16.1, -7.4 + dz, -PI / 2, pick, y);
    L.stats.displays += 4;
    for (const cx of [-17.9, -20.3]) {
      [-9.2, -7.6, -6.0].forEach((z) => {
        L.add('soc.console', cx, z, -PI / 2, pick);
        L.obstacle(cx, z, 1.6, 0.9, PI / 2);
        const T = (lx: number, lz: number) => L.tf(cx, z, -PI / 2, lx, lz);
        for (const [lx, a] of [
          [-0.3, 0.12],
          [0.3, -0.12],
        ] as const) {
          const [mx, mz] = T(lx, -0.2);
          L.add(`monitor.${r.pick(['dash1', 'dash3', 'sheet3', 'soc4'])}`, mx, mz, -PI / 2 + a, pick);
          L.stats.monitors++;
        }
        const [kx, kz] = T(0, 0.12);
        L.add('kbmouse', kx, kz, -PI / 2);
        const [sx, sz] = T(0, 0.82);
        L.add('chair.task', sx, sz, -PI / 2, pick);
        if (r.chance(0.6)) {
          L.person(sx, sz, -PI / 2, 'sitType', false, pick);
          const [lx, lz] = T(0.6, 0.15);
          L.add('laptop.sheet1', lx, lz, -PI / 2 - 0.3, pick);
          L.stats.laptops++;
        }
      });
    }
  }

  // ---------------- 会議室 W-2 / W-1 / Web 会議室 W ----------------
  {
    const p: PickInfo = { title: '会議室 W-2（8名）', lines: ['65型ディスプレイ＋Web会議カメラバー、天井マイク'] };
    L.add('table.meet.3012', -19.4, -0.5, 0, p);
    L.obstacle(-19.4, -0.5, 3.0, 1.2);
    L.tableChairs(-19.4, -0.5, 0, 3.0, 1.2, 3, [true, false], 0.65, 'fabric.green', p, { laptopScreens: ['sheet1', 'dash2', 'slide2'] });
    L.display(65, 'slide2', -16.1, -0.5, -PI / 2, p);
    const p1: PickInfo = { title: '会議室 W-1（6名）', lines: ['65型ディスプレイ＋Web会議カメラバー'] };
    L.add('table.meet.2410', -20.8, 6.7, PI / 2, p1);
    L.obstacle(-20.8, 6.7, 2.4, 1.0, PI / 2);
    L.tableChairs(-20.8, 6.7, PI / 2, 2.4, 1.0, 3, [true, false], 0.0, 'fabric.gray', p1);
    L.display(65, 'lock', -20.8, 3.26, 0, p1);
    const w1: PickInfo = { title: 'Web会議室 W-1（2名）', lines: ['43型ディスプレイ＋Webカメラ、吸音パネル'] };
    L.add('table.web.1207', -17.6, 4.3, 0, w1);
    L.display(43, 'video1', -17.6, 3.26, 0, w1);
    L.mchair(-17.6, 4.95, 0, true, 'fabric.navy', { laptop: 'video3', pick: w1, web: true });
    const w2: PickInfo = { title: 'Web会議室 W-2（3名）', lines: ['43型ディスプレイ＋Webカメラ、吸音パネル'] };
    L.add('table.meet.1608', -17.6, 7.6, 0, w2);
    L.display(43, 'off', -17.6, 6.46, 0, w2);
    for (const x of [-18.1, -17.6, -17.1]) L.mchair(x, 8.45, 0, false, 'fabric.navy', { pick: w2 });
  }

  // ---------------- 大会議室 A / B ----------------
  {
    for (const [cx, name, occ, scr] of [
      [-32.4, '大会議室 A', 0.8, 'video2'],
      [-26.8, '大会議室 B', 0.0, 'off'],
    ] as const) {
      const p: PickInfo = { title: `${name}（12名）`, lines: ['86型ディスプレイ＋話者追尾カメラ＋天井アレイマイク', '可動間仕切りを開放して A+B 一体利用（24名）'] };
      L.add('table.meet.4215', cx, 6.3, PI / 2, p);
      L.obstacle(cx, 6.3, 4.2, 1.5, PI / 2);
      L.tableChairs(cx, 6.3, PI / 2, 4.2, 1.5, 5, [true, false], occ, 'leather.black', p, { laptopScreens: ['sheet1', 'dash1', 'slide1'], web: 0.05 });
      L.display(86, scr, cx, 2.26, 0, p);
      L.add('camera.ptz', cx + 1.3, 2.35, 0, p, 2.3);
    }
    L.person(-32.4, 3.2, PI, 'standPoint');
  }

  // ---------------- ペリメーターブース（西） ----------------
  {
    const p: PickInfo = { title: 'ペリメーターブース', lines: ['ハイバックソファ（吸音）', '少人数打合せ・Web会議'] };
    L.add('sofa.booth', -36.3, 3.8, 0, p);
    L.add('sofa.booth', -36.3, 7.6, 0, p);
    L.obstacle(-36.3, 3.8, 1.6, 2.3);
    L.obstacle(-36.3, 7.6, 1.6, 2.3);
    L.person(-36.3, 3.0, PI, 'sitSofa', true);
    L.add('laptop.video1', -36.3, 3.55, PI, p);
    L.person(-36.3, 4.6, 0, 'sitSofa');
    L.add('laptop.sheet2', -36.3, 4.05, 0, p);
    L.stats.laptops += 2;
  }

  // ---------------- 来客ゾーン ----------------
  {
    const pe: PickInfo = { title: 'エントランス・受付', lines: ['無人受付（内線電話・受付タブレット）', 'セキュリティドア（ICカード・共連れ防止）×2', 'サインウォール（苔壁＋社名）'] };
    L.add('sign.wall', 0, 9.54, PI, pe);
    L.add('counter.reception', -3.3, 5.8, PI / 2, pe);
    L.obstacle(-3.3, 5.8, 1.9, 0.6, PI / 2);
    L.add('tablet.stand', -3.2, 5.4, PI / 2, pe);
    L.add('phone.desk', -3.2, 6.3, PI / 2, pe);
    L.add('bench.wait', 4.05, 5.8, -PI / 2, pe);
    L.obstacle(4.05, 5.8, 1.6, 0.5, PI / 2);
    L.add('plant.tall', 4.1, 3.9, 0);
    L.add('plant.tall', -4.25, 3.85, 1);
    L.add('umbrella', 3.3, 3.55, 0);
    // 来訪者 2 名（受付中）
    L.person(-2.4, 5.6, PI / 2, 'standTalk');
    L.person(-1.9, 6.2, PI / 2 + 0.3, 'stand');

    const g = (id: string, cx: number, cz: number, table: string, len: number, dep: number, per: number, cap: number, occ: number, inch: number, scr: string) => {
      const p: PickInfo = { title: `${id}（${cap}名）`, lines: [`${inch}型ディスプレイ＋Web会議カメラバー`, '来客対応・社外とのハイブリッド会議'] };
      L.add(table, cx, cz, PI / 2, p);
      L.obstacle(cx, cz, len, dep, PI / 2);
      L.tableChairs(cx, cz, PI / 2, len, dep, per, [cap > per * 2, false], occ, 'leather.black', p, { laptopScreens: ['slide1', 'slide2', 'sheet1'] });
      L.display(inch, scr, cx, 3.3, 0, p);
    };
    g('応接室 1', -10.8, 5.9, 'table.meet.1812', 1.8, 1.2, 3, 6, 0.5, 65, 'slide1');
    g('応接室 2', -6.8, 5.9, 'table.meet.1812', 1.8, 1.2, 3, 6, 0.0, 65, 'off');
    g('会議室 3', 7.2, 5.9, 'table.meet.2410', 2.4, 1.0, 3, 7, 0.75, 75, 'video4');
    g('Web会議室 4', 11.2, 5.9, 'table.meet.1608', 1.6, 0.8, 2, 4, 0.0, 55, 'lock');
  }

  // ---------------- コミュニケーションラウンジ ----------------
  {
    const pl: PickInfo = { title: 'コミュニケーションラウンジ', lines: ['パントリー・共用テーブル・ソファブース・窓際カウンター', '98型ディスプレイで全体朝礼／ハイブリッド配信', '南面バルコニー（新宿通り側）'] };
    L.add('pantry.back', -9.8, 12.0, 0, { title: 'パントリー', lines: ['コーヒーマシン×2・電子レンジ×2・冷蔵庫・ウォーターサーバー・シンク'] });
    L.obstacle(-9.8, 12.0, 5.6, 0.7);
    L.add('pantry.island', -9.8, 13.7, 0, pl);
    L.obstacle(-9.8, 13.7, 3.7, 0.9);
    for (const x of [-11.1, -10.2, -9.3, -8.4]) L.add('chair.stool', x, 14.55, 0);
    L.person(-10.2, 14.55, 0, 'sit', false, pl, 0.2);
    L.person(-9.3, 14.6, 0.3, 'sitLean', false, pl, 0.2);
    L.add('mug', -10.2, 13.75, 0, undefined, 0.3);
    L.add('mug', -9.2, 13.7, 0, undefined, 0.3);
    L.person(-10.8, 12.8, 0, 'stand', false, pl);
    L.person(-8.9, 12.8, -PI / 2 + 0.3, 'standTalk', false, pl);
    L.add('trash.station', -5.9, 12.0, 0);

    L.add('table.communal', 0, 14.6, 0, pl);
    L.obstacle(0, 14.6, 6.0, 1.2);
    L.tableChairs(0, 14.6, 0, 6.0, 1.2, 5, [false, false], 0.35, 'fabric.mustard', pl, { laptopScreens: ['code1', 'sheet2', 'dash1', 'video1'], web: 0.15 });

    L.add('sofa.booth', 7.6, 14.0, 0, pl);
    L.add('sofa.booth', 10.6, 14.0, 0, pl);
    L.obstacle(7.6, 14.0, 1.6, 2.3);
    L.obstacle(10.6, 14.0, 1.6, 2.3);
    L.person(7.6, 13.2, PI, 'sitSofa', true, pl);
    L.person(7.6, 14.8, 0, 'sitSofa', true, pl);
    L.add('laptop.video3', 7.6, 13.75, PI, pl);
    L.add('laptop.video1', 7.6, 14.25, 0, pl);
    L.person(10.6, 14.8, 0, 'sitSofa', false, pl);
    L.add('laptop.dash2', 10.6, 14.25, 0, pl);
    L.stats.laptops += 3;

    // ラグ＋ソファ（西）
    L.add('rug', -5.3, 15.6, 0);
    L.add('sofa.2', -5.3, 16.55, 0, pl);
    L.add('chair.lounge', -6.5, 14.9, PI + 0.4, pl);
    L.add('chair.lounge', -4.1, 14.9, PI - 0.4, pl);
    L.add('table.side', -5.3, 15.6, 0);
    L.person(-5.7, 16.45, 0, 'sitSofa', false, pl);
    L.person(-4.1, 14.95, PI - 0.4, 'sitSofa', false, pl);
    L.obstacle(-5.3, 15.6, 3.0, 2.2);

    // 窓際カウンター
    const counterXs = [-11.6, -10.6, -9.6, -8.6, -7.6, -6.6, -2, -1, 0, 1, 2, 6.6, 7.6, 8.6, 9.6, 10.6, 11.6];
    for (const x of counterXs) {
      L.add('table.counter', x, 17.85, 0, pl);
      L.add('chair.stool', x, 17.2, 0);
      L.stats.lounge++;
    }
    L.obstacle(-9.1, 17.85, 5.0, 0.45);
    L.obstacle(0, 17.85, 5.0, 0.45);
    L.obstacle(9.1, 17.85, 5.0, 0.45);
    for (const x of [-9.6, 1, 8.6]) {
      L.person(x, 17.2, 0, 'sitType', r.chance(0.4), pl, 0.2);
      L.add(`laptop.${r.pick(['code2', 'sheet1', 'video2'])}`, x, 17.75, 0, pl, 0.28);
      L.stats.laptops++;
    }

    // 98 型（サインウォール裏）
    L.display(98, 'slide2', 0, 9.66, 0, { title: '98型ディスプレイ', lines: ['全体朝礼・部会のハイブリッド配信（カメラバー付）'] });
    // ソフトな仕切り：低書架＋植栽
    for (const sgn of [1, -1]) {
      for (const z of [13.6, 15.5]) {
        L.add('shelf.low', sgn * 12.6, z, PI / 2);
        L.obstacle(sgn * 12.6, z, 1.8, 0.4, PI / 2);
      }
      L.add('plant.tall', sgn * 12.1, 17.4, 0);
    }
    L.add('plant.floor', -3.6, 12.2, 0);
    L.add('plant.floor', 3.6, 12.2, 1);
    L.stats.lounge += 10 + 4 + 8 + 4;
  }

  // ---------------- 歩行・立ち話 ----------------
  L.person(23.1, -3.0, 0.2, 'stand');
  L.person(23.4, 11.0, -PI / 2, 'standTalk');
  L.person(22.6, 11.1, PI / 2, 'standTalk');
  L.person(-23.2, -2.0, PI, 'stand');
  L.person(-12.0, 10.6, -PI / 2, 'stand');
  L.person(29.4, -11.4, PI / 2, 'standTalk');
  L.person(30.2, -11.6, -PI / 2, 'stand', true);

  // ---------------- コア：トイレ・給湯室・EVホール・機械室 ----------------
  {
    // 男子トイレ
    for (let i = 0; i < 5; i++) L.add('wc.urinal', -10.5, -8.2 + i * 0.8, -PI / 2);
    for (let i = 0; i < 4; i++) {
      const z = -9.1 + i * 1.0;
      L.add('wc.stall', -15.1, z, PI / 2);
      L.add('wc.toilet', -15.55, z, -PI / 2);
    }
    L.add('wc.lav', -13.2, -1.0, PI);
    // 多目的トイレ
    L.add('wc.toilet', -9.9, -6.6, 0);
    // 女子トイレ
    for (let i = 0; i < 7; i++) {
      const z = -9.1 + i * 1.0;
      L.add('wc.stall', 15.1, z, -PI / 2);
      L.add('wc.toilet', 15.55, z, PI / 2);
    }
    L.add('wc.lav', 10.8, -5.5, PI / 2);
    L.add('wc.lav', 12.6, -1.0, PI);
    // 共用給湯室
    L.add('sink.core', 8.9, -6.2, PI);
    L.add('vending', 7.86, -8.2, PI / 2, { title: '自動販売機', lines: ['公開情報：専有部出入口前に給湯室・自販機'] });
    // EV ホール
    L.add('aed', -2.15, 2.1, PI / 2, { title: 'AED', lines: ['EVホール南端'] });
    L.add('hydrant', 2.15, 1.2, -PI / 2, { title: '屋内消火栓', lines: [] });
    L.add('fire.ext', -5.5, -12.3, 0);
    L.add('fire.ext', 5.5, -12.3, 0);
    L.add('hydrant', -3.8, -12.3, 0, { title: '屋内消火栓', lines: [] });
    // 外調機
    L.add('ahu.unit', -7.2, -16.2, 0, { title: '外調機（全熱交換器）', lines: ['外気の予冷・予熱と換気'] });
    L.add('ahu.unit', 7.2, -16.2, 0, { title: '外調機（全熱交換器）', lines: ['外気の予冷・予熱と換気'] });
    // IDF・倉庫
    L.add('rack.42u', -15.2, 1.0, PI / 2, { title: 'IDFラック', lines: ['フロアスイッチ（PoE：無線AP給電）', 'パッチパネル'] });
    L.add('rack.42u', -15.2, 1.7, PI / 2, { title: 'IDFラック', lines: ['会議室AV機器・入退室管理盤'] });
    L.add('ups', -15.3, 2.5, PI / 2, { title: 'UPS', lines: [] });
    for (const x of [11.6, 13.5]) L.add('shelf.steel', x, -0.25, 0, { title: 'IT機器倉庫', lines: ['交換用PC・周辺機器'] });
    L.add('pc.cabinet', 15.4, 1.6, -PI / 2, { title: 'ノートPC保管庫（予備機）', lines: [] });
  }

  L.stats.desks.common = 0;
  return { obstacles: L.obstacles, stats: L.stats, seatSpots: L.seatSpots };
}

