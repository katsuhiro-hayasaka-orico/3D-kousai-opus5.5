/**
 * 2 階 室・ゾーン定義（コア＝ビル共用部、専有部＝オリエントコーポレーション）
 *
 * 矩形 rect = [x0, z0, x1, z1]（x0<x1, z0<z1）。z0 が北側。
 * 専有部の矩形は重なりなく敷き詰めてあり、面積集計にそのまま使える。
 * 壁は各室の辺に「壁種」を指定し、同一線上の重複は walls.ts で優先度により統合する。
 */

export type Group = 'core' | 'it' | 'risk' | 'common' | 'visitor';
export type Side = 'n' | 's' | 'e' | 'w';
export type WallType = 'rc' | 'lgs' | 'glass' | 'film' | 'movable' | 'low';
export type DoorType =
  | 'steel'
  | 'steelDouble'
  | 'wood'
  | 'glass'
  | 'glassSec'
  | 'glassDouble'
  | 'sliding'
  | 'opening'
  | 'counter'
  | 'ev';

export interface Door {
  side: Side;
  /** 辺方向の中心座標（n/s 辺なら x、e/w 辺なら z） */
  at: number;
  w: number;
  type: DoorType;
  /** 開き勝手：in = 室内側へ開く（既定）、out = 室外側へ */
  swing?: 'in' | 'out';
  /** カードリーダー（入退室管理） */
  reader?: boolean;
  label?: string;
}

export type Kind =
  | 'stair'
  | 'vestibule'
  | 'machine'
  | 'evhall'
  | 'ev'
  | 'shaft'
  | 'corridor'
  | 'wc'
  | 'pantry'
  | 'idf'
  | 'storage'
  | 'entrance'
  | 'meeting'
  | 'web'
  | 'lounge'
  | 'soc'
  | 'focus'
  | 'aisle'
  | 'lab'
  | 'support'
  | 'office'
  | 'agile'
  | 'project'
  | 'locker'
  | 'archive'
  | 'monitor';

export interface Room {
  id: string;
  name: string;
  group: Group;
  kind: Kind;
  rect: [number, number, number, number];
  floor: string;
  walls?: Partial<Record<Side, WallType>>;
  doors?: Door[];
  /** 着席数（会議室・執務席など） */
  cap?: number;
  equip?: string[];
  note?: string;
  /** ラベル表示（既定 true） */
  label?: boolean;
  /** 天井高（既定 2.8） */
  ceiling?: number;
}

const RC4 = { n: 'rc', s: 'rc', e: 'rc', w: 'rc' } as const;

