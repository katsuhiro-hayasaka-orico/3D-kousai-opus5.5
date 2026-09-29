import * as THREE from 'three';
import { Rng } from './rng';

/**
 * 手続き的に生成するキャンバステクスチャ群。
 * 外部画像に依存せず単一 HTML で完結させるため、床材・画面・サインなどはすべてここで描く。
 */

export const JP_FONT =
  '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic","Meiryo","IPAGothic",sans-serif';

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

export function canvasTex(
  key: string,
  w: number,
  h: number,
  draw: Draw,
  opts: { repeat?: boolean; srgb?: boolean; aniso?: number } = {},
): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = opts.aniso ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function shade(color: number, f: number): string {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 255) * f));
  const gg = Math.min(255, Math.max(0, ((color >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (color & 255) * f));
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
}

/** タイルカーペット（500角）。テクスチャ 1 枚 = 2m × 2m（4×4 枚）。市松に目地方向を変える。 */
export function carpetTexture(key: string, base: number, fleck: number, seed = 1): THREE.CanvasTexture {
  return canvasTex(
    'carpet:' + key,
    512,
    512,
    (g, w, h) => {
      const r = new Rng(seed);
      const tile = w / 4;
      for (let ty = 0; ty < 4; ty++) {
        for (let tx = 0; tx < 4; tx++) {
          const f = 0.94 + r.next() * 0.1;
          g.fillStyle = shade(base, f);
          g.fillRect(tx * tile, ty * tile, tile, tile);
          const vertical = (tx + ty) % 2 === 0;
          // ループパイル風の筋
          g.globalAlpha = 0.18;
          for (let i = 0; i < 60; i++) {
            g.strokeStyle = r.chance(0.5) ? shade(base, 0.78) : shade(base, 1.18);
            g.lineWidth = 1;
            const p = r.next() * tile;
            g.beginPath();
            if (vertical) {
              g.moveTo(tx * tile + p, ty * tile);
              g.lineTo(tx * tile + p, ty * tile + tile);
            } else {
              g.moveTo(tx * tile, ty * tile + p);
              g.lineTo(tx * tile + tile, ty * tile + p);
            }
            g.stroke();
          }
          g.globalAlpha = 1;
          // フレック（混色糸）
          for (let i = 0; i < 260; i++) {
            g.fillStyle = r.chance(0.6) ? hex(fleck) : shade(base, 0.7);
            g.globalAlpha = 0.35 + r.next() * 0.4;
            g.fillRect(tx * tile + r.next() * tile, ty * tile + r.next() * tile, 1.5, 1.5);
          }
          g.globalAlpha = 1;
        }
      }
      // 目地
      g.strokeStyle = 'rgba(0,0,0,0.16)';
      g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo(i * tile, 0);
        g.lineTo(i * tile, h);
        g.moveTo(0, i * tile);
        g.lineTo(w, i * tile);
        g.stroke();
      }
    },
    { repeat: true },
  );
}

/** フローリング（ラウンジ）。1 枚 = 2m × 2m、幅 150mm 乱尺。 */
export function woodFloorTexture(key: string, base: number, seed = 7): THREE.CanvasTexture {
  return canvasTex(
    'wood:' + key,
    512,
    512,
    (g, w, h) => {
      const r = new Rng(seed);
      const rows = 13; // 2000 / 150 ≒ 13
      const rh = h / rows;
      for (let i = 0; i < rows; i++) {
        let x = -r.next() * 200;
        while (x < w) {
          const len = 120 + r.next() * 260;
          const f = 0.85 + r.next() * 0.25;
          g.fillStyle = shade(base, f);
          g.fillRect(x, i * rh, len, rh);
          g.globalAlpha = 0.12;
          for (let k = 0; k < 6; k++) {
            g.strokeStyle = shade(base, 0.6);
            g.beginPath();
            const yy = i * rh + r.next() * rh;
            g.moveTo(x, yy);
            g.bezierCurveTo(x + len * 0.3, yy + r.range(-3, 3), x + len * 0.6, yy + r.range(-3, 3), x + len, yy);
            g.stroke();
          }
          g.globalAlpha = 1;
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x, i * rh, 1, rh);
          x += len;
        }
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(0, i * rh, w, 1);
      }
    },
    { repeat: true },
  );
}

