import * as THREE from 'three';
import { RenderItem, renderInfo } from './renders';

/**
 * 360° パノラマビューア（Blender Cycles の正距円筒画像）。
 *
 * 内側を向いた球に画像を貼り、既存のレンダラーでそのまま描く（表示中はメインシーンの描画・更新を止める）。
 * ドラッグで見回し、ホイール／ピンチで画角を変える。画像の中心（u=0.5）が初期の正面。
 */
export class PanoViewer {
  active = false;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  private material = new THREE.MeshBasicMaterial({ color: 0x15181c, toneMapped: false });
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private infoEl: HTMLElement;
  private msgEl: HTMLElement;
  private listEl: HTMLElement;
  private lon = 0;
  private lat = 0;
  private dir = new THREE.Vector3();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; fov: number } | null = null;
  private tex: THREE.Texture | null = null;
  private token = 0;

  constructor(
    parent: HTMLElement,
    panos: RenderItem[],
    private renderer: THREE.WebGLRenderer,
  ) {
    const geo = new THREE.SphereGeometry(50, 96, 48);
    geo.scale(-1, 1, 1); // 内側から見る（左右は反転しない）
    this.scene.add(new THREE.Mesh(geo, this.material));

    this.el = document.createElement('div');
    this.el.id = 'pano';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', '360° パノラマ');
    this.el.innerHTML = `
      <div class="pano-top">
        <div class="pano-title"><b></b><span></span></div>
        <button class="pano-close">3D に戻る</button>
      </div>
      <div class="pano-msg"></div>
      <div class="pano-bottom">
        <div class="pano-list"></div>
        <div class="pano-hint">ドラッグ：見回す　ホイール／ピンチ：ズーム　Esc：閉じる</div>
      </div>`;
    parent.appendChild(this.el);
    this.titleEl = this.el.querySelector('.pano-title b')!;
    this.infoEl = this.el.querySelector('.pano-title span')!;
    this.msgEl = this.el.querySelector('.pano-msg')!;
    this.listEl = this.el.querySelector('.pano-list')!;
    this.el.querySelector<HTMLButtonElement>('.pano-close')!.onclick = () => this.close();
    for (const p of panos) {
      const b = document.createElement('button');
      b.textContent = p.title;
      b.dataset.id = p.id;
      b.onclick = () => this.open(p);
      this.listEl.appendChild(b);
    }
    this.bindInput();
  }

  private bindInput(): void {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinch = { d: this.pinchDist(), fov: this.camera.fov };
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 1) {
        const k = this.camera.fov / Math.max(200, el.clientHeight);
        this.lon -= (e.clientX - p.x) * k;
        this.lat = THREE.MathUtils.clamp(this.lat + (e.clientY - p.y) * k, -85, 85);
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pinch && this.pointers.size === 2) this.setFov(this.pinch.fov * (this.pinch.d / Math.max(1, this.pinchDist())));
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setFov(this.camera.fov + e.deltaY * 0.05);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (this.active && e.key === 'Escape') this.close();
    });
  }

  private pinchDist(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private setFov(f: number): void {
    this.camera.fov = THREE.MathUtils.clamp(f, 30, 100);
    this.camera.updateProjectionMatrix();
  }

  async open(item: RenderItem): Promise<void> {
    this.active = true;
    this.el.hidden = false;
    document.body.classList.add('pano-open');
    this.titleEl.textContent = item.title;
    this.infoEl.textContent = renderInfo(item);
    this.listEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.id === item.id));
    this.lon = 0;
    this.lat = 0;
    this.setFov(this.el.clientWidth < this.el.clientHeight ? 90 : 75);
    this.msgEl.textContent = '読み込み中…';
    this.msgEl.hidden = false;
    this.showTexture(null);
    const token = ++this.token;
    try {
      const tex = await new THREE.TextureLoader().loadAsync(item.url);
      if (token !== this.token || !this.active) {
        tex.dispose();
        return;
      }
      this.fitTexture(tex);
      this.showTexture(tex);
      this.msgEl.hidden = true;
    } catch (e) {
      console.warn('パノラマの読み込みに失敗', e);
      if (token === this.token) this.msgEl.textContent = '画像を読み込めませんでした';
    }
  }

  /** 表示する画像を差し替え（null = 読み込み中の暗い球）。前の画像は解放する */
  private showTexture(tex: THREE.Texture | null): void {
    if (this.tex !== tex) this.tex?.dispose();
    this.tex = tex;
    this.material.map = tex;
    this.material.color.set(tex ? 0xffffff : 0x15181c);
    this.material.needsUpdate = true;
  }

  /** 端末の最大テクスチャサイズを超える場合は縮小してから使う */
  private fitTexture(tex: THREE.Texture): void {
    const img = tex.image as HTMLImageElement;
    const max = this.renderer.capabilities.maxTextureSize;
    if (img.width > max) {
      const c = document.createElement('canvas');
      c.width = max;
      c.height = Math.round((img.height * max) / img.width);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      tex.image = c;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.token++;
    this.el.hidden = true;
    document.body.classList.remove('pano-open');
    this.showTexture(null);
    this.pointers.clear();
    this.pinch = null;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** 画像中心（u=0.5）を lon=0 とし、lon が増えると右へ向く */
  render(): void {
    const th = THREE.MathUtils.degToRad(this.lon);
    const ph = THREE.MathUtils.degToRad(this.lat);
    this.dir.set(-Math.cos(th) * Math.cos(ph), Math.sin(ph), -Math.sin(th) * Math.cos(ph));
    this.camera.lookAt(this.dir);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