// ============================================================
// コア（ビル共用部）
// ============================================================
export const CORE_ROOMS: Room[] = [
  // --- 北側バンド ---
  { id: 'STAIR-W', name: '特別避難階段（西）', group: 'core', kind: 'stair', rect: [-16, -19.2, -12.8, -12.4], floor: 'floor.concrete', walls: { ...RC4 }, label: true },
  {
    id: 'VEST-W', name: '付室（西）', group: 'core', kind: 'vestibule', rect: [-12.8, -19.2, -9.6, -12.4], floor: 'floor.stone', walls: { ...RC4 },
    doors: [
      { side: 's', at: -11.2, w: 1.0, type: 'steel', swing: 'in' },
      { side: 'w', at: -14.2, w: 0.9, type: 'steel', swing: 'out' },
    ],
    note: '排煙設備付き。避難時は共用廊下→付室→階段の順に避難。',
  },
  { id: 'AHU-W', name: '外調機械室（西）', group: 'core', kind: 'machine', rect: [-9.6, -19.2, -4.8, -12.4], floor: 'floor.concrete', walls: { ...RC4 }, doors: [{ side: 's', at: -7.2, w: 1.0, type: 'steel', swing: 'in' }], equip: ['外気処理空調機（全熱交換器）', 'ダクトシャフト'] },
  {
    id: 'EVL-S', name: '非常用EV乗降ロビー', group: 'core', kind: 'evhall', rect: [-4.8, -16.4, 4.8, -12.4], floor: 'floor.stone', walls: { ...RC4 },
    doors: [{ side: 's', at: 0, w: 1.8, type: 'steelDouble', swing: 'out', label: '常時開放防火戸' }],
  },
  { id: 'EV-8', name: '非常用EV（30人乗）', group: 'core', kind: 'ev', rect: [-4.8, -19.2, -1.4, -16.4], floor: 'floor.shaft', walls: { ...RC4 }, doors: [{ side: 's', at: -3.1, w: 1.2, type: 'ev' }], label: false },
  { id: 'PS-N', name: 'PS', group: 'core', kind: 'shaft', rect: [-1.4, -19.2, 1.4, -16.4], floor: 'floor.shaft', walls: { ...RC4 }, label: false },
  { id: 'EV-9', name: '人荷用EV（17人乗）', group: 'core', kind: 'ev', rect: [1.4, -19.2, 4.8, -16.4], floor: 'floor.shaft', walls: { ...RC4 }, doors: [{ side: 's', at: 3.1, w: 1.0, type: 'ev' }], label: false },
  { id: 'AHU-E', name: '外調機械室（東）', group: 'core', kind: 'machine', rect: [4.8, -19.2, 9.6, -12.4], floor: 'floor.concrete', walls: { ...RC4 }, doors: [{ side: 's', at: 7.2, w: 1.0, type: 'steel', swing: 'in' }], equip: ['外気処理空調機（全熱交換器）', 'ダクトシャフト'] },
  {
    id: 'VEST-E', name: '付室（東）', group: 'core', kind: 'vestibule', rect: [9.6, -19.2, 12.8, -12.4], floor: 'floor.stone', walls: { ...RC4 },
    doors: [
      { side: 's', at: 11.2, w: 1.0, type: 'steel', swing: 'in' },
      { side: 'e', at: -14.2, w: 0.9, type: 'steel', swing: 'out' },
    ],
  },
  { id: 'STAIR-E', name: '特別避難階段（東）', group: 'core', kind: 'stair', rect: [12.8, -19.2, 16, -12.4], floor: 'floor.concrete', walls: { ...RC4 } },

  // --- 共用廊下 ---
  {
    id: 'CORR', name: '共用廊下', group: 'core', kind: 'corridor', rect: [-16, -12.4, 16, -10.2], floor: 'floor.stone', walls: { ...RC4 },
    doors: [
      { side: 'w', at: -11.5, w: 1.6, type: 'steelDouble', swing: 'in', reader: true, label: '通用口（西）・避難方向に開く' },
      { side: 'e', at: -11.5, w: 1.6, type: 'steelDouble', swing: 'in', reader: true, label: '通用口（東）・避難方向に開く' },
    ],
    note: '乗用EVホールと東西のオフィス通用口、トイレ・給湯室・階段付室を結ぶ。',
  },

  // --- 乗用 EV ホール（7基：西4・東3） ---
  {
    id: 'EVH', name: '乗用EVホール', group: 'core', kind: 'evhall', rect: [-2.25, -10.2, 2.25, 3.2], floor: 'floor.stone',
    walls: { s: 'glass' },
    doors: [{ side: 's', at: 0, w: 1.8, type: 'glassDouble', swing: 'in', reader: true, label: 'メインエントランス（オリエントコーポレーション）' }],
    equip: ['乗用EV 7基（27人乗）', 'インジケーター・ホールランタン', 'AED・消火器'],
    note: '公開情報：常用7基（27人乗）。EV周りはヘビーデューティーゾーン（1,000kg/㎡）。',
  },
  ...[0, 1, 2, 3].map((i): Room => {
    const z0 = -10.2 + i * 2.8;
    return { id: `EV-${i + 1}`, name: `乗用EV ${i + 1}号機`, group: 'core', kind: 'ev', rect: [-4.9, z0, -2.25, z0 + 2.8], floor: 'floor.shaft', walls: { ...RC4 }, doors: [{ side: 'e', at: z0 + 1.4, w: 1.1, type: 'ev' }], label: false };
  }),
  ...[0, 1, 2].map((i): Room => {
    const z0 = -10.2 + i * 2.8;
    return { id: `EV-${i + 5}`, name: `乗用EV ${i + 5}号機`, group: 'core', kind: 'ev', rect: [2.25, z0, 4.9, z0 + 2.8], floor: 'floor.shaft', walls: { ...RC4 }, doors: [{ side: 'w', at: z0 + 1.4, w: 1.1, type: 'ev' }], label: false };
  }),
  { id: 'PS-W1', name: 'PS', group: 'core', kind: 'shaft', rect: [-4.9, 1.0, -2.25, 3.2], floor: 'floor.shaft', walls: { ...RC4 }, label: false },
  { id: 'EPS-E1', name: 'EPS', group: 'core', kind: 'shaft', rect: [2.25, -1.8, 4.9, 3.2], floor: 'floor.shaft', walls: { ...RC4 }, label: false },

  // --- 西側：男子トイレ・多目的・EPS・DS ---
  {
    id: 'WC-M', name: '男子トイレ', group: 'core', kind: 'wc', rect: [-16, -10.2, -10.4, -0.6], floor: 'floor.tile', walls: { ...RC4 },
    doors: [{ side: 'n', at: -11.4, w: 1.0, type: 'opening' }],
    equip: ['小便器 ×5', '大便器ブース ×4', '3連洗面カウンター（自動水栓）'],
  },
  {
    id: 'WC-MP', name: '多目的トイレ', group: 'core', kind: 'wc', rect: [-10.4, -10.2, -7.4, -5.8], floor: 'floor.tile', walls: { ...RC4 },
    doors: [{ side: 'n', at: -8.9, w: 1.2, type: 'sliding' }],
    equip: ['オストメイト対応', 'ベビーシート', '手すり'],
  },
  { id: 'EPS-W', name: 'EPS', group: 'core', kind: 'shaft', rect: [-7.4, -10.2, -4.9, -5.8], floor: 'floor.concrete', walls: { ...RC4 }, doors: [{ side: 'n', at: -6.15, w: 0.8, type: 'steel', swing: 'out' }], label: false },
  { id: 'DS-W', name: 'DS/PS', group: 'core', kind: 'shaft', rect: [-10.4, -5.8, -4.9, 3.2], floor: 'floor.shaft', walls: { ...RC4 }, label: false },
  {
    id: 'IDF-W', name: 'テナント用IDF室（西）', group: 'core', kind: 'idf', rect: [-16, -0.6, -10.4, 3.2], floor: 'floor.vinyl', walls: { ...RC4 },
    doors: [{ side: 's', at: -14.8, w: 0.9, type: 'steel', swing: 'out', reader: true }],
    equip: ['フロアスイッチ（PoE）', 'パッチパネル', 'UPS'], note: '専有部側から出入り。無線LAN AP・会議室機器を収容。',
  },

  // --- 東側：女子トイレ・給湯室・EPS・DS ---
  {
    id: 'WC-F', name: '女子トイレ', group: 'core', kind: 'wc', rect: [10.4, -10.2, 16, -0.6], floor: 'floor.tile', walls: { ...RC4 },
    doors: [{ side: 'n', at: 11.4, w: 1.0, type: 'opening' }],
    equip: ['大便器ブース ×7', '3連洗面カウンター ×2（うち1台はパウダーコーナー）'],
  },
  {
    id: 'PAN-C', name: '共用給湯室', group: 'core', kind: 'pantry', rect: [7.4, -10.2, 10.4, -5.8], floor: 'floor.tile', walls: { ...RC4 },
    doors: [{ side: 'n', at: 8.9, w: 1.2, type: 'opening' }],
    equip: ['流し台', '電気温水器', '自動販売機'], note: '公開情報：専有部出入口前に給湯室・自販機。',
  },
  { id: 'EPS-E', name: 'EPS', group: 'core', kind: 'shaft', rect: [4.9, -10.2, 7.4, -5.8], floor: 'floor.concrete', walls: { ...RC4 }, doors: [{ side: 'n', at: 6.15, w: 0.8, type: 'steel', swing: 'out' }], label: false },
  { id: 'DS-E', name: 'DS/PS', group: 'core', kind: 'shaft', rect: [4.9, -5.8, 10.4, 3.2], floor: 'floor.shaft', walls: { ...RC4 }, label: false },
  {
    id: 'STK-E', name: 'IT機器倉庫', group: 'core', kind: 'storage', rect: [10.4, -0.6, 16, 3.2], floor: 'floor.vinyl', walls: { ...RC4 },
    doors: [{ side: 's', at: 14.8, w: 0.9, type: 'steel', swing: 'out', reader: true }],
    equip: ['スチールラック', '交換用PC・周辺機器', '廃棄PC保管（データ消去待ち）'], note: '専有部側から出入り。',
  },
];