/** 石材調タイル（EVホール・廊下）。1 枚 = 1.2m × 1.2m（600角×4）。 */
export function stoneTexture(key: string, base: number, seed = 3): THREE.CanvasTexture {
  return canvasTex(
    'stone:' + key,
    512,
    512,
    (g, w) => {
      const r = new Rng(seed);
      const t = w / 2;
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          g.fillStyle = shade(base, 0.96 + r.next() * 0.08);
          g.fillRect(x * t, y * t, t, t);
          for (let i = 0; i < 900; i++) {
            g.fillStyle = r.chance(0.5) ? shade(base, 0.85) : shade(base, 1.08);
            g.globalAlpha = 0.25;
            g.fillRect(x * t + r.next() * t, y * t + r.next() * t, 2, 2);
          }
          g.globalAlpha = 0.12;
          g.strokeStyle = shade(base, 0.7);
          for (let v = 0; v < 3; v++) {
            g.beginPath();
            let px = x * t + r.next() * t;
            let py = y * t;
            g.moveTo(px, py);
            for (let s = 0; s < 8; s++) {
              px += r.range(-18, 18);
              py += t / 8;
              g.lineTo(px, py);
            }
            g.stroke();
          }
          g.globalAlpha = 1;
        }
      g.strokeStyle = 'rgba(0,0,0,0.2)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, t, t);
      g.strokeRect(t, 0, t, t);
      g.strokeRect(0, t, t, t);
      g.strokeRect(t, t, t, t);
    },
    { repeat: true },
  );
}

/** 小口タイル（トイレ）1 枚 = 1.2m 角、300 角。 */
export function tileTexture(key: string, base: number, grout: string): THREE.CanvasTexture {
  return canvasTex(
    'tile:' + key,
    256,
    256,
    (g, w, h) => {
      const r = new Rng(11);
      const n = 4;
      const t = w / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.fillStyle = shade(base, 0.96 + r.next() * 0.06);
          g.fillRect(x * t, y * t, t, t);
        }
      g.strokeStyle = grout;
      g.lineWidth = 2;
      for (let i = 0; i <= n; i++) {
        g.beginPath();
        g.moveTo(i * t, 0);
        g.lineTo(i * t, h);
        g.moveTo(0, i * t);
        g.lineTo(w, i * t);
        g.stroke();
      }
    },
    { repeat: true },
  );
}

/** 帯電防止ビニル床（ラボ）。 */
export function vinylTexture(key: string, base: number): THREE.CanvasTexture {
  return canvasTex(
    'vinyl:' + key,
    256,
    256,
    (g, w, h) => {
      const r = new Rng(5);
      g.fillStyle = hex(base);
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = r.chance(0.5) ? 'rgba(40,40,40,0.18)' : 'rgba(255,255,255,0.3)';
        g.fillRect(r.next() * w, r.next() * h, 1.5, 1.5);
      }
      // 導電ラインを含む 600 角
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.strokeRect(0.5, 0.5, w / 2, h / 2);
      g.strokeRect(w / 2, 0.5, w / 2 - 1, h / 2);
      g.strokeRect(0.5, h / 2, w / 2, h / 2 - 1);
      g.strokeRect(w / 2, h / 2, w / 2 - 1, h / 2 - 1);
    },
    { repeat: true },
  );
}

/** 木目（家具天板・木目調ルーバー）。 */
export function woodGrainTexture(key: string, base: number, seed = 21): THREE.CanvasTexture {
  return canvasTex(
    'grain:' + key,
    512,
    128,
    (g, w, h) => {
      const r = new Rng(seed);
      g.fillStyle = hex(base);
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = r.chance(0.5) ? shade(base, 0.8) : shade(base, 1.1);
        g.globalAlpha = 0.25;
        g.lineWidth = r.range(0.5, 2);
        g.beginPath();
        const y = r.next() * h;
        g.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * r.range(1, 4));
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    { repeat: true },
  );
}

