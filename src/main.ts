import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './style.css';
import { Instancer } from './core/instancer';
import { acZoneOf } from './build/ceiling';
import { ALL_ROOMS, GROUP_LABEL, Room, roomArea, roomAt, roomById } from './data/rooms';
import { SPEC, TSUBO } from './data/spec';
import { jst, sunPosition } from './sun';
import { Labels } from './ui/labels';
import { Minimap } from './ui/minimap';
import { WalkControls } from './ui/walk';
import { LayerKey, World, buildWorld } from './world';
import { aboutHtml } from './about';

import { Mode, PRESETS, Preset } from './data/presets';

const PI = Math.PI;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const viewport = $('#viewport');
const loadmsg = $('#loadmsg');

// ------------------------------------------------------------
// レンダラー・シーン
// ------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe4e8ec);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const hemi = new THREE.HemisphereLight(0xf4f7fb, 0x8a8478, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e2, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -58;
sun.shadow.camera.right = 58;
sun.shadow.camera.top = 58;
sun.shadow.camera.bottom = -58;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 320;
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.025;
scene.add(sun);
scene.add(sun.target);

// カメラ
const persp = new THREE.PerspectiveCamera(45, 1, 0.08, 1200);
persp.position.set(40, 58, 72);
const ortho = new THREE.OrthographicCamera(-50, 50, 30, -30, 0.1, 500);
ortho.position.set(0, 200, 0);
ortho.up.set(0, 0, -1);
ortho.lookAt(0, 0, 0);
let camera: THREE.Camera = persp;

