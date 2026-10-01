import * as THREE from 'three';
import { Mode, PRESETS, Preset } from '../data/presets';
import { ALL_ROOMS, GROUP_LABEL, Group, Room, roomArea, roomAt } from '../data/rooms';
import { TSUBO } from '../data/spec';

/**
 * 自動ツアー：カット割りした視点を順に再生し、3D 間取りを網羅的に見せる。
 *
 *  ハイライト（約 3 分）：外観 → フロア全体・平面図（ゾーニング・避難経路・無線 LAN）→ エリア俯瞰
 *                        → ウォークスルー 13 か所 → 夕方への時間経過 → 締め
 *  全室めぐり（約 2.5 分）：名前のある全室を 1 室ずつ（床に枠で強調、寸法・面積・席数・設備を字幕に）
 *
 * カットの中ではカメラをゆっくり動かし（軌道・ドリー・ティルト）、カットの境目は暗転でつなぐ。
 * ウォークスルーの前進量は、壁・柱・家具に当たらない範囲に収める（TourHost.free）。
 * 録画するときは、WebGL の画面に字幕と進行バーを重ねたキャンバスを MediaRecorder で WebM にする。
 */

export type Pose =
  | { kind: 'persp'; pos: THREE.Vector3; target: THREE.Vector3 }
  | { kind: 'walk'; x: number; z: number; yaw: number; pitch: number }
  | { kind: 'plan'; x: number; z: number; zoom: number };

/** ツアーが切り替える表示レイヤー（UI の表示レイヤーのキー） */
export const TOUR_KEYS = ['labels', 'ceiling', 'zones', 'wifi', 'evac', 'ac', 'grid'] as const;
export type TourKey = (typeof TOUR_KEYS)[number];
export type Overlay = Partial<Record<TourKey, boolean>>;
/** カットで指定しないときの状態 */
const OVERLAY_DEFAULT: Record<TourKey, boolean> = { labels: true, ceiling: false, zones: false, wifi: false, evac: false, ac: false, grid: false };

export interface Cut {
  chapter: string;
  title: string;
  sub?: string;
  /** 秒（速度 1×） */
  dur: number;
  mode: Mode;
  /** 時刻。配列なら [開始, 終了] で時間経過させる */
  sun?: number | [number, number];
  overlay?: Overlay;
  /** 床に枠を描く室の矩形 */
  highlight?: [number, number, number, number];
  /** t = 0〜1（カット内の進行、イージング済み） */
  pose: (t: number) => Pose;
}

export interface TourStats {
  officeNet: number;
  desks: { it: number; risk: number };
  meetingRooms: number;
  meetingSeats: number;
  present: number;
  aps: number;
}

export interface TourHost {
  /** 開始時：現在の状態を退避し、通常の UI を隠す */
  enter(): void;
  /** 終了時：退避した状態に戻す */
  leave(): void;
  setMode(m: Mode): void;
  apply(p: Pose): void;
  setSun(hours: number): void;
  setOverlay(o: Record<TourKey, boolean>): void;
  highlight(rect: [number, number, number, number] | null): void;
  /** ウォークスルーで立てる位置か */
  free(x: number, z: number): boolean;
  stats: TourStats;
  canvas: HTMLCanvasElement;
}

export type Program = 'highlight' | 'rooms' | 'all';
export const PROGRAMS: { key: Program; label: string; note: string }[] = [
  { key: 'highlight', label: 'ハイライト', note: '外観・平面図・エリア俯瞰・ウォークスルー・時間経過（約 3 分）' },
  { key: 'rooms', label: '全室めぐり', note: '名前のある全室を 1 室ずつ、寸法・面積・席数・設備つきで（約 2.5 分）' },
  { key: 'all', label: 'すべて', note: 'ハイライト → 全室めぐり（約 5.5 分）' },
];

// ------------------------------------------------------------
// カメラの動き
// ------------------------------------------------------------
const D2R = Math.PI / 180;
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * THREE.MathUtils.clamp(t, 0, 1));
const lerp = THREE.MathUtils.lerp;

