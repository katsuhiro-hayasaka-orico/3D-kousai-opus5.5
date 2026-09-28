import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ALL_ROOMS, Room, roomArea } from '../data/rooms';

type Kind = 'room' | 'zone' | 'axis' | 'ac' | 'poi';

interface Item {
  obj: CSS2DObject;
  el: HTMLElement;
  kind: Kind;
  rect?: [number, number, number, number];
  minPx: number;
  /** 実測したラベルの幅・高さ（px） */
  w?: number;
  h?: number;
}

/** CSS2D ラベル。画面上の室サイズに応じて自動で出し分け、重なりを抑える。 */
export class Labels {
  renderer: CSS2DRenderer;
  group = new THREE.Group();
  private items: Item[] = [];
  private enabled: Record<Kind, boolean> = { room: true, zone: true, axis: false, ac: false, poi: true };

  constructor(container: HTMLElement) {
    this.renderer = new CSS2DRenderer();
    this.renderer.domElement.className = 'label-layer';
    container.appendChild(this.renderer.domElement);
    this.group.name = 'labels';
  }

  private add(kind: Kind, html: string, cls: string, x: number, y: number, z: number, rect?: Item['rect'], minPx = 0): Item {
    const el = document.createElement('div');
    el.className = `lbl ${cls}`;
    el.innerHTML = html;
    const obj = new CSS2DObject(el);
    obj.position.set(x, y, z);
    this.group.add(obj);
    const it: Item = { obj, el, kind, rect, minPx };
    this.items.push(it);
    return it;
  }

  buildRooms(onClick: (r: Room) => void): void {
    for (const r of ALL_ROOMS) {
      if (r.label === false) continue;
      const [x0, z0, x1, z1] = r.rect;
      const a = roomArea(r);
      const isZone = r.kind === 'office' || r.kind === 'lounge' || r.kind === 'agile' || r.kind === 'focus' || r.kind === 'locker';
      const cap = r.cap ? ` · ${r.cap}席` : '';
      const html = `<b>${r.name}</b><span>${a.toFixed(1)}㎡${cap}</span>`;
      const cls = `lbl-${r.group} ${isZone ? 'lbl-zone' : 'lbl-room'} ${r.group === 'core' ? 'lbl-core' : ''}`;
      const it = this.add(isZone ? 'zone' : 'room', html, cls, (x0 + x1) / 2, 0.15, (z0 + z1) / 2, r.rect, isZone ? 90 : 56);
      it.el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        onClick(r);
      });
    }
  }

  buildAxes(axes: { name: string; x: number; z: number }[]): void {
    for (const a of axes) this.add('axis', a.name, 'lbl-axis', a.x, 0.05, a.z);
    this.add('axis', '76,800', 'lbl-dim', 0, 0.05, 25.4 + 0.2);
    this.add('axis', '38,400', 'lbl-dim lbl-dim-v', 45.2, 0.05, 0);
  }

  buildAc(centers: { id: number; x: number; z: number; units: number }[]): void {
    for (const c of centers) this.add('ac', `AC-${String(c.id).padStart(2, '0')}<span>${c.units}台</span>`, 'lbl-ac', c.x, 0.1, c.z);
  }

  poi(html: string, x: number, y: number, z: number): void {
    this.add('poi', html, 'lbl-poi', x, y, z);
  }

  setEnabled(kind: Kind, on: boolean): void {
    this.enabled[kind] = on;
  }

  isEnabled(kind: Kind): boolean {
    return this.enabled[kind];
  }

  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  /** 1m あたりの画面 px（通り芯ラベルの間引きに使用） */
  private pxPerMeter(camera: THREE.Camera, w: number, h: number): number {
    this.v.set(0, 0, 0).project(camera);
    this.v2.set(6.4, 0, 0).project(camera);
    return Math.hypot((this.v.x - this.v2.x) * w * 0.5, (this.v.y - this.v2.y) * h * 0.5) / 6.4;
  }

  update(scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, visible: boolean): void {
    if (!visible) {
      this.renderer.domElement.style.display = 'none';
      return;
    }
    this.renderer.domElement.style.display = '';
    const ppm = this.pxPerMeter(camera, w, h);
    for (const it of this.items) {
      let show = this.enabled[it.kind];
      if (show && it.kind === 'axis') show = ppm * 6.4 >= 36;
      if (show && it.kind === 'ac') show = ppm * 9.6 >= 60;
      if (show && it.rect) {
        // 室の画面上の大きさ（px）
        const [x0, z0, x1, z1] = it.rect;
        this.v.set(x0, 0, (z0 + z1) / 2).project(camera);
        this.v2.set(x1, 0, (z0 + z1) / 2).project(camera);
        const ax = Math.hypot((this.v.x - this.v2.x) * w * 0.5, (this.v.y - this.v2.y) * h * 0.5);
        this.v.set((x0 + x1) / 2, 0, z0).project(camera);
        this.v2.set((x0 + x1) / 2, 0, z1).project(camera);
        const az = Math.hypot((this.v.x - this.v2.x) * w * 0.5, (this.v.y - this.v2.y) * h * 0.5);
        const long = Math.max(ax, az);
        const short = Math.min(ax, az);
        if (!it.w && it.el.offsetWidth) {
          it.w = it.el.offsetWidth;
          it.h = it.el.offsetHeight;
        }
        const lw = it.w ?? it.minPx;
        const lh = it.h ?? 20;
        show = long >= Math.max(it.minPx, lw * 0.8) && short >= Math.min(lh, 26);
        it.el.classList.toggle('lbl-compact', show && short < lh * 1.4);
      }
      it.obj.visible = show;
    }
    this.renderer.render(scene, camera);
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h);
  }
}
