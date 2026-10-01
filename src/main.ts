import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { Instancer } from './core/instancer';
import { acZoneOf } from './build/ceiling';
import { ALL_ROOMS, GROUP_LABEL, Room, roomArea, roomAt, roomById } from './data/rooms';
import { CW, GROUND_Y, PLATE, SPEC, TSUBO } from './data/spec';
import { jst, sunPosition } from './sun';
import { Labels } from './ui/labels';
import { Minimap } from './ui/minimap';
import { WalkControls } from './ui/walk';
import { LayerKey, World, buildWorld } from './world';
import { M } from './core/materials';
import { aboutHtml } from './about';
import { EMIT_LAYER, registerEmitters } from './gfx/bloom';
import { Lighting } from './gfx/environment';
import { Lightmaps } from './gfx/lightmaps';
import { CityClearance } from './gfx/clearance';
import { AOParams, PostFX, QUALITIES, Quality, initialQuality, saveQuality } from './gfx/post';
import { Gallery } from './ui/gallery';
import { PanoViewer } from './ui/pano';
import { RENDERS } from './ui/renders';

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
// 素材色を保ったまま高輝度だけを圧縮する Khronos PBR Neutral（ACES より色相・彩度の転びが少ない）
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
// ポストエフェクトは 1 フレームに複数回描画するので、フレーム単位で集計する（loop でリセット）
renderer.info.autoReset = false;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);

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
// 発光体だけを描くブルーム用パスでも同じライト構成にして、シェーダーの再コンパイルを避ける
hemi.layers.enable(EMIT_LAYER);
sun.layers.enable(EMIT_LAYER);
const lighting = new Lighting(scene, hemi, renderer, pmrem);

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

// ポストエフェクト（画質プリセット）
const post = new PostFX(renderer, scene, persp);
post.setQuality(initialQuality());
lighting.setPostToneMapping(post.quality !== 'low');

/** AO の効き（m）。俯瞰は広め、室内は接地感が出る程度に */
const AO_BY_MODE: Record<Mode, AOParams> = {
  orbit: { radius: 1.4, thickness: 2.0, power: 2.6, intensity: 0.9 },
  plan: { radius: 1.0, thickness: 2.5, power: 2.4, intensity: 0.8 },
  walk: { radius: 0.5, thickness: 1.0, power: 1.6, intensity: 1.0 },
  exterior: { radius: 1.8, thickness: 2.5, power: 2.2, intensity: 0.85 },
};

// Blender（Cycles）レンダーのギャラリーと 360° ビューア
const pano = new PanoViewer($('#app'), RENDERS.filter((r) => r.kind === 'pano'), renderer);
const gallery = new Gallery($('#app'), RENDERS, {
  goPreset: (name) => {
    const p = PRESETS.find((q) => q.name === name);
    if (p) goPreset(p);
  },
  openPano: (it) => pano.open(it),
});

// ------------------------------------------------------------
// ワールド構築（進捗表示のため分割実行）
// ------------------------------------------------------------
let world: World;
let walk: WalkControls;
let minimap: Minimap;
let lightmaps: Lightmaps;
let clearance: CityClearance;
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
  clearance = new CityClearance(
    world.cityBlocks,
    new THREE.Box3(new THREE.Vector3(PLATE.x0, GROUND_Y, PLATE.z0), new THREE.Vector3(PLATE.x1, GROUND_Y + SPEC.height, PLATE.z1)),
  );
  labels.poi('麹町ミレニアムガーデン（オリコ本社）※概略', 2, 30, 82, () => world.layers.upper.visible && world.cityBlocks[0].visible);
  registerEmitters(scene);
  lightmaps = new Lightmaps(world, renderer);

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

  // 任意アセット（Blender の出力）は表示開始後に読み込む
  lighting.loadInterior().then(renderGfxNote);
  await lightmaps.load(new URLSearchParams(location.search).has('lmdebug'));
  applyGI(toggles.gi.on);
}

