import { RenderItem, renderInfo } from './renders';

/**
 * フォトリアル（Blender Cycles）ギャラリー。
 * サムネイル一覧 → ライトボックス（題名・レンダー情報・「3Dでこの視点へ」・パノラマは「360°で見る」）。
 */
export class Gallery {
  private el: HTMLElement;
  private grid: HTMLElement;
  private view: HTMLElement;
  private img: HTMLImageElement;
  private index = -1;

  constructor(
    parent: HTMLElement,
    private items: RenderItem[],
    private hooks: { goPreset: (name: string) => void; openPano: (item: RenderItem) => void },
  ) {
    this.el = document.createElement('div');
    this.el.id = 'gallery';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'フォトリアル（Blender Cycles）');
    this.el.innerHTML = `
      <div class="gal-card">
        <header>
          <h2>フォトリアル <span>Blender Cycles</span></h2>
          <p>同じ 3D データを Blender（Cycles・パストレーシング）でレンダリングした静止画と 360° パノラマです。</p>
          <button class="close" aria-label="閉じる">×</button>
        </header>
        <div class="gal-grid"></div>
      </div>
      <div class="gal-view" hidden>
        <img alt="" />
        <button class="gal-nav gal-prev" aria-label="前へ">‹</button>
        <button class="gal-nav gal-next" aria-label="次へ">›</button>
        <div class="gal-meta">
          <h3></h3>
          <p class="gal-info"></p>
          <p class="gal-note"></p>
          <div class="gal-actions">
            <button data-act="preset">3Dでこの視点へ</button>
            <button data-act="pano">360°で見る</button>
            <button data-act="back">一覧へ</button>
          </div>
        </div>
        <button class="close" aria-label="閉じる">×</button>
      </div>`;
    parent.appendChild(this.el);
    this.grid = this.el.querySelector('.gal-grid')!;
    this.view = this.el.querySelector('.gal-view')!;
    this.img = this.view.querySelector('img')!;

    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'gal-item';
      const im = document.createElement('img');
      im.dataset.src = it.thumbUrl; // 初めて開いたときに読み込む
      im.alt = it.title;
      const t = document.createElement('b');
      t.textContent = it.title;
      const s = document.createElement('small');
      s.textContent = renderInfo(it);
      b.append(im, t, s);
      if (it.kind === 'pano') {
        const k = document.createElement('span');
        k.className = 'gal-kind';
        k.textContent = '360°';
        b.appendChild(k);
      }
      b.onclick = () => this.show(i);
      this.grid.appendChild(b);
    });

    this.el.querySelectorAll<HTMLButtonElement>('.close').forEach((b) => (b.onclick = () => this.close()));
    this.el.onclick = (e) => {
      if (e.target === this.el) this.close();
    };
    this.view.querySelector<HTMLButtonElement>('.gal-prev')!.onclick = () => this.step(-1);
    this.view.querySelector<HTMLButtonElement>('.gal-next')!.onclick = () => this.step(1);
    this.view.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = () => {
        const it = this.items[this.index];
        if (!it) return;
        if (b.dataset.act === 'back') return this.showGrid();
        this.close();
        if (b.dataset.act === 'preset' && it.preset) this.hooks.goPreset(it.preset);
        if (b.dataset.act === 'pano') this.hooks.openPano(it);
      };
    });
    window.addEventListener('keydown', (e) => {
      if (this.el.hidden) return;
      if (e.key === 'Escape') this.index >= 0 ? this.showGrid() : this.close();
      if (this.index >= 0 && e.key === 'ArrowLeft') this.step(-1);
      if (this.index >= 0 && e.key === 'ArrowRight') this.step(1);
    });
  }

  open(): void {
    this.el.hidden = false;
    this.grid.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((im) => {
      im.src = im.dataset.src!;
      im.removeAttribute('data-src');
    });
    this.showGrid();
  }

  close(): void {
    this.el.hidden = true;
    this.index = -1;
  }

  private showGrid(): void {
    this.index = -1;
    this.view.hidden = true;
    this.img.removeAttribute('src');
  }

  show(i: number): void {
    const it = this.items[i];
    if (!it) return;
    this.el.hidden = false;
    this.index = i;
    this.view.hidden = false;
    this.img.src = it.url;
    this.img.alt = it.title;
    this.view.querySelector('h3')!.textContent = it.title;
    this.view.querySelector('.gal-info')!.textContent = renderInfo(it);
    const note = this.view.querySelector<HTMLElement>('.gal-note')!;
    note.textContent = it.note ?? '';
    note.hidden = !it.note;
    this.view.querySelector<HTMLButtonElement>('[data-act="preset"]')!.hidden = !it.preset;
    this.view.querySelector<HTMLButtonElement>('[data-act="pano"]')!.hidden = it.kind !== 'pano';
    this.view.classList.toggle('is-pano', it.kind === 'pano');
  }

  private step(d: number): void {
    const n = this.items.length;
    this.show((this.index + d + n) % n);
  }
}
