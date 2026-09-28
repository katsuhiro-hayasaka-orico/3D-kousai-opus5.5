import * as THREE from 'three';
import { G, PB, mat4 } from '../core/geom';
import { Instancer } from '../core/instancer';

/**
 * 家具・機器・人物のプロトタイプ定義（実寸、単位 m）。
 * 共通の向き：
 *   - 椅子・人物：人は -z 方向を向く（背もたれは +z 側）
 *   - 画面・機器・収納：正面は +z 方向
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 2 点間のカプセル（手足） */
export function limb(pb: PB, mat: string, r: number, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize());
  const m = new THREE.Matrix4().compose(mid, q, V(1, 1, 1));
  pb.add(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 2, 7), mat, m);
}

// ------------------------------------------------------------
// 人物
// ------------------------------------------------------------

export type Pose = 'sit' | 'sitType' | 'sitLean' | 'stand' | 'standTalk' | 'standPoint' | 'sitSofa';

function head(pb: PB, cx: number, cy: number, cz: number, headset: boolean): void {
  pb.sphere('person.skin', 0.1, cx, cy, cz, 0.9, 1.05, 0.95, 12, 9);
  pb.sphere('person.hair', 0.104, cx, cy + 0.03, cz + 0.02, 0.93, 0.85, 0.96, 12, 8);
  // 目・眉・鼻（顔は -z 側）
  for (const s of [-1, 1]) {
    pb.sphere('person.eye', 0.011, cx + s * 0.032, cy + 0.012, cz - 0.088, 1, 1.1, 0.6, 5, 4);
    pb.box('person.hairFixed', 0.03, 0.006, 0.01, cx + s * 0.033, cy + 0.04, cz - 0.089, 0, 0, s * -0.12);
  }
  pb.sphere('person.skin', 0.014, cx, cy - 0.012, cz - 0.098, 0.8, 1.2, 0.8, 5, 4);
  pb.box('person.mouth', 0.026, 0.004, 0.006, cx, cy - 0.045, cz - 0.09);
  // 耳
  pb.sphere('person.skin', 0.022, cx - 0.093, cy - 0.005, cz + 0.005, 0.5, 1, 0.8, 5, 4);
  pb.sphere('person.skin', 0.022, cx + 0.093, cy - 0.005, cz + 0.005, 0.5, 1, 0.8, 5, 4);
  if (headset) {
    // ヘッドバンド（XY 平面の半円＝左右の耳をつなぐ）
    pb.add(new THREE.TorusGeometry(0.108, 0.009, 6, 18, Math.PI), 'headset', new THREE.Matrix4().makeTranslation(cx, cy + 0.01, cz + 0.01));
    pb.cyl('headset', 0.04, 0.04, 0.025, cx - 0.105, cy - 0.01, cz + 0.005, 12, 0, 0, Math.PI / 2);
    pb.cyl('headset', 0.04, 0.04, 0.025, cx + 0.105, cy - 0.01, cz + 0.005, 12, 0, 0, Math.PI / 2);
    // マイクブーム
    pb.pipe('headset', 0.005, V(cx - 0.11, cy - 0.03, cz), V(cx - 0.06, cy - 0.09, cz - 0.09));
  }
}

export function personParts(pb: PB, pose: Pose, headset = false): void {
  const skin = 'person.skin';
  const top = 'person.top';
  const bot = 'person.bottom';
  const shoe = 'person.shoe';
  if (pose === 'sit' || pose === 'sitType' || pose === 'sitLean' || pose === 'sitSofa') {
    const hipY = pose === 'sitSofa' ? 0.44 : 0.5;
    const lean = pose === 'sitLean' ? 0.12 : pose === 'sitSofa' ? 0.14 : -0.06;
    // 骨盤
    pb.sphere(bot, 0.17, 0, hipY + 0.02, 0.03, 1.0, 0.62, 0.8, 10, 7);
    // 胴
    pb.pushT(0, hipY + 0.05, 0.04, 0, lean, 0);
    pb.add(G.capsule(0.15, 0.3, 3), top, mat4(0, 0.3, 0, 0, 0, 0, 1.12, 1, 0.72));
    pb.sphere(top, 0.155, 0, 0.44, 0, 1.3, 0.5, 0.72, 10, 7); // 肩
    pb.cyl(skin, 0.045, 0.05, 0.08, 0, 0.56, 0, 10);
    head(pb, 0, 0.7, -0.01, headset);
    pb.pop();
    // 脚
    const kneeZ = pose === 'sitSofa' ? -0.46 : -0.42;
    const kneeY = pose === 'sitSofa' ? 0.46 : 0.52;
    for (const s of [-1, 1]) {
      limb(pb, bot, 0.07, V(s * 0.1, hipY, 0.0), V(s * 0.11, kneeY, kneeZ));
      limb(pb, bot, 0.055, V(s * 0.11, kneeY, kneeZ - 0.02), V(s * 0.115, 0.1, kneeZ - 0.06));
      pb.box(shoe, 0.095, 0.07, 0.25, s * 0.115, 0.035, kneeZ - 0.12);
    }
    // 腕
    const shY = hipY + 0.05 + 0.44 * Math.cos(lean);
    const shZ = 0.04 + 0.44 * Math.sin(lean);
    for (const s of [-1, 1]) {
      const sh = V(s * 0.19, shY, shZ);
      if (pose === 'sitType') {
        const el = V(s * 0.21, hipY + 0.28, shZ - 0.2);
        const wr = V(s * 0.12, 0.79, -0.45);
        limb(pb, top, 0.045, sh, el);
        limb(pb, top, 0.04, el, wr);
        pb.sphere(skin, 0.037, wr.x, wr.y, wr.z - 0.03, 1, 0.6, 1.3, 6, 5);
      } else if (pose === 'sitLean' || pose === 'sitSofa') {
        const el = V(s * 0.23, hipY + 0.2, shZ - 0.05);
        const wr = V(s * 0.16, hipY + 0.14, -0.25);
        limb(pb, top, 0.045, sh, el);
        limb(pb, top, 0.04, el, wr);
        pb.sphere(skin, 0.037, wr.x, wr.y, wr.z - 0.02, 1, 0.6, 1.3, 6, 5);
      } else {
        // 机に手を置く
        const el = V(s * 0.22, hipY + 0.26, shZ - 0.15);
        const wr = V(s * 0.18, 0.78, -0.4);
        limb(pb, top, 0.045, sh, el);
        limb(pb, top, 0.04, el, wr);
        pb.sphere(skin, 0.037, wr.x, wr.y, wr.z - 0.03, 1, 0.6, 1.3, 6, 5);
      }
    }
    return;
  }
  // 立位
  const hipY = 0.93;
  pb.sphere(bot, 0.17, 0, hipY + 0.02, 0, 1, 0.6, 0.72, 10, 7);
  pb.add(G.capsule(0.15, 0.3, 3), top, mat4(0, hipY + 0.33, 0, 0, 0, 0, 1.12, 1, 0.72));
  pb.sphere(top, 0.155, 0, hipY + 0.47, 0, 1.3, 0.5, 0.72, 10, 7);
  pb.cyl(skin, 0.045, 0.05, 0.08, 0, hipY + 0.58, 0, 10);
  head(pb, 0, hipY + 0.72, 0, headset);
  for (const s of [-1, 1]) {
    limb(pb, bot, 0.072, V(s * 0.1, hipY, 0), V(s * 0.105, 0.5, 0.0));
    limb(pb, bot, 0.056, V(s * 0.105, 0.5, 0.0), V(s * 0.11, 0.09, 0.02));
    pb.box(shoe, 0.095, 0.07, 0.25, s * 0.11, 0.035, -0.05);
  }
  const shY = hipY + 0.47;
  for (const s of [-1, 1]) {
    const sh = V(s * 0.2, shY, 0);
    let el = V(s * 0.24, shY - 0.28, 0.02);
    let wr = V(s * 0.25, shY - 0.55, -0.02);
    if (pose === 'standTalk') {
      el = V(s * 0.23, shY - 0.28, -0.02);
      wr = V(s * 0.12, shY - 0.36, -0.28);
    }
    if (pose === 'standPoint' && s > 0) {
      el = V(0.3, shY - 0.05, -0.18);
      wr = V(0.34, shY + 0.18, -0.42);
    }
    limb(pb, top, 0.045, sh, el);
    limb(pb, top, 0.04, el, wr);
    pb.sphere(skin, 0.038, wr.x, wr.y, wr.z, 1, 1.2, 0.8, 6, 5);
  }
}