/** ベイク GI の適用（マテリアル差し替え＋環境光のバランス調整） */
function applyGI(on: boolean): void {
  lightmaps.setEnabled(on);
  lighting.setGI(lightmaps.enabled);
  lighting.setDaylight(lightmaps.ambientDaylight);
  syncInteriorExposure();
  const input = toggles.gi.input;
  if (input) {
    input.disabled = !lightmaps.available;
    // 使えないときはチェックを外して見せる（設定値 toggles.gi.on は保持）
    input.checked = lightmaps.available && toggles.gi.on;
  }
  $<HTMLInputElement>('#giGain').disabled = !lightmaps.available;
  renderGfxNote();
}

/** GI 強度（自動露出に対する倍率） */
function setGIGain(g: number): void {
  lightmaps.setGain(g);
  syncInteriorExposure();
  $<HTMLInputElement>('#giGain').value = String(g);
  $('#giGainOut').textContent = g.toFixed(2);
}

/** 室内 HDR の露出をベイク GI と揃える（実ベイクが無ければ HDR 側の自動露出） */
function syncInteriorExposure(): void {
  lighting.setInteriorExposure(lightmaps.status === 'ready' ? lightmaps.exposure * lightmaps.gain : null);
}

function renderGfxNote(): void {
  const lines = [lightmaps.note, lighting.interiorNote].filter(Boolean);
  $('#gfxNote').textContent = lines.join('　／　');
}

function setQuality(q: Quality): void {
  post.setQuality(q);
  lighting.setPostToneMapping(q !== 'low');
  saveQuality(q);
  document.querySelectorAll<HTMLButtonElement>('#quality button').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
}

// ------------------------------------------------------------
// 日照
// ------------------------------------------------------------
function setSun(hours: number): void {
  const { azimuth, elevation } = sunPosition(jst(2026, 9, 28, hours));
  const az = THREE.MathUtils.degToRad(azimuth);
  const el = THREE.MathUtils.degToRad(Math.max(elevation, 2));
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  lighting.setSun(dir);
  sun.position.copy(dir.multiplyScalar(150));
  sun.target.position.set(0, 0, 0);
  const k = THREE.MathUtils.clamp(elevation / 25, 0, 1);
  sun.intensity = 0.4 + 2.2 * k;
  lightmaps.setSun(k, elevation);
  lighting.setDaylight(lightmaps.ambientDaylight);
  sun.color.setHSL(0.08, 0.6 - 0.45 * k, 0.72 + 0.2 * k);
  fitShadow();
  // 周辺街区の点灯窓：昼はガラスの反射に埋もれ、日没に向けて浮かび上がる
  (M('ghost.city') as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 1.3 * (1 - k) ** 2;
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
const toggles: Record<string, { label: string; on: boolean; apply: (v: boolean) => void; input?: HTMLInputElement }> = {};

function layer(k: LayerKey, v: boolean): void {
  world.layers[k].visible = v;
}

function applyModeLayers(): void {
  const t = (k: string) => toggles[k]?.on ?? false;
  layer('structure', true);
  layer('furniture', t('furniture'));
  layer('people', t('people'));
  const indoor = mode === 'walk' || mode === 'exterior';
  // 外観で上階を出すときは、上階の複製と同じく 2F にも天井・照明を出す
  layer('ceiling', mode === 'walk' || (mode === 'exterior' && t('upper')) || (t('ceiling') && mode !== 'plan'));
  layer('eaves', indoor || t('context'));
  layer('site', mode !== 'plan' && t('context'));
  layer('upper', mode === 'exterior' && t('upper'));
  layer('floors', mode === 'exterior' && t('upper'));
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
  fitShadow();
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
  post.setCamera(camera);
  post.setAO(AO_BY_MODE[m]);
  lighting.setMode(m);
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
    ['upper', '上階・周辺（外観時）', true],
    ['gi', 'ベイクGI（Blender）', true],
  ];
  const box = $('#layers');
  for (const [k, label, on] of defs) {
    const l = document.createElement('label');
    l.className = 'tg';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = on;
    const apply =
      k === 'gi'
        ? applyGI
        : () => {
            applyModeLayers();
            renderer.shadowMap.needsUpdate = true;
          };
    toggles[k] = { label, on, apply, input: i };
    i.onchange = () => {
      toggles[k].on = i.checked;
      apply(i.checked);
    };
    const s = document.createElement('span');
    s.textContent = label;
    l.append(i, s);
    box.appendChild(l);
  }
  // ライトマップの読み込みが終わるまでは操作不可
  toggles.gi.input!.disabled = true;
  toggles.gi.input!.closest('label')!.title = 'Blender でベイクした間接光（床・壁・天井）';

  // 画質
  const qbox = $('#quality');
  for (const q of QUALITIES) {
    const b = document.createElement('button');
    b.textContent = q.label;
    b.title = q.title;
    b.dataset.q = q.key;
    b.classList.toggle('on', q.key === post.quality);
    b.onclick = () => setQuality(q.key);
    qbox.appendChild(b);
  }
  const gain = $<HTMLInputElement>('#giGain');
  gain.disabled = true;
  gain.oninput = () => setGIGain(parseFloat(gain.value));
  if (RENDERS.length) {
    const pb = $('#photoBtn');
    pb.hidden = false;
    pb.onclick = () => gallery.open();
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
  // 外観の上階・屋上（不透明）より奥の 2F は選ばない
  const maxD = world.layers.floors.visible ? (ray.intersectObjects(upperOccluders(), false)[0]?.distance ?? Infinity) : Infinity;
  // 床（y=0）との交点
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const fp = new THREE.Vector3();
  const floorHit = ray.ray.intersectPlane(plane, fp);
  const room = floorHit && ray.ray.origin.distanceTo(fp) < maxD ? roomAt(fp.x, fp.z) : undefined;
  for (const h of hits) {
    if (!h.object.visible || h.distance > maxD) continue;
    const info = Instancer.pickOf(h.object, h.instanceId);
    if (info) {
      const rm = roomAt(h.point.x, h.point.z) ?? room;
      showInfo(info.title, info.lines ?? [], rm);
      return;
    }
  }
  if (room) showRoom(room);
}

/** ピックを遮る上階・屋上のメッシュ（ガラス・家具・照明器具は除く） */
let occluders: THREE.Object3D[] | null = null;
function upperOccluders(): THREE.Object3D[] {
  if (!occluders) {
    const list: THREE.Object3D[] = [];
    world.layers.floors.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || m.material.userData.isGlass) return;
      if (m.name.startsWith('upper:furniture:') || m.name.startsWith('upper:ceil.')) return;
      list.push(m);
    });
    occluders = list;
  }
  return occluders;
}

