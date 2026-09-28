import { ALL_ROOMS, BALCONIES } from '../data/rooms';
import { PLATE } from '../data/spec';

const FILL: Record<string, string> = {
  core: '#c9ccd1',
  it: '#cfe0f5',
  risk: '#d3ead7',
  common: '#f6e2bd',
  visitor: '#eadcf2',
};

/** 2D 平面ミニマップ（現在地・視線方向を表示、クリックで移動） */
export class Minimap {
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oz = 0;
  private base: HTMLCanvasElement;

  constructor(container: HTMLElement, onPick: (x: number, z: number) => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    container.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.canvas.addEventListener('pointerdown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const dpr = this.canvas.width / r.width;
      const x = ((e.clientX - r.left) * dpr - this.ox) / this.scale + PLATE.x0 - 3;
      const z = ((e.clientY - r.top) * dpr - this.oz) / this.scale + PLATE.z0 - 3;
      onPick(x, z);
      e.stopPropagation();
    });
    this.resize();
  }

  resize(): void {
    const cssW = this.canvas.clientWidth || 260;
    const W = PLATE.x1 - PLATE.x0 + 6;
    const D = PLATE.z1 - PLATE.z0 + 6;
    const cssH = (cssW * D) / W;
    this.canvas.style.height = cssH + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.scale = this.canvas.width / W;
    this.ox = 0;
    this.oz = 0;
    this.drawBase();
  }

  private toPx(x: number, z: number): [number, number] {
    return [(x - PLATE.x0 + 3) * this.scale + this.ox, (z - PLATE.z0 + 3) * this.scale + this.oz];
  }

  private drawBase(): void {
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    const g = this.base.getContext('2d')!;
    g.fillStyle = '#f7f7f5';
    g.fillRect(0, 0, this.base.width, this.base.height);
    for (const b of BALCONIES) {
      const d = 2.4;
      let r: [number, number, number, number];
      if (b.side === 's') r = [b.from, PLATE.z1, b.to, PLATE.z1 + d];
      else if (b.side === 'e') r = [PLATE.x1, b.from, PLATE.x1 + d, b.to];
      else if (b.side === 'w') r = [PLATE.x0 - d, b.from, PLATE.x0, b.to];
      else r = [b.from, PLATE.z0 - d, b.to, PLATE.z0];
      const [a, c] = this.toPx(r[0], r[1]);
      const [e, f] = this.toPx(r[2], r[3]);
      g.fillStyle = '#d9c6ad';
      g.fillRect(a, c, e - a, f - c);
    }
    for (const r of ALL_ROOMS) {
      const [a, c] = this.toPx(r.rect[0], r.rect[1]);
      const [e, f] = this.toPx(r.rect[2], r.rect[3]);
      g.fillStyle = r.kind === 'ev' || r.kind === 'shaft' ? '#8f949b' : FILL[r.group];
      g.fillRect(a, c, e - a, f - c);
      if (r.walls && Object.keys(r.walls).length) {
        g.strokeStyle = 'rgba(40,40,40,0.55)';
        g.lineWidth = 1;
        g.strokeRect(a + 0.5, c + 0.5, e - a - 1, f - c - 1);
      }
    }
    const [a, c] = this.toPx(PLATE.x0, PLATE.z0);
    const [e, f] = this.toPx(PLATE.x1, PLATE.z1);
    g.strokeStyle = '#333';
    g.lineWidth = 2;
    g.strokeRect(a, c, e - a, f - c);
  }

  draw(x: number, z: number, yaw: number | null, fovHalf = 0.6): void {
    const g = this.g;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    const [px, pz] = this.toPx(x, z);
    if (yaw !== null) {
      const R = 10 * this.scale;
      g.fillStyle = 'rgba(230,120,30,0.28)';
      g.beginPath();
      g.moveTo(px, pz);
      g.arc(px, pz, R, yaw - Math.PI / 2 - fovHalf, yaw - Math.PI / 2 + fovHalf);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#e8741e';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, pz, Math.max(4, 0.55 * this.scale), 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
