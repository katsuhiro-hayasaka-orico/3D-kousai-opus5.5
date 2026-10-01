import * as THREE from 'three';
import { PB, buildStatic } from './core/geom';
import { Instancer } from './core/instancer';
import { buildMaterials } from './core/materials';
import { Rng } from './core/rng';
import { buildCeiling } from './build/ceiling';
import { buildLayout, Box2, LayoutStats } from './build/layout';
import { buildAcOverlay, buildEvacOverlay, buildPlanLines, buildWifiOverlay, buildZoneOverlay } from './build/overlays';
import { defineProtos } from './build/protos';
import {
  buildColumns,
  CITY_BLOCKS,
  buildCityBlock,
  buildCurtainWall,
  buildFloors,
  buildLedgeAndBalconies,
  buildSite,
  buildStairs,
  buildUpperEaves,
  columnCenters,
  treeProto,
} from './build/shell';
import { Walkers } from './build/walkers';
import { buildRoof, buildUpperFloors, buildUpperFurniture } from './build/upper';
import { DoorInfo, buildWalls, wallColliders } from './build/walls';
import { roomPlateTexture } from './core/textures';
import { lmHash, packWallCharts } from './core/lightmap';
import { ALL_ROOMS, TENANT_ROOMS, roomArea } from './data/rooms';
import { COLUMN, CORE, PLATE } from './data/spec';

export type LayerKey =
  | 'structure'
  | 'furniture'
  | 'people'
  | 'ceiling'
  | 'eaves'
  | 'site'
  | 'upper'
  | 'floors'
  | 'zones'
  | 'ac'
  | 'wifi'
  | 'evac'
  | 'plan';

export interface WorldStats extends LayoutStats {
  columns: number;
  bays: number;
  walkers: number;
  plateArea: number;
  coreArea: number;
  officeGross: number;
  officeNet: number;
  areaByGroup: Record<string, number>;
  ceiling: Record<string, number>;
  acZones: number;
  aps: number;
  rooms: number;
  meetingRooms: number;
}

export interface World {
  layers: Record<LayerKey, THREE.Group>;
  walkers: Walkers;
  obstacles: Box2[];
  colliders: { a: THREE.Vector2; b: THREE.Vector2; t: number }[];
  stats: WorldStats;
  acCenters: { id: number; x: number; z: number; units: number }[];
  axes: { name: string; x: number; z: number }[];
  pickables: THREE.Object3D[];
  /**
   * ライトマップ対象メッシュとレイアウトハッシュ。followers は同じジオメトリを共有する外観用上階の
   * InstancedMesh（userData.lmSource が元メッシュ）で、ハッシュには含めない
   */
  lightmap: { meshes: THREE.Mesh[]; followers: THREE.Mesh[]; hash: string; wallDensity: number; wallFill: number };
  /** 周辺街区の箱（外観で建物を遮るものを隠す：gfx/clearance.ts） */
  cityBlocks: THREE.Mesh[];
}

