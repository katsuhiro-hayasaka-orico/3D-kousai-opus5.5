import * as THREE from 'three';
import { ATLASES, LmAtlas } from '../core/lightmap';
import { ALL_ROOMS, BALCONIES, Group } from '../data/rooms';
import { CW, GRID, PLATE } from '../data/spec';
import type { World } from '../world';

/**
 * 検証用ライトマップ（URL に ?lmdebug=1）。
 *
 * ベイク画像の向き・位置合わせを目視で証明するため、ライトマップ UV と同じアトラス定義から
 * 画像を Canvas で合成する。
 *  - floor / ceil : rooms.ts の室矩形（壁芯）を幅 0.4m の帯で描く → 壁の両側に均等な帯が見えれば一致。
 *                   1m グリッドと 3.2m モジュール線、北（N）・南（S）の文字も描く（平面図で正立すれば向きも一致）。
 *                   天井は下から見上げると平面図の鏡像になるので、文字だけ左右反転して描く（見上げて正立すれば一致）
 *  - wall         : 各チャート（ボックスの面）を面の向き別に塗り分け（北=青・南=赤・東=緑・西=黄）、
 *                   高さに比例して明るくし（上ほど明るい）、高さ 1m に赤線、水平方向 1m ごとに目盛りを描く
 *                   → 全壁で赤線が 1m に連続し、目盛りが面の継ぎ目で揃えば一致
 * UV は 0〜1 に正規化されているので、画像は半解像度で作っても位置は変わらない。
 */

const DIV = 2;

const GROUP_COLOR: Record<Group, string> = {
  it: '#3d7fd1',
  risk: '#3f9e5a',
  common: '#e0a13a',
  visitor: '#b66ad1',
  core: '#8a8f96',
};

export function debugLightmap(atlas: LmAtlas, world: World): HTMLCanvasElement {
  const def = ATLASES[atlas];
  const c = document.createElement('canvas');
  c.width = def.w / DIV;
  c.height = def.h / DIV;
  const g = c.getContext('2d')!;
  if (atlas === 'wall') drawWall(g, c.width, c.height, world);
  else drawPlan(g, c.width, c.height, def.bounds!, atlas === 'floor' ? 'FLOOR' : 'CEIL');
  const [dx, dy, ds] = def.dummy;
  g.fillStyle = '#b8b8b8';
  g.fillRect(dx / DIV - 2, dy / DIV - 2, ds / DIV + 4, ds / DIV + 4);
  return c;
}

function drawPlan(g: CanvasRenderingContext2D, W: number, H: number, b: [number, number, number, number], tag: string): void {
  const [x0, z0, x1, z1] = b;
  const px = (x: number) => ((x - x0) / (x1 - x0)) * W;
  const py = (z: number) => ((z - z0) / (z1 - z0)) * H;
  const m = W / (x1 - x0); // 1m あたりの px
  const mirror = tag === 'CEIL';
  const text = (t: string, x: number, y: number) => {
    g.save();
    g.translate(x, y);
    if (mirror) g.scale(-1, 1);
    g.fillText(t, 0, 0);
    g.restore();
  };

  g.fillStyle = '#dcdcdc';
  g.fillRect(0, 0, W, H);
  for (const r of ALL_ROOMS) {
    const [a, c, e, f] = r.rect;
    g.fillStyle = GROUP_COLOR[r.group] + '40';
    g.fillRect(px(a), py(c), px(e) - px(a), py(f) - py(c));
  }
  g.fillStyle = '#c89a5a60';
  for (const bl of BALCONIES) {
    const d = CW.balcony;
    const r =
      bl.side === 's'
        ? [bl.from, PLATE.z1, bl.to, PLATE.z1 + d]
        : bl.side === 'n'
          ? [bl.from, PLATE.z0 - d, bl.to, PLATE.z0]
          : bl.side === 'e'
            ? [PLATE.x1, bl.from, PLATE.x1 + d, bl.to]
            : [PLATE.x0 - d, bl.from, PLATE.x0, bl.to];
    g.fillRect(px(r[0]), py(r[1]), px(r[2]) - px(r[0]), py(r[3]) - py(r[1]));
  }

  // 1m グリッドと 3.2m モジュール（プレート端 x=-38.4 はモジュールの倍数）
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  for (let x = Math.ceil(x0); x <= x1; x++) {
    g.moveTo(px(x), 0);
    g.lineTo(px(x), H);
  }
  for (let z = Math.ceil(z0); z <= z1; z++) {
    g.moveTo(0, py(z));
    g.lineTo(W, py(z));
  }
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  for (let k = Math.ceil(x0 / GRID); k * GRID <= x1; k++) {
    g.moveTo(px(k * GRID), 0);
    g.lineTo(px(k * GRID), H);
  }
  for (let k = Math.ceil(z0 / GRID); k * GRID <= z1; k++) {
    g.moveTo(0, py(k * GRID));
    g.lineTo(W, py(k * GRID));
  }
  g.stroke();

  // 室の輪郭（壁芯に幅 0.4m の帯）と室 ID
  g.lineWidth = 0.4 * m;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const r of ALL_ROOMS) {
    const [a, c, e, f] = r.rect;
    g.strokeStyle = GROUP_COLOR[r.group];
    g.strokeRect(px(a), py(c), px(e) - px(a), py(f) - py(c));
    g.fillStyle = '#222';
    g.font = `bold ${Math.round(0.7 * m)}px sans-serif`;
    text(r.id, (px(a) + px(e)) / 2, (py(c) + py(f)) / 2);
  }
  // 外形線と方位
  g.lineWidth = 0.25 * m;
  g.strokeStyle = '#d02020';
  g.strokeRect(px(PLATE.x0), py(PLATE.z0), px(PLATE.x1) - px(PLATE.x0), py(PLATE.z1) - py(PLATE.z0));
  g.fillStyle = '#d02020';
  g.font = `bold ${Math.round(1.6 * m)}px sans-serif`;
  text(`N ${tag}`, px(-26), py(-17.4));
  text(`S ${tag}`, px(-26), py(17.4));
  text('E', px(35.5), py(0));
  text('W', px(-35.5), py(0));
}

