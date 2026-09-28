/**
 * 麹町弘済ビルディング — 建物仕様
 *
 * 座標系（three.js）: x = 東(+), z = 南(+), y = 上(+)。単位はメートル。
 * 原点は 2 階の基準階プレート中心、y = 0 は 2 階 OA フロア仕上げ面（FL）。
 *
 * 「公開」= 公開情報で確認できた値、「推定」= 公開情報から逆算・想定した値。
 */

export const SPEC = {
  name: '麹町弘済ビルディング',
  address: '東京都千代田区麹町五丁目1番4号',
  owner: '公益財団法人 鉄道弘済会',
  design: '日建設計',
  construction: '清水建設',
  completed: '2025年6月30日',
  floors: '地上12階・地下2階',
  height: 62.166, // m 公開
  totalFloorArea: 36361.37, // ㎡ 公開
  siteArea: 6377.17, // ㎡ 公開
  buildingArea: 3298.28, // ㎡ 公開（建築物環境計画書 A棟）
  typicalRentable: 2214.0, // ㎡ 公開（669.73坪）
  typicalRentableTsubo: 669.73,
  divisions: [157.89, 207.12, 207.12, 97.76], // 坪 公開（4分割時）
  ceilingHeight: 2.8, // m 公開（一部 2.6m）
  floorLoad: '500kg/㎡（EV周り ヘビーデューティーゾーン 1,000kg/㎡）',
  hvac: '個別空調（1フロア 30ゾーン）',
  glazing: 'Low-E 複層ガラス',
  elevators: '乗用 7基（27人乗）＋ 非常用・人荷用 2基',
  generator: '非常用発電機（72時間）',
} as const;

/** 平面グリッド（推定）: 3.2m モジュール */
export const GRID = 3.2;

/** 基準階外形（推定）: 76.8m × 38.4m、北側に片寄せコア、コの字型の無柱オフィス（公開：コの字型無柱） */
export const PLATE = {
  x0: -38.4,
  x1: 38.4,
  z0: -19.2, // 北面
  z1: 19.2, // 南面（新宿通り側）
};

/** コア（推定）: 32.0m × 22.4m、北面に接する */
export const CORE = {
  x0: -16.0,
  x1: 16.0,
  z0: -19.2,
  z1: 3.2,
};

/** 高さ関係（推定。CH 2,800 は公開値） */
export const H = {
  oa: 0.1, // OA フロア高さ
  ceiling: 2.8, // 天井高（公開）
  ceilingLow: 2.6, // 一部 2.6m（公開）— 本モデルでは外周ペリメータ梁下に適用
  floorToFloor: 4.5, // 基準階階高（推定）
  firstFloor: 5.6, // 1階階高（推定）
  slab: 0.2,
  door: 2.4, // 一般扉高さ
  doorTall: 2.7, // ガラス間仕切り用ハイドア
  steelDoor: 2.1, // コア鉄扉
};

/** 2 階床レベルから見た地盤面（1F FL）: y = -H.firstFloor */
export const GROUND_Y = -H.firstFloor;

/** 外周柱（推定）: 6.4m スパン、800 角、カーテンウォール内側 */
export const COLUMN = {
  size: 0.8,
  inset: 0.55, // 外壁ラインから柱芯まで
  span: 6.4,
};

/** カーテンウォール（推定）: マリオン 1.6m ピッチ */
export const CW = {
  mullionPitch: 1.6,
  mullionDepth: 0.16,
  mullionWidth: 0.06,
  eave: 1.2, // 連続庇の出（推定）
  balcony: 2.4, // バルコニーの出（推定）
};

export const TSUBO = 3.305785; // ㎡/坪
