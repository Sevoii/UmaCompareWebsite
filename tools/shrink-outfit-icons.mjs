// Turn the PNGs gen-outfits.mjs copied into assets/uma_icons/ and assets/outfit_icons/ into small
// WebP files (at most 144px on the long side, plenty for the 96px editor portrait on a 1.5x
// screen; the aspect ratio is kept), using a headless browser's canvas so no image tooling is
// needed. Deletes each PNG after converting it.
//
//   node tools/shrink-outfit-icons.mjs "<path to msedge.exe or chrome.exe>"
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 144;
const QUALITY = 0.85;
const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const browser = process.argv[2];
if (!browser) throw new Error('usage: node tools/shrink-outfit-icons.mjs <browser executable>');
// served as "<folder>/<file>.png"
const pngs = ['uma_icons', 'outfit_icons'].flatMap((folder) =>
  readdirSync(join(assets, folder)).filter((f) => f.endsWith('.png')).map((f) => `${folder}/${f}`));
const dir = assets;
if (!pngs.length) { console.log('no PNGs to convert'); process.exit(0); }

// Serve the folder so the page can load the images same-origin (keeps the canvas readable).
const server = createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1));
  if (!pngs.includes(name)) { res.writeHead(name ? 404 : 200, { 'content-type': 'text/html' }); res.end(''); return; }
  res.writeHead(200, { 'content-type': 'image/png' });
  res.end(readFileSync(join(dir, name)));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'shrink-icons-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, `${origin}/`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 100 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); }
  catch { await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result ?? m.error); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await sleep(500);

let before = 0, after = 0;
for (const name of pngs) {
  const { result } = await send('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(`${origin}/${name}`)};
      await img.decode();
      const scale = Math.min(1, ${SIZE} / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', ${QUALITY});
    })()`,
  });
  const webp = Buffer.from(result.value.split(',')[1], 'base64');
  before += readFileSync(join(dir, name)).length;
  after += webp.length;
  writeFileSync(join(dir, name.replace(/\.png$/, '.webp')), webp);
  rmSync(join(dir, name));
}
console.log(`${pngs.length} icons: ${(before / 1024).toFixed(0)} KB PNG -> ${(after / 1024).toFixed(0)} KB WebP`);
ws.close();
proc.kill();
server.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
