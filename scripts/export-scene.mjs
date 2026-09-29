// Blender 連携：アプリをヘッドレスで開き、scene.glb と meta.json を blender/cache/ に書き出す。
//   npm run dev（別ターミナル）→ node scripts/export-scene.mjs [url] [出力先]
// Chromium は CHROME_PATH、未指定なら Playwright 同梱パス。出力先を変えたときは BLENDER_CACHE で Blender 側に渡す。
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = path.resolve(process.argv[3] ?? 'blender/cache');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('done'), null, { timeout: 300000 });
const files = [];
page.on('download', async (d) => {
  const p = path.join(out, d.suggestedFilename());
  await d.saveAs(p);
  files.push(p);
});
const t0 = Date.now();
const bytes = await page.evaluate(() => window.__app.exportScene());
const deadline = Date.now() + 120000;
while (files.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
const info = await page.evaluate(() => window.__app.lightmapInfo());
console.log(`exported ${(bytes / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('files:', files.join(', '));
console.log('lightmap:', JSON.stringify(info));
await browser.close();
