/** 表示モード */
export type Mode = 'orbit' | 'plan' | 'walk' | 'exterior';

/**
 * 視点プリセット（three.js 座標：x=東, y=上, z=南）。
 * walk = [x, z, yaw, pitch]（yaw=0 で北向き、目線高 1.55m）。
 * Blender のカメラもここから生成する（scripts/export-scene.mjs → blender/cache/meta.json）。
 */
export interface Preset {
  name: string;
  group: string;
  mode: Mode;
  pos?: [number, number, number];
  target?: [number, number, number];
  walk?: [number, number, number, number?];
}

const PI = Math.PI;
export const PRESETS: Preset[] = [
  { name: '全体俯瞰', group: '俯瞰', mode: 'orbit', pos: [40, 58, 72], target: [0, 0, 0] },
  { name: '北西から', group: '俯瞰', mode: 'orbit', pos: [-52, 46, -58], target: [0, 0, 0] },
  { name: 'IT・システムG（東）', group: '俯瞰', mode: 'orbit', pos: [52, 30, 34], target: [26, 0, -1] },
  { name: 'リスク管理G（西）', group: '俯瞰', mode: 'orbit', pos: [-52, 30, 34], target: [-26, 0, -1] },
  { name: '来客・ラウンジ', group: '俯瞰', mode: 'orbit', pos: [2, 22, 34], target: [0, 0, 10] },
  { name: 'コア（EV・トイレ）', group: '俯瞰', mode: 'orbit', pos: [2, 30, 8], target: [0, 0, -8] },
  { name: 'SOC・検証ラボ', group: '俯瞰', mode: 'orbit', pos: [30, 14, -2], target: [20, 0, -12] },
  { name: 'EVホール → 入口', group: 'ウォークスルー', mode: 'walk', walk: [0, -7.5, PI, -0.04] },
  { name: 'エントランス受付', group: 'ウォークスルー', mode: 'walk', walk: [1.6, 3.7, PI - 0.28, 0.02] },
  { name: 'ラウンジ', group: 'ウォークスルー', mode: 'walk', walk: [9.2, 10.6, -PI * 0.69, -0.08] },
  { name: 'IT 執務（南）', group: 'ウォークスルー', mode: 'walk', walk: [13.9, 10.5, PI * 0.62, -0.08] },
  { name: 'IT 執務（東）', group: 'ウォークスルー', mode: 'walk', walk: [23.2, -11.0, PI * 0.74, -0.1] },
  { name: 'アジャイル開発', group: 'ウォークスルー', mode: 'walk', walk: [31.8, 3.1, PI * 0.62, -0.08] },
  { name: 'SOC', group: 'ウォークスルー', mode: 'walk', walk: [24.9, -13.1, -PI / 2 + 0.25, -0.05] },
  { name: '検証ラボ', group: 'ウォークスルー', mode: 'walk', walk: [21.8, -9.9, -PI / 2 - 0.45, -0.1] },
  { name: 'Webブース列', group: 'ウォークスルー', mode: 'walk', walk: [37.0, -11.5, -PI / 2 + 0.12, -0.05] },
  { name: 'リスク管理 執務', group: 'ウォークスルー', mode: 'walk', walk: [-13.8, 10.5, -PI * 0.62, -0.08] },
  { name: 'モニタリング室', group: 'ウォークスルー', mode: 'walk', walk: [-21.8, -4.8, PI * 0.3, -0.05] },
  { name: '大会議室 A', group: 'ウォークスルー', mode: 'walk', walk: [-34.75, 9.15, 0.38, -0.1] },
  { name: '書庫', group: 'ウォークスルー', mode: 'walk', walk: [-22.15, -13.3, 0, -0.05] },
  { name: '南東から', group: '外観', mode: 'exterior', pos: [62, 12, 92], target: [2, 9, 4] },
  { name: '新宿通り 歩道', group: '外観', mode: 'exterior', pos: [-3, -3.95, 29.4], target: [1, 1.6, 17] },
  { name: '2F バルコニー', group: '外観', mode: 'exterior', pos: [-11.6, 1.4, 21.2], target: [8, 0.8, 19] },
];