/**
 * 太陽のシャドウカメラの範囲。通常は 2F と外構（原点中心 ±58 m）。外観で上階を出すときは、
 * 建物全体（庇込み・地盤〜塔屋頂部）の外接箱をライト空間へ投影した範囲まで広げる（上階・屋上の影が切れないように）
 */
const shadowBox = new THREE.Box3(
  new THREE.Vector3(PLATE.x0 - CW.eave - 0.5, GROUND_Y, PLATE.z0 - CW.eave - 0.5),
  new THREE.Vector3(PLATE.x1 + CW.eave + 0.5, GROUND_Y + SPEC.height + 0.5, PLATE.z1 + CW.eave + 0.5),
);
const shadowCorner = new THREE.Vector3();
function fitShadow(): void {
  const cam = sun.shadow.camera;
  let [l, r, b, t] = [-58, 58, -58, 58];
  if (mode === 'exterior' && world?.layers.floors.visible) {
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
    for (let i = 0; i < 8; i++) {
      shadowCorner
        .set(i & 1 ? shadowBox.max.x : shadowBox.min.x, i & 2 ? shadowBox.max.y : shadowBox.min.y, i & 4 ? shadowBox.max.z : shadowBox.min.z)
        .applyMatrix4(cam.matrixWorldInverse);
      l = Math.min(l, shadowCorner.x - 1);
      r = Math.max(r, shadowCorner.x + 1);
      b = Math.min(b, shadowCorner.y - 1);
      t = Math.max(t, shadowCorner.y + 1);
    }
  }
  if (cam.left !== l || cam.right !== r || cam.bottom !== b || cam.top !== t) {
    Object.assign(cam, { left: l, right: r, bottom: b, top: t });
    cam.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
  }
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
  // ポストエフェクト込みで描いた直後に読み出す（preserveDrawingBuffer なしでも同一タスク内なら有効）
  lighting.update();
  post.render(0);
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
const viewDir = new THREE.Vector3();

function loop(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  renderer.info.reset();
  requestAnimationFrame(loop);
  if (pano.active) {
    // 360° ビューア表示中はメインシーンを止める
    pano.render();
    return;
  }
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
  clearance.update(persp.position, mode === 'exterior');

  lighting.update();
  post.render(dt);
  labels.update(scene, camera, viewport.clientWidth, viewport.clientHeight, true);

  // ミニマップ・方位
  let yawDeg = 0;
  if (mode === 'walk') {
    minimap.draw(walk.pos.x, walk.pos.y, walk.yaw, THREE.MathUtils.degToRad(persp.fov * 0.7));
  } else if (mode === 'plan') {
    minimap.draw(planCtl.target.x, planCtl.target.z, null);
    yawDeg = ortho.up.x > 0.5 ? 90 : 0;
  } else {
    const d = viewDir.subVectors(orbit.target, persp.position);
    const yaw = Math.atan2(d.x, -d.z);
    yawDeg = THREE.MathUtils.radToDeg(yaw);
    minimap.draw(orbit.target.x, orbit.target.z, yaw, 0.5);
  }
  if (mode === 'walk') yawDeg = THREE.MathUtils.radToDeg(walk.yaw);
  compass.style.setProperty('--rot', `${-yawDeg}deg`);
}

// ------------------------------------------------------------
// リサイズ
// ------------------------------------------------------------
function onResize(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h);
  post.setSize(w, h, renderer.getPixelRatio());
  pano.resize(w, h);
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
    const t = toggles[k];
    if (!t) return;
    t.on = v;
    if (t.input) t.input.checked = v;
    t.apply(v);
  },
  stats: () => world.stats,
  cityHidden: () => clearance.hidden,
  /** 撮影用：外観・俯瞰のカメラを任意の位置・注視点へ（three.js 座標） */
  view: (pos: [number, number, number], target: [number, number, number]) => {
    fly = null;
    persp.position.set(...pos);
    orbit.target.set(...target);
    orbit.update();
  },
  lightmapInfo: () => ({ hash: world.lightmap.hash, wallDensity: world.lightmap.wallDensity, wallFill: world.lightmap.wallFill, meshes: world.lightmap.meshes.length }),
  /** Blender 連携：scene.glb と meta.json をダウンロード（scripts/export-scene.mjs から呼ぶ） */
  exportScene: async () => {
    const ex = await import('./export');
    const glb = await lightmaps.withBaseMaterials(() => ex.exportGLB(world));
    ex.download(glb, 'scene.glb', 'model/gltf-binary');
    ex.download(JSON.stringify(ex.exportMeta(world), null, 1), 'meta.json', 'application/json');
    return glb.byteLength;
  },
  info: () => renderer.info,
  setSun,
  pick,
  setQuality,
  /** 画質・ライトマップ・レンダー一覧の状態 */
  gfx: () => ({ quality: post.quality, lightmap: lightmaps?.info(), interior: lighting.interiorNote, renders: RENDERS.map((r) => `${r.kind}:${r.id}`) }),
  setGIGain,
  debugView: (v: 'ao' | 'bloom' | null) => post.debugView(v),
  openGallery: (i?: number) => (i === undefined ? gallery.open() : gallery.show(i)),
  openPano: (id: string) => {
    const it = RENDERS.find((r) => r.id === id && r.kind === 'pano');
    if (!it) return;
    gallery.close(); // 画面の操作（ギャラリーのカード）と同じく、ギャラリーを閉じてから開く
    pano.open(it);
  },
  closePano: () => pano.close(),
};

init().catch((e) => {
  console.error(e);
  loadmsg.textContent = 'エラー：' + (e as Error).message;
});