/** 個人ロッカー前面（W900×H1800、3列×4段）。 */
export function lockerTexture(): THREE.CanvasTexture {
  return canvasTex('locker', 256, 512, (g, w, h) => {
    g.fillStyle = '#e9e7e2';
    g.fillRect(0, 0, w, h);
    const cols = 3;
    const rows = 4;
    const cw = w / cols;
    const rh = h / rows;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        g.strokeStyle = '#a9a6a0';
        g.lineWidth = 3;
        g.strokeRect(x * cw + 2, y * rh + 2, cw - 4, rh - 4);
        // 番号プレート
        g.fillStyle = '#ffffff';
        g.fillRect(x * cw + 14, y * rh + 16, cw - 28, 14);
        g.fillStyle = '#888';
        g.font = '10px sans-serif';
        g.fillText(String(100 + y * cols + x), x * cw + 18, y * rh + 27);
        // 電子錠テンキー
        g.fillStyle = '#3a3a3a';
        g.fillRect(x * cw + cw - 26, y * rh + rh / 2 - 12, 12, 24);
        g.fillStyle = '#6cf';
        g.fillRect(x * cw + cw - 23, y * rh + rh / 2 - 9, 6, 3);
      }
  });
}

/** サーバーラック前面（パンチング扉＋LED）。 */
export function rackTexture(): THREE.CanvasTexture {
  return canvasTex('rack', 128, 512, (g, w, h) => {
    g.fillStyle = '#16181b';
    g.fillRect(0, 0, w, h);
    const r = new Rng(9);
    // 機器
    let y = 20;
    while (y < h - 30) {
      const u = r.pick([1, 1, 2, 2, 4]);
      const uh = u * 10.5;
      g.fillStyle = r.pick(['#2a2e33', '#23272b', '#31363c']);
      g.fillRect(10, y, w - 20, uh - 2);
      for (let i = 0; i < u * 3; i++) {
        g.fillStyle = r.pick(['#3f3', '#3f3', '#6cf', '#fa3', '#3f3']);
        g.fillRect(16 + i * 6, y + 3, 3, 2);
      }
      y += uh;
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let yy = 0; yy < h; yy += 4) for (let xx = 0; xx < w; xx += 4) g.fillRect(xx, yy, 2, 2);
  });
}

// ---------- 画面コンテンツ ----------

function screenBase(g: CanvasRenderingContext2D, w: number, h: number, bg: string) {
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
}

/** Web 会議（ギャラリービュー）。リモート会議が活発という前提を画面で表現。 */
export function screenVideoMeeting(seed = 1): THREE.CanvasTexture {
  return canvasTex('scr:video:' + seed, 512, 320, (g, w, h) => {
    const r = new Rng(seed * 31 + 5);
    screenBase(g, w, h, '#1f1f24');
    const cols = 3;
    const rows = 3;
    const pad = 6;
    const tw = (w - pad * (cols + 1)) / cols;
    const th = (h - 40 - pad * (rows + 1)) / rows;
    const bgs = ['#5d6d7e', '#7e6f5d', '#4f6b5c', '#6b5f7a', '#80796b', '#56697a', '#8a7f72', '#5e7064', '#706a80'];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const px = pad + x * (tw + pad);
        const py = pad + y * (th + pad);
        g.fillStyle = bgs[(y * cols + x + seed) % bgs.length];
        g.fillRect(px, py, tw, th);
        // 人物シルエット
        g.fillStyle = r.pick(['#e8c4a0', '#d9ae8a', '#f1d2b4']);
        g.beginPath();
        g.arc(px + tw / 2, py + th * 0.42, th * 0.17, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = r.pick(['#2e3b55', '#44546a', '#f2f2f2', '#3a3a3a', '#6d4c41']);
        g.beginPath();
        g.ellipse(px + tw / 2, py + th, tw * 0.28, th * 0.38, 0, Math.PI, 0);
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(px + 4, py + th - 14, 46, 11);
        if (r.chance(0.25)) {
          g.strokeStyle = '#6c8cff';
          g.lineWidth = 3;
          g.strokeRect(px + 1.5, py + 1.5, tw - 3, th - 3);
        }
      }
    // ツールバー
    g.fillStyle = '#2b2b33';
    g.fillRect(0, h - 34, w, 34);
    const icons = ['#ddd', '#ddd', '#ddd', '#ddd', '#e53935'];
    icons.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(w / 2 - 80 + i * 40, h - 17, 10, 0, Math.PI * 2);
      g.fill();
    });
  });
}

