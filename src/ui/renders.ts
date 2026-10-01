/**
 * Blender（Cycles）レンダーの一覧（src/assets/renders/renders.json と画像）。
 * 契約は docs/GRAPHICS-PIPELINE.md §5。ファイルが無ければ空配列（ギャラリーのボタンは出さない）。
 */

export interface RenderEntry {
  id: string;
  kind: 'still' | 'pano';
  title: string;
  /** src/data/presets.ts の視点名（「3Dでこの視点へ」に使う） */
  preset?: string;
  file: string;
  thumb?: string;
  w?: number;
  h?: number;
  samples?: number;
  seconds?: number;
  sunHours?: number;
  note?: string;
  /** パノラマの撮影位置（three.js 座標）と向き（北から時計回りの度） */
  pos?: [number, number, number];
  heading?: number;
}

/** 画像 URL を解決済みのエントリ */
export interface RenderItem extends RenderEntry {
  url: string;
  thumbUrl: string;
}

const manifests = import.meta.glob<RenderEntry[]>('../assets/renders/renders.json', { eager: true, import: 'default' });
const images = import.meta.glob<string>('../assets/renders/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' });

function imageUrl(file: string | undefined): string | undefined {
  if (!file) return undefined;
  for (const [path, url] of Object.entries(images)) if (path.endsWith('/' + file)) return url;
  return undefined;
}

export const RENDERS: RenderItem[] = (Object.values(manifests)[0] ?? []).flatMap((e) => {
  const url = imageUrl(e.file);
  if (!url) return [];
  return [{ ...e, url, thumbUrl: imageUrl(e.thumb) ?? url }];
});

/** 「Cycles・256 サンプル・13分32秒・日照 10:30」形式の説明 */
export function renderInfo(e: RenderEntry): string {
  const parts = ['Blender Cycles'];
  if (e.samples) parts.push(`${e.samples} サンプル`);
  if (e.seconds) {
    // 先に秒へ丸めてから分ける（59.5 秒以上を「N分60秒」にしない）
    const total = Math.round(e.seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    parts.push(m ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`);
  }
  if (e.sunHours !== undefined) {
    const tm = Math.round(e.sunHours * 60);
    const h = Math.floor(tm / 60);
    const mi = tm % 60;
    parts.push(`日照 ${h}:${String(mi).padStart(2, '0')}`);
  }
  if (e.w && e.h) parts.push(`${e.w}×${e.h}`);
  return parts.join('・');
}
