import * as THREE from 'three';
import { PB } from '../core/geom';
import { CORE, CW, GROUND_Y, H, PLATE, SPEC } from '../data/spec';

/**
 * 外観用の上階（3F〜12F）と屋上。
 *
 * 2F の躯体・軒・天井面と天井照明を InstancedMesh で 4.5 m ずつ積み上げる（Blender 側の
 * コレクションインスタンスと同じ考え方）。家具・人物は省略。12F のセットバックは表現しない。
 * 上階は Blender へは書き出さない（Blender 側で独自に積層する）。
 */

export const UPPER_FLOORS = 10; // 3F〜12F

/** 2F のメッシュ群を上階へ複製した InstancedMesh 群 */
export function buildUpperFloors(sources: THREE.Object3D[], count = UPPER_FLOORS): THREE.Group {
  const grp = new THREE.Group();
  grp.name = 'upperFloors';
  const m = new THREE.Matrix4();
  const t = new THREE.Matrix4();
  for (const src of sources) {
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) {
        const im = o as THREE.InstancedMesh;
        // 天井設備は照明器具（ライン照明・ダウンライト）だけ。窓越しに見える
        if (!/^ceil\.(line|down):/.test(im.name)) return;
        const out = new THREE.InstancedMesh(im.geometry, im.material, im.count * count);
        for (let k = 0; k < count; k++) {
          t.makeTranslation(0, H.floorToFloor * (k + 1), 0);
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, m);
            out.setMatrixAt(k * im.count + i, m.premultiply(t));
          }
        }
        finish(out, im, grp);
        return;
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name.startsWith('plate:')) return;
      const out = new THREE.InstancedMesh(mesh.geometry, mesh.material, count);
      for (let k = 0; k < count; k++) {
        t.makeTranslation(0, H.floorToFloor * (k + 1), 0);
        out.setMatrixAt(k, m.copy(mesh.matrixWorld).premultiply(t));
      }
      finish(out, mesh, grp);
    });
  }
  return grp;
}

function finish(out: THREE.InstancedMesh, src: THREE.Mesh, grp: THREE.Group): void {
  out.name = 'upper:' + src.name;
  out.castShadow = src.castShadow;
  out.receiveShadow = src.receiveShadow;
  out.renderOrder = src.renderOrder;
  // ライトマップ対象（2F の床・天井・壁）の複製は同じ uv1 を持つので、同じベイク GI を当てられる
  if (src.userData.lmAtlas) out.userData.lmSource = src;
  out.instanceMatrix.needsUpdate = true;
  out.computeBoundingBox();
  out.computeBoundingSphere();
  grp.add(out);
}

/**
 * 屋上：13F 相当レベルのスラブ、パラペット、塔屋（最高高さ 62.166 m：公開）、
 * 設備目隠しルーバーと冷却塔。寸法は blender/common.py の build_roof と同じ。
 */
export function buildRoof(pb: PB): void {
  const e = CW.eave;
  const roof = (UPPER_FLOORS + 1) * H.floorToFloor;
  const top = SPEC.height + GROUND_Y;
  pb.boxX('floor.slabEdge', PLATE.x0, roof - 0.32, PLATE.z0, PLATE.x1, roof - 0.005, PLATE.z1);
  pb.boxX('floor.concrete', PLATE.x0, roof - 0.005, PLATE.z0, PLATE.x1, roof + 0.15, PLATE.z1);
  // パラペット（庇の外周に立ち上げ）
  const x0 = PLATE.x0 - e;
  const x1 = PLATE.x1 + e;
  const z0 = PLATE.z0 - e;
  const z1 = PLATE.z1 + e;
  const ph = roof + 1.1;
  const w = 0.25;
  for (const [a0, b0, a1, b1] of [
    [x0, z0, x1, z0 + w],
    [x0, z1 - w, x1, z1],
    [x0, z0, x0 + w, z1],
    [x1 - w, z0, x1, z1],
  ]) {
    pb.boxX('facade.panel', a0, roof - 0.12, b0, a1, ph, b1);
    pb.boxX('alu', a0 - 0.02, ph, b0 - 0.02, a1 + 0.02, ph + 0.05, b1 + 0.02);
  }
  // 塔屋（コア上部）：外装パネル＋スパンドレル帯、頂部で最高高さ
  const px0 = CORE.x0 + 2;
  const px1 = CORE.x1 - 2;
  const pz0 = CORE.z0 + 1;
  const pz1 = CORE.z1 - 3;
  pb.boxX('facade.panel', px0, roof, pz0, px1, top - 0.6, pz1);
  pb.boxX('facade.spandrel', px0 - 0.03, roof + 2.2, pz0 - 0.03, px1 + 0.03, roof + 3.4, pz1 + 0.03);
  pb.boxX('alu', px0 - 0.15, top - 0.6, pz0 - 0.15, px1 + 0.15, top, pz1 + 0.15);
  // 設備スペースの目隠しルーバー（塔屋の南側、屋上中央）
  const sx0 = -24;
  const sx1 = 24;
  const sz0 = pz1 + 1.6;
  const sz1 = 12.8;
  const sh = 4.2;
  for (const x of [sx0, sx1]) pb.boxX('alu.dark', x - 0.1, roof, sz0, x + 0.1, roof + sh, sz1);
  for (const z of [sz0, sz1]) pb.boxX('alu.dark', sx0, roof, z - 0.1, sx1, roof + sh, z + 0.1);
  for (let y = roof + 0.35; y < roof + sh - 0.1; y += 0.3) {
    pb.boxX('alu', sx0 - 0.25, y, sz1 + 0.1, sx1 + 0.25, y + 0.09, sz1 + 0.25);
    pb.boxX('alu', sx0 - 0.25, y, sz0, sx0 - 0.1, y + 0.09, sz1 + 0.25);
    pb.boxX('alu', sx1 + 0.1, y, sz0, sx1 + 0.25, y + 0.09, sz1 + 0.25);
  }
  // 冷却塔・室外機（ルーバー内）
  for (let i = 0, x = -20; x <= 20; i++, x += 8) {
    pb.boxX('steelDoor', x - 3, roof + 0.15, sz0 + 1.5, x + 3, roof + 2.4 + (i % 2) * 0.6, sz0 + 5.5);
    pb.boxX('plastic.gray', x - 2.4, roof + 0.15, sz1 - 4.5, x + 2.4, roof + 1.8, sz1 - 1.5);
  }
}