const DIR_COLOR: [string, THREE.Vector3][] = [
  ['#3a6fd0', new THREE.Vector3(0, 0, -1)], // 北向きの面
  ['#c8453a', new THREE.Vector3(0, 0, 1)], // 南
  ['#3a9a4a', new THREE.Vector3(1, 0, 0)], // 東
  ['#d6b93a', new THREE.Vector3(-1, 0, 0)], // 西
];

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}

function drawWall(g: CanvasRenderingContext2D, W: number, H: number, world: World): void {
  g.fillStyle = '#6a6a6a';
  g.fillRect(0, 0, W, H);
  const seen = new Set<string>();
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const uv = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const dPdu = new THREE.Vector3();
  const dPdv = new THREE.Vector3();
  const pad = 3 / DIV;

  for (const mesh of world.lightmap.meshes) {
    if (mesh.userData.lmAtlas !== 'wall') continue;
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position;
    const nor = mesh.geometry.attributes.normal;
    const uv1 = mesh.geometry.attributes.uv1 as THREE.BufferAttribute;
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let t = 0; t + 2 < pos.count; t += 3) {
      for (let k = 0; k < 3; k++) {
        p[k].fromBufferAttribute(pos, t + k).applyMatrix4(mesh.matrixWorld);
        uv[k].fromBufferAttribute(uv1, t + k);
      }
      const u0 = Math.min(uv[0].x, uv[1].x, uv[2].x) * W;
      const u1 = Math.max(uv[0].x, uv[1].x, uv[2].x) * W;
      const v0 = Math.min(uv[0].y, uv[1].y, uv[2].y) * H;
      const v1 = Math.max(uv[0].y, uv[1].y, uv[2].y) * H;
      if (u1 - u0 < 1 || v1 - v0 < 1) continue; // 予約ブロックへ縮退した面
      const key = `${Math.round(u0)},${Math.round(v0)},${Math.round(u1)},${Math.round(v1)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // uv（px）→ 世界座標のアフィン写像
      const du1 = (uv[1].x - uv[0].x) * W;
      const dv1 = (uv[1].y - uv[0].y) * H;
      const du2 = (uv[2].x - uv[0].x) * W;
      const dv2 = (uv[2].y - uv[0].y) * H;
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-9) continue;
      e1.subVectors(p[1], p[0]);
      e2.subVectors(p[2], p[0]);
      dPdu.copy(e1).multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det);
      dPdv.copy(e2).multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det);
      const at = (u: number, v: number) => p[0].clone().addScaledVector(dPdu, u - uv[0].x * W).addScaledVector(dPdv, v - uv[0].y * H);

      n.fromBufferAttribute(nor, t).applyMatrix3(nm).normalize();
      let col = '#888888';
      let best = -1;
      for (const [c, d] of DIR_COLOR) {
        const s = n.dot(d);
        if (s > best) {
          best = s;
          col = c;
        }
      }
      // 高さで明るさを変える（上ほど明るい）
      const yTop = at(u0, v0).y;
      const yBot = at(u0, v1).y;
      const k = (y: number) => 0.35 + 0.6 * THREE.MathUtils.clamp(y / 2.8, 0, 1);
      const grad = g.createLinearGradient(0, v0, 0, v1);
      grad.addColorStop(0, shade(col, k(yTop)));
      grad.addColorStop(1, shade(col, k(yBot)));
      g.fillStyle = grad;
      g.fillRect(u0 - pad, v0 - pad, u1 - u0 + pad * 2, v1 - v0 + pad * 2);

      // 高さ 1m の赤線
      if (Math.abs(dPdv.y) > 1e-6) {
        const vy = v0 + (1 - yTop) / dPdv.y;
        if (vy > v0 && vy < v1) {
          g.fillStyle = '#ff1010';
          g.fillRect(u0, vy - 1, u1 - u0, 2);
        }
      }
      // 水平方向 1m ごとの目盛り（面の向きに応じて x または z）
      const axis = Math.abs(n.z) > Math.abs(n.x) ? 'x' : 'z';
      const d = dPdu[axis];
      if (Math.abs(d) > 1e-6) {
        const h0 = at(u0, v0)[axis];
        const h1 = at(u1, v0)[axis];
        g.fillStyle = 'rgba(0,0,0,0.7)';
        for (let s = Math.ceil(Math.min(h0, h1)); s <= Math.max(h0, h1); s++) {
          const us = u0 + (s - h0) / d;
          g.fillRect(us - 0.5, v0, 1, v1 - v0);
        }
      }
    }
  }
}