// ============================================================
// 専有部（オリエントコーポレーション）
// ============================================================
export const TENANT_ROOMS: Room[] = [
  // ---------------- 来客ゾーン（中央） ----------------
  {
    id: 'ENT', name: 'エントランス・受付', group: 'visitor', kind: 'entrance', rect: [-4.8, 3.2, 4.8, 9.6], floor: 'floor.stone',
    walls: { s: 'lgs' },
    doors: [
      { side: 's', at: -4.05, w: 1.1, type: 'glassSec', reader: true, label: 'セキュリティドア（西）' },
      { side: 's', at: 4.05, w: 1.1, type: 'glassSec', reader: true, label: 'セキュリティドア（東）' },
    ],
    equip: ['無人受付（内線電話・受付タブレット）', 'サインウォール', '共連れ防止カードリーダー', '監視カメラ'],
    note: '来客は受付→応接／会議室まで。執務エリアへはICカードで入室。',
  },
  { id: 'G1', name: '応接室 1', group: 'visitor', kind: 'meeting', rect: [-12.8, 3.2, -8.8, 8.0], floor: 'floor.carpetVisitor', walls: { s: 'glass', e: 'lgs', w: 'lgs' }, doors: [{ side: 's', at: -10.8, w: 0.9, type: 'glass' }], cap: 6, equip: ['65型ディスプレイ', 'Web会議カメラバー', '天井マイク'] },
  { id: 'G2', name: '応接室 2', group: 'visitor', kind: 'meeting', rect: [-8.8, 3.2, -4.8, 8.0], floor: 'floor.carpetVisitor', walls: { s: 'glass', e: 'lgs' }, doors: [{ side: 's', at: -6.8, w: 0.9, type: 'glass' }], cap: 6, equip: ['65型ディスプレイ', 'Web会議カメラバー'] },
  { id: 'VC-W', name: '来客通路（西）', group: 'visitor', kind: 'corridor', rect: [-12.8, 8.0, -4.8, 9.6], floor: 'floor.carpetVisitor', walls: { w: 'lgs', s: 'lgs' }, label: false },
  { id: 'G3', name: '会議室 3（来客）', group: 'visitor', kind: 'meeting', rect: [4.8, 3.2, 9.6, 8.0], floor: 'floor.carpetVisitor', walls: { s: 'glass', w: 'lgs', e: 'lgs' }, doors: [{ side: 's', at: 7.2, w: 0.9, type: 'glass' }], cap: 8, equip: ['75型ディスプレイ', 'Web会議カメラバー', '天井マイク'] },
  { id: 'G4', name: 'Web会議室 4（来客）', group: 'visitor', kind: 'web', rect: [9.6, 3.2, 12.8, 8.0], floor: 'floor.carpetVisitor', walls: { s: 'glass', e: 'lgs' }, doors: [{ side: 's', at: 11.2, w: 0.9, type: 'glass' }], cap: 4, equip: ['55型ディスプレイ', 'Web会議カメラバー'] },
  { id: 'VC-E', name: '来客通路（東）', group: 'visitor', kind: 'corridor', rect: [4.8, 8.0, 12.8, 9.6], floor: 'floor.carpetVisitor', walls: { e: 'lgs', s: 'lgs' }, label: false },

  // ---------------- 共用ラウンジ（南面中央） ----------------
  {
    id: 'LOUNGE', name: 'コミュニケーションラウンジ', group: 'common', kind: 'lounge', rect: [-12.8, 9.6, 12.8, 19.2], floor: 'floor.wood',
    cap: 48,
    equip: ['パントリー（コーヒーマシン・冷蔵庫・電子レンジ・ウォーターサーバー）', '98型ディスプレイ（全体会議・ハイブリッド配信）', 'ハイバックソファブース（Web会議可）', '窓際カウンター', '南面バルコニー出入口'],
    note: '両グループの交流・全体朝礼・来訪社員のフリー席を兼ねる。新宿通りに面する南面。',
  },

  // ---------------- IT・システムグループ（東側） ----------------
  {
    id: 'SOC', name: 'セキュリティ監視室（SOC/CSIRT）', group: 'it', kind: 'soc', rect: [16, -19.2, 25.6, -12.4], floor: 'floor.carpetDark',
    walls: { e: 'lgs', s: 'film' },
    doors: [{ side: 's', at: 17.4, w: 1.0, type: 'glassSec', reader: true, label: '生体認証＋ICカード' }],
    cap: 6, equip: ['55型×6面 ビデオウォール', '監視卓 6席（トリプルモニター）', 'インシデント対応テーブル', '入室記録カメラ'],
    note: 'サイバーセキュリティ室。ガラスは全面すりガラスフィルムで画面を秘匿。',
  },
  { id: 'FOCUS-E', name: '集中エリア・Webブース（IT）', group: 'it', kind: 'focus', rect: [25.6, -19.2, 38.4, -12.4], floor: 'floor.carpetIT', cap: 16, equip: ['集中席（サイドパネル付）×8', '1人用Webブース ×4', '2人用Webブース ×2'] },
  { id: 'AIS-E3', name: '通路', group: 'it', kind: 'aisle', rect: [16, -12.4, 38.4, -10.6], floor: 'floor.carpetAccent', label: false },
  {
    id: 'LAB', name: '検証ラボ', group: 'it', kind: 'lab', rect: [16, -10.6, 22.4, -4.2], floor: 'floor.vinyl',
    walls: { n: 'lgs', e: 'glass', s: 'lgs' },
    doors: [{ side: 'e', at: -7.4, w: 1.0, type: 'glassSec', reader: true }],
    cap: 4, equip: ['42Uラック ×5（検証環境）', '作業台（静電対策）', 'スマートフォン検証端末キャビネット', '帯電防止床'],
  },
  {
    id: 'ITSUP', name: 'ITサポートデスク・キッティング', group: 'it', kind: 'support', rect: [16, -4.2, 22.4, 3.2], floor: 'floor.carpetIT',
    walls: { e: 'lgs', s: 'lgs' },
    doors: [
      { side: 'e', at: -2.6, w: 0.9, type: 'wood' },
      { side: 'e', at: 1.4, w: 1.8, type: 'counter', label: 'ヘルプデスク窓口' },
    ],
    cap: 4, equip: ['ヘルプデスク窓口カウンター', 'キッティング作業台 ×2', 'ノートPC充電保管庫 ×3', '貸出用モバイルPC・Webカメラ・ヘッドセット'],
    note: 'モバイルPCの配備・故障対応・貸出を担う。',
  },
  { id: 'A2-E', name: '通路', group: 'it', kind: 'aisle', rect: [22.4, -10.6, 24, 9.6], floor: 'floor.carpetAccent', label: false },
  { id: 'WORK-E1', name: 'IT・システムG 執務エリア（東）', group: 'it', kind: 'office', rect: [24, -10.6, 38.4, 2.2], floor: 'floor.carpetIT', cap: 48, equip: ['ベンチデスク 8人島 ×6（W1200×D700/席、中央スクリーンH400）', '各席 24型モニター＋USB-Cドック（モバイルPC接続）', 'グループアドレス運用'] },
  { id: 'AIS-E4', name: '通路', group: 'it', kind: 'aisle', rect: [24, 2.2, 30.4, 4.4], floor: 'floor.carpetAccent', label: false },
  {
    id: 'PRJ-E', name: 'プロジェクトルーム', group: 'it', kind: 'project', rect: [24, 4.4, 30.4, 9.6], floor: 'floor.carpetDark',
    walls: { n: 'glass', e: 'lgs', s: 'glass', w: 'glass' },
    doors: [{ side: 'w', at: 5.6, w: 0.9, type: 'glass' }],
    cap: 10, equip: ['75型ディスプレイ', 'Web会議カメラバー', 'ホワイトボード壁', '天井マイク'],
    note: 'システム開発案件の常設プロジェクトルーム。',
  },
  { id: 'AGILE-E', name: 'アジャイル開発エリア', group: 'it', kind: 'agile', rect: [30.4, 2.2, 38.4, 9.6], floor: 'floor.carpetAccent', cap: 12, equip: ['スタンディングテーブル ×2', 'モバイルホワイトボード ×3', 'カンバンボード', 'モバイルディスプレイ'] },
  { id: 'WEB-E1', name: 'Web会議室 E-1', group: 'it', kind: 'web', rect: [16, 3.2, 19.2, 6.4], floor: 'floor.carpetDark', walls: { e: 'lgs', s: 'lgs', w: 'glass' }, doors: [{ side: 'w', at: 4.8, w: 0.9, type: 'glass' }], cap: 2, equip: ['43型ディスプレイ', 'Webカメラ', '吸音パネル'] },
  { id: 'WEB-E2', name: 'Web会議室 E-2', group: 'it', kind: 'web', rect: [16, 6.4, 19.2, 9.6], floor: 'floor.carpetDark', walls: { s: 'glass', w: 'lgs' }, doors: [{ side: 's', at: 17.6, w: 0.9, type: 'glass' }], cap: 3, equip: ['43型ディスプレイ', 'Webカメラ', '吸音パネル'] },
  { id: 'MTG-E1', name: '会議室 E-1', group: 'it', kind: 'meeting', rect: [19.2, 3.2, 22.4, 9.6], floor: 'floor.carpetDark', walls: { w: 'lgs', e: 'glass', s: 'glass' }, doors: [{ side: 's', at: 20.8, w: 0.9, type: 'glass' }], cap: 6, equip: ['65型ディスプレイ', 'Web会議カメラバー'] },
  { id: 'ALC-E', name: 'ロッカーコーナー（IT）', group: 'it', kind: 'locker', rect: [12.8, 3.2, 16, 9.6], floor: 'floor.carpetIT', equip: ['個人ロッカー（電子錠・PC充電コンセント付）'] },
  { id: 'WORK-E2', name: 'IT・システムG 執務エリア（南）', group: 'it', kind: 'office', rect: [12.8, 9.6, 38.4, 19.2], floor: 'floor.carpetIT', cap: 48, equip: ['ベンチデスク 8人島 ×6（南面窓に直交配置）', '各席 24型モニター＋USB-Cドック', '南東バルコニー出入口'] },

  // ---------------- リスク管理グループ（西側） ----------------
  {
    id: 'ARCH', name: '書庫・文書保管室', group: 'risk', kind: 'archive', rect: [-25.6, -19.2, -16, -12.4], floor: 'floor.vinyl',
    walls: { w: 'lgs', s: 'lgs' },
    doors: [{ side: 's', at: -17.6, w: 1.0, type: 'steel', swing: 'in', reader: true }],
    equip: ['電動式移動棚（集密書架）', '業務用シュレッダー', 'スキャナー（電子化作業台）'],
    note: '契約・審査関連書類を施錠管理。入退室ログ取得。',
  },
  { id: 'FOCUS-W', name: '集中エリア・Webブース（リスク）', group: 'risk', kind: 'focus', rect: [-38.4, -19.2, -25.6, -12.4], floor: 'floor.carpetRisk', cap: 16, equip: ['集中席（サイドパネル付）×8', '1人用Webブース ×4', '2人用Webブース ×2'] },
  { id: 'AIS-W3', name: '通路', group: 'risk', kind: 'aisle', rect: [-38.4, -12.4, -16, -10.6], floor: 'floor.carpetAccent', label: false },
  {
    id: 'MON', name: 'モニタリングルーム（入室制限）', group: 'risk', kind: 'monitor', rect: [-22.4, -10.6, -16, -4.2], floor: 'floor.carpetDark',
    walls: { n: 'lgs', w: 'film', s: 'lgs' },
    doors: [{ side: 'w', at: -7.4, w: 1.0, type: 'glassSec', swing: 'out', reader: true }],
    cap: 6, equip: ['監視卓 6席（デュアルモニター）', '55型×4面 モニターウォール', '不正検知ダッシュボード'],
    note: '不正利用・与信モニタリング等の機微情報を扱う想定の入室制限室。',
  },
  {
    id: 'MTG-W2', name: '会議室 W-2', group: 'risk', kind: 'meeting', rect: [-22.4, -4.2, -16, 3.2], floor: 'floor.carpetDark',
    walls: { w: 'glass', s: 'lgs' },
    doors: [{ side: 'w', at: -2.6, w: 0.9, type: 'glass' }],
    cap: 8, equip: ['65型ディスプレイ', 'Web会議カメラバー', '天井マイク'],
  },
  { id: 'A2-W', name: '通路', group: 'risk', kind: 'aisle', rect: [-24, -10.6, -22.4, 9.6], floor: 'floor.carpetAccent', label: false },
  { id: 'WORK-W1', name: 'リスク管理G 執務エリア（西）', group: 'risk', kind: 'office', rect: [-38.4, -10.6, -24, 2.2], floor: 'floor.carpetRisk', cap: 48, equip: ['ベンチデスク 8人島 ×6（木目天板）', '各席 24型モニター＋USB-Cドック', '複合機コーナー・個人ロッカー'] },
  {
    id: 'BIG-A', name: '大会議室 A', group: 'risk', kind: 'meeting', rect: [-35.2, 2.2, -29.6, 9.6], floor: 'floor.carpetDark',
    walls: { n: 'lgs', w: 'lgs', s: 'glass', e: 'movable' },
    doors: [{ side: 's', at: -34.5, w: 0.9, type: 'glass' }],
    cap: 12, equip: ['86型ディスプレイ', 'Web会議カメラ（話者追尾）', '天井アレイマイク', '可動間仕切りでB室と一体利用（24名）'],
  },
  {
    id: 'BIG-B', name: '大会議室 B', group: 'risk', kind: 'meeting', rect: [-29.6, 2.2, -24, 9.6], floor: 'floor.carpetDark',
    walls: { n: 'lgs', e: 'glass', s: 'glass' },
    doors: [{ side: 's', at: -24.8, w: 0.9, type: 'glass' }],
    cap: 12, equip: ['86型ディスプレイ', 'Web会議カメラ（話者追尾）', '天井アレイマイク'],
  },
  { id: 'PERI-W', name: 'ペリメーターブース', group: 'risk', kind: 'office', rect: [-38.4, 2.2, -35.2, 9.6], floor: 'floor.carpetRisk', cap: 4, equip: ['2人用ハイバックブース ×2'] },
  { id: 'WEB-W1', name: 'Web会議室 W-1', group: 'risk', kind: 'web', rect: [-19.2, 3.2, -16, 6.4], floor: 'floor.carpetDark', walls: { w: 'lgs', s: 'lgs', e: 'glass' }, doors: [{ side: 'e', at: 4.8, w: 0.9, type: 'glass' }], cap: 2, equip: ['43型ディスプレイ', 'Webカメラ', '吸音パネル'] },
  { id: 'WEB-W2', name: 'Web会議室 W-2', group: 'risk', kind: 'web', rect: [-19.2, 6.4, -16, 9.6], floor: 'floor.carpetDark', walls: { s: 'glass', e: 'lgs' }, doors: [{ side: 's', at: -17.6, w: 0.9, type: 'glass' }], cap: 3, equip: ['43型ディスプレイ', 'Webカメラ', '吸音パネル'] },
  { id: 'MTG-W1', name: '会議室 W-1', group: 'risk', kind: 'meeting', rect: [-22.4, 3.2, -19.2, 9.6], floor: 'floor.carpetDark', walls: { e: 'lgs', w: 'glass', s: 'glass' }, doors: [{ side: 's', at: -20.8, w: 0.9, type: 'glass' }], cap: 6, equip: ['65型ディスプレイ', 'Web会議カメラバー'] },
  { id: 'ALC-W', name: 'ロッカーコーナー（リスク）', group: 'risk', kind: 'locker', rect: [-16, 3.2, -12.8, 9.6], floor: 'floor.carpetRisk', equip: ['個人ロッカー（電子錠・PC充電コンセント付）'] },
  { id: 'WORK-W2', name: 'リスク管理G 執務エリア（南）', group: 'risk', kind: 'office', rect: [-38.4, 9.6, -12.8, 19.2], floor: 'floor.carpetRisk', cap: 48, equip: ['ベンチデスク 8人島 ×6（南面窓に直交配置）', '各席 24型モニター＋USB-Cドック', '南西バルコニー出入口'] },
];