/** コードエディタ（システム開発）。 */
export function screenCode(seed = 1): THREE.CanvasTexture {
  return canvasTex('scr:code:' + seed, 512, 320, (g, w, h) => {
    const r = new Rng(seed * 17 + 3);
    screenBase(g, w, h, '#1e1e1e');
    g.fillStyle = '#252526';
    g.fillRect(0, 0, 90, h);
    g.fillStyle = '#333337';
    g.fillRect(0, 0, w, 18);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = '#6b6b6b';
      g.fillRect(10, 26 + i * 14, 30 + r.next() * 40, 5);
    }
    const cols = ['#569cd6', '#4ec9b0', '#ce9178', '#dcdcaa', '#9cdcfe', '#c586c0', '#6a9955'];
    for (let i = 0; i < 20; i++) {
      let x = 104 + (r.int(0, 3) * 14);
      const y = 26 + i * 14;
      g.fillStyle = '#5a5a5a';
      g.fillRect(96, y, 4, 5);
      const n = r.int(1, 5);
      for (let k = 0; k < n; k++) {
        const len = 16 + r.next() * 70;
        g.fillStyle = r.pick(cols);
        g.fillRect(x, y, len, 6);
        x += len + 6;
      }
    }
    g.fillStyle = '#007acc';
    g.fillRect(0, h - 14, w, 14);
  });
}