const orbit = new OrbitControls(persp, renderer.domElement);
orbit.target.set(0, 0, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.minDistance = 3;
orbit.maxDistance = 400;
orbit.screenSpacePanning = true;

const planCtl = new OrbitControls(ortho, renderer.domElement);
planCtl.enableRotate = false;
planCtl.enableDamping = true;
planCtl.screenSpacePanning = true;
planCtl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
planCtl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
planCtl.minZoom = 0.6;
planCtl.maxZoom = 12;
planCtl.enabled = false;

const labels = new Labels(viewport);
scene.add(labels.group);

// ------------------------------------------------------------
// ワールド構築（進捗表示のため分割実行）
// ------------------------------------------------------------
let world: World;
let walk: WalkControls;
let minimap: Minimap;
let mode: Mode = 'orbit';

const tick = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function init(): Promise<void> {
  loadmsg.textContent = 'マテリアル・テクスチャを生成中…';
  await tick();
  world = buildWorld(scene, (m) => (loadmsg.textContent = m));
  await tick();
  loadmsg.textContent = 'ラベル・UI を準備中…';
  labels.buildRooms((r) => showRoom(r));
  labels.buildAxes(world.axes);
  labels.buildAc(world.acCenters);
  labels.poi('新宿通り →（南）', 0, -5.4, 33);
  labels.poi('麹町ミレニアムガーデン（オリコ本社）※概略', 2, 30, 82);

  walk = new WalkControls(persp, renderer.domElement, world.colliders, world.obstacles);
  minimap = new Minimap($('#mapbox'), (x, z) => {
    if (mode === 'walk') walk.place(x, z, walk.yaw);
    else if (mode === 'plan') flyPlan(x, z, ortho.zoom);
    else flyTo(new THREE.Vector3(x + 10, 22, z + 18), new THREE.Vector3(x, 0, z));
  });

  buildPanel();
  setSun(10.5);
  setMode('orbit', true);
  onResize();
  $('#loading').classList.add('done');
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------
// 日照
// ------------------------------------------------------------
function setSun(hours: number): void {
  const { azimuth, elevation } = sunPosition(jst(2026, 9, 28, hours));
  const az = THREE.MathUtils.degToRad(azimuth);
  const el = THREE.MathUtils.degToRad(Math.max(elevation, 2));
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  sun.position.copy(dir.multiplyScalar(150));
  sun.target.position.set(0, 0, 0);
  const k = THREE.MathUtils.clamp(elevation / 25, 0, 1);
  sun.intensity = 0.4 + 2.2 * k;
  sun.color.setHSL(0.08, 0.6 - 0.45 * k, 0.72 + 0.2 * k);
  renderer.shadowMap.needsUpdate = true;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  $('#timeOut').textContent = `${h}:${String(m).padStart(2, '0')}`;
  const shOut = $('#timeOut');
  shOut.title = `太陽方位 ${azimuth.toFixed(0)}° / 高度 ${elevation.toFixed(0)}°`;
}

// ------------------------------------------------------------
// モード
// ------------------------------------------------------------
const toggles: Record<string, { label: string; on: boolean; apply: (v: boolean) => void }> = {};

function layer(k: LayerKey, v: boolean): void {
  world.layers[k].visible = v;
}

function applyModeLayers(): void {
  const t = (k: string) => toggles[k]?.on ?? false;
  layer('structure', true);
  layer('furniture', t('furniture'));
  layer('people', t('people'));
  const indoor = mode === 'walk' || mode === 'exterior';
  layer('ceiling', mode === 'walk' || (t('ceiling') && mode !== 'plan'));
  layer('eaves', indoor || t('context'));
  layer('site', mode !== 'plan' && t('context'));
  layer('upper', mode === 'exterior' && t('upper'));
  layer('zones', t('zones'));
  layer('ac', t('ac'));
  layer('wifi', t('wifi'));
  layer('evac', t('evac'));
  layer('plan', mode === 'plan' || t('grid'));
  labels.setEnabled('room', t('labels') && (mode === 'orbit' || mode === 'plan'));
  labels.setEnabled('zone', t('labels') && (mode === 'orbit' || mode === 'plan'));
  labels.setEnabled('axis', mode === 'plan' || t('grid'));
  labels.setEnabled('ac', t('ac'));
  labels.setEnabled('poi', mode === 'exterior');
}

let panelBeforeWalk: boolean | null = null;

/** 左パネルに隠れないよう、描画中心を空き領域の中心へずらす */
function applyViewOffset(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  const open = !$('#panel').classList.contains('closed');
  const off = open && w >= 900 && mode !== 'walk' ? 156 : 0;
  for (const cam of [persp, ortho]) {
    if (off) cam.setViewOffset(w, h, -off, 0, w, h);
    else cam.clearViewOffset();
  }
}

function setMode(m: Mode, instant = false): void {
  const panel = $('#panel');
  if (m === 'walk' && mode !== 'walk') {
    panelBeforeWalk = panel.classList.contains('closed');
    if (window.innerWidth < 1500) panel.classList.add('closed');
  } else if (m !== 'walk' && mode === 'walk' && panelBeforeWalk !== null) {
    panel.classList.toggle('closed', panelBeforeWalk);
    panelBeforeWalk = null;
  }
  mode = m;
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  orbit.enabled = m === 'orbit' || m === 'exterior';
  planCtl.enabled = m === 'plan';
  walk.enabled = m === 'walk';
  $('#walkui').hidden = m !== 'walk';
  $('#hintbar').hidden = m === 'walk';
  $('#hintbar').textContent =
    m === 'plan'
      ? 'ドラッグ：移動　ホイール：ズーム　クリック：詳細表示'
      : m === 'walk'
        ? 'W/A/S/D・矢印：移動　ドラッグ：見回し　ホイール：画角　ミニマップ：ワープ'
        : 'ドラッグ：回転　右ドラッグ：移動　ホイール：ズーム　クリック：詳細表示';
  scene.background = new THREE.Color(m === 'plan' ? 0xf4f5f6 : m === 'orbit' ? 0xe4e8ec : 0xcfe0ee);
  if (m === 'plan') {
    camera = ortho;
    // 縦長画面では長手（東西）を縦にして表示
    const portrait = viewport.clientWidth / viewport.clientHeight < 0.8;
    ortho.up.set(portrait ? 1 : 0, 0, portrait ? 0 : -1);
    ortho.position.set(0, 200, 0);
    planCtl.target.set(0, 0, 0);
    ortho.zoom = 1;
    fitOrtho();
    planCtl.update();
  } else if (m === 'walk') {
    camera = persp;
    persp.fov = 62;
    persp.updateProjectionMatrix();
    walk.place(0, 4.6, Math.PI, -0.04);
  } else {
    camera = persp;
    persp.fov = 45;
    persp.updateProjectionMatrix();
    if (m === 'orbit') {
      orbit.maxPolarAngle = Math.PI * 0.495;
      flyTo(new THREE.Vector3(40, 58, 72).multiplyScalar(fitScale()), new THREE.Vector3(0, 0, 0), instant);
    } else {
      orbit.maxPolarAngle = Math.PI * 0.52;
      flyTo(new THREE.Vector3(62, 12, 92), new THREE.Vector3(2, 9, 4), instant);
    }
  }
  applyModeLayers();
  applyViewOffset();
  renderer.shadowMap.needsUpdate = true;
}

/** 縦長画面ではカメラを引く */
function fitScale(): number {
  const a = viewport.clientWidth / Math.max(1, viewport.clientHeight);
  return THREE.MathUtils.clamp(1.3 / a, 1, 2.6);
}

function fitOrtho(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  const panelOpen = !$('#panel').classList.contains('closed') && w >= 900;
  const avail = w - (panelOpen ? 312 : 0);
  const portrait = w / h < 0.8;
  const needW = portrait ? 60 : 96;
  const needH = portrait ? 96 : 60;
  const aspect = avail / h;
  let halfW = needW / 2;
  let halfH = halfW / aspect;
  if (halfH * 2 < needH) {
    halfH = needH / 2;
    halfW = halfH * aspect;
  }
  halfW *= w / avail;
  ortho.left = -halfW;
  ortho.right = halfW;
  ortho.top = halfH;
  ortho.bottom = -halfH;
  ortho.updateProjectionMatrix();
}

// カメラ移動アニメーション
let fly: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; t: number } | null = null;
function flyTo(pos: THREE.Vector3, target: THREE.Vector3, instant = false): void {
  if (instant) {
    persp.position.copy(pos);
    orbit.target.copy(target);
    orbit.update();
    fly = null;
    return;
  }
  fly = { p0: persp.position.clone(), p1: pos, t0: orbit.target.clone(), t1: target, t: 0 };
}
function flyPlan(x: number, z: number, zoom: number): void {
  planCtl.target.set(x, 0, z);
  ortho.position.set(x, 200, z);
  ortho.zoom = Math.max(zoom, 2.2);
  ortho.updateProjectionMatrix();
}

// ------------------------------------------------------------
// プリセット
// ------------------------------------------------------------
function goPreset(p: Preset): void {
  if (mode !== p.mode) setMode(p.mode, true);
  if (p.walk) {
    walk.place(p.walk[0], p.walk[1], p.walk[2], p.walk[3] ?? -0.05);
  } else if (p.pos && p.target) {
    const t = new THREE.Vector3(...p.target);
    const pos = new THREE.Vector3(...p.pos);
    if (p.mode === 'orbit') pos.sub(t).multiplyScalar(fitScale()).add(t);
    flyTo(pos, t);
  }
}

// ------------------------------------------------------------
// パネル
// ------------------------------------------------------------
function buildPanel(): void {
  const pre = $('#presets');
  let lastGroup = '';
  for (const p of PRESETS) {
    if (p.group !== lastGroup) {
      const g = document.createElement('div');
      g.className = 'grp';
      g.textContent = p.group;
      pre.appendChild(g);
      lastGroup = p.group;
    }
    const b = document.createElement('button');
    b.textContent = p.name;
    b.onclick = () => goPreset(p);
    pre.appendChild(b);
  }

  const defs: [string, string, boolean][] = [
    ['furniture', '家具・機器', true],
    ['people', '人物', true],
    ['labels', '室名ラベル', true],
    ['ceiling', '天井・照明', false],
    ['zones', 'ゾーン色分け', false],
    ['ac', '空調30ゾーン', false],
    ['wifi', '無線LAN AP', false],
    ['evac', '避難経路', false],
    ['grid', '通り芯・扉軌跡', false],
    ['context', '外構・周辺', true],
    ['upper', '他階（外観時）', true],
  ];
  const box = $('#layers');
  for (const [k, label, on] of defs) {
    toggles[k] = { label, on, apply: () => applyModeLayers() };
    const l = document.createElement('label');
    l.className = 'tg';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = on;
    i.onchange = () => {
      toggles[k].on = i.checked;
      applyModeLayers();
      renderer.shadowMap.needsUpdate = true;
    };
    const s = document.createElement('span');
    s.textContent = label;
    l.append(i, s);
    box.appendChild(l);
  }

  const time = $<HTMLInputElement>('#time');
  time.oninput = () => setSun(parseFloat(time.value));
  const sh = $<HTMLInputElement>('#shadows');
  sh.onchange = () => {
    sun.castShadow = sh.checked;
    renderer.shadowMap.needsUpdate = true;
  };

  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode as Mode)));
  $('#panelToggle').onclick = () => {
    $('#panel').classList.toggle('closed');
    fitOrtho();
    applyViewOffset();
  };
  if (window.innerWidth < 760) $('#panel').classList.add('closed');
  $('#info .close').onclick = () => ($('#info').hidden = true);
  $('#modal .close').onclick = () => ($('#modal').hidden = true);
  $('#modal').onclick = (e) => {
    if (e.target === $('#modal')) $('#modal').hidden = true;
  };
  $('#about').onclick = () => {
    $('#modal .body').innerHTML = aboutHtml(world.stats);
    $('#modal').hidden = false;
  };
  $('#shot').onclick = screenshot;
  $('#csv').onclick = exportCsv;

  // ウォーク用ボタン
  document.querySelectorAll<HTMLButtonElement>('#walkui [data-move]').forEach((b) => {
    const mv = b.dataset.move!;
    const start = (e: Event) => {
      e.preventDefault();
      if (mv === 'f') walk.setIntent(1, 0);
      if (mv === 'b') walk.setIntent(-1, 0);
      if (mv === 'l') walk.setIntent(0, -1);
      if (mv === 'r') walk.setIntent(0, 1);
    };
    const stop = () => walk.setIntent(0, 0);
    b.addEventListener('pointerdown', start);
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', stop);
    b.addEventListener('pointercancel', stop);
  });

  renderStats();
}

