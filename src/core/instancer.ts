import * as THREE from 'three';
import { PB, Part, mergeByMaterial, mat4 } from './geom';
import { M } from './materials';

/** クリック時に表示する情報 */
export interface PickInfo {
  title: string;
  lines?: string[];
  roomId?: string;
}

interface Item {
  m: THREE.Matrix4;
  tints?: Record<string, THREE.Color>;
  pick?: PickInfo;
}

export interface AddOpts {
  tints?: Record<string, THREE.Color | number>;
  pick?: PickInfo;
  scale?: number | [number, number, number];
  rx?: number;
  rz?: number;
}

/**
 * 家具・人物などの繰り返し要素を InstancedMesh で描画するための登録簿。
 * プロトタイプ（パーツ群）をマテリアル単位でマージし、1 プロト × 1 マテリアル = 1 ドローコールにする。
 */
export class Instancer {
  private protos = new Map<string, Part[]>();
  private items = new Map<string, Item[]>();
  private counts = new Map<string, number>();

  define(name: string, fn: (pb: PB) => void): void {
    if (this.protos.has(name)) return;
    const pb = new PB();
    fn(pb);
    this.protos.set(name, pb.parts);
  }

  has(name: string): boolean {
    return this.protos.has(name);
  }

  add(name: string, x: number, y: number, z: number, ry = 0, o: AddOpts = {}): void {
    if (!this.protos.has(name)) throw new Error('undefined proto: ' + name);
    const s = o.scale ?? 1;
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    const m = mat4(x, y, z, o.rx ?? 0, ry, o.rz ?? 0, sx, sy, sz);
    let arr = this.items.get(name);
    if (!arr) {
      arr = [];
      this.items.set(name, arr);
    }
    let tints: Record<string, THREE.Color> | undefined;
    if (o.tints) {
      tints = {};
      for (const [k, v] of Object.entries(o.tints)) tints[k] = v instanceof THREE.Color ? v : new THREE.Color(v);
    }
    arr.push({ m, tints, pick: o.pick });
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }

  count(name: string): number {
    return this.counts.get(name) ?? 0;
  }

  countPrefix(prefix: string): number {
    let n = 0;
    for (const [k, v] of this.counts) if (k.startsWith(prefix)) n += v;
    return n;
  }

  build(groupName: string, filter?: (proto: string) => boolean): THREE.Group {
    const grp = new THREE.Group();
    grp.name = groupName;
    const white = new THREE.Color(1, 1, 1);
    const tmp = new THREE.Matrix4();
    for (const [name, parts] of this.protos) {
      if (filter && !filter(name)) continue;
      const items = this.items.get(name);
      if (!items || items.length === 0) continue;
      for (const [mk, { geo, noShadow }] of mergeByMaterial(parts)) {
        const mat = M(mk);
        const im = new THREE.InstancedMesh(geo, mat, items.length);
        im.name = `${name}:${mk}`;
        const isGlass = !!mat.userData.isGlass;
        im.castShadow = !isGlass && !noShadow && !mat.name.startsWith('screen') && !mat.name.startsWith('light');
        im.receiveShadow = !isGlass;
        if (isGlass) im.renderOrder = 2;
        const tintable = !!mat.userData.tintable;
        const def = (mat.userData.defaultTint as THREE.Color | undefined) ?? white;
        items.forEach((it, i) => {
          im.setMatrixAt(i, tmp.copy(it.m));
          if (tintable) im.setColorAt(i, it.tints?.[mk] ?? def);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingBox();
        im.computeBoundingSphere();
        im.userData = { proto: name, items };
        grp.add(im);
      }
    }
    return grp;
  }

  /** インスタンスのピック情報 */
  static pickOf(obj: THREE.Object3D, instanceId: number | undefined): PickInfo | undefined {
    const items = obj.userData?.items as Item[] | undefined;
    if (!items || instanceId === undefined) return undefined;
    return items[instanceId]?.pick;
  }
}
