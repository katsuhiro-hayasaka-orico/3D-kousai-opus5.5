import * as THREE from 'three';

/**
 * 外観で建物を遮る周辺街区の箱を隠す。判定は Blender の set_visibility（clear_view）と同じ：
 * カメラが箱（+2 m）の中にあるか、カメラから建物の外接箱の 27 点（角・辺の中点・中心）への線分が箱に当たれば隠す。
 */
export class CityClearance {
  private boxes: THREE.Box3[];
  private probes: THREE.Vector3[] = [];
  private last = new THREE.Vector3(NaN, NaN, NaN);
  private active = false;
  private ray = new THREE.Ray();
  private hit = new THREE.Vector3();
  private grown = new THREE.Box3();

  constructor(
    private blocks: THREE.Mesh[],
    building: THREE.Box3,
  ) {
    this.boxes = blocks.map((m) => new THREE.Box3().setFromObject(m));
    const { min, max } = building;
    for (const fx of [0, 0.5, 1])
      for (const fy of [0, 0.5, 1])
        for (const fz of [0, 0.5, 1])
          this.probes.push(new THREE.Vector3(min.x + (max.x - min.x) * fx, min.y + (max.y - min.y) * fy, min.z + (max.z - min.z) * fz));
  }

  /** 毎フレーム。enabled=false なら全部表示に戻す。カメラが動いたときだけ判定する */
  update(cam: THREE.Vector3, enabled: boolean): void {
    if (!enabled) {
      if (this.active) for (const m of this.blocks) m.visible = true;
      this.active = false;
      this.last.set(NaN, NaN, NaN);
      return;
    }
    if (this.active && cam.distanceToSquared(this.last) < 1e-4) return;
    this.active = true;
    this.last.copy(cam);
    this.blocks.forEach((m, i) => (m.visible = !this.occludes(cam, this.boxes[i])));
  }

  /** 隠している箱の数（撮影・検証用） */
  get hidden(): number {
    return this.blocks.filter((m) => !m.visible).length;
  }

  private occludes(cam: THREE.Vector3, box: THREE.Box3): boolean {
    if (this.grown.copy(box).expandByScalar(2).containsPoint(cam)) return true;
    for (const p of this.probes) {
      const len = cam.distanceTo(p);
      this.ray.origin.copy(cam);
      this.ray.direction.subVectors(p, cam).divideScalar(len);
      if (this.ray.intersectBox(box, this.hit) && this.hit.distanceTo(cam) <= len) return true;
    }
    return false;
  }
}