/** 注視点のまわりの方位（北から時計回り、度）・仰角（度）・距離からカメラ位置 */
function around(target: THREE.Vector3, azDeg: number, elDeg: number, dist: number): THREE.Vector3 {
  const az = azDeg * D2R;
  const el = elDeg * D2R;
  return new THREE.Vector3(
    target.x + Math.sin(az) * Math.cos(el) * dist,
    target.y + Math.sin(el) * dist,
    target.z - Math.cos(az) * Math.cos(el) * dist,
  );
}

/** プリセットの視点を中心に、注視点のまわりを sweep 度回る（distK で距離を寄せる・引く） */
function arc(pos: [number, number, number], target: [number, number, number], sweep: number, distK: [number, number] = [1, 0.94], liftY = 0) {
  const t = new THREE.Vector3(...target);
  const d = new THREE.Vector3(...pos).sub(t);
  const dist = d.length();
  const az = Math.atan2(d.x, -d.z) / D2R;
  const el = Math.asin(d.y / dist) / D2R;
  return (k: number): Pose => {
    const tt = t.clone();
    tt.y += liftY * k;
    return { kind: 'persp', pos: around(tt, az - sweep / 2 + sweep * k, el, dist * lerp(distK[0], distK[1], k)), target: tt };
  };
}

function preset(name: string): Preset {
  const p = PRESETS.find((q) => q.name === name);
  if (!p) throw new Error(`プリセットがない: ${name}`);
  return p;
}

/** ウォークスルー：プリセットの位置から、ぶつからない範囲で前進しながら少し首を振る */
function walkDolly(start: [number, number, number, number?], free: (x: number, z: number) => boolean, maxLen = 2.4, pan = 0.07) {
  const [x, z, yaw, pitch = -0.05] = start;
  const fx = Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let reach = 0;
  for (let s = 0.1; s <= maxLen + 0.7; s += 0.1) {
    if (!free(x + fx * s, z + fz * s)) break;
    reach = s;
  }
  const len = Math.max(0, Math.min(maxLen, reach - 1.0));
  return (k: number): Pose => ({ kind: 'walk', x: x + fx * len * k, z: z + fz * len * k, yaw: yaw + pan * (k - 0.5) * 2, pitch });
}

function roomLine(r: Room | undefined): string {
  if (!r) return '';
  const [x0, z0, x1, z1] = r.rect;
  const a = roomArea(r);
  const parts = [`${(x1 - x0).toFixed(1)}×${(z1 - z0).toFixed(1)}m`, `${a.toFixed(1)}㎡（${(a / TSUBO).toFixed(1)}坪）`];
  if (r.cap) parts.push(`${r.cap}席`);
  return parts.join('・');
}

/** 視線の先（0〜10 m）で最初に見つかる、通路・廊下以外の室 */
function roomAhead([x, z, yaw]: [number, number, number, number?]): Room | undefined {
  for (let s = 0; s <= 10; s += 0.5) {
    const r = roomAt(x + Math.sin(yaw) * s, z - Math.cos(yaw) * s);
    if (r && r.kind !== 'aisle' && r.kind !== 'corridor') return r;
  }
  return roomAt(x, z);
}

/** start を渡すとプリセットの代わりにその位置から撮る（プリセットの構図が手前の人物で塞がるときなど） */
function walkCut(name: string, title: string, free: TourHost['free'], start?: [number, number, number, number?], maxLen?: number, dur = 6): Cut {
  const w = start ?? preset(name).walk!;
  const r = roomAhead(w);
  const equip = r?.equip?.slice(0, 2).join('、');
  return {
    chapter: 'ウォークスルー',
    title,
    sub: [r ? `${r.name}（${roomLine(r)}）` : '', equip ?? ''].filter(Boolean).join('　'),
    dur,
    mode: 'walk',
    pose: walkDolly(w, free, maxLen),
  };
}