function renderStats(): void {
  const s = world.stats;
  const net = s.officeNet;
  const rows: [string, string, boolean?][] = [
    ['基準階貸室（公開）', `${SPEC.typicalRentable.toLocaleString()}㎡（${SPEC.typicalRentableTsubo}坪）`],
    ['本モデル専有面積', `${net.toFixed(1)}㎡（${(net / TSUBO).toFixed(2)}坪）`],
    ['公開値との差', `${(((net - SPEC.typicalRentable) / SPEC.typicalRentable) * 100).toFixed(2)}%`],
    ['外形／コア', '76.8×38.4m ／ 32.0×22.4m'],
    ['IT／リスク', `${(s.areaByGroup.it ?? 0).toFixed(1)} ／ ${(s.areaByGroup.risk ?? 0).toFixed(1)}㎡`],
    ['共用ラウンジ／来客', `${(s.areaByGroup.common ?? 0).toFixed(1)} ／ ${(s.areaByGroup.visitor ?? 0).toFixed(1)}㎡`],
    ['天井高・床', 'CH2,800・OAフロア'],
    ['執務席（IT／リスク）', `${s.desks.it} ／ ${s.desks.risk}席`, true],
    ['うち集中席', `${s.focus}席`],
    ['会議室・Web会議室', `${s.meetingRooms}室（${s.meetingSeats}席）`],
    ['Webブース（1人／2人）', `${s.booths1} ／ ${s.booths2}台`],
    ['ラウンジ席', `約${s.lounge}席`],
    ['個人ロッカー', `${s.lockers}人分`],
    ['表示中の在席者', `${s.present}人`, true],
    ['うちWeb会議中', `${s.webMeeting}人`],
    ['モバイルPC／外部モニター', `${s.laptops} ／ ${s.monitors}台`],
    ['大型ディスプレイ', `${s.displays}面`],
    ['複合機', `${s.mfp}台`],
    ['無線LAN AP', `${s.aps}台`, true],
    ['空調', `${s.acZones}ゾーン／カセット${s.ceiling.ac ?? 0}台`],
    ['LED照明', `${s.ceiling.light ?? 0}台`],
    ['外周柱／ガラス面', `${s.columns}本 ／ ${s.bays}スパン`],
  ];
  $('#stats').innerHTML = rows.map(([k, v, sep]) => `<tr class="${sep ? 'sep' : ''}"><th>${k}</th><td>${v}</td></tr>`).join('');
}

