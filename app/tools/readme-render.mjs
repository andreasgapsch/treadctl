// README-Bilder aus dem Demo-Modus im Browser (ohne Geraet): Apps, eigene Strecken (Import, Bibliothek), Strecke im Lauf, Pläne.
// Nutzt nur die freien Beispielstrecken. Aufruf: node readme-render.mjs <ausgabeordner>
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.join(HERE, '../assets/www'), OUT = process.argv[2];
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const FREI = ['hallwilersee-runde', 'homberg-runde', 'arosa-weisshorn'];
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  const tm = /^\/tiles\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(u);
  if (tm) { const f = path.join(HERE, '../assets/tiles', tm[1], tm[2], tm[3], tm[4] + '.jpg'); if (fs.existsSync(f)) { r.writeHead(200, { 'Content-Type': 'image/jpeg' }); r.end(fs.readFileSync(f)); } else { r.writeHead(404); r.end(); } return; }
  const sm = /^\/strecken\/([a-z0-9-]+)\.json$/.exec(u);
  if (sm && !FREI.includes(sm[1])) { r.writeHead(404); r.end(); return; }   // nur freie Strecken
  const f = path.join(WWW, u === '/' ? 'index.html' : u);
  if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${srv.address().port}/`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
p.on('pageerror', e => console.log('Fehler', e.message));
// ohne die oberste Zeile mit dem Demo-Hinweis
const CLIP = { x: 0, y: 40, width: 1280, height: 680 };
const shot = async (n, url, wait, act, clip) => {
  if (url !== null) await p.goto(B + url); if (url && url.includes('strecke')) await p.evaluate(() => window.TX && window.TX.demoReady).catch(() => {});
  await p.waitForTimeout(wait); if (act) await act();
  await p.screenshot({ path: path.join(OUT, n + '.jpg'), type: 'jpeg', quality: 85, clip }); console.log('  ' + n);
};
await shot('route-run', '?demo=1&frozen=1&szenario=strecke&strecke=homberg-runde#/strecke/homberg-runde', 4000);
await shot('route-run-trail', '?demo=1&frozen=1&szenario=strecke&strecke=arosa-weisshorn#/strecke/arosa-weisshorn', 4000);
await shot('route-planning', '?demo=1&szenario=keins#/strecke/homberg-runde', 5000, null, CLIP);
await shot('route-planning-trail', '?demo=1&szenario=keins#/strecke/arosa-weisshorn', 5000, null, CLIP);
await shot('apps', '?demo=1&szenario=keins#/apps', 2500, null, CLIP);
// eigene Strecke: Dateiliste, Pruefung, gespeicherte Strecke in der Bibliothek
await shot('route-import-list', '?demo=1&frozen=1#/strecken', 1500, async () => { await p.click('.rtop [data-v="import"]'); await p.waitForSelector('.frow'); await p.waitForTimeout(400); }, CLIP);
await shot('route-import', null, 0, async () => { await p.click('.frow'); await p.waitForSelector('.irev', { timeout: 8000 }); await p.waitForTimeout(1500); }, CLIP);
await p.fill('#iname', 'Meine Seerunde'); await p.click('[data-a="save"]'); await p.waitForTimeout(2500);
await shot('route-library', '?demo=1&frozen=1#/strecken', 2500, null, CLIP);
await shot('plans', '?demo=1&szenario=keins#/plans', 2000, null, CLIP);

await b.close(); srv.close();