// ------------------------------------------------------------
// プログラム
// ------------------------------------------------------------
function highlightCuts(host: TourHost): Cut[] {
  const st = host.stats;
  const se = preset('南東から');
  const street = preset('新宿通り 歩道');
  const balcony = preset('2F バルコニー');
  const all = preset('全体俯瞰');
  const cuts: Cut[] = [
    {
      chapter: '外観',
      title: '麹町弘済ビルディング',
      sub: '千代田区麹町 5-1-4・地上 12 階／地下 2 階・高さ 62.166m・2025 年竣工（公開情報）',
      dur: 9,
      mode: 'exterior',
      sun: 10.5,
      pose: arc(se.pos!, [2, 16, 4], 26, [1.05, 0.92]),
    },
    {
      chapter: '外観',
      title: '新宿通りから見上げる',
      sub: '2 階（基準階 669.73 坪）が今回の再現対象',
      dur: 6,
      mode: 'exterior',
      sun: 10.5,
      pose: (k) => ({ kind: 'persp', pos: new THREE.Vector3(...street.pos!), target: new THREE.Vector3(1, lerp(1.6, 9, k), 17) }),
    },
    {
      chapter: '外観',
      title: '2F 南面バルコニー',
      sub: '各分割区画に専用バルコニー（公開。位置・寸法は推定）',
      dur: 6,
      mode: 'exterior',
      sun: 10.5,
      pose: (k) => {
        const dx = lerp(0, 6, k);
        return { kind: 'persp', pos: new THREE.Vector3(balcony.pos![0] + dx, balcony.pos![1], balcony.pos![2]), target: new THREE.Vector3(balcony.target![0] + dx, balcony.target![1], balcony.target![2]) };
      },
    },
    {
      chapter: 'フロア全体',
      title: '2F 全体',
      sub: `専有 ${st.officeNet.toFixed(1)}㎡（${(st.officeNet / TSUBO).toFixed(2)}坪）・執務席 IT ${st.desks.it}／リスク ${st.desks.risk}・会議室 ${st.meetingRooms} 室 ${st.meetingSeats} 席`,
      dur: 9,
      mode: 'orbit',
      sun: 10.5,
      pose: arc(all.pos!, all.target!, 34, [1.0, 0.86]),
    },
    {
      chapter: 'フロア全体',
      title: '平面図',
      sub: '外形 76.8×38.4m・3.2m モジュール・北側片寄せコア 32.0×22.4m（推定）',
      dur: 6,
      mode: 'plan',
      overlay: { grid: true },
      pose: (k) => ({ kind: 'plan', x: 0, z: 0, zoom: lerp(1, 1.08, k) }),
    },
    {
      chapter: 'フロア全体',
      title: 'ゾーニング',
      sub: '東：IT・システムグループ　西：リスク管理グループ　南中央：来客・ラウンジ　北：コア',
      dur: 6,
      mode: 'plan',
      overlay: { zones: true },
      pose: (k) => ({ kind: 'plan', x: 0, z: 0, zoom: lerp(1.04, 1.12, k) }),
    },
    {
      chapter: 'フロア全体',
      title: '避難経路',
      sub: '2 方向避難（東西の特別避難階段）',
      dur: 5,
      mode: 'plan',
      overlay: { evac: true },
      pose: (k) => ({ kind: 'plan', x: 0, z: 0, zoom: lerp(1.08, 1.14, k) }),
    },
    {
      chapter: 'フロア全体',
      title: '無線 LAN',
      sub: `アクセスポイント ${st.aps} 台（モバイル PC・Web 会議前提の配置。推定）`,
      dur: 5,
      mode: 'plan',
      overlay: { wifi: true },
      pose: (k) => ({ kind: 'plan', x: 0, z: 0, zoom: lerp(1.12, 1.16, k) }),
    },
  ];
  const areas: [string, string, string][] = [
    ['IT・システムG（東）', 'IT・システムグループ', '執務エリア・アジャイル開発・SOC・検証ラボ・Web ブース'],
    ['SOC・検証ラボ', 'セキュリティ監視室・検証ラボ', '入室制限エリア（カードリーダー）'],
    ['来客・ラウンジ', '来客ゾーンとラウンジ', 'エントランス・応接室・コミュニケーションラウンジ'],
    ['リスク管理G（西）', 'リスク管理グループ', '執務エリア・モニタリングルーム・大会議室・書庫'],
    ['コア（EV・トイレ）', 'コア', '乗用 EV 7 基・トイレ・給湯室・IDF 室'],
  ];
  for (const [name, title, sub] of areas) {
    const p = preset(name);
    cuts.push({ chapter: 'エリア', title, sub, dur: 6, mode: 'orbit', pose: arc(p.pos!, p.target!, 22, [1.02, 0.9]) });
  }
  const walks: [string, string, [number, number, number, number?]?, number?][] = [
    ['EVホール → 入口', 'EV ホールから入口へ'],
    ['エントランス受付', 'エントランス・受付'],
    ['ラウンジ', 'コミュニケーションラウンジ'],
    ['IT 執務（南）', 'IT・システムG 執務エリア（南）'],
    // 縦通路（A2-E）を南へ。東の島が左手に並ぶ
    ['IT 執務（東）', 'IT・システムG 執務エリア（東）', [23.2, -9.6, Math.PI * 0.93, -0.1]],
    ['アジャイル開発', 'アジャイル開発エリア'],
    ['Webブース列', '集中エリア・Web ブース'],
    ['SOC', 'セキュリティ監視室（SOC/CSIRT）'],
    ['検証ラボ', '検証ラボ'],
    ['リスク管理 執務', 'リスク管理G 執務エリア'],
    ['モニタリング室', 'モニタリングルーム'],
    ['大会議室 A', '大会議室 A'],
    // 移動棚の隙間へ入り込まないよう、前進せずに見回すだけ
    ['書庫', '書庫・文書保管室', undefined, 0],
  ];
  for (const [name, title, start, len] of walks) cuts.push(walkCut(name, title, host.free, start, len));
  cuts.push(
    {
      chapter: '時間の移ろい',
      title: '15:00 → 18:00',
      sub: '2026 年 9 月 28 日の太陽位置。日が傾くと室内照明が浮かび上がる',
      dur: 11,
      mode: 'exterior',
      sun: [15, 18],
      pose: arc(se.pos!, [2, 16, 4], 18, [1.0, 0.95]),
    },
    {
      chapter: 'おわりに',
      title: '麹町弘済ビルディング 2F — 3D 間取り再現モデル',
      sub: '公開情報に基づく参考再現（内装・人員配置は想定）',
      dur: 7,
      mode: 'orbit',
      sun: 10.5,
      pose: arc(all.pos!, all.target!, 20, [0.95, 1.25]),
    },
  );
  return cuts;
}