// ------------------------------------------------------------
// ピック・情報表示
// ------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt: { x: number; y: number; t: number } | null = null;

renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5) return;
  pick(e.clientX, e.clientY);
});

function groupColor(g: string): string {
  return { it: '#3d7fd1', risk: '#3f9e5a', common: '#e0a13a', visitor: '#b66ad1', core: '#8a8f96' }[g] ?? '#666';
}

function pick(cx: number, cy: number): void {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = world.pickables.filter((o) => o.visible);
  const hits = ray.intersectObjects(targets, true);
  // 床（y=0）との交点
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const fp = new THREE.Vector3();
  const floorHit = ray.ray.intersectPlane(plane, fp);
  const room = floorHit ? roomAt(fp.x, fp.z) : undefined;
  for (const h of hits) {
    if (!h.object.visible) continue;
    const info = Instancer.pickOf(h.object, h.instanceId);
    if (info) {
      const rm = roomAt(h.point.x, h.point.z) ?? room;
      showInfo(info.title, info.lines ?? [], rm);
      return;
    }
  }
  if (room) showRoom(room);
}

function roomDetail(r: Room): string {
  const [x0, z0, x1, z1] = r.rect;
  const a = roomArea(r);
  const zones = new Set<number>();
  for (let x = x0 + 0.5; x < x1; x += 1.5) for (let z = z0 + 0.5; z < z1; z += 1.5) zones.add(acZoneOf(x, z));
  const ac = r.group === 'core' ? '—' : [...zones].sort((p, q) => p - q).map((n) => 'AC-' + String(n).padStart(2, '0')).join(', ');
  return `
    <span class="tag" style="background:${groupColor(r.group)}">${GROUP_LABEL[r.group]}</span>
    <h2>${r.name}</h2>
    <dl>
      <dt>寸法</dt><dd>${(x1 - x0).toFixed(1)}m × ${(z1 - z0).toFixed(1)}m</dd>
      <dt>面積</dt><dd>${a.toFixed(2)}㎡（${(a / TSUBO).toFixed(2)}坪）</dd>
      ${r.cap ? `<dt>席数</dt><dd>${r.cap}席</dd>` : ''}
      <dt>空調</dt><dd>${ac}</dd>
      <dt>ID</dt><dd>${r.id}</dd>
    </dl>
    ${r.equip?.length ? `<ul>${r.equip.map((e) => `<li>${e}</li>`).join('')}</ul>` : ''}
    ${r.note ? `<div class="note">${r.note}</div>` : ''}
    <button class="go" data-room="${r.id}">この場所を歩いて見る</button>`;
}

