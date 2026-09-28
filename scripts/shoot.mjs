// ヘッドレス撮影ハーネス（見た目の回帰確認用）
//   node scripts/shoot.mjs <url> <outdir> '[{"eval":"__app.goPreset(\"SOC\")","wait":800,"shot":"soc"}]'
// Chromium は CHROME_PATH、未指定なら Playwright 同梱パスを使用。
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const steps = JSON.parse(process.argv[4] ?? '[]');
const W = +(process.env.W ?? 1600);
const Hh = +(process.env.H ?? 1000);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: Hh }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('done') || /エラー/.test(document.querySelector('#loadmsg')?.textContent ?? ''), null, { timeout: 240000 });
console.log('loaded in', (Date.now() - t0) / 1000, 's');
await page.waitForTimeout(1500);
for (const s of steps) {
  if (s.eval) await page.evaluate(s.eval);
  if (s.click) await page.mouse.click(s.click[0], s.click[1]);
  if (s.key) {
    await page.keyboard.down(s.key);
    await page.waitForTimeout(s.hold ?? 500);
    await page.keyboard.up(s.key);
  }
  if (s.text) console.log('TEXT', s.text, JSON.stringify(await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? null, s.text)));
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) {
    const jpg = s.shot.endsWith('.jpg');
    await page.screenshot({ path: `${out}/${jpg ? s.shot : s.shot + '.png'}`, ...(jpg ? { type: 'jpeg', quality: 82 } : {}) });
    console.log('shot', s.shot);
  }
}
if (steps.length === 0) await page.screenshot({ path: `${out}/default.png` });
const info = await page.evaluate(() => {
  const a = window.__app;
  if (!a) return null;
  const i = a.info();
  return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, stats: a.stats() };
});
console.log(JSON.stringify(info, null, 1).slice(0, 3000));
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
