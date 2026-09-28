import * as THREE from 'three';
import * as T from './textures';

/**
 * マテリアルパレット。同一キーは 1 インスタンスを共有し、マージ／インスタンシング時のバッチ単位になる。
 */

type Std = THREE.MeshStandardMaterialParameters;

const mats = new Map<string, THREE.Material>();

function std(key: string, p: Std): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(p);
  m.name = key;
  mats.set(key, m);
  return m;
}

function tintable(key: string, p: Std, defaultTint = 0xffffff): THREE.MeshStandardMaterial {
  const m = std(key, { color: 0xffffff, ...p });
  m.userData.tintable = true;
  m.userData.defaultTint = new THREE.Color(defaultTint);
  return m;
}

function emissiveScreen(key: string, tex: THREE.Texture, intensity = 0.9): THREE.MeshStandardMaterial {
  return std(key, {
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: intensity,
    roughness: 0.35,
    metalness: 0.0,
  });
}

let built = false;

export function buildMaterials(): void {
  if (built) return;
  built = true;

  // ---- 床 ----
  std('floor.carpet', { map: T.carpetTexture('gray', 0x8b8e90, 0x5f6366, 1), roughness: 0.98 });
  std('floor.carpetIT', { map: T.carpetTexture('it', 0x7f8a96, 0x3d6d9e, 2), roughness: 0.98 });
  std('floor.carpetRisk', { map: T.carpetTexture('risk', 0x878d86, 0x5d7a57, 3), roughness: 0.98 });
  std('floor.carpetDark', { map: T.carpetTexture('dark', 0x55595e, 0x3a3d41, 4), roughness: 0.98 });
  std('floor.carpetVisitor', { map: T.carpetTexture('visitor', 0x6c6258, 0x8f8272, 5), roughness: 0.98 });
  std('floor.carpetAccent', { map: T.carpetTexture('accent', 0x4c6b8a, 0x6f8fb0, 6), roughness: 0.98 });
  std('floor.wood', { map: T.woodFloorTexture('oak', 0xb08a60, 7), roughness: 0.62 });
  std('floor.stone', { map: T.stoneTexture('ev', 0xcfc8bd, 3), roughness: 0.35, metalness: 0.02 });
  std('floor.stoneDark', { map: T.stoneTexture('evd', 0x6d6a66, 4), roughness: 0.3 });
  std('floor.tile', { map: T.tileTexture('wc', 0xb9b6b0, '#8d8a85'), roughness: 0.5 });
  std('floor.vinyl', { map: T.vinylTexture('lab', 0xc9ccce), roughness: 0.55 });
  std('floor.concrete', { color: 0x9a9894, roughness: 0.92 });
  std('floor.shaft', { color: 0x2b2d30, roughness: 1 });
  std('floor.deck', { map: T.woodFloorTexture('deck', 0x8a6a4c, 17), roughness: 0.85 });
  std('floor.slabEdge', { color: 0xbfbcb6, roughness: 0.9 });

  // ---- 壁・建具 ----
  std('wall.white', { color: 0xf1efea, roughness: 0.9 });
  std('wall.core', { color: 0xe4e1da, roughness: 0.92 });
  std('wall.cap', { color: 0x3b3e42, roughness: 0.8 });
  std('wall.wood', { map: T.woodGrainTexture('wall', 0xa47b52, 31), roughness: 0.7 });
  std('wall.movable', { color: 0xd7d0c4, roughness: 0.85 });
  std('wall.moss', { map: T.mossTexture(), roughness: 1 });
  std('wall.acoustic', { color: 0x5e6b73, roughness: 1 });
  std('wall.wcTile', { map: T.tileTexture('wcw', 0xe8e5df, '#c9c5be'), roughness: 0.5 });
  const glass = std('glass', {
    color: 0xcfe3e6,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.4,
  });
  glass.userData.isGlass = true;
  const film = std('glass.film', {
    color: 0xf4f6f6,
    roughness: 0.6,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  film.userData.isGlass = true;
  const cw = std('glass.cw', {
    color: 0x9fc2c9,
    roughness: 0.04,
    metalness: 0.1,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.8,
  });
  cw.userData.isGlass = true;
  std('alu', { color: 0xb8bcc0, roughness: 0.35, metalness: 0.85 });
  std('alu.dark', { color: 0x4a4e53, roughness: 0.4, metalness: 0.7 });
  std('steel', { color: 0x5b6066, roughness: 0.5, metalness: 0.6 });
  std('steelDoor', { color: 0x8c9095, roughness: 0.55, metalness: 0.4 });
  std('stainless', { color: 0xdfe2e6, roughness: 0.3, metalness: 0.85 });
  std('chrome', { color: 0xe6e8ea, roughness: 0.08, metalness: 1.0 });
  std('door.wood', { map: T.woodGrainTexture('door', 0xb88c5e, 41), roughness: 0.6 });

  // ---- 家具 ----
  std('wood.light', { map: T.woodGrainTexture('light', 0xd6b98f, 51), roughness: 0.55 });
  std('wood.mid', { map: T.woodGrainTexture('mid', 0xa77a4f, 52), roughness: 0.55 });
  std('wood.dark', { map: T.woodGrainTexture('dark', 0x5e4332, 53), roughness: 0.55 });
  std('top.white', { color: 0xf3f2ef, roughness: 0.45 });
  std('top.stone', { color: 0xe7e3dc, roughness: 0.25 });
  std('frame.white', { color: 0xe8e8e6, roughness: 0.4, metalness: 0.3 });
  std('frame.black', { color: 0x222426, roughness: 0.45, metalness: 0.4 });
  std('frame.silver', { color: 0xa9adb2, roughness: 0.35, metalness: 0.8 });
  std('plastic.black', { color: 0x1c1d1f, roughness: 0.5 });
  std('plastic.dark', { color: 0x34373b, roughness: 0.55 });
  std('plastic.white', { color: 0xf0f0ee, roughness: 0.5 });
  std('plastic.gray', { color: 0x9a9da1, roughness: 0.55 });
  std('mesh.black', { color: 0x1f2124, roughness: 0.9 });
  std('fabric.gray', { color: 0x7a7e84, roughness: 1 });
  std('fabric.panel', { color: 0x9da3a8, roughness: 1 });
  std('fabric.blue', { color: 0x3b5b7e, roughness: 1 });
  std('fabric.green', { color: 0x5f7a55, roughness: 1 });
  std('fabric.mustard', { color: 0xc49a3a, roughness: 1 });
  std('fabric.terracotta', { color: 0xb86a4b, roughness: 1 });
  std('fabric.navy', { color: 0x2c3a4f, roughness: 1 });
  std('fabric.beige', { color: 0xcdbfa8, roughness: 1 });
  std('felt.gray', { color: 0x6c7277, roughness: 1 });
  std('felt.green', { color: 0x587160, roughness: 1 });
  std('felt.blue', { color: 0x46607a, roughness: 1 });
  std('leather.black', { color: 0x2a2a2c, roughness: 0.6 });
  std('locker', { map: T.lockerTexture(), roughness: 0.5, metalness: 0.2 });
  std('locker.side', { color: 0xe9e7e2, roughness: 0.5, metalness: 0.2 });
  std('rack.front', { map: T.rackTexture(), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: T.rackTexture() });
  std('rack.body', { color: 0x1a1c1f, roughness: 0.6, metalness: 0.5 });
  std('whiteboard', { map: T.whiteboardTexture(1), roughness: 0.2 });
  std('whiteboard2', { map: T.whiteboardTexture(2), roughness: 0.2 });
  std('whiteboard3', { map: T.whiteboardTexture(3), roughness: 0.2 });
  std('whiteboard.plain', { color: 0xfafaf7, roughness: 0.18 });
  std('paper', { color: 0xf7f6f2, roughness: 0.9 });
  std('cardboard', { color: 0xb08d62, roughness: 0.95 });
  std('ceramic', { color: 0xf5f5f3, roughness: 0.15 });
  std('mirror', { color: 0xdfe6ea, roughness: 0.02, metalness: 1 });
  std('water', { color: 0x9fd4ec, roughness: 0.1, transparent: true, opacity: 0.6 });

  // ---- 植栽 ----
  tintable('leaf', { roughness: 0.8 }, 0x4f7d3a);
  std('leaf.dark', { color: 0x355f2e, roughness: 0.85 });
  std('pot.white', { color: 0xecebe7, roughness: 0.6 });
  std('pot.dark', { color: 0x3b3b3b, roughness: 0.6 });
  std('pot.terracotta', { color: 0xa9674a, roughness: 0.85 });
  std('soil', { color: 0x3d2c20, roughness: 1 });
  std('trunk', { color: 0x6b5139, roughness: 1 });

  // ---- 人物（インスタンスごとに色替え） ----
  tintable('person.skin', { roughness: 0.7 }, 0xe8c3a0);
  tintable('person.hair', { roughness: 0.85 }, 0x241c16);
  tintable('person.top', { roughness: 0.95 }, 0x4a4f57);
  tintable('person.bottom', { roughness: 0.95 }, 0x2b2b2e);
  std('person.shoe', { color: 0x1e1e1f, roughness: 0.6 });
  std('person.eye', { color: 0x141414, roughness: 0.3 });
  std('person.hairFixed', { color: 0x2a2320, roughness: 0.9 });
  std('person.mouth', { color: 0xa0605a, roughness: 0.8 });
  std('headset', { color: 0x1b1c1e, roughness: 0.5 });
  tintable('chair.fabric', { roughness: 1 }, 0x6b7077);

  // ---- 画面 ----
  for (let i = 1; i <= 4; i++) emissiveScreen('screen.video' + i, T.screenVideoMeeting(i), 0.95);
  for (let i = 1; i <= 3; i++) emissiveScreen('screen.code' + i, T.screenCode(i), 0.95);
  for (let i = 1; i <= 3; i++) emissiveScreen('screen.dash' + i, T.screenDashboard(i), 0.9);
  for (let i = 1; i <= 3; i++) emissiveScreen('screen.sheet' + i, T.screenSheet(i), 0.9);
  for (let i = 1; i <= 6; i++) emissiveScreen('screen.soc' + i, T.screenSoc(i), 1.0);
  for (let i = 1; i <= 2; i++) emissiveScreen('screen.slide' + i, T.screenSlides(i), 0.9);
  emissiveScreen('screen.lock', T.screenLock(), 0.7);
  std('screen.off', { color: 0x0c0d0f, roughness: 0.2, metalness: 0.3 });

  // ---- 照明 ----
  std('light.panel', { color: 0xffffff, emissive: 0xfffaf0, emissiveIntensity: 1.6, roughness: 0.5 });
  std('light.warm', { color: 0xfff3dc, emissive: 0xffd9a0, emissiveIntensity: 1.4, roughness: 0.5 });
  std('light.led', { color: 0x44ff66, emissive: 0x44ff66, emissiveIntensity: 1.2 });
  std('light.ledBlue', { color: 0x33aaff, emissive: 0x33aaff, emissiveIntensity: 1.2 });
  std('light.ledRed', { color: 0xff3344, emissive: 0xff3344, emissiveIntensity: 1.2 });
  std('exitSign', { color: 0x1b8f3a, emissive: 0x22aa44, emissiveIntensity: 0.8 });
  std('ceiling', { map: T.ceilingTexture(), roughness: 0.95, side: THREE.DoubleSide });

  // ---- サイン ----
  std('sign.text', { map: T.signTexture(), transparent: true, roughness: 0.6, emissive: 0xffffff, emissiveMap: T.signTexture(), emissiveIntensity: 0.25 });

  // ---- 外装・周辺 ----
  std('facade.panel', { color: 0xe9e6df, roughness: 0.6, metalness: 0.1 });
  std('facade.spandrel', { color: 0x2d3439, roughness: 0.3, metalness: 0.4 });
  std('facade.soffit', { map: T.woodGrainTexture('soffit', 0xb58a5c, 61), roughness: 0.7 });
  std('facade.stone', { color: 0xc9c3b8, roughness: 0.7 });
  std('rail.glass', { color: 0xdde9ea, transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  std('blind', { map: T.blindTexture(), roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const ghost = std('ghost', { color: 0xf6f4ef, roughness: 0.7, transparent: true, opacity: 0.5, depthWrite: false });
  ghost.userData.isGlass = true;
  const ghostLine = std('ghost.glass', { color: 0x7fa3ad, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.26, depthWrite: false });
  ghostLine.userData.isGlass = true;
  const ghostCity = std('ghost.city', { color: 0xe9e6e0, roughness: 0.9, transparent: true, opacity: 0.35, depthWrite: false });
  ghostCity.userData.isGlass = true;
  std('ground', { color: 0x8f9588, roughness: 1 });
  std('asphalt', { map: T.asphaltTexture(), roughness: 0.95 });
  std('paving', { map: T.pavingTexture(), roughness: 0.9 });
  std('lane', { color: 0xf2f2ee, roughness: 0.8 });
  std('laneYellow', { color: 0xe8c547, roughness: 0.8 });
  std('grass', { color: 0x6f8f4e, roughness: 1 });
  std('hedge', { color: 0x456d34, roughness: 1 });

  // ---- オーバーレイ ----
  for (const [k, c] of Object.entries(OVERLAY_COLORS)) {
    std('ov.' + k, { color: c, transparent: true, opacity: 0.42, depthWrite: false, roughness: 1, emissive: c, emissiveIntensity: 0.35 });
  }
}

export const OVERLAY_COLORS: Record<string, number> = {
  it: 0x3d7fd1,
  risk: 0x3f9e5a,
  common: 0xe0a13a,
  visitor: 0xb66ad1,
  core: 0x8a8f96,
};

export function M(key: string): THREE.Material {
  const m = mats.get(key);
  if (!m) throw new Error('unknown material: ' + key);
  return m;
}

export function allMaterials(): Map<string, THREE.Material> {
  return mats;
}