const ROOM_ORDER: Group[] = ['it', 'risk', 'visitor', 'common', 'core'];

function roomCuts(): Cut[] {
  const rooms = ALL_ROOMS.filter((r) => r.label !== false && r.kind !== 'ev' && r.kind !== 'shaft');
  rooms.sort((a, b) => {
    const g = ROOM_ORDER.indexOf(a.group) - ROOM_ORDER.indexOf(b.group);
    if (g) return g;
    // 東から西へ、同じ列は北から南へ
    const ax = (a.rect[0] + a.rect[2]) / 2;
    const bx = (b.rect[0] + b.rect[2]) / 2;
    if (Math.abs(ax - bx) > 3) return a.group === 'risk' ? ax - bx : bx - ax;
    return a.rect[1] - b.rect[1];
  });
  return rooms.map((r, i) => {
    const [x0, z0, x1, z1] = r.rect;
    const t = new THREE.Vector3((x0 + x1) / 2, 0.4, (z0 + z1) / 2);
    const span = Math.max(x1 - x0, z1 - z0);
    const dist = THREE.MathUtils.clamp(span * 1.15 + 6, 10, 34);
    const az0 = 196 + ((i * 37) % 40) - 20;
    const equip = r.equip?.slice(0, 3).join('、');
    return {
      chapter: `全室めぐり：${GROUP_LABEL[r.group]}`,
      title: r.name,
      sub: [roomLine(r), equip].filter(Boolean).join('　'),
      dur: 3.2,
      mode: 'orbit' as Mode,
      sun: 10.5,
      highlight: r.rect,
      pose: (k: number): Pose => ({ kind: 'persp', pos: around(t, az0 + 14 * k, 56, dist * lerp(1.04, 0.96, k)), target: t }),
    };
  });
}