// ------------------------------------------------------------
// 家具
// ------------------------------------------------------------

const DESK_H = 0.72;

function taskChair(pb: PB, pulledOut: number, turn: number): void {
  pb.pushT(0, 0, pulledOut, turn);
  // 5 本脚ベース
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    pb.box('plastic.black', 0.04, 0.035, 0.3, Math.sin(a) * 0.15, 0.07, Math.cos(a) * 0.15, 0, a, 0);
    pb.cyl('plastic.black', 0.026, 0.026, 0.03, Math.sin(a) * 0.3, 0.026, Math.cos(a) * 0.3, 6, 0, a, Math.PI / 2);
  }
  pb.cyl('chrome', 0.022, 0.022, 0.3, 0, 0.24, 0, 8);
  pb.box('plastic.black', 0.28, 0.04, 0.3, 0, 0.39, 0.02);
  // 座
  pb.box('fabric.gray', 0.5, 0.075, 0.48, 0, 0.45, -0.01);
  // 背（メッシュ）
  pb.box('plastic.black', 0.05, 0.5, 0.04, 0, 0.62, 0.26, -0.12, 0, 0);
  pb.box('mesh.black', 0.46, 0.56, 0.035, 0, 0.83, 0.27, -0.1, 0, 0);
  pb.box('plastic.black', 0.48, 0.05, 0.05, 0, 1.11, 0.3, -0.1, 0, 0);
  // 肘掛
  for (const s of [-1, 1]) {
    pb.box('plastic.black', 0.03, 0.22, 0.04, s * 0.26, 0.55, 0.05);
    pb.box('plastic.black', 0.07, 0.03, 0.26, s * 0.26, 0.665, 0.0);
  }
  pb.pop();
}

function meetingChair(pb: PB, mat: string): void {
  // 樹脂シェル＋スチール 4 本脚
  for (const [x, z] of [
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ]) {
    pb.cyl('frame.silver', 0.011, 0.011, 0.45, x, 0.225, z, 8);
  }
  pb.box(mat, 0.47, 0.05, 0.46, 0, 0.47, 0);
  pb.box(mat, 0.46, 0.42, 0.04, 0, 0.72, 0.23, -0.12, 0, 0);
}

function laptop(pb: PB, screen: string | null, x: number, z: number, ry: number, onStand = false): void {
  pb.pushT(x, DESK_H, z, ry);
  let y0 = 0;
  if (onStand) {
    pb.box('alu', 0.24, 0.01, 0.22, 0, 0.005, 0);
    pb.box('alu', 0.2, 0.12, 0.012, 0, 0.065, -0.1, -0.5, 0, 0);
    y0 = 0.07;
    pb.pushT(0, y0, 0, 0, -0.35, 0);
  }
  pb.box('alu', 0.31, 0.016, 0.215, 0, 0.008, 0);
  pb.box('plastic.dark', 0.27, 0.002, 0.1, 0, 0.017, -0.02);
  if (screen) {
    pb.pushT(0, 0.016, -0.105, 0, -0.26, 0);
    pb.box('alu', 0.31, 0.205, 0.006, 0, 0.1025, 0);
    pb.plane(screen, 0.29, 0.18, 0, 0.106, 0.0035);
    pb.pop();
  } else {
    pb.box('alu', 0.31, 0.008, 0.215, 0, 0.02, 0);
  }
  if (onStand) pb.pop();
  pb.pop();
}

function monitor24(pb: PB, screen: string, x: number, z: number, ry = 0): void {
  pb.pushT(x, DESK_H, z, ry);
  pb.box('plastic.black', 0.23, 0.012, 0.19, 0, 0.006, 0.0);
  pb.box('plastic.black', 0.045, 0.3, 0.03, 0, 0.16, -0.035);
  pb.box('plastic.black', 0.545, 0.33, 0.028, 0, 0.36, -0.01);
  pb.plane(screen, 0.52, 0.295, 0, 0.365, 0.0045);
  pb.pop();
}

function keyboardMouse(pb: PB, x: number, z: number): void {
  pb.box('plastic.dark', 0.36, 0.018, 0.12, x, DESK_H + 0.009, z);
  pb.box('plastic.black', 0.34, 0.004, 0.1, x, DESK_H + 0.02, z);
  pb.sphere('plastic.dark', 0.032, x + 0.26, DESK_H + 0.012, z, 0.9, 0.45, 1.5, 10, 6);
}