/** 会議室等の扉脇に室名サイン（H1550） */
function buildRoomPlates(doors: DoorInfo[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'roomPlates';
  const kinds = new Set(['meeting', 'web', 'project', 'soc', 'lab', 'support', 'monitor', 'archive', 'idf', 'storage', 'wc', 'pantry']);
  const geo = new THREE.PlaneGeometry(0.3, 0.1125);
  const done = new Set<string>();
  for (const d of doors) {
    if (!kinds.has(d.room.kind) || done.has(d.room.id) || d.door.type === 'counter') continue;
    done.add(d.room.id);
    const sub = d.room.cap ? `${d.room.cap}名` : d.room.group === 'core' ? '' : d.room.id;
    const mat = new THREE.MeshStandardMaterial({ map: roomPlateTexture(d.room.name.replace(/（.*?）/g, ''), sub), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.12 });
    mat.emissiveMap = mat.map;
    mat.name = `plate.${d.room.id}`;
    const m = new THREE.Mesh(geo, mat);
    m.name = `plate:${d.room.id}`;
    const t = d.wallType === 'rc' ? 0.1 : d.wallType === 'glass' || d.wallType === 'film' ? 0.012 : 0.062;
    const along = d.b + 0.24;
    const out = -1; // 室外側
    if (d.axis === 'h') m.position.set(along, 1.55, d.c + d.inward.y * out * (t + 0.004));
    else m.position.set(d.c + d.inward.x * out * (t + 0.004), 1.55, along);
    m.rotation.y = Math.atan2(-d.inward.x, -d.inward.y);
    g.add(m);
  }
  return g;
}

export function buildWorld(scene: THREE.Scene, progress: (msg: string) => void = () => {}): World {
  buildMaterials();
  const rng = new Rng(42);
  const layers = {} as Record<LayerKey, THREE.Group>;
  const mk = (k: LayerKey) => {
    const g = new THREE.Group();
    g.name = 'layer:' + k;
    layers[k] = g;
    scene.add(g);
    return g;
  };
  (['structure', 'furniture', 'people', 'ceiling', 'eaves', 'site', 'upper', 'floors', 'zones', 'ac', 'wifi', 'evac', 'plan'] as LayerKey[]).forEach(mk);

  // ---- 躯体 ----
  progress('躯体・床・柱を生成中…');
  const sb = new PB();
  buildFloors(sb);
  const nCols = buildColumns(sb);
  const { bays } = buildCurtainWall(sb, rng);
  buildLedgeAndBalconies(sb);
  buildStairs(sb);
  progress('壁・建具を生成中…');
  const walls = buildWalls();
  sb.parts.push(...walls.pb.parts);
  const lmPack = packWallCharts(sb.parts);
  layers.structure.add(buildStatic(sb, 'structure', { lightmap: true }));
  layers.structure.add(buildRoomPlates(walls.doors));

  const eb = new PB();
  buildUpperEaves(eb);
  layers.eaves.add(buildStatic(eb, 'eaves'));

  // ---- 家具・人物 ----
  progress('家具・機器・人物を配置中…');
  const I = new Instancer();
  defineProtos(I);
  I.define('tree', treeProto);
  const layout = buildLayout(I);

  // ---- 天井設備 ----
  progress('天井設備（照明・空調・Wi-Fi）を配置中…');
  const ceil = buildCeiling(I, walls.pieces);
  layers.ceiling.add(buildStatic(ceil.pb, 'ceilingPlanes', { cast: false, lightmap: true }));

  // ---- 外構・周辺街区 ----
  progress('外観・周辺を生成中…');
  const site = new PB();
  const trees: { x: number; z: number; s: number }[] = [];
  buildSite(site, trees);
  layers.site.add(buildStatic(site, 'site', { cast: false }));
  const tr = new Rng(99);
  for (const t of trees) I.add('tree', t.x, -5.6, t.z, tr.range(0, 6), { scale: t.s, tints: { leaf: new THREE.Color().setHSL(0.26 + tr.range(-0.03, 0.03), 0.42, 0.3 + tr.range(-0.05, 0.05)) } });
  const cityBlocks: THREE.Mesh[] = [];
  CITY_BLOCKS.forEach((_, i) => {
    const pb = new PB();
    buildCityBlock(pb, i);
    const g = buildStatic(pb, 'ghost', { cast: false, receive: false });
    // Blender は分割した街区を city.<n> と名付けるので、ここは別の名前にする（番号は Blender 側の並び順に使う）
    g.name = `cityBlock.${i}`;
    g.traverse((o) => (o as THREE.Mesh).isMesh && cityBlocks.push(o as THREE.Mesh));
    layers.upper.add(g);
  });

  // ---- インスタンス生成 ----
  progress('インスタンスを構築中…');
  layers.people.add(I.build('people', (n) => n.startsWith('person.')));
  layers.ceiling.add(I.build('ceilingEquip', (n) => n.startsWith('ceil.')));
  layers.site.add(I.build('trees', (n) => n === 'tree'));
  layers.furniture.add(I.build('furniture', (n) => !n.startsWith('person.') && !n.startsWith('ceil.') && n !== 'tree'));
  layers.ceiling.traverse((o) => ((o as THREE.Mesh).castShadow = false));

  // ---- 外観用の上階（3F〜12F）と屋上 ----
  layers.floors.add(buildUpperFloors([layers.structure, layers.eaves, layers.ceiling]));
  layers.floors.add(buildUpperFurniture(layers.furniture));
  const roof = new PB();
  buildRoof(roof);
  layers.floors.add(buildStatic(roof, 'roof'));

  const walkers = new Walkers();
  layers.people.add(walkers.group);

  // ---- オーバーレイ ----
  layers.zones.add(buildZoneOverlay());
  const acO = buildAcOverlay(ceil.ac);
  layers.ac.add(acO.group);
  layers.wifi.add(buildWifiOverlay(ceil.ap));
  layers.evac.add(buildEvacOverlay());
  const planL = buildPlanLines(walls.doors);
  layers.plan.add(planL.group);

  // ---- 衝突（歩行モード） ----
  const colliders = wallColliders(walls.pieces);
  const obstacles = [...layout.obstacles];
  const s = COLUMN.size / 2 + 0.02;
  for (const [x, z] of columnCenters()) obstacles.push([x - s, z - s, x + s, z + s]);
  // 外周（カーテンウォール）
  const P = PLATE;
  colliders.push(
    { a: new THREE.Vector2(P.x0, P.z0), b: new THREE.Vector2(P.x1, P.z0), t: 0.3 },
    { a: new THREE.Vector2(P.x0, P.z1), b: new THREE.Vector2(P.x1, P.z1), t: 0.3 },
    { a: new THREE.Vector2(P.x0, P.z0), b: new THREE.Vector2(P.x0, P.z1), t: 0.3 },
    { a: new THREE.Vector2(P.x1, P.z0), b: new THREE.Vector2(P.x1, P.z1), t: 0.3 },
  );

  // ---- 集計 ----
  const plateArea = (P.x1 - P.x0) * (P.z1 - P.z0);
  const coreArea = (CORE.x1 - CORE.x0) * (CORE.z1 - CORE.z0);
  const officeGross = TENANT_ROOMS.reduce((a, r) => a + roomArea(r), 0);
  const colArea = nCols * COLUMN.size * COLUMN.size;
  const areaByGroup: Record<string, number> = {};
  for (const r of TENANT_ROOMS) areaByGroup[r.group] = (areaByGroup[r.group] ?? 0) + roomArea(r);
  const meetingList = ALL_ROOMS.filter((r) => ['meeting', 'web', 'project'].includes(r.kind));
  const meetingRooms = meetingList.length;
  const meetingCap = meetingList.reduce((a, r) => a + (r.cap ?? 0), 0);

  const pickables: THREE.Object3D[] = [layers.furniture, layers.people, layers.ceiling];

  const stats: WorldStats = {
    ...layout.stats,
    columns: nCols,
    bays,
    walkers: walkers.count,
    plateArea,
    coreArea,
    officeGross,
    officeNet: officeGross - colArea,
    areaByGroup,
    ceiling: ceil.counts,
    acZones: 30,
    aps: ceil.ap.length,
    rooms: ALL_ROOMS.length,
    meetingRooms,
  };
  stats.meetingSeats = meetingCap;
  stats.present += walkers.count;

  const lmMeshes: THREE.Mesh[] = [];
  for (const k of ['structure', 'ceiling'] as LayerKey[])
    layers[k].traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.lmAtlas) lmMeshes.push(o as THREE.Mesh);
    });
  const followers: THREE.Mesh[] = [];
  layers.floors.traverse((o) => {
    if (o.userData.lmSource) followers.push(o as THREE.Mesh);
  });
  const lightmap = { meshes: lmMeshes, followers, hash: lmHash(lmMeshes), wallDensity: lmPack.density, wallFill: lmPack.fill };

  return { layers, walkers, obstacles, colliders, stats, acCenters: acO.centers, axes: planL.axes, pickables, lightmap, cityBlocks };
}