function showRoom(r: Room): void {
  const body = $('#info .body');
  body.innerHTML = roomDetail(r);
  bindGo(body);
  $('#info').hidden = false;
}

function showInfo(title: string, lines: string[], r?: Room): void {
  const body = $('#info .body');
  body.innerHTML = `<h2>${title}</h2><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>${r ? `<hr style="border:0;border-top:1px solid var(--line);margin:10px 0" />${roomDetail(r)}` : ''}`;
  bindGo(body);
  $('#info').hidden = false;
}

function bindGo(body: HTMLElement): void {
  body.querySelectorAll<HTMLButtonElement>('.go').forEach((b) => {
    b.onclick = () => {
      const r = roomById(b.dataset.room!);
      const [x0, z0, x1, z1] = r.rect;
      if (mode !== 'walk') setMode('walk', true);
      // 室内の空いている点を探す
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const cand: [number, number][] = [];
      for (let i = 0; i <= 8; i++)
        for (let j = 0; j <= 8; j++) cand.push([x0 + 0.5 + ((x1 - x0 - 1) * i) / 8, z0 + 0.5 + ((z1 - z0 - 1) * j) / 8]);
      cand.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q[0] - cx, q[1] - cz));
      const free = cand.find(([x, z]) => !world.obstacles.some((o) => x > o[0] - 0.35 && x < o[2] + 0.35 && z > o[1] - 0.35 && z < o[3] + 0.35)) ?? [cx, cz];
      // 室の長手方向を向く
      const yaw = x1 - x0 > z1 - z0 ? (free[0] < cx ? PI / 2 : -PI / 2) : free[1] < cz ? PI : 0;
      walk.place(free[0], free[1], yaw, -0.08);
    };
  });
}