export const ALL_ROOMS: Room[] = [...CORE_ROOMS, ...TENANT_ROOMS];

export function roomArea(r: Room): number {
  const [x0, z0, x1, z1] = r.rect;
  return (x1 - x0) * (z1 - z0);
}

export function roomAt(x: number, z: number): Room | undefined {
  // 小さい室を優先
  let best: Room | undefined;
  let bestA = Infinity;
  for (const r of ALL_ROOMS) {
    const [x0, z0, x1, z1] = r.rect;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) {
      const a = roomArea(r);
      if (a < bestA) {
        best = r;
        bestA = a;
      }
    }
  }
  return best;
}

export function roomById(id: string): Room {
  const r = ALL_ROOMS.find((q) => q.id === id);
  if (!r) throw new Error('room not found: ' + id);
  return r;
}

export const GROUP_LABEL: Record<Group, string> = {
  core: '共用部（コア）',
  it: 'IT・システムグループ',
  risk: 'リスク管理グループ',
  common: '共用（ラウンジ）',
  visitor: '来客ゾーン',
};

/** バルコニー（推定位置）: 外壁面・範囲 */
export interface Balcony {
  id: string;
  side: Side;
  from: number;
  to: number;
  doors: number[]; // 扉中心
}
export const BALCONIES: Balcony[] = [
  { id: 'BAL-S', side: 's', from: -12.8, to: 12.8, doors: [-4.0, 4.0] },
  { id: 'BAL-SE', side: 's', from: 22.4, to: 32.0, doors: [28.0] },
  { id: 'BAL-SW', side: 's', from: -32.0, to: -22.4, doors: [-28.0] },
  { id: 'BAL-E', side: 'e', from: -12.8, to: -3.2, doors: [-8.8] },
  { id: 'BAL-W', side: 'w', from: -12.8, to: -3.2, doors: [-8.8] },
];