/** ダッシュボード（BI・リスク指標）。 */
export function screenDashboard(seed = 1): THREE.CanvasTexture {
  return canvasTex('scr:dash:' + seed, 512, 320, (g, w, h) => {
    const r = new Rng(seed * 13 + 7);
    screenBase(g, w, h, '#f4f6f9');
    g.fillStyle = '#1b3a6b';
    g.fillRect(0, 0, w, 26);
    g.fillStyle = '#fff';
    g.fillRect(10, 9, 90, 8);
    // KPI カード
    for (let i = 0; i < 4; i++) {
      const x = 10 + i * 124;
      g.fillStyle = '#fff';
      g.fillRect(x, 36, 114, 56);
      g.fillStyle = ['#1e88e5', '#43a047', '#fb8c00', '#e53935'][i];
      g.fillRect(x, 36, 4, 56);
      g.fillStyle = '#333';
      g.fillRect(x + 12, 46, 50, 6);
      g.fillRect(x + 12, 62, 70, 16);
    }
    // 折れ線
    g.fillStyle = '#fff';
    g.fillRect(10, 102, 300, 208);
    g.strokeStyle = '#1e88e5';
    g.lineWidth = 3;
    g.beginPath();
    let y = 250;
    for (let x = 20; x < 300; x += 20) {
      y = Math.max(120, Math.min(290, y + r.range(-28, 22)));
      if (x === 20) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = '#fb8c00';
    g.beginPath();
    y = 200;
    for (let x = 20; x < 300; x += 20) {
      y = Math.max(120, Math.min(290, y + r.range(-20, 20)));
      if (x === 20) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // 棒グラフ
    g.fillStyle = '#fff';
    g.fillRect(320, 102, 182, 208);
    for (let i = 0; i < 8; i++) {
      const bh = 30 + r.next() * 150;
      g.fillStyle = i % 2 ? '#90caf9' : '#1e88e5';
      g.fillRect(332 + i * 21, 300 - bh, 14, bh);
    }
  });
}

/** 表計算（リスク管理の定型業務）。 */
export function screenSheet(seed = 1): THREE.CanvasTexture {
  return canvasTex('scr:sheet:' + seed, 512, 320, (g, w, h) => {
    const r = new Rng(seed * 7 + 1);
    screenBase(g, w, h, '#ffffff');
    g.fillStyle = '#217346';
    g.fillRect(0, 0, w, 22);
    g.fillStyle = '#f3f3f3';
    g.fillRect(0, 22, w, 20);
    g.strokeStyle = '#d4d4d4';
    g.lineWidth = 1;
    for (let y = 42; y < h; y += 14) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    for (let x = 30; x < w; x += 60) {
      g.beginPath();
      g.moveTo(x, 42);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 46; y < h - 6; y += 14)
      for (let x = 34; x < w - 40; x += 60) {
        if (r.chance(0.7)) {
          g.fillStyle = r.chance(0.08) ? '#c62828' : '#444';
          g.fillRect(x + 50 - r.range(12, 44), y + 3, r.range(12, 40), 5);
        }
      }
    g.fillStyle = 'rgba(255,235,59,0.35)';
    g.fillRect(30, 42 + 14 * r.int(2, 12), w - 30, 14);
  });
}

/** SOC 用：脅威マップ／アラート一覧。 */
export function screenSoc(seed = 1): THREE.CanvasTexture {
  return canvasTex('scr:soc:' + seed, 512, 288, (g, w, h) => {
    const r = new Rng(seed * 19 + 2);
    screenBase(g, w, h, '#0b1320');
    g.strokeStyle = 'rgba(80,160,255,0.15)';
    for (let x = 0; x < w; x += 16) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y < h; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    if (seed % 3 === 0) {
      // アラートリスト
      for (let i = 0; i < 14; i++) {
        const lv = r.pick(['#e53935', '#fb8c00', '#fdd835', '#43a047', '#43a047']);
        g.fillStyle = lv;
        g.fillRect(12, 14 + i * 19, 8, 12);
        g.fillStyle = '#9fb3c8';
        g.fillRect(28, 17 + i * 19, 80 + r.next() * 240, 6);
      }
    } else if (seed % 3 === 1) {
      // 大陸風ブロブ＋攻撃ライン
      g.fillStyle = 'rgba(70,130,200,0.35)';
      for (let i = 0; i < 9; i++) {
        g.beginPath();
        g.ellipse(r.range(40, w - 40), r.range(40, h - 40), r.range(20, 70), r.range(14, 40), r.next(), 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < 16; i++) {
        g.strokeStyle = r.pick(['rgba(255,80,80,0.8)', 'rgba(255,180,60,0.8)', 'rgba(120,220,255,0.8)']);
        g.lineWidth = 1.5;
        g.beginPath();
        const x0 = r.range(20, w - 20);
        const y0 = r.range(20, h - 20);
        const x1 = w * 0.78;
        const y1 = h * 0.42;
        g.moveTo(x0, y0);
        g.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 60, x1, y1);
        g.stroke();
      }
      g.fillStyle = '#ff5252';
      g.beginPath();
      g.arc(w * 0.78, h * 0.42, 5, 0, Math.PI * 2);
      g.fill();
    } else {
      // トラフィックグラフ
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = ['#4fc3f7', '#81c784', '#ff8a65'][k];
        g.lineWidth = 2;
        g.beginPath();
        let y = h * (0.3 + k * 0.25);
        for (let x = 0; x < w; x += 8) {
          y += r.range(-6, 6);
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    g.fillStyle = '#4fc3f7';
    g.fillRect(0, 0, w, 3);
  });
}

/** ロック画面／スリープ（空席の PC）。 */
export function screenLock(): THREE.CanvasTexture {
  return canvasTex('scr:lock', 256, 160, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#0d2b5c');
    grd.addColorStop(1, '#0a6aa8');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = 'bold 26px sans-serif';
    g.fillText('10:24', 20, 60);
  });
}

/** 大型ディスプレイのプレゼン資料。 */
export function screenSlides(seed = 1): THREE.CanvasTexture {
  return canvasTex('scr:slide:' + seed, 512, 288, (g, w, h) => {
    const r = new Rng(seed * 3 + 11);
    screenBase(g, w, h, '#ffffff');
    g.fillStyle = '#0b3a75';
    g.fillRect(0, 0, w, 44);
    g.fillStyle = '#fff';
    g.fillRect(18, 16, 180, 12);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = '#0b3a75';
      g.fillRect(30, 70 + i * 30, 6, 6);
      g.fillStyle = '#555';
      g.fillRect(44, 70 + i * 30, 120 + r.next() * 120, 7);
    }
    g.fillStyle = '#e3f2fd';
    g.fillRect(330, 70, 160, 170);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = '#1e88e5';
      const bh = 20 + r.next() * 120;
      g.fillRect(345 + i * 28, 230 - bh, 18, bh);
    }
  });
}

/** ホワイトボード（カンバン＋付箋）。 */
export function whiteboardTexture(seed = 1): THREE.CanvasTexture {
  return canvasTex('wb:' + seed, 512, 256, (g, w, h) => {
    const r = new Rng(seed * 23 + 4);
    g.fillStyle = '#fbfbf8';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#333';
    g.lineWidth = 2;
    const cols = 4;
    for (let i = 1; i < cols; i++) {
      g.beginPath();
      g.moveTo((w / cols) * i, 10);
      g.lineTo((w / cols) * i, h - 10);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(10, 36);
    g.lineTo(w - 10, 36);
    g.stroke();
    for (let c = 0; c < cols; c++) {
      g.fillStyle = '#333';
      g.fillRect(c * (w / cols) + 20, 14, 50, 8);
      const n = r.int(2, 7);
      for (let k = 0; k < n; k++) {
        g.fillStyle = r.pick(['#fff176', '#ffcc80', '#a5d6a7', '#90caf9', '#f48fb1']);
        const x = c * (w / cols) + 12 + (k % 3) * 38;
        const y = 46 + Math.floor(k / 3) * 44;
        g.fillRect(x, y, 32, 32);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + 4, y + 8, 22, 3);
        g.fillRect(x + 4, y + 15, 16, 3);
      }
    }
    g.strokeStyle = '#1565c0';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(40, h - 40);
    g.bezierCurveTo(120, h - 70, 200, h - 10, 300, h - 45);
    g.stroke();
  });
}

/** エントランスのサインウォール（ロゴは使わず文字のみ）。 */
export function signTexture(): THREE.CanvasTexture {
  return canvasTex('sign:entrance', 1024, 384, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.font = `600 64px ${JP_FONT}`;
    g.fillText('Orient Corporation', w / 2, 118);
    g.font = `500 44px ${JP_FONT}`;
    g.fillText('株式会社オリエントコーポレーション', w / 2, 190);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(w / 2 - 300, 222, 600, 2);
    g.font = `400 36px ${JP_FONT}`;
    g.fillText('IT・システムグループ ／ リスク管理グループ', w / 2, 280);
    g.font = `400 26px ${JP_FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText('麹町弘済ビルディング 2F', w / 2, 330);
  });
}

/** 室名サイン（扉脇）。 */
export function roomPlateTexture(text: string, sub = ''): THREE.CanvasTexture {
  return canvasTex('plate:' + text + sub, 256, 96, (g, w, h) => {
    g.fillStyle = '#2f3438';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = `600 30px ${JP_FONT}`;
    g.textBaseline = 'middle';
    g.fillText(text, 14, sub ? 36 : h / 2, w - 28);
    if (sub) {
      g.font = `400 20px ${JP_FONT}`;
      g.fillStyle = '#b8c4cc';
      g.fillText(sub, 14, 72, w - 28);
    }
  });
}

/** モス（苔）壁。 */
export function mossTexture(): THREE.CanvasTexture {
  return canvasTex(
    'moss',
    256,
    256,
    (g, w, h) => {
      const r = new Rng(77);
      g.fillStyle = '#3d5a2a';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = r.pick(['#4f7a33', '#5f8c3a', '#2f4a22', '#6f9a45', '#39562a']);
        g.beginPath();
        g.arc(r.next() * w, r.next() * h, r.range(2, 7), 0, Math.PI * 2);
        g.fill();
      }
    },
    { repeat: true },
  );
}

/** ロールスクリーン生地。 */
export function blindTexture(): THREE.CanvasTexture {
  return canvasTex(
    'blind',
    64,
    64,
    (g, w, h) => {
      g.fillStyle = '#e6e2d8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.05)';
      for (let y = 0; y < h; y += 2) g.fillRect(0, y, w, 1);
      for (let x = 0; x < w; x += 2) g.fillRect(x, 0, 1, h);
    },
    { repeat: true },
  );
}

/** 天井（システム天井 岩綿吸音板）。 */
export function ceilingTexture(): THREE.CanvasTexture {
  return canvasTex(
    'ceiling',
    256,
    256,
    (g, w, h) => {
      const r = new Rng(3);
      g.fillStyle = '#f2f1ee';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) {
        g.fillStyle = 'rgba(0,0,0,0.07)';
        g.fillRect(r.next() * w, r.next() * h, 1.2, 1.2);
      }
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      // 640 角（テクスチャ 1 枚 = 1.28m）
      g.beginPath();
      g.moveTo(w / 2, 0);
      g.lineTo(w / 2, h);
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      g.stroke();
      g.strokeRect(0, 0, w, h);
    },
    { repeat: true },
  );
}

/** 道路（新宿通り）アスファルト。 */
export function asphaltTexture(): THREE.CanvasTexture {
  return canvasTex(
    'asphalt',
    256,
    256,
    (g, w, h) => {
      const r = new Rng(8);
      g.fillStyle = '#4a4c4f';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = r.chance(0.5) ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
        g.fillRect(r.next() * w, r.next() * h, 1.5, 1.5);
      }
    },
    { repeat: true },
  );
}

/** 歩道インターロッキング。 */
export function pavingTexture(): THREE.CanvasTexture {
  return canvasTex(
    'paving',
    256,
    256,
    (g, w, h) => {
      const r = new Rng(12);
      const bw = 32;
      const bh = 16;
      for (let y = 0; y < h; y += bh)
        for (let x = -((y / bh) % 2) * (bw / 2); x < w; x += bw) {
          g.fillStyle = shade(0xb9b2a6, 0.9 + r.next() * 0.15);
          g.fillRect(x, y, bw - 1, bh - 1);
        }
    },
    { repeat: true },
  );
}

/**
 * 周辺街区の外装タイル：CITY_TILE.bays スパン × CITY_TILE.floors 層。1 層の下 32 % がスパンドレル帯、
 * 各スパン左 6 % がマリオン（blender/common.py の city_material と同じ比率）。点灯窓は約 55 %。
 * 基本色・自己発光・粗さの 3 枚を同じ乱数配置で描く。
 */
export const CITY_TILE = { bays: 16, floors: 8, floorH: 3.8, bayW: 1.5 };

export function cityFacadeTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const { bays, floors } = CITY_TILE;
  const bw = 32;
  const fh = 64;
  const r = new Rng(31);
  const cells: { lit: number; tone: number; blind: number }[] = [];
  for (let j = 0; j < floors; j++) {
    // 階ごとに点灯率を変える（空きフロア・会議室などのばらつき）
    const rate = 0.25 + r.next() * 0.6;
    for (let i = 0; i < bays; i++) cells.push({ lit: r.chance(rate) ? 0.65 + r.next() * 0.35 : 0, tone: r.next(), blind: r.next() * 0.45 });
  }
  const each = (g: CanvasRenderingContext2D, h: number, fn: (x: number, y: number, c: (typeof cells)[number]) => void) => {
    for (let j = 0; j < floors; j++)
      for (let i = 0; i < bays; i++) {
        // キャンバス上端が v=1。j 層目の窓は下 32 % のスパンドレルを除いた部分
        const yTop = h - (j + 1) * fh;
        fn(i * bw, yTop, cells[j * bays + i]);
      }
    g.globalAlpha = 1;
  };
  const glassH = Math.round(fh * 0.68);
  const mull = Math.max(2, Math.round(bw * 0.06));
  const map = canvasTex(
    'city.facade',
    bays * bw,
    floors * fh,
    (g, w, h) => {
      g.fillStyle = '#c4c2bc';
      g.fillRect(0, 0, w, h);
      each(g, h, (x, y, c) => {
        const k = 38 + Math.round(c.tone * 16);
        g.fillStyle = c.lit ? `rgb(${k + 70},${k + 64},${k + 52})` : `rgb(${k - 6},${k + 2},${k + 8})`;
        g.fillRect(x + mull, y, bw - mull, glassH);
        // ブラインド（上から）
        g.fillStyle = 'rgba(220,218,210,0.55)';
        g.fillRect(x + mull, y, bw - mull, Math.round(glassH * c.blind));
      });
      // スパンドレルの目地
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let j = 0; j < floors; j++) g.fillRect(0, h - j * fh - 1, w, 1);
    },
    { repeat: true },
  );
  const emissive = canvasTex(
    'city.facade.emit',
    bays * bw,
    floors * fh,
    (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      each(g, h, (x, y, c) => {
        if (!c.lit) return;
        const b = Math.round(255 * c.lit);
        g.fillStyle = `rgb(${b},${Math.round(b * 0.93)},${Math.round(b * 0.8)})`;
        g.fillRect(x + mull, y + Math.round(glassH * c.blind), bw - mull, glassH - Math.round(glassH * c.blind));
      });
    },
    { repeat: true },
  );
  const rough = canvasTex(
    'city.facade.rough',
    bays * bw,
    floors * fh,
    (g, w, h) => {
      g.fillStyle = 'rgb(170,170,170)';
      g.fillRect(0, 0, w, h);
      each(g, h, (x, y) => {
        g.fillStyle = 'rgb(28,28,28)';
        g.fillRect(x + mull, y, bw - mull, glassH);
      });
    },
    { repeat: true, srgb: false },
  );
  return { map, emissive, rough };
}