// ------------------------------------------------------------
// 再生
// ------------------------------------------------------------
const FADE_IN = 0.45;
const FADE_OUT = 0.35;

export class Tour {
  active = false;
  private cuts: Cut[] = [];
  private starts: number[] = [];
  private total = 0;
  private time = 0;
  private index = -1;
  private paused = false;
  private speed = 1;
  private sunAcc = 0;
  private program: Program = 'highlight';
  private el: HTMLElement;
  private fade: HTMLElement;
  private cap: { chapter: HTMLElement; title: HTMLElement; sub: HTMLElement; count: HTMLElement };
  private bar: HTMLElement;
  private fill: HTMLElement;
  private playBtn: HTMLButtonElement;
  private speedBtn: HTMLButtonElement;
  private recBadge: HTMLElement;
  private rec: { recorder: MediaRecorder; chunks: Blob[]; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    parent: HTMLElement,
    private host: TourHost,
  ) {
    this.fade = document.createElement('div');
    this.fade.id = 'tourFade';
    this.el = document.createElement('div');
    this.el.id = 'tour';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="tour-bar" title="クリックでその位置へ"><div class="tour-fill"></div></div>
      <div class="tour-cap">
        <div class="tour-chapter"></div>
        <div class="tour-title"></div>
        <div class="tour-sub"></div>
      </div>
      <div class="tour-ctl" role="toolbar" aria-label="ツアーの操作">
        <button data-a="prev" title="前のカット（←）">⏮</button>
        <button data-a="play" title="一時停止／再生（Space）">❚❚</button>
        <button data-a="next" title="次のカット（→）">⏭</button>
        <button data-a="speed" title="速度">1×</button>
        <span class="tour-count"></span>
        <span class="tour-rec" hidden>● 録画中</span>
        <button data-a="exit" title="終了（Esc）">✕ 終了</button>
      </div>`;
    parent.append(this.fade, this.el);
    this.bar = this.el.querySelector('.tour-bar')!;
    this.fill = this.el.querySelector('.tour-fill')!;
    this.cap = {
      chapter: this.el.querySelector('.tour-chapter')!,
      title: this.el.querySelector('.tour-title')!,
      sub: this.el.querySelector('.tour-sub')!,
      count: this.el.querySelector('.tour-count')!,
    };
    this.playBtn = this.el.querySelector('[data-a="play"]')!;
    this.speedBtn = this.el.querySelector('[data-a="speed"]')!;
    this.recBadge = this.el.querySelector('.tour-rec')!;
    this.el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'prev') this.jump(this.index - (this.time - this.starts[this.index] > 1.5 ? 0 : 1));
        if (a === 'next') this.jump(this.index + 1);
        if (a === 'play') this.setPaused(!this.paused);
        if (a === 'speed') this.setSpeed(this.speed === 1 ? 1.5 : this.speed === 1.5 ? 2 : 1);
        if (a === 'exit') this.stop();
      };
    });
    this.bar.onclick = (e) => {
      const r = this.bar.getBoundingClientRect();
      this.seek(((e.clientX - r.left) / r.width) * this.total);
    };
  }

  /** 再生を始める。record=true なら字幕込みで WebM に録画し、終了時に保存する */
  start(program: Program, record = false): void {
    if (this.active) this.stop();
    this.program = program;
    this.cuts = program === 'highlight' ? highlightCuts(this.host) : program === 'rooms' ? roomCuts() : [...highlightCuts(this.host), ...roomCuts()];
    this.starts = [];
    let t = 0;
    for (const c of this.cuts) {
      this.starts.push(t);
      t += c.dur;
    }
    this.total = t;
    this.buildBar();
    this.active = true;
    this.paused = false;
    this.speed = 1;
    this.speedBtn.textContent = '1×';
    this.playBtn.textContent = '❚❚';
    this.time = 0;
    this.index = -1;
    this.host.enter();
    document.body.classList.add('touring');
    this.el.hidden = false;
    window.addEventListener('keydown', this.onKey, true);
    if (record) this.startRecording();
    this.update(0);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.el.hidden = true;
    this.fade.style.opacity = '0';
    document.body.classList.remove('touring');
    window.removeEventListener('keydown', this.onKey, true);
    this.host.highlight(null);
    this.host.leave();
    this.stopRecording();
  }

  /** 撮影・確認用 */
  get state() {
    return { active: this.active, program: this.program, time: this.time, total: this.total, index: this.index, cuts: this.cuts.length, paused: this.paused, title: this.cuts[this.index]?.title };
  }

  seek(sec: number): void {
    if (!this.active) return;
    this.time = THREE.MathUtils.clamp(sec, 0, this.total - 1e-3);
    this.index = -1; // カットの開始処理（モード・時刻・レイヤー）をやり直す
    this.update(0);
  }

  private jump(i: number): void {
    if (i >= this.cuts.length) return this.stop();
    this.seek(this.starts[Math.max(0, i)] + 1e-3);
  }

  private setPaused(p: boolean): void {
    this.paused = p;
    this.playBtn.textContent = p ? '▶' : '❚❚';
  }

  private setSpeed(s: number): void {
    this.speed = s;
    this.speedBtn.textContent = `${s}×`;
  }

  private key(e: KeyboardEvent): void {
    if (!this.active) return;
    const handled = ['Escape', ' ', 'ArrowLeft', 'ArrowRight'].includes(e.key);
    if (!handled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') this.stop();
    if (e.key === ' ') this.setPaused(!this.paused);
    if (e.key === 'ArrowLeft') this.jump(this.index - 1);
    if (e.key === 'ArrowRight') this.jump(this.index + 1);
  }

  /** 毎フレーム（メインループから。カメラは描画の前に置く） */
  update(dt: number): void {
    if (!this.active) return;
    if (!this.paused) this.time += dt * this.speed;
    if (this.time >= this.total) {
      this.stop();
      return;
    }
    let i = this.index >= 0 ? this.index : 0;
    while (i + 1 < this.cuts.length && this.time >= this.starts[i + 1]) i++;
    while (i > 0 && this.time < this.starts[i]) i--;
    const cut = this.cuts[i];
    if (i !== this.index) this.begin(i);
    const local = this.time - this.starts[i];
    const k = ease(local / cut.dur);
    if (Array.isArray(cut.sun)) {
      this.sunAcc += dt * this.speed;
      // 太陽の更新（影・空の焼き直し）は重いので間引く
      if (this.sunAcc > 0.2 || local < 0.05) {
        this.sunAcc = 0;
        this.host.setSun(lerp(cut.sun[0], cut.sun[1], local / cut.dur));
      }
    }
    this.host.apply(cut.pose(k));
    const fadeIn = 1 - THREE.MathUtils.clamp(local / FADE_IN, 0, 1);
    const fadeOut = THREE.MathUtils.clamp((local - (cut.dur - FADE_OUT)) / FADE_OUT, 0, 1);
    this.fade.style.opacity = String(Math.max(fadeIn, fadeOut));
    this.fill.style.width = `${(this.time / this.total) * 100}%`;
  }

  /** 描画の直後（録画中なら字幕と進行バーを重ねて 1 コマ書く） */
  afterRender(): void {
    if (!this.rec || !this.active) return;
    const { ctx, canvas } = this.rec;
    const src = this.host.canvas;
    if (canvas.width !== src.width || canvas.height !== src.height) {
      canvas.width = src.width;
      canvas.height = src.height;
    }
    const w = canvas.width;
    const h = canvas.height;
    ctx.globalAlpha = 1;
    ctx.drawImage(src, 0, 0, w, h);
    const fade = Number(this.fade.style.opacity || 0);
    if (fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, w, h);
    }
    const cut = this.cuts[this.index];
    if (cut) {
      const s = h / 900;
      const font = '"Hiragino Sans","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';
      const pad = 26 * s;
      ctx.font = `600 ${17 * s}px ${font}`;
      const subW = cut.sub ? ctx.measureText(cut.sub).width : 0;
      ctx.font = `700 ${34 * s}px ${font}`;
      const titleW = ctx.measureText(cut.title).width;
      const boxW = Math.min(w - 2 * pad, Math.max(titleW, subW) + 2 * pad);
      const boxH = (cut.sub ? 118 : 88) * s;
      ctx.fillStyle = 'rgba(16,24,40,0.72)';
      ctx.fillRect(pad, h - boxH - pad * 1.6, boxW, boxH);
      ctx.fillStyle = '#9fc2ff';
      ctx.font = `600 ${15 * s}px ${font}`;
      ctx.fillText(cut.chapter, pad * 2, h - boxH - pad * 1.6 + 30 * s);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${34 * s}px ${font}`;
      ctx.fillText(cut.title, pad * 2, h - boxH - pad * 1.6 + 70 * s);
      if (cut.sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font = `600 ${17 * s}px ${font}`;
        ctx.fillText(cut.sub, pad * 2, h - boxH - pad * 1.6 + 100 * s, w - 4 * pad);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, h - 5 * s, w, 5 * s);
      ctx.fillStyle = '#4f8cff';
      ctx.fillRect(0, h - 5 * s, (w * this.time) / this.total, 5 * s);
    }
  }

  private begin(i: number): void {
    const prev = this.cuts[this.index];
    this.index = i;
    const cut = this.cuts[i];
    if (!prev || prev.mode !== cut.mode) this.host.setMode(cut.mode);
    this.host.setOverlay({ ...OVERLAY_DEFAULT, ...cut.overlay });
    this.host.highlight(cut.highlight ?? null);
    const sun = Array.isArray(cut.sun) ? cut.sun[0] : (cut.sun ?? 10.5);
    if (!prev || prev.sun !== cut.sun || Array.isArray(prev.sun)) this.host.setSun(sun);
    this.sunAcc = 0;
    this.cap.chapter.textContent = cut.chapter;
    this.cap.title.textContent = cut.title;
    this.cap.sub.textContent = cut.sub ?? '';
    this.cap.sub.hidden = !cut.sub;
    this.cap.count.textContent = `${i + 1} / ${this.cuts.length}`;
  }

  private buildBar(): void {
    this.bar.querySelectorAll('.tour-mark').forEach((m) => m.remove());
    let last = '';
    this.cuts.forEach((c, i) => {
      if (c.chapter === last) return;
      last = c.chapter;
      const m = document.createElement('div');
      m.className = 'tour-mark';
      m.style.left = `${(this.starts[i] / this.total) * 100}%`;
      m.title = c.chapter;
      this.bar.appendChild(m);
    });
  }

  private startRecording(): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    if (!ctx || !type || !canvas.captureStream) {
      alert('このブラウザでは録画できません（MediaRecorder の WebM に非対応）。再生だけを続けます。');
      return;
    }
    canvas.width = this.host.canvas.width;
    canvas.height = this.host.canvas.height;
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      a.download = `kojimachi-kousai-2f-tour-${this.program}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    recorder.start(1000);
    this.rec = { recorder, chunks, canvas, ctx };
    this.recBadge.hidden = false;
  }

  private stopRecording(): void {
    if (!this.rec) return;
    this.rec.recorder.stop();
    this.rec = null;
    this.recBadge.hidden = true;
  }
}
