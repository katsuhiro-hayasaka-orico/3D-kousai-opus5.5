import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { ATLASES } from './core/lightmap';
import { allMaterials } from './core/materials';
import { PRESETS } from './data/presets';
import { CORE, GROUND_Y, H, PLATE, SPEC } from './data/spec';
import { BALCONIES } from './data/rooms';
import { jst, sunPosition } from './sun';
import type { LayerKey, World } from './world';

/**
 * Blender 連携用の書き出し。
 *
 *  scene.glb : 躯体・天井・家具・人物・外構・周辺街区（L_upper）を glTF 2.0 で。
 *              InstancedMesh は EXT_mesh_gpu_instancing（Blender はリンク複製として読み込む）。
 *              インスタンスごとの色（人物の服・肌など）は Blender が読まないため、
 *              色ごとにマテリアル派生「キー#rrggbb」を作って InstancedMesh を分割する。
 *              ライトマップ対象メッシュは TEXCOORD_1（uv1）を持つ。
 *  meta.json : ライトマップアトラス定義・レイアウトハッシュ・カメラ・日照・建物寸法。
 */

export const EXPORT_LAYERS: LayerKey[] = ['structure', 'eaves', 'ceiling', 'furniture', 'people', 'site', 'upper'];

const variantCache = new Map<string, THREE.Material>();

function variant(base: THREE.Material, c: THREE.Color): THREE.Material {
  const hex = c.getHexString();
  const key = `${base.name}#${hex}`;
  let m = variantCache.get(key);
  if (!m) {
    m = base.clone();
    (m as THREE.MeshStandardMaterial).color.copy(c);
    m.name = key;
    m.userData = {};
    variantCache.set(key, m);
  }
  return m;
}

/** ユーザーデータ（ピック情報など）を除いた書き出し用コピー */
function cloneForExport(src: THREE.Object3D): THREE.Object3D | null {
  if (src.type === 'CSS2DObject') return null;
  if ((src as THREE.InstancedMesh).isInstancedMesh) {
    const im = src as THREE.InstancedMesh;
    const mat = im.material as THREE.Material;
    const g = new THREE.Group();
    g.name = im.name;
    const tmp = new THREE.Matrix4();
    const col = new THREE.Color();
    const groups = new Map<string, { mat: THREE.Material; idx: number[] }>();
    for (let i = 0; i < im.count; i++) {
      let key = '_';
      let m = mat;
      if (im.instanceColor && mat.userData?.tintable) {
        im.getColorAt(i, col);
        // 連続色（樹木の葉など）は量子化して派生マテリアル数を抑える
        const q = (v: number) => Math.round(v * 24) / 24;
        col.setRGB(q(col.r), q(col.g), q(col.b));
        key = col.getHexString();
        m = variant(mat, col);
      }
      let e = groups.get(key);
      if (!e) {
        e = { mat: m, idx: [] };
        groups.set(key, e);
      }
      e.idx.push(i);
    }
    for (const [key, e] of groups) {
      const out = new THREE.InstancedMesh(im.geometry, e.mat, e.idx.length);
      out.name = key === '_' ? im.name : `${im.name}#${key}`;
      e.idx.forEach((src, i) => {
        im.getMatrixAt(src, tmp);
        out.setMatrixAt(i, tmp);
      });
      out.userData = {};
      g.add(out);
    }
    return g;
  }
  let out: THREE.Object3D;
  if ((src as THREE.Mesh).isMesh) {
    const m = src as THREE.Mesh;
    out = new THREE.Mesh(m.geometry, m.material);
    out.userData = {};
    if (m.userData.lmAtlas) out.userData = { lmAtlas: m.userData.lmAtlas, matKey: m.userData.matKey };
  } else if ((src as THREE.LineSegments).isLineSegments) {
    return null;
  } else {
    out = new THREE.Group();
  }
  out.name = src.name;
  out.position.copy(src.position);
  out.quaternion.copy(src.quaternion);
  out.scale.copy(src.scale);
  for (const c of src.children) {
    const cc = cloneForExport(c);
    if (cc) out.add(cc);
  }
  return out;
}

export function buildExportScene(world: World): THREE.Scene {
  const scene = new THREE.Scene();
  scene.name = 'Kojimachi_Kousai_2F';
  for (const k of EXPORT_LAYERS) {
    const g = new THREE.Group();
    g.name = 'L_' + k;
    for (const c of world.layers[k].children) {
      const cc = cloneForExport(c);
      if (cc) g.add(cc);
    }
    scene.add(g);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

export async function exportGLB(world: World): Promise<ArrayBuffer> {
  const scene = buildExportScene(world);
  const exporter = new GLTFExporter();
  const res = await exporter.parseAsync(scene, { binary: true, onlyVisible: false, maxTextureSize: 2048 });
  return res as ArrayBuffer;
}

/** カメラ（three.js 座標）。walk はヨー・ピッチから注視点を作る */
function presetCameras() {
  return PRESETS.map((p) => {
    if (p.walk) {
      const [x, z, yaw, pitch = -0.05] = p.walk;
      const eye = 1.55;
      const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
      return { name: p.name, group: p.group, mode: p.mode, pos: [x, eye, z], target: [x + dir[0] * 10, eye + dir[1] * 10, z + dir[2] * 10], fov: 62 };
    }
    return { name: p.name, group: p.group, mode: p.mode, pos: p.pos, target: p.target, fov: 45 };
  });
}

export function exportMeta(world: World): Record<string, unknown> {
  const sun = (h: number) => ({ hours: h, ...sunPosition(jst(2026, 9, 28, h)) });
  const mats: Record<string, unknown> = {};
  for (const [k, m] of allMaterials()) {
    const s = m as THREE.MeshStandardMaterial;
    mats[k] = {
      color: s.color?.getHexString(),
      roughness: s.roughness,
      metalness: s.metalness,
      emissive: s.emissive?.getHexString(),
      emissiveIntensity: s.emissiveIntensity,
      opacity: s.opacity,
      transparent: s.transparent,
      map: !!s.map,
      tintable: !!m.userData.tintable,
      glass: !!m.userData.isGlass,
    };
  }
  return {
    version: 1,
    note: 'three.js 座標（x=東, y=上, z=南, 単位 m）。Blender に glTF で読み込むと (x, -z, y) になる。',
    building: {
      name: SPEC.name,
      plate: PLATE,
      core: CORE,
      ceiling: H.ceiling,
      floorToFloor: H.floorToFloor,
      groundY: GROUND_Y,
      heightFromGround: SPEC.height,
      floors: 12,
      balconies: BALCONIES,
    },
    lightmap: {
      hash: world.lightmap.hash,
      wallDensityPxPerM: world.lightmap.wallDensity,
      wallFill: world.lightmap.wallFill,
      atlases: ATLASES,
      meshes: world.lightmap.meshes.map((m) => ({ name: m.name, atlas: m.userData.lmAtlas, material: m.userData.matKey, triangles: m.geometry.attributes.position.count / 3 })),
      uvConvention: 'uv1 の v は画像上端=0（three.js 側 flipY=false）。glTF 読み込み後の Blender UV では画像下端基準になるため、ベイク画像はそのまま使える。',
    },
    sun: { date: '2026-09-28', tz: '+09:00', lat: 35.685, lon: 139.733, default: sun(10.5), morning: sun(8.5), afternoon: sun(14), dusk: sun(17.3) },
    cameras: presetCameras(),
    materials: mats,
    layers: EXPORT_LAYERS.map((k) => 'L_' + k),
  };
}

export function download(data: BlobPart, name: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