export function defineProtos(I: Instancer): void {
  // --- 人物 ---
  for (const pose of ['sit', 'sitType', 'sitLean', 'stand', 'standTalk', 'standPoint', 'sitSofa'] as Pose[]) {
    I.define(`person.${pose}`, (pb) => personParts(pb, pose, false));
    I.define(`person.${pose}.hs`, (pb) => personParts(pb, pose, true));
  }

  // --- 椅子 ---
  I.define('chair.task', (pb) => taskChair(pb, 0, 0));
  for (const m of ['fabric.gray', 'fabric.blue', 'fabric.green', 'fabric.mustard', 'fabric.terracotta', 'fabric.navy', 'fabric.beige', 'leather.black']) {
    I.define('chair.meet.' + m, (pb) => meetingChair(pb, m));
  }
  I.define('chair.stool', (pb) => {
    pb.cyl('frame.black', 0.2, 0.2, 0.02, 0, 0.01, 0, 20);
    pb.cyl('frame.black', 0.02, 0.02, 0.62, 0, 0.32, 0, 8);
    pb.cyl('wood.mid', 0.19, 0.19, 0.04, 0, 0.66, 0, 20);
    pb.add(new THREE.TorusGeometry(0.18, 0.008, 6, 20), 'frame.black', new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.3, 0));
  });
  I.define('chair.lounge', (pb) => {
    pb.box('fabric.mustard', 0.72, 0.18, 0.7, 0, 0.3, 0);
    pb.box('fabric.mustard', 0.72, 0.45, 0.14, 0, 0.55, 0.3, -0.15, 0, 0);
    pb.box('fabric.mustard', 0.12, 0.25, 0.66, -0.34, 0.45, 0);
    pb.box('fabric.mustard', 0.12, 0.25, 0.66, 0.34, 0.45, 0);
    for (const [x, z] of [
      [-0.3, -0.28],
      [0.3, -0.28],
      [-0.3, 0.28],
      [0.3, 0.28],
    ])
      pb.cyl('wood.dark', 0.018, 0.014, 0.21, x, 0.105, z, 8);
  });

  // --- デスク島（片側 n 席 × 両面） ---
  for (const n of [2, 3, 4]) {
    for (const [tag, topMat] of [
      ['white', 'top.white'],
      ['wood', 'wood.light'],
    ] as const) {
      I.define(`island.${n}.${tag}`, (pb) => {
        const L = n * 1.2;
        pb.box(topMat, L, 0.025, 0.69, 0, DESK_H - 0.0125, -0.355);
        pb.box(topMat, L, 0.025, 0.69, 0, DESK_H - 0.0125, 0.355);
        pb.box('plastic.gray', L, 0.012, 0.003, 0, DESK_H - 0.01, -0.7);
        pb.box('plastic.gray', L, 0.012, 0.003, 0, DESK_H - 0.01, 0.7);
        // 脚（T 字フレーム）
        const legXs = [-L / 2 + 0.04, L / 2 - 0.04];
        if (n >= 3) legXs.push(0);
        for (const x of legXs) {
          for (const z of [-0.55, 0.55]) pb.box('frame.white', 0.05, DESK_H - 0.03, 0.05, x, (DESK_H - 0.03) / 2, z);
          pb.box('frame.white', 0.06, 0.03, 1.3, x, 0.015, 0);
          pb.box('frame.white', 0.05, 0.04, 1.3, x, DESK_H - 0.045, 0);
        }
        // 中央スクリーン（H400）＋配線トレイ
        pb.box('fabric.panel', L - 0.02, 0.4, 0.03, 0, DESK_H + 0.2, 0);
        pb.box('alu', L - 0.02, 0.015, 0.035, 0, DESK_H + 0.405, 0);
        pb.box('frame.white', L - 0.1, 0.08, 0.26, 0, DESK_H - 0.12, 0);
        // 天板上コンセント（各席）
        for (let i = 0; i < n; i++) {
          const x = -L / 2 + 0.6 + i * 1.2;
          pb.box('plastic.white', 0.24, 0.05, 0.035, x, DESK_H + 0.025, 0.035);
          pb.box('plastic.white', 0.24, 0.05, 0.035, x, DESK_H + 0.025, -0.035);
        }
      });
    }
  }

  // 画面バリエーション
  const screens = ['video1', 'video2', 'video3', 'video4', 'code1', 'code2', 'code3', 'dash1', 'dash2', 'dash3', 'sheet1', 'sheet2', 'sheet3', 'lock', 'soc1', 'soc2', 'soc3', 'soc4', 'soc5', 'soc6', 'slide1', 'slide2'];
  for (const s of screens) {
    I.define(`laptop.${s}`, (pb) => laptop(pb, `screen.${s}`, 0, 0, 0));
    I.define(`laptopStand.${s}`, (pb) => laptop(pb, `screen.${s}`, 0, 0, 0, true));
    I.define(`monitor.${s}`, (pb) => monitor24(pb, `screen.${s}`, 0, 0));
  }
  I.define('monitor.off', (pb) => monitor24(pb, 'screen.off', 0, 0));
  I.define('laptop.closed', (pb) => laptop(pb, null, 0, 0, 0));
  I.define('kbmouse', (pb) => keyboardMouse(pb, 0, 0));
  I.define('dock', (pb) => {
    pb.box('plastic.black', 0.12, 0.028, 0.08, 0, DESK_H + 0.014, 0);
    pb.box('light.ledBlue', 0.01, 0.004, 0.004, 0.04, DESK_H + 0.02, 0.041);
  });
  I.define('headset.desk', (pb) => {
    pb.add(new THREE.TorusGeometry(0.08, 0.008, 6, 14, Math.PI), 'headset', new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, DESK_H + 0.01, 0));
    pb.cyl('headset', 0.035, 0.035, 0.02, -0.08, DESK_H + 0.012, 0, 12);
    pb.cyl('headset', 0.035, 0.035, 0.02, 0.08, DESK_H + 0.012, 0, 12);
  });
  I.define('mug', (pb) => {
    pb.cyl('ceramic', 0.04, 0.036, 0.095, 0, DESK_H + 0.0475, 0, 12);
    pb.add(new THREE.TorusGeometry(0.025, 0.007, 6, 10, Math.PI), 'ceramic', new THREE.Matrix4().makeRotationZ(-Math.PI / 2).setPosition(0.04, DESK_H + 0.05, 0));
  });
  I.define('bottle', (pb) => {
    pb.cyl('water', 0.035, 0.035, 0.2, 0, DESK_H + 0.1, 0, 10);
    pb.cyl('plastic.white', 0.018, 0.018, 0.03, 0, DESK_H + 0.215, 0, 8);
  });
  I.define('notebook', (pb) => {
    pb.box('fabric.navy', 0.18, 0.012, 0.25, 0, DESK_H + 0.006, 0);
    pb.box('paper', 0.17, 0.004, 0.24, 0.004, DESK_H + 0.013, 0);
  });
  I.define('smartphone', (pb) => {
    pb.box('plastic.black', 0.072, 0.008, 0.15, 0, DESK_H + 0.004, 0);
  });
  I.define('docs', (pb) => {
    pb.box('paper', 0.21, 0.02, 0.297, 0, DESK_H + 0.01, 0);
    pb.box('fabric.blue', 0.22, 0.004, 0.305, 0, DESK_H + 0.022, 0);
  });
  I.define('plant.desk', (pb) => {
    pb.cyl('pot.white', 0.05, 0.04, 0.09, 0, DESK_H + 0.045, 0, 10);
    pb.sphere('leaf', 0.07, 0, DESK_H + 0.14, 0, 1, 0.8, 1, 8, 6);
  });

  // --- 集中席（サイドパネル付 1 人席） ---
  I.define('desk.focus', (pb) => {
    pb.box('wood.light', 1.2, 0.025, 0.7, 0, DESK_H - 0.0125, 0);
    for (const s of [-1, 1]) {
      pb.box('felt.gray', 0.03, 1.25, 0.72, s * 0.615, 0.625, 0);
      pb.box('frame.black', 0.04, DESK_H, 0.04, s * 0.55, DESK_H / 2, 0.3);
    }
    pb.box('felt.gray', 1.26, 0.55, 0.03, 0, DESK_H + 0.275, -0.36);
    pb.box('frame.black', 1.1, 0.04, 0.04, 0, DESK_H - 0.05, -0.3);
    pb.box('light.warm', 0.6, 0.015, 0.05, 0, DESK_H + 0.52, -0.3);
  });

  // --- Web 会議ブース ---
  const boothDef = (name: string, W: number, D: number, felt: string) =>
    I.define(name, (pb) => {
      const H = 2.25;
      const t = 0.05;
      // 外殻（背・側・天井）
      pb.boxX('plastic.white', -W / 2, 0.05, -D / 2, W / 2, H, -D / 2 + t);
      pb.boxX('plastic.white', -W / 2, 0.05, -D / 2, -W / 2 + t, H, D / 2);
      pb.boxX('plastic.white', W / 2 - t, 0.05, -D / 2, W / 2, H, D / 2);
      pb.boxX('plastic.white', -W / 2, H - 0.06, -D / 2, W / 2, H, D / 2);
      pb.boxX('frame.black', -W / 2, 0, -D / 2, W / 2, 0.05, D / 2);
      // 内装フェルト
      pb.boxX(felt, -W / 2 + t, 0.05, -D / 2 + t, W / 2 - t, H - 0.06, -D / 2 + t + 0.02);
      pb.boxX(felt, -W / 2 + t, 0.05, -D / 2 + t, -W / 2 + t + 0.02, H - 0.06, D / 2);
      pb.boxX(felt, W / 2 - t - 0.02, 0.05, -D / 2 + t, W / 2 - t, H - 0.06, D / 2);
      // 前面ガラス扉
      pb.boxX('glass', -W / 2 + t, 0.06, D / 2 - 0.015, W / 2 - t, H - 0.07, D / 2);
      pb.boxX('frame.black', -W / 2 + t, H - 0.12, D / 2 - 0.02, W / 2 - t, H - 0.06, D / 2 + 0.005);
      pb.boxX('frame.black', W / 2 - t - 0.04, 0.06, D / 2 - 0.02, W / 2 - t, H - 0.07, D / 2 + 0.005);
      pb.boxX('stainless', W / 2 - t - 0.1, 0.9, D / 2, W / 2 - t - 0.08, 1.3, D / 2 + 0.04);
      // 室内照明・換気
      pb.boxX('light.panel', -W / 2 + 0.15, H - 0.075, -D / 2 + 0.15, W / 2 - 0.15, H - 0.065, D / 2 - 0.15);
      // カウンター
      pb.boxX('wood.light', -W / 2 + t, 0.73, -D / 2 + t, W / 2 - t, 0.755, -D / 2 + t + 0.42);
    });
  boothDef('booth.1p', 1.1, 1.1, 'felt.blue');
  boothDef('booth.1p.g', 1.1, 1.1, 'felt.green');
  boothDef('booth.2p', 2.2, 1.35, 'felt.gray');

  // --- ハイバックソファ・ブース（ラウンジ／ペリメーター） ---
  I.define('sofa.booth', (pb) => {
    // 2 人掛け×対面、中央テーブル。全体 2.0(W) × 2.2(D)
    for (const s of [-1, 1]) {
      pb.pushT(0, 0, s * 0.8, s > 0 ? 0 : Math.PI);
      pb.box('fabric.navy', 1.5, 0.42, 0.58, 0, 0.21, 0);
      pb.box('fabric.navy', 1.5, 0.12, 0.55, 0, 0.46, -0.02);
      pb.box('fabric.navy', 1.6, 1.4, 0.12, 0, 0.7, 0.3);
      pb.box('felt.gray', 1.6, 0.02, 0.2, 0, 1.4, 0.26);
      pb.pop();
    }
    pb.box('wood.mid', 1.2, 0.03, 0.62, 0, 0.72, 0);
    pb.cyl('frame.black', 0.03, 0.03, 0.7, 0, 0.35, 0, 8);
    pb.box('frame.black', 0.5, 0.02, 0.4, 0, 0.01, 0);
    pb.cyl('light.warm', 0.12, 0.14, 0.12, 0, 1.75, 0, 16);
    pb.cyl('frame.black', 0.004, 0.004, 1.05, 0, 2.3, 0, 4);
  });
  I.define('sofa.2', (pb) => {
    pb.box('fabric.green', 1.5, 0.4, 0.8, 0, 0.2, 0);
    pb.box('fabric.green', 1.5, 0.14, 0.72, 0, 0.47, -0.02);
    pb.box('fabric.green', 1.5, 0.45, 0.16, 0, 0.62, 0.33);
    pb.box('fabric.green', 0.16, 0.3, 0.8, -0.72, 0.55, 0);
    pb.box('fabric.green', 0.16, 0.3, 0.8, 0.72, 0.55, 0);
  });
  I.define('rug', (pb) => {
    pb.box('fabric.beige', 3.0, 0.012, 2.2, 0, 0.006, 0);
  });

  // --- テーブル ---
  const table = (name: string, W: number, D: number, h: number, top: string, legs: 'four' | 'panel' | 'center' = 'four') =>
    I.define(name, (pb) => {
      pb.box(top, W, 0.03, D, 0, h - 0.015, 0);
      if (legs === 'four') {
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) pb.box('frame.black', 0.04, h - 0.03, 0.04, sx * (W / 2 - 0.08), (h - 0.03) / 2, sz * (D / 2 - 0.08));
      } else if (legs === 'panel') {
        for (const sx of [-1, 1]) pb.box('frame.silver', 0.05, h - 0.03, D - 0.2, sx * (W / 2 - 0.2), (h - 0.03) / 2, 0);
        pb.box('frame.silver', W - 0.4, 0.2, 0.02, 0, h - 0.13, 0);
        // 配線ボックス（天板中央）
        pb.box('plastic.dark', 0.3, 0.005, 0.12, 0, h + 0.002, 0);
      } else {
        pb.cyl('frame.black', 0.04, 0.04, h - 0.03, 0, (h - 0.03) / 2, 0, 10);
        pb.cyl('frame.black', 0.25, 0.25, 0.02, 0, 0.01, 0, 20);
      }
    });
  table('table.meet.2410', 2.4, 1.0, 0.72, 'wood.light', 'panel');
  table('table.meet.3012', 3.0, 1.2, 0.72, 'wood.light', 'panel');
  table('table.meet.3612', 3.6, 1.2, 0.72, 'wood.mid', 'panel');
  table('table.meet.4215', 4.2, 1.5, 0.72, 'wood.mid', 'panel');
  table('table.meet.1812', 1.8, 1.2, 0.72, 'wood.light', 'panel');
  table('table.meet.1608', 1.6, 0.8, 0.72, 'top.white', 'four');
  table('table.web.1207', 1.2, 0.6, 0.72, 'wood.light', 'four');
  table('table.communal', 6.0, 1.2, 0.72, 'wood.mid', 'four');
  table('table.high', 1.8, 0.9, 1.0, 'top.white', 'four');
  table('table.counter', 1.0, 0.45, 1.0, 'wood.mid', 'four');
  I.define('table.round', (pb) => {
    pb.cyl('top.white', 0.45, 0.45, 0.03, 0, 0.705, 0, 28);
    pb.cyl('frame.black', 0.03, 0.03, 0.69, 0, 0.345, 0, 10);
    pb.cyl('frame.black', 0.24, 0.24, 0.02, 0, 0.01, 0, 20);
  });
  I.define('table.side', (pb) => {
    pb.cyl('wood.mid', 0.25, 0.25, 0.025, 0, 0.45, 0, 20);
    pb.cyl('frame.black', 0.02, 0.02, 0.44, 0, 0.22, 0, 8);
    pb.cyl('frame.black', 0.18, 0.18, 0.015, 0, 0.008, 0, 16);
  });

  // --- 壁掛けディスプレイ（壁面 z=0、画面 +z 向き） ---
  const disp = (inch: number, screen: string, tag: string, bare: boolean) =>
    I.define(`${bare ? 'panel' : 'display'}.${inch}.${tag}`, (pb) => {
      const W = inch * 0.0254 * 0.8716;
      const Hh = inch * 0.0254 * 0.4903;
      const cy = bare ? 0 : inch >= 86 ? 1.55 : inch >= 65 ? 1.45 : 1.35;
      pb.box('plastic.black', W + 0.012, Hh + 0.012, 0.05, 0, cy, 0.045);
      pb.plane(`screen.${screen}`, W, Hh, 0, cy, 0.071);
      if (bare) return;
      // カメラバー＋スピーカー
      pb.box('plastic.black', 0.7, 0.07, 0.07, 0, cy + Hh / 2 + 0.08, 0.06);
      pb.box('plastic.gray', 0.03, 0.03, 0.005, 0, cy + Hh / 2 + 0.08, 0.098);
      pb.box('fabric.gray', Math.min(W, 1.0), 0.08, 0.08, 0, cy - Hh / 2 - 0.08, 0.05);
    });
  for (const inch of [43, 55, 65, 75, 86, 98]) {
    for (const s of ['video1', 'video2', 'video3', 'video4', 'slide1', 'slide2', 'dash1', 'dash2', 'dash3', 'soc1', 'soc2', 'soc3', 'soc4', 'soc5', 'soc6', 'sheet1', 'lock', 'off']) {
      disp(inch, s, s, false);
      disp(inch, s, s, true);
    }
  }
  I.define('ahu.unit', (pb) => {
    pb.box('plastic.gray', 3.0, 1.9, 1.4, 0, 0.95, 0);
    for (let i = 0; i < 4; i++) pb.box('steel', 0.02, 1.7, 1.38, -1.2 + i * 0.8, 0.95, 0);
    pb.box('alu', 1.2, 0.7, 0.7, 0, 2.3, 0);
    pb.box('alu', 0.7, 0.6, 2.2, 1.0, 2.35, -1.5);
    pb.box('plastic.dark', 0.5, 0.3, 0.2, -1.1, 1.3, 0.72);
  });
  I.define('ups', (pb) => {
    pb.box('rack.body', 0.6, 1.2, 0.9, 0, 0.6, 0);
    pb.box('screen.dash3', 0.18, 0.12, 0.005, 0, 1.0, 0.453);
  });
  I.define('display.mobile', (pb) => {
    pb.box('frame.black', 0.8, 0.04, 0.6, 0, 0.1, 0);
    for (const s of [-1, 1]) pb.sphere('plastic.black', 0.04, s * 0.35, 0.04, 0.25, 1, 1, 1, 6, 6);
    pb.box('frame.black', 0.08, 1.5, 0.06, 0, 0.85, 0);
    pb.box('plastic.black', 1.46, 0.85, 0.06, 0, 1.4, 0.06);
    pb.plane('screen.dash2', 1.43, 0.8, 0, 1.4, 0.091);
  });
  I.define('camera.ptz', (pb) => {
    pb.box('plastic.black', 0.16, 0.12, 0.14, 0, 0, 0);
    pb.sphere('plastic.dark', 0.05, 0, 0, 0.07, 1, 1, 1, 10, 8);
  });

  // --- ホワイトボード ---
  I.define('whiteboard.mobile', (pb) => {
    for (const s of [-1, 1]) {
      pb.box('frame.silver', 0.035, 1.9, 0.035, s * 0.92, 0.95, 0);
      pb.box('frame.silver', 0.05, 0.03, 0.55, s * 0.92, 0.06, 0);
      pb.sphere('plastic.black', 0.035, s * 0.92, 0.035, 0.24, 1, 1, 1, 6, 6);
      pb.sphere('plastic.black', 0.035, s * 0.92, 0.035, -0.24, 1, 1, 1, 6, 6);
    }
    pb.box('frame.silver', 1.84, 1.02, 0.03, 0, 1.35, 0);
    pb.plane('whiteboard', 1.8, 0.98, 0, 1.35, 0.016);
    pb.plane('whiteboard.plain', 1.8, 0.98, 0, 1.35, -0.016, Math.PI);
    pb.box('frame.silver', 1.4, 0.03, 0.08, 0, 0.83, 0.04);
  });
  for (const [k, m] of [
    ['a', 'whiteboard'],
    ['b', 'whiteboard2'],
    ['c', 'whiteboard3'],
    ['plain', 'whiteboard.plain'],
  ] as const)
    I.define(`whiteboard.wall.${k}`, (pb) => {
      pb.box('frame.silver', 2.44, 1.24, 0.025, 0, 1.4, 0.0125);
      pb.plane(m, 2.4, 1.2, 0, 1.4, 0.026);
      pb.box('frame.silver', 1.6, 0.025, 0.07, 0, 0.78, 0.04);
    });

  // --- 収納・機器 ---
  I.define('locker.900', (pb) => {
    pb.box('locker.side', 0.9, 0.06, 0.5, 0, 0.03, 0.0);
    pb.box('locker.side', 0.9, 1.74, 0.5, 0, 0.93, -0.005);
    pb.plane('locker', 0.9, 1.74, 0, 0.93, 0.246);
  });
  I.define('mfp', (pb) => {
    pb.box('plastic.white', 0.62, 0.62, 0.68, 0, 0.31, 0);
    pb.box('plastic.gray', 0.6, 0.1, 0.64, 0, 0.67, 0);
    pb.box('plastic.white', 0.6, 0.14, 0.62, 0, 0.79, -0.01);
    pb.box('plastic.white', 0.58, 0.12, 0.5, 0, 0.93, -0.02);
    pb.box('plastic.black', 0.26, 0.02, 0.16, 0.12, 1.0, 0.24, -0.5, 0, 0);
    pb.plane('screen.dash1', 0.22, 0.12, 0.12, 1.012, 0.244, 0, -Math.PI / 2 + 0.5);
    pb.box('plastic.dark', 0.4, 0.02, 0.06, 0, 0.45, 0.35);
    for (let i = 0; i < 3; i++) pb.box('plastic.gray', 0.56, 0.005, 0.005, 0, 0.12 + i * 0.12, 0.342);
  });
  I.define('shred.box', (pb) => {
    pb.box('steel', 0.42, 0.72, 0.42, 0, 0.36, 0);
    pb.box('plastic.black', 0.3, 0.01, 0.04, 0, 0.725, 0.05);
    pb.box('light.ledRed', 0.18, 0.04, 0.003, 0, 0.55, 0.211);
  });
  I.define('trash.station', (pb) => {
    const cols = ['fabric.blue', 'fabric.green', 'fabric.mustard', 'fabric.terracotta'];
    cols.forEach((c, i) => {
      pb.box('plastic.gray', 0.3, 0.72, 0.4, -0.465 + i * 0.31, 0.36, 0);
      pb.box(c, 0.3, 0.06, 0.4, -0.465 + i * 0.31, 0.75, 0);
    });
  });
  I.define('pc.cabinet', (pb) => {
    pb.box('plastic.gray', 1.0, 1.8, 0.5, 0, 0.9, 0);
    for (let i = 0; i < 2; i++) {
      pb.box('steel', 0.46, 1.7, 0.01, -0.245 + i * 0.49, 0.9, 0.253);
      pb.box('glass', 0.3, 0.8, 0.004, -0.245 + i * 0.49, 1.1, 0.26);
      pb.box('light.led', 0.03, 0.01, 0.003, -0.245 + i * 0.49, 1.65, 0.26);
    }
  });
  I.define('rack.42u', (pb) => {
    pb.box('rack.body', 0.6, 2.0, 1.07, 0, 1.0, 0);
    pb.plane('rack.front', 0.56, 1.92, 0, 1.0, 0.536);
    pb.box('plastic.black', 0.6, 0.06, 1.07, 0, 2.03, 0);
  });
  I.define('shelf.steel', (pb) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pb.box('frame.silver', 0.03, 2.1, 0.03, sx * 0.885, 1.05, sz * 0.21);
    for (let i = 0; i < 5; i++) {
      const y = 0.08 + i * 0.48;
      pb.box('frame.silver', 1.8, 0.02, 0.45, 0, y, 0);
      if (i < 4)
        for (let k = 0; k < 4; k++) pb.box('cardboard', 0.38, 0.28, 0.36, -0.66 + k * 0.44, y + 0.15, 0);
    }
  });
  I.define('shelf.pc', (pb) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pb.box('frame.silver', 0.03, 2.1, 0.03, sx * 0.885, 1.05, sz * 0.21);
    for (let i = 0; i < 5; i++) {
      const y = 0.08 + i * 0.48;
      pb.box('frame.silver', 1.8, 0.02, 0.45, 0, y, 0);
      if (i < 4) for (let k = 0; k < 10; k++) pb.box(k % 3 === 0 ? 'plastic.white' : 'cardboard', 0.07, 0.3, 0.38, -0.8 + k * 0.175, y + 0.16, 0);
    }
  });
  I.define('archive.carriage', (pb) => {
    // 電動移動棚 1 連：W4.5 × D0.9 × H2.4（本体は z 方向に延びる）
    pb.box('plastic.white', 0.9, 2.3, 4.5, 0, 1.2, 0);
    pb.box('steel', 0.92, 0.1, 4.52, 0, 0.05, 0);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        pb.box(i % 2 ? 'fabric.blue' : 'fabric.navy', 0.02, 0.3, 4.3, s * 0.452, 0.35 + i * 0.36, 0);
      }
    }
    pb.box('frame.silver', 0.92, 2.4, 0.06, 0, 1.2, 2.28);
    pb.box('plastic.black', 0.2, 0.3, 0.02, 0, 1.2, 2.32);
    pb.cyl('stainless', 0.1, 0.1, 0.03, 0, 1.0, 2.33, 16, Math.PI / 2, 0, 0);
  });
  I.define('shredder.big', (pb) => {
    pb.box('plastic.gray', 0.6, 0.95, 0.55, 0, 0.475, 0);
    pb.box('plastic.black', 0.5, 0.02, 0.1, 0, 0.96, 0.1);
  });
  I.define('scanner', (pb) => {
    pb.box('plastic.dark', 0.32, 0.18, 0.2, 0, DESK_H + 0.09, 0);
    pb.box('plastic.gray', 0.28, 0.01, 0.16, 0, DESK_H + 0.22, 0.05, 0.7, 0, 0);
  });
  I.define('bench.kitting', (pb) => {
    pb.box('top.white', 2.4, 0.03, 0.9, 0, 0.85, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pb.box('frame.silver', 0.04, 0.84, 0.04, sx * 1.15, 0.42, sz * 0.4);
    pb.box('frame.silver', 2.3, 0.02, 0.8, 0, 0.2, 0);
    for (let i = 0; i < 4; i++) pb.box('cardboard', 0.42, 0.1, 0.32, -0.9 + i * 0.6, 0.26, 0);
    // 電源タップ・LAN
    pb.box('plastic.white', 1.8, 0.04, 0.05, 0, 0.885, -0.4);
  });
  I.define('bench.lab', (pb) => {
    pb.box('top.stone', 2.4, 0.03, 0.75, 0, 0.72, 0);
    pb.box('plastic.gray', 2.4, 0.68, 0.02, 0, 0.36, -0.36);
    for (const sx of [-1, 1]) pb.box('plastic.gray', 0.03, 0.7, 0.72, sx * 1.185, 0.35, 0);
    pb.box('frame.silver', 2.3, 0.02, 0.3, 0, 1.25, -0.24);
    for (const sx of [-1, 1]) pb.box('frame.silver', 0.03, 0.55, 0.03, sx * 1.1, 1.0, -0.36);
    pb.box('plastic.white', 2.2, 0.05, 0.04, 0, 0.77, -0.33);
  });
  I.define('device.cabinet', (pb) => {
    pb.box('steel', 0.9, 1.2, 0.45, 0, 0.6, 0);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 6; c++) {
        pb.box('plastic.black', 0.1, 0.18, 0.01, -0.34 + c * 0.135, 0.18 + r * 0.26, 0.226);
        pb.box('light.led', 0.02, 0.01, 0.003, -0.34 + c * 0.135, 0.3 + r * 0.26, 0.232);
      }
  });
  I.define('soc.console', (pb) => {
    // 1 席分：W1.6 × D0.9、トリプルモニター
    pb.box('top.white', 1.6, 0.03, 0.9, 0, 0.72, 0);
    pb.box('plastic.dark', 1.6, 0.7, 0.03, 0, 0.35, -0.44);
    for (const sx of [-1, 1]) pb.box('plastic.dark', 0.03, 0.7, 0.88, sx * 0.785, 0.35, 0);
  });
  I.define('counter.reception', (pb) => {
    pb.box('wood.mid', 1.8, 1.05, 0.12, 0, 0.525, 0.24);
    pb.box('top.stone', 1.9, 0.04, 0.6, 0, 1.07, 0.02);
    pb.box('wall.white', 1.8, 0.72, 0.5, 0, 0.36, -0.02);
    pb.box('light.warm', 1.7, 0.02, 0.01, 0, 0.05, 0.305);
  });
  I.define('sign.wall', (pb) => {
    // エントランスのサインウォール：木目フレーム＋苔パネル＋切文字サイン（内照）
    pb.boxX('wood.mid', -3.3, 0.0, 0, 3.3, 2.8, 0.03);
    pb.boxX('wall.moss', -2.95, 0.35, 0.03, 2.95, 2.42, 0.075);
    pb.plane('sign.text', 3.9, 1.46, 0, 1.42, 0.08);
    pb.boxX('light.warm', -2.95, 2.44, 0.03, 2.95, 2.46, 0.09);
    pb.boxX('light.warm', -2.95, 0.31, 0.03, 2.95, 0.33, 0.09);
  });
  I.define('tablet.stand', (pb) => {
    pb.cyl('frame.silver', 0.012, 0.012, 0.18, 0, 1.18, 0, 8);
    pb.box('plastic.black', 0.25, 0.18, 0.012, 0, 1.3, 0, -0.35, 0, 0);
    pb.plane('screen.slide1', 0.23, 0.16, 0, 1.302, 0.008, 0, -0.35);
  });
  I.define('phone.desk', (pb) => {
    pb.box('plastic.black', 0.2, 0.05, 0.2, 0, 1.115, 0, 0.2, 0, 0);
    pb.box('plastic.black', 0.05, 0.04, 0.2, -0.07, 1.16, 0);
  });
  I.define('bench.wait', (pb) => {
    pb.box('fabric.beige', 1.6, 0.12, 0.5, 0, 0.42, 0);
    pb.box('wood.mid', 1.6, 0.36, 0.45, 0, 0.18, 0);
  });

  // --- パントリー ---
  I.define('pantry.back', (pb) => {
    // W4.8 × D0.65 のバックカウンター（シンク・コーヒーマシン・電子レンジ・冷蔵庫）
    pb.box('wood.light', 4.8, 0.85, 0.62, 0, 0.425, 0);
    pb.box('top.stone', 4.84, 0.04, 0.66, 0, 0.87, 0.01);
    pb.box('stainless', 0.6, 0.02, 0.42, -1.4, 0.885, 0.02);
    pb.box('plastic.black', 0.56, 0.01, 0.38, -1.4, 0.875, 0.02);
    pb.pipe('chrome', 0.012, V(-1.4, 0.89, -0.22), V(-1.4, 1.18, -0.22));
    pb.pipe('chrome', 0.012, V(-1.4, 1.18, -0.22), V(-1.4, 1.14, -0.02));
    // コーヒーマシン×2
    for (const x of [-0.3, 0.2]) {
      pb.box('plastic.black', 0.34, 0.52, 0.42, x, 1.15, -0.06);
      pb.box('stainless', 0.28, 0.16, 0.02, x, 1.26, 0.155);
      pb.box('screen.dash3', 0.12, 0.08, 0.005, x, 1.34, 0.166);
      pb.box('ceramic', 0.08, 0.1, 0.08, x, 0.94, 0.06);
    }
    // 電子レンジ×2（上段棚）
    pb.box('plastic.white', 1.2, 0.03, 0.4, 1.3, 1.25, -0.1);
    for (const x of [1.0, 1.6]) {
      pb.box('plastic.white', 0.5, 0.3, 0.38, x, 1.42, -0.1);
      pb.box('plastic.black', 0.32, 0.22, 0.005, x - 0.05, 1.42, 0.092);
    }
    // 冷蔵庫
    pb.box('stainless', 0.7, 1.8, 0.7, 2.0 + 0.35 + 0.05, 0.9, 0.0);
    pb.box('plastic.black', 0.02, 0.5, 0.03, 2.4 - 0.28, 1.2, 0.36);
    // ウォーターサーバー
    pb.box('plastic.white', 0.32, 1.25, 0.35, -2.7, 0.625, 0.0);
    pb.box('plastic.black', 0.2, 0.2, 0.02, -2.7, 0.95, 0.18);
    pb.cyl('water', 0.15, 0.15, 0.35, -2.7, 1.43, 0.0, 16);
    // 吊戸棚
    pb.box('wood.light', 3.0, 0.7, 0.35, -0.8, 2.05, -0.14);
  });
  I.define('pantry.island', (pb) => {
    pb.box('wood.mid', 3.6, 1.0, 0.8, 0, 0.5, 0);
    pb.box('top.stone', 3.7, 0.04, 0.9, 0, 1.02, 0);
    pb.box('light.warm', 3.4, 0.02, 0.01, 0, 0.06, 0.401);
  });
  I.define('vending', (pb) => {
    pb.box('plastic.white', 1.0, 1.83, 0.72, 0, 0.915, 0);
    pb.box('glass', 0.8, 1.0, 0.01, -0.05, 1.25, 0.365);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 6; c++) pb.box(['fabric.terracotta', 'fabric.blue', 'fabric.green', 'fabric.mustard'][(r + c) % 4], 0.08, 0.18, 0.05, -0.38 + c * 0.13, 0.9 + r * 0.32, 0.33);
    pb.box('plastic.black', 0.12, 0.3, 0.02, 0.4, 1.1, 0.365);
  });
  I.define('sink.core', (pb) => {
    pb.box('stainless', 1.5, 0.85, 0.6, 0, 0.425, 0);
    pb.box('stainless', 0.5, 0.02, 0.4, -0.3, 0.86, 0);
    pb.pipe('chrome', 0.012, V(-0.3, 0.86, -0.26), V(-0.3, 1.15, -0.26));
    pb.box('plastic.white', 0.4, 0.5, 0.2, 0.4, 1.3, -0.18);
  });

  // --- 植栽 ---
  I.define('plant.floor', (pb) => {
    pb.cyl('pot.white', 0.22, 0.18, 0.5, 0, 0.25, 0, 18);
    pb.cyl('soil', 0.2, 0.2, 0.02, 0, 0.49, 0, 14);
    pb.cyl('trunk', 0.025, 0.03, 0.9, 0, 0.9, 0, 6);
    pb.sphere('leaf', 0.35, 0, 1.45, 0, 1, 0.9, 1, 10, 8);
    pb.sphere('leaf', 0.26, 0.18, 1.2, 0.1, 1, 0.9, 1, 8, 6);
    pb.sphere('leaf', 0.24, -0.16, 1.28, -0.1, 1, 0.9, 1, 8, 6);
  });
  I.define('plant.tall', (pb) => {
    pb.cyl('pot.dark', 0.24, 0.2, 0.55, 0, 0.275, 0, 18);
    pb.cyl('trunk', 0.03, 0.04, 1.3, 0, 1.1, 0, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pb.sphere('leaf', 0.28, Math.cos(a) * 0.22, 1.5 + (i % 3) * 0.18, Math.sin(a) * 0.22, 1, 0.7, 1, 8, 6);
    }
  });
  I.define('planter.long', (pb) => {
    pb.box('wood.mid', 1.8, 0.45, 0.45, 0, 0.225, 0);
    for (let i = 0; i < 5; i++) pb.sphere('leaf', 0.24, -0.72 + i * 0.36, 0.55, 0, 1, 0.8, 1, 8, 6);
  });
  I.define('shelf.low', (pb) => {
    // 低書架（H1200）上部に植栽
    pb.box('wood.light', 1.8, 1.05, 0.4, 0, 0.525, 0);
    for (let r = 0; r < 2; r++) {
      pb.box('wood.mid', 1.72, 0.02, 0.36, 0, 0.35 + r * 0.35, 0.0);
      for (let k = 0; k < 9; k++) pb.box(['fabric.navy', 'paper', 'fabric.terracotta', 'fabric.mustard'][(k + r) % 4], 0.05, 0.26, 0.26, -0.7 + k * 0.17, 0.2 + r * 0.35 + 0.15, 0.03);
    }
    pb.box('pot.white', 1.7, 0.16, 0.3, 0, 1.13, 0);
    for (let i = 0; i < 5; i++) pb.sphere('leaf', 0.18, -0.68 + i * 0.34, 1.3, 0, 1, 0.8, 1, 8, 6);
  });

  // --- 防災・設備 ---
  I.define('aed', (pb) => {
    pb.box('plastic.white', 0.4, 0.5, 0.2, 0, 1.3, 0.1);
    pb.box('light.ledRed', 0.3, 0.08, 0.005, 0, 1.47, 0.203);
  });
  I.define('fire.ext', (pb) => {
    pb.box('fabric.terracotta', 0.3, 0.9, 0.2, 0, 0.45, 0.1);
    pb.cyl('light.ledRed', 0.07, 0.07, 0.5, 0, 0.35, 0.28, 12);
  });
  I.define('hydrant', (pb) => {
    pb.box('stainless', 0.75, 1.5, 0.05, 0, 1.0, 0.025);
    pb.box('light.ledRed', 0.06, 0.06, 0.02, 0, 1.85, 0.03);
  });
  I.define('ac.remote', (pb) => {
    pb.box('plastic.white', 0.12, 0.12, 0.02, 0, 1.3, 0.01);
    pb.box('screen.dash3', 0.08, 0.05, 0.002, 0, 1.31, 0.021);
  });
  I.define('umbrella', (pb) => {
    pb.box('steel', 0.6, 0.55, 0.25, 0, 0.275, 0);
  });

  // --- 天井設備（y は天井面） ---
  I.define('ceil.line', (pb) => {
    pb.box('light.panel', 1.2, 0.02, 0.08, 0, -0.012, 0);
    pb.box('frame.white', 1.22, 0.01, 0.1, 0, -0.004, 0);
  });
  I.define('ceil.down', (pb) => {
    pb.cyl('frame.white', 0.09, 0.09, 0.01, 0, -0.005, 0, 16);
    pb.cyl('light.panel', 0.065, 0.065, 0.004, 0, -0.012, 0, 16);
  });
  I.define('ceil.ac', (pb) => {
    pb.box('plastic.white', 0.95, 0.03, 0.95, 0, -0.015, 0);
    pb.box('plastic.gray', 0.58, 0.012, 0.58, 0, -0.032, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      pb.box('plastic.dark', 0.6, 0.01, 0.08, Math.sin(a) * 0.38, -0.031, Math.cos(a) * 0.38, 0, a, 0);
    }
  });
  I.define('ceil.ap', (pb) => {
    pb.cyl('plastic.white', 0.11, 0.11, 0.035, 0, -0.018, 0, 20);
    pb.cyl('light.ledBlue', 0.015, 0.015, 0.005, 0, -0.037, 0, 8);
  });
  I.define('ceil.spk', (pb) => {
    pb.cyl('plastic.white', 0.1, 0.1, 0.01, 0, -0.005, 0, 18);
    pb.cyl('mesh.black', 0.07, 0.07, 0.004, 0, -0.011, 0, 18);
  });
  I.define('ceil.sp', (pb) => {
    pb.cyl('chrome', 0.03, 0.03, 0.01, 0, -0.005, 0, 10);
    pb.cyl('chrome', 0.008, 0.012, 0.03, 0, -0.025, 0, 6);
  });
  I.define('ceil.smoke', (pb) => {
    pb.cyl('plastic.white', 0.05, 0.055, 0.04, 0, -0.02, 0, 14);
    pb.cyl('light.ledRed', 0.004, 0.004, 0.003, 0.02, -0.041, 0, 6);
  });
  I.define('ceil.cctv', (pb) => {
    pb.cyl('plastic.white', 0.07, 0.07, 0.03, 0, -0.015, 0, 14);
    pb.sphere('plastic.dark', 0.055, 0, -0.03, 0, 1, 0.8, 1, 10, 8);
  });
  I.define('ceil.mic', (pb) => {
    pb.box('plastic.white', 0.6, 0.03, 0.6, 0, -0.015, 0);
    pb.box('mesh.black', 0.56, 0.005, 0.56, 0, -0.032, 0);
  });
  I.define('ceil.exit', (pb) => {
    pb.box('plastic.white', 0.36, 0.14, 0.03, 0, -0.1, 0);
    pb.box('exitSign', 0.32, 0.1, 0.034, 0, -0.1, 0);
    pb.box('frame.silver', 0.01, 0.03, 0.01, 0, -0.015, 0);
  });
  I.define('ceil.pendant', (pb) => {
    pb.cyl('frame.black', 0.003, 0.003, 1.0, 0, -0.5, 0, 4);
    pb.cyl('frame.black', 0.02, 0.18, 0.16, 0, -1.08, 0, 18);
    pb.cyl('light.warm', 0.17, 0.17, 0.005, 0, -1.16, 0, 18);
  });
  I.define('ceil.linearPendant', (pb) => {
    pb.cyl('frame.black', 0.003, 0.003, 0.9, -0.9, -0.45, 0, 4);
    pb.cyl('frame.black', 0.003, 0.003, 0.9, 0.9, -0.45, 0, 4);
    pb.box('frame.black', 2.2, 0.06, 0.08, 0, -0.93, 0);
    pb.box('light.panel', 2.16, 0.01, 0.06, 0, -0.965, 0);
  });

  // --- トイレ衛生器具 ---
  I.define('wc.toilet', (pb) => {
    pb.box('ceramic', 0.36, 0.3, 0.2, 0, 0.55, 0.12);
    pb.sphere('ceramic', 0.2, 0, 0.35, -0.12, 0.9, 0.5, 1.35, 14, 10);
    pb.box('ceramic', 0.36, 0.04, 0.5, 0, 0.42, -0.1);
    pb.box('plastic.white', 0.3, 0.16, 0.1, 0.35, 0.75, 0.2);
  });
  I.define('wc.urinal', (pb) => {
    pb.box('ceramic', 0.38, 0.62, 0.32, 0, 0.8, 0.16);
    pb.box('plastic.black', 0.28, 0.4, 0.02, 0, 0.8, 0.0);
    pb.box('wall.white', 0.03, 0.7, 0.4, 0.4, 1.1, 0.2);
  });
  I.define('wc.stall', (pb) => {
    // 幅 1.0 × 奥行 1.6 のブース（前面扉＝+z）
    pb.boxX('plastic.gray', -0.5, 0.12, -0.8, -0.48, 2.0, 0.8);
    pb.boxX('plastic.gray', 0.48, 0.12, -0.8, 0.5, 2.0, 0.8);
    pb.boxX('plastic.gray', -0.48, 0.12, 0.78, 0.48, 2.0, 0.8);
    pb.boxX('frame.silver', -0.5, 1.98, -0.8, 0.5, 2.02, 0.82);
    pb.boxX('light.led', 0.3, 1.7, 0.8, 0.36, 1.74, 0.805);
  });
  I.define('wc.lav', (pb) => {
    // 3 連洗面カウンター（W2.7）
    pb.box('top.stone', 2.7, 0.05, 0.58, 0, 0.8, 0);
    pb.box('wood.mid', 2.7, 0.2, 0.55, 0, 0.67, 0.0);
    for (let i = 0; i < 3; i++) {
      const x = -0.9 + i * 0.9;
      pb.cyl('ceramic', 0.2, 0.17, 0.12, x, 0.84, 0.03, 18);
      pb.pipe('chrome', 0.012, V(x, 0.83, -0.24), V(x, 1.0, -0.24));
      pb.pipe('chrome', 0.01, V(x, 1.0, -0.24), V(x, 0.98, -0.12));
    }
    pb.box('mirror', 2.7, 0.9, 0.01, 0, 1.55, -0.285);
    pb.box('light.panel', 2.7, 0.05, 0.08, 0, 2.1, -0.25);
  });
}