// ------------------------------------------------------------
// スクリーンショット
// ------------------------------------------------------------
function screenshot(): void {
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `kojimachi-kousai-2f-${mode}.png`;
  a.click();
}

function exportCsv(): void {
  const head = ['ID', '室名', '区分', '用途', '幅(m)', '奥行(m)', '面積(㎡)', '面積(坪)', '席数', '設備・備考'];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(',')];
  for (const r of ALL_ROOMS) {
    const [x0, z0, x1, z1] = r.rect;
    const a = roomArea(r);
    lines.push(
      [r.id, r.name, GROUP_LABEL[r.group], r.kind, (x1 - x0).toFixed(2), (z1 - z0).toFixed(2), a.toFixed(2), (a / TSUBO).toFixed(2), r.cap ?? '', [...(r.equip ?? []), r.note ?? ''].filter(Boolean).join(' / ')]
        .map(esc)
        .join(','),
    );
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kojimachi-kousai-2f-rooms.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------
// ループ
// ------------------------------------------------------------
const clock = new THREE.Clock();
const compass = $('#compass');

function loop(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 0.9);
    const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
    persp.position.lerpVectors(fly.p0, fly.p1, e);
    orbit.target.lerpVectors(fly.t0, fly.t1, e);
    if (fly.t >= 1) fly = null;
  }
  if (world.layers.people.visible) world.walkers.update(dt);
  if (mode === 'walk') walk.update(dt);
  else if (mode === 'plan') planCtl.update();
  else orbit.update();

  renderer.render(scene, camera);
  labels.update(scene, camera, viewport.clientWidth, viewport.clientHeight, true);

  // ミニマップ・方位
  let yawDeg = 0;
  if (mode === 'walk') {
    minimap.draw(walk.pos.x, walk.pos.y, walk.yaw, THREE.MathUtils.degToRad(persp.fov * 0.7));
  } else if (mode === 'plan') {
    minimap.draw(planCtl.target.x, planCtl.target.z, null);
    yawDeg = ortho.up.x > 0.5 ? 90 : 0;
  } else {
    const d = new THREE.Vector3().subVectors(orbit.target, persp.position);
    const yaw = Math.atan2(d.x, -d.z);
    yawDeg = THREE.MathUtils.radToDeg(yaw);
    minimap.draw(orbit.target.x, orbit.target.z, yaw, 0.5);
  }
  if (mode === 'walk') yawDeg = THREE.MathUtils.radToDeg(walk.yaw);
  compass.style.setProperty('--rot', `${-yawDeg}deg`);
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------
// リサイズ
// ------------------------------------------------------------
function onResize(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  persp.aspect = w / h;
  persp.updateProjectionMatrix();
  fitOrtho();
  applyViewOffset();
  minimap?.resize();
}
window.addEventListener('resize', onResize);

// テスト・デバッグ用フック
(window as unknown as { __app: unknown }).__app = {
  setMode: (m: Mode) => setMode(m, true),
  goPreset: (name: string) => {
    const p = PRESETS.find((q) => q.name === name);
    if (p) {
      goPreset(p);
      if (p.pos && p.target) fly && (fly.t = 0.999);
    }
  },
  presets: () => PRESETS.map((p) => p.name),
  toggle: (k: string, v: boolean) => {
    if (toggles[k]) {
      toggles[k].on = v;
      applyModeLayers();
      renderer.shadowMap.needsUpdate = true;
    }
  },
  stats: () => world.stats,
  lightmapInfo: () => ({ hash: world.lightmap.hash, wallDensity: world.lightmap.wallDensity, wallFill: world.lightmap.wallFill, meshes: world.lightmap.meshes.length }),
  /** Blender 連携：scene.glb と meta.json をダウンロード（scripts/export-scene.mjs から呼ぶ） */
  exportScene: async () => {
    const ex = await import('./export');
    const glb = await ex.exportGLB(world);
    ex.download(glb, 'scene.glb', 'model/gltf-binary');
    ex.download(JSON.stringify(ex.exportMeta(world), null, 1), 'meta.json', 'application/json');
    return glb.byteLength;
  },
  info: () => renderer.info,
  setSun,
  pick,
};

init().catch((e) => {
  console.error(e);
  loadmsg.textContent = 'エラー：' + (e as Error).message;
});
