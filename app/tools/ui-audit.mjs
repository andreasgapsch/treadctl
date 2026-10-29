#!/usr/bin/env node
// Prueft die Oberflaeche in assets/www im Demo-Modus mit headless Chrome:
// Bildschirmfotos aller Ansichten (Faktor 1.5) samt Vergleich mit den Mockups, JS-Fehler,
// Touch-Ziele, Textkontrast (gemessen an Pixeln), axe-core, Lighthouse Accessibility,
// Sicherheitsablaeufe (kein Start ohne START), Groesse, Zeichen- und Chrome-83-Regeln.
// Aufruf: node ui-audit.mjs [--nolh] [--only=name,name]   Ausgabe: Punkteliste, Bilder in tools/out/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pruefeCss, pruefePille } from './gestaltung-regeln.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.resolve(HERE, '../assets/www');
const MOCK = path.resolve(HERE, '../../design/v3/out');
const OUT = path.resolve(HERE, 'out');
const CHROME = '/usr/bin/google-chrome';
const args = process.argv.slice(2);
const NOLH = args.includes('--nolh');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
// --flows=Text: nur Ablaeufe, deren Name den Text enthaelt (ohne Bilder), z. B. --flows=Strecke
const FLOWF = (args.find(a => a.startsWith('--flows=')) || '').slice(8);
fs.mkdirSync(OUT, { recursive: true });

/* ---------- statischer Server ----------
   Spielt fuer den Streckenmodus den Dienst nach: /tiles/<quelle>/<z>/<x>/<y> liefert Kacheln aus dem Offline-Paket
   (app/assets/tiles) oder einem lokalen Zwischenspeicher (tools/.tiles, einmal vom Prüfrechner geholt), sonst wie der Dienst eine leere
   dunkle Kachel. Der Browser selbst fragt nie einen anderen Host an. Fehlen die Beispielstrecken, dient die Fixture. */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const TILE_DIR = path.join(HERE, '.tiles');
// nur Luftbild der Schweiz (swisstopo SWISSIMAGE)
const TILE_UP = { luft: (z, x, y) => `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg` };
// leere Kachel 0x1B1E25 wie der Dienst (1 x 1 PNG, Leaflet skaliert)
const EMPTY_TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQllMFAAC2AF/aqp7zAAAAAElFTkSuQmCC', 'base64');
let tilesOn = !args.includes('--keine-kacheln'), tileReq = 0;
const FIXTURE = path.join(HERE, 'fixtures/strecke-test.json');
async function tile(res, src, z, x, y) {
  tileReq++;
  const f = path.join(TILE_DIR, src, String(z), String(x), y + '.jpg');
  const send = (b, t) => { res.writeHead(200, { 'Content-Type': t, 'Cache-Control': 'no-store' }); res.end(b); };
  // wie der Dienst: zuerst das Offline-Paket der Beispielstrecken (app/assets/tiles), dann der Zwischenspeicher
  const pack = path.join(HERE, '../assets/tiles', src, String(z), String(x), y + '.jpg');
  if (tilesOn && fs.existsSync(pack)) return send(fs.readFileSync(pack), 'image/jpeg');
  if (tilesOn && fs.existsSync(f)) return send(fs.readFileSync(f), 'image/jpeg');
  if (tilesOn && TILE_UP[src] && z >= 12 && z <= 16) {
    try {
      const r = await fetch(TILE_UP[src](z, x, y), { headers: { 'User-Agent': 'TreadCtl-Audit/1 (Laufband privat)' }, signal: AbortSignal.timeout(6000) });
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); return send(b, 'image/jpeg'); }
    } catch (e) { /* offline: leere Kachel */ }
  }
  send(EMPTY_TILE, 'image/png');
}
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // ohne eigenes Mock eines Ablaufs: Befehle nimmt der Prueferver an (z. B. das Profil beim Laden), sonst 404
  if (u === '/api/media') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"active":false,"pkg":"","app":"","playing":false,"title":"","artist":"","album":"","dur":0,"pos":0,"art":0,"canNext":false,"canPrev":false}'); return; }
  if (u === '/api/hr' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"state":"aus","name":"","address":"","hr":0,"scanning":false,"bt":true,"found":[]}'); return; }
  if (u === '/api/summary') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
  if (u === '/api/ftms') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"on":false,"ctl":false,"name":"Tread Control","maxS":14,"maxI":10,"state":"aus","clients":[]}'); return; }   // wie der Dienst ohne FTMS
  if (u === '/api/bt/audio') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"audio":[]}'); return; }
  if (u === '/api/fan' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"state":"kein Ventilator","name":"","address":"","auto":false,"level":0,"target":0,"manual":false,"connected":false,"awake":false}'); return; }
  if (u === '/api/media/cmd' && req.method === 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"keine Wiedergabe"}'); return; }
  if (u === '/api/cmd' && req.method === 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
  if (u.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
  const tm = /^\/tiles\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(u);
  if (tm) { tile(res, tm[1], +tm[2], +tm[3], +tm[4]); return; }
  if (u === '/strecken/homberg-runde.json' && !fs.existsSync(path.join(WWW, u))) {
    const o = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')); o.id = 'homberg-runde'; o.name = 'Teststrecke (Fixture)';
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); return;
  }
  let f = path.join(WWW, u === '/' ? 'index.html' : u);
  if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nicht gefunden'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const res = [];   // [ok, punkt, detail]
const add = (ok, p, d = '') => res.push([!!ok, p, d]);
// Parallel ausfuehren: Ansichten und Ablaeufe warten meist auf Zeitgeber (Countdown, Einlaufen, Banner), nicht auf die CPU
const PAR = Math.max(1, +((args.find(x => x.startsWith('--par=')) || '--par=8').slice(6)) || 8);
async function pool(jobs, n = PAR) {
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (k < jobs.length) await jobs[k++](); }));
}

/* ---------- Ansichten ---------- */
const VIEWS = [
  { n: 'home', h: '#/', mock: 'home' },
  { n: 'run-ready', h: '#/run', mock: 'run-ready' },
  { n: 'run', h: '#/run', q: 'szenario=lauf', mock: 'run' },
  { n: 'run-pause', h: '#/run', q: 'szenario=pause', mock: 'run-pause' },
  { n: 'run-fehler', h: '#/run', q: 'szenario=fehler' },
  // Schluessel waehrend des Laufs gezogen: Pause mit Gehtempo 3.0 als Ziel
  { n: 'run-nachfehler', h: '#/run', q: 'szenario=nachfehler' },
  { n: 'run-nachfehler-countdown', h: '#/run', q: 'szenario=nachfehler', act: async p => { await p.click('.pmodal [data-x="resume"]'); await p.waitForTimeout(150); } },
  { n: 'interval-ready', h: '#/interval/p-schwelle' },
  // Dienst meldet nach dem Lauf noch Altwerte: BEREIT muss trotzdem Nullen zeigen
  { n: 'interval-ready-alt', h: '#/interval/p-schwelle', q: 'szenario=plan-bereit',
    act: async p => { await p.evaluate(() => { const s = window.TX.sim.s; s.elapsed = 50; s.dist = 0.03; s.kcal = 2; s.elev = 4; }); await p.waitForTimeout(700); } },
  // Beenden ueber die Pille mit kurzem Lauf: Nachfrage mit Vorgabe Verwerfen
  { n: 'run-kurz', h: '#/', act: async p => { await p.evaluate(() => { window.TX.sim.lastSum = { ts: Date.now(), type: 'free', name: 'Freies Laufen', elapsed: 84, dist: 0.18, kcal: 9, elev: 0, avgHr: 118, maxHr: 124, hist: [] }; location.hash = '#/summary/last'; }); await p.waitForTimeout(700); } },
  { n: 'run-countdown', h: '#/run', q: 'szenario=pause', act: async p => { await p.click('[data-x="resume"]'); await p.waitForTimeout(150); } },
  // START in BEREIT: derselbe Vollbild-Countdown wie WEITER (arm, nach 3 s start)
  { n: 'run-start-countdown', h: '#/run', act: async p => { await p.click('.bigbtn'); await p.waitForTimeout(150); } },
  { n: 'zones-start-countdown', h: '#/zones', q: 'puls=0', act: async p => { await p.click('[data-z="2"]'); await p.waitForTimeout(1000); await p.click('.bigbtn'); await p.waitForTimeout(150); } },
  { n: 'interval', h: '#/interval/p-schwelle', q: 'szenario=intervall', mock: 'interval' },
  { n: 'interval-wechsel', h: '#/interval/p-schwelle', q: 'szenario=wechsel', mock: 'interval-wechsel' },
  { n: 'zones-setup', h: '#/zones' },
  { n: 'zones-setup-nohr', h: '#/zones', q: 'puls=0' },
  { n: 'zones-ready', h: '#/zones', act: async p => { await p.click('[data-z="2"]'); await p.waitForTimeout(900); } },
  { n: 'zones-ready-nohr', h: '#/zones', q: 'puls=0', act: async p => { await p.click('[data-z="2"]'); await p.waitForTimeout(900); } },
  { n: 'run-nohr', h: '#/run', q: 'szenario=lauf&puls=0' },
  { n: 'interval-nohr', h: '#/interval/p-schwelle', q: 'szenario=intervall&puls=0' },
  { n: 'zones', h: '#/zones', q: 'szenario=zonen', mock: 'zones' },
  { n: 'plans', h: '#/plans', mock: 'plans' },
  { n: 'plans-edit', h: '#/plans/edit/p-schwelle' },
  { n: 'plans-edit-zones', h: '#/plans/edit/p-grundlage' },
  { n: 'apps', h: '#/apps', mock: 'apps' },
  { n: 'apps-lauf', h: '#/apps', q: 'szenario=lauf' },
  // hideBar aus: Statuszeile leer, dort liegt die Herstellerleiste
  { n: 'apps-leiste-aus', h: '#/apps', act: async p => { await p.click('[data-p="hideBar"]'); await p.waitForTimeout(200); } },
  { n: 'summary', h: '#/summary', mock: 'summary' },
  { n: 'history', h: '#/history' },
  // ohne Läufe: Wochenraster mit Hinweis statt leerer Fläche; Startseite mit Schnellstart statt Wiederholen
  { n: 'history-leer', h: '#/history', q: 'leer=1' },
  { n: 'home-leer', h: '#/', q: 'leer=1' },
  // echte App-Symbole von TreadNative.icon (Prüfbilder je Paket)
  { n: 'home-symbole', h: '#/', init: 'icons' },
  { n: 'apps-symbole', h: '#/apps', init: 'icons' },
  { n: 'saver', h: '#/', q: 'saver=1', wait: 2600 },
  { n: 'profile', h: '#/', act: async p => { await p.click('.avatar'); await p.waitForTimeout(300); } },
  { n: 'home-nogap', h: '#/', q: 'nogap=1', cmp: 'home' },
  { n: 'run-nogap', h: '#/run', q: 'szenario=lauf&nogap=1', cmp: 'run' },
  { n: 'interval-nogap', h: '#/interval/p-schwelle', q: 'szenario=intervall&nogap=1', cmp: 'interval' },
  { n: 'plans-nogap', h: '#/plans', q: 'nogap=1', cmp: 'plans' },
  { n: 'zones-nogap', h: '#/zones', q: 'szenario=zonen&nogap=1', cmp: 'zones' },
  { n: 'run-pause-nogap', h: '#/run', q: 'szenario=pause&nogap=1', cmp: 'run-pause' },
  // Streckenmodus (Beispielstrecke Homberg-Runde, sonst Fixture)
  { n: 'home-strecken', h: '#/' },
  { n: 'strecken-liste', h: '#/strecken', wait: 2200 },
  { n: 'strecke-detail', h: '#/strecke/homberg-runde', wait: 3800 },
  { n: 'strecke-detail-trail', h: '#/strecke/arosa-weisshorn', wait: 3800 },
  { n: 'strecke-import', h: '#/strecken', wait: 1800, swiss: true, act: async p => { await p.click('.rtop [data-v="import"]'); await p.waitForSelector('.frow'); await p.click('.frow'); await p.waitForSelector('.irev', { timeout: 8000 }); await p.waitForTimeout(300); } },
  { n: 'strecke-import-liste', h: '#/strecken', wait: 1800, act: async p => { await p.click('.rtop [data-v="import"]'); await p.waitForSelector('.frow'); await p.waitForTimeout(200); } },
  { n: 'strecke-lauf', h: '#/strecke/homberg-runde', q: 'szenario=strecke', ready: true, wait: 3800 },
  { n: 'strecke-versatz', h: '#/strecke/homberg-runde', q: 'szenario=strecke-versatz', ready: true, wait: 3800 },
  { n: 'strecke-ziel', h: '#/strecke/homberg-runde', q: 'szenario=strecke-ziel', ready: true, wait: 3800 },
  { n: 'strecke-unterbrechung', h: '#/strecke/homberg-runde', q: 'szenario=strecke-unterbrechung', ready: true, wait: 3800 },
  { n: 'strecke-start-pruefen', h: '#/strecke/homberg-runde', wait: 1000, act: async p => {
    await p.evaluate(() => { localStorage.setItem('tx.routeprefs.v1', JSON.stringify({ 'homberg-runde': { target: 3700, mode: 'terrain', scale: 1 } })); });
    await p.reload(); await p.waitForTimeout(3500); await p.click('.bigbtn'); await p.waitForTimeout(300); } },
  // nach dem Ziel: Band hat nach 10 s angehalten, Pausen-Dialog «Ziel erreicht», dann BEENDEN wie von Hand
  { n: 'strecke-ziel-pause', h: '#/strecke/homberg-runde', q: 'szenario=strecke-ende', ready: true, wait: 2600 },
  { n: 'strecke-zusammenfassung', h: '#/strecke/homberg-runde', q: 'szenario=strecke-ende', ready: true, wait: 2600, act: async p => { await p.click('.pmodal [data-x="end"]'); await p.waitForTimeout(1500); } },
  // Ventilator: Automatik im Lauf, Handwahl 75, kein Ventilator gekoppelt
  { n: 'geraete-ventilator-lauf', h: '#/geraete', q: 'szenario=lauf' },
  { n: 'geraete-ventilator-hand', h: '#/geraete', q: 'luefter=hand' },
  { n: 'geraete-ventilator-keiner', h: '#/geraete', q: 'luefter=keiner' },
  { n: 'geraete', h: '#/geraete', wait: 900, act: async p => { await p.click('[data-v="scan"]'); await p.waitForTimeout(3500); await p.click('.frow2 [data-con]'); await p.waitForTimeout(2500); } },
  { n: 'hrmenu', h: '#/', act: async p => { await p.click('[data-g="hrmenu"]'); await p.waitForTimeout(400); await p.click('.hrmenu [data-hm="scan"]'); await p.waitForTimeout(3300); } },
  { n: 'kopf-player', h: '#/plans' },
  { n: 'kopf-player-hoerbuch', h: '#/history', q: 'musik=hoerbuch' },
  { n: 'kopf-musik-menue', h: '#/plans', q: 'musik=aus', act: async p => { await p.click('[data-mp="panel"]'); await p.waitForTimeout(300); } },
  { n: 'kopf-player-fenster', h: '#/plans', act: async p => { await p.click('.head .mp .mpo'); await p.waitForTimeout(400); } },
  { n: 'interval-player', h: '#/interval/p-schwelle', q: 'szenario=intervall' },
  // Stufentest HFmax: Vorlage, Lauf mit Max-Puls, Pause, Auswertung mit Uebernahme, ohne Puls, Rueckfrage bei 142 bpm
  { n: 'plaene-stufentest', h: '#/plans?f=test' },
  { n: 'stufentest-bereit', h: '#/interval/p-hfmax' },
  { n: 'stufentest-lauf', h: '#/interval/p-hfmax', q: 'szenario=stufentest' },
  { n: 'stufentest-pause', h: '#/interval/p-hfmax', q: 'szenario=stufentest-pause' },
  { n: 'stufentest-auswertung', h: '#/', act: async p => { await p.evaluate(() => { window.__hfRun(186); }); await p.waitForTimeout(900); } },
  { n: 'stufentest-ohne-puls', h: '#/', act: async p => { await p.evaluate(() => { window.__hfRun(0); }); await p.waitForTimeout(900); } },
  { n: 'stufentest-rueckfrage', h: '#/', act: async p => { await p.evaluate(() => { window.__hfRun(142); }); await p.waitForTimeout(900); await p.click('[data-v="hfset"]'); await p.waitForTimeout(300); } },
  { n: 'strecke-detail-player', h: '#/strecke/homberg-runde', wait: 3000 },
  { n: 'profile-gewicht', h: '#/', act: async p => { await p.click('.avatar'); await p.waitForTimeout(300); } },
  { n: 'interval-einlaufen', h: '#/interval/p-schwelle', q: 'szenario=intervall-start', wait: 1600 },
  { n: 'interval-einlaufen-bald', h: '#/interval/p-schwelle', q: 'szenario=intervall-start', wait: 800, act: async p => { await p.evaluate(() => { window.TX.sim.hold = 6.4; }); await p.waitForTimeout(800); } },
  { n: 'run-taste-countdown', h: '#/run', act: async p => { await p.evaluate(() => { window.TX.sim.s.tSpeed = 10; window.TX.sim.hwKey('go'); }); await p.waitForTimeout(500); } },
  { n: 'strecke-lauf-nogap', h: '#/strecke/homberg-runde', q: 'szenario=strecke&nogap=1', ready: true, wait: 3800, cmp: 'strecke-lauf' }
].filter(v => !FLOWF && (!ONLY.length || ONLY.includes(v.n)));

/* ---------- Netzwaechter: jede Anfrage an einen anderen Host als 127.0.0.1 ist ein Fehler ----------
   Ausnahme nur der gemockte swisstopo-Hoehendienst im Importtest (wird hier beantwortet, nie ins Netz). */
const extReq = [];
const SAMPLE = id => JSON.parse(fs.readFileSync(fs.existsSync(path.join(WWW, 'strecken', id + '.json')) ? path.join(WWW, 'strecken', id + '.json') : FIXTURE, 'utf8'));
function lv95(lat, lon) {
  const p = (lat * 3600 - 169028.66) / 10000, l = (lon * 3600 - 26782.5) / 10000;
  return [2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3, 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3];
}
// Antwort wie profile.json: Hoehe vom naechsten Punkt der Beispielstrecke (LV95), dazu ein Zusatzpunkt (wie die echte Antwort)
function swissAnswer(body, ref) {
  const f = new URLSearchParams(body), co = JSON.parse(f.get('geom')).coordinates;
  const rp = ref.pts.map(p => [...lv95(p[0], p[1]), p[2]]);
  const out = []; let d = 0;
  co.forEach((c, i) => {
    if (i) d += Math.hypot(c[0] - co[i - 1][0], c[1] - co[i - 1][1]);
    let best = 0, bd = 1e18; for (let k = 0; k < rp.length; k++) { const q = (rp[k][0] - c[0]) ** 2 + (rp[k][1] - c[1]) ** 2; if (q < bd) { bd = q; best = k; } }
    out.push({ alts: { COMB: Math.round(rp[best][2] * 10) / 10, DTM2: rp[best][2] }, dist: Math.round(d * 10) / 10, easting: c[0], northing: c[1] });
    if (i === 0 && co.length > 1) { const h = Math.hypot(co[1][0] - c[0], co[1][1] - c[1]) / 2; out.push({ alts: { COMB: Math.round(rp[best][2] * 10) / 10 }, dist: Math.round(h * 10) / 10, easting: c[0], northing: c[1] }); }
  });
  return { out, form: { sr: f.get('sr'), nb: +f.get('nb_points'), distinct: f.get('distinct_points'), n: co.length, first: co[0] } };
}
const swissLog = [];
// Hoehenmodell fuer den Mock: Punkte aller Beispielstrecken (naechster Punkt liefert die Hoehe)
let swissRef = null;
const SWISS_REF = () => {
  if (swissRef) return swissRef;
  const ids = ['homberg-runde', 'hallwilersee-runde', 'arosa-weisshorn'].filter(id => fs.existsSync(path.join(WWW, 'strecken', id + '.json')));
  return (swissRef = { pts: [].concat(...(ids.length ? ids : ['homberg-runde']).map(id => SAMPLE(id).pts)) });
};
async function guard(ctx, name, swiss) {
  await ctx.route(u => !/^http:\/\/127\.0\.0\.1[:/]/.test(u.href) && !/^(data|blob):/.test(u.href), async r => {
    const url = r.request().url();
    if (swiss && /^https:\/\/api3\.geo\.admin\.ch\/rest\/services\/profile\.json/.test(url)) {
      if (swiss === 'offline') return r.abort('internetdisconnected');
      const a = swissAnswer(r.request().postData() || '', SWISS_REF());
      swissLog.push(a.form);
      return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(a.out) });
    }
    extReq.push(name + ': ' + url.slice(0, 90)); return r.abort('blockedbyclient');
  });
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--hide-scrollbars', '--font-render-hinting=none'] });
const ctxOpts = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, hasTouch: true };
const helper = await (await browser.newContext()).newPage();
const axeSrc = fs.readFileSync(path.join(HERE, 'node_modules/axe-core/axe.min.js'), 'utf8');

// Bildvergleich und Pixelkontrast in einer Hilfsseite (Canvas)
async function imgStats(fn, a, b, extra) {
  const toUrl = buf => 'data:image/png;base64,' + buf.toString('base64');
  return helper.evaluate(fn, { a: a && toUrl(a), b: b && toUrl(b), extra });
}
async function similarity(a, b) {
  return imgStats(async ({ a, b }) => {
    const load = src => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; });
    const [A, B] = await Promise.all([load(a), load(b)]);
    const W = 192, H = 108, get = img => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
    const da = get(A), db = get(B); let s = 0, n = 0;
    for (let y = 7; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 4; s += (Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2])) / 3; n++; }
    return 100 - s / n / 255 * 100;
  }, a, b);
}
async function pixelContrast(bgPng, items) {
  return imgStats(async ({ a, extra }) => {
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = a; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const D = x.getImageData(0, 0, c.width, c.height).data, S = c.width / 1280;
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return extra.map(it => {
      const cs = [];
      for (const r of it.rects) {
        const x0 = Math.max(0, Math.floor(r.x * S)), y0 = Math.max(0, Math.floor(r.y * S)), x1 = Math.min(c.width, Math.ceil((r.x + r.w) * S)), y1 = Math.min(c.height, Math.ceil((r.y + r.h) * S));
        for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) {
          const k = (yy * c.width + xx) * 4, br = D[k], bg = D[k + 1], bb = D[k + 2], al = it.c[3];
          const tr = it.c[0] * al + br * (1 - al), tg = it.c[1] * al + bg * (1 - al), tb = it.c[2] * al + bb * (1 - al);
          const l1 = L(tr, tg, tb), l2 = L(br, bg, bb);
          cs.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
        }
      }
      if (!cs.length) return { t: it.t, cr: 99 };
      cs.sort((p, q) => p - q);
      return { t: it.t, cr: cs[Math.floor(cs.length * 0.05)], fs: it.fs, fw: it.fw };
    });
  }, bgPng, null, items);
}

// Prüfbilder für TreadNative.icon: 144 px PNG je Paket (farbige Fläche mit weissem Kreis), wie die Brücke sie liefert
const ICON_PKGS = { 'org.smarttube.stable': '#e62117', 'app.revanced.android.apps.youtube.music': '#ff0033', 'org.jellyfin.mobile': '#00a4dc', 'com.kinomap.training': '#f26722', 'com.zwift.zwiftgame': '#fc6719', 'com.audiobookshelf.app': '#264d4b' };
const ICONS = await helper.evaluate(pk => {
  const o = {};
  for (const [k, c] of Object.entries(pk)) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 144; const x = cv.getContext('2d');
    x.fillStyle = c; x.fillRect(0, 0, 144, 144); x.fillStyle = '#fff'; x.beginPath(); x.arc(72, 72, 34, 0, 7); x.fill();
    o[k] = cv.toDataURL('image/png');
  }
  return o;
}, ICON_PKGS);
// Brücke mit icon(), installed(), launch(), setPref(); Demo bleibt über ?demo=1 aktiv
function iconBridge(ic) {
  window.__calls = [];
  window.TreadNative = { token: () => 't', installed: () => JSON.stringify(Object.keys(ic)), launch: () => true, setPref: (k, v) => { window.__calls.push(k + '=' + v); },
    icon: pkg => { window.__calls.push('icon:' + pkg); return ic[pkg] || ''; } };
}
// Stufentest-Lauf im Verlauf ablegen (Abbruch in Stufe 14 bei 15.5 km/h) und dessen Zusammenfassung oeffnen; mh = hoechster Puls, 0 = ohne Pulssignal
function hfRunHelper() {
  window.__hfRun = mh => {
    const h = [];
    for (let t = 0; t <= 1410; t += 10) {
      const v = t < 600 ? 8 : Math.min(15.5, 9 + Math.floor((t - 600) / 60) * 0.5);
      h.push([t, v, 1, mh ? Math.round(Math.min(mh, 118 + v * 4 + (t > 600 ? (t - 600) / 22 : 0))) : 0]);
    }
    if (mh) h[h.length - 1][3] = mh;
    const id = 'hf' + mh;
    window.TX.saveRun({ id, ts: Date.now(), name: 'Stufentest HFmax', type: 'interval', planId: 'p-hfmax', elapsed: 1410, dist: 3.62, kcal: 310, elev: 36, avgHr: mh ? 158 : 0, maxHr: mh, hist: h });
    location.hash = '#/summary/' + id;
  };
}
const consoleErr = [], dashBad = [], spillBad = [];
let touchBad = [], touchN = 0, contrastBad = [], contrastN = 0, contrastMin = 99, axeBad = [];
const shots = {};

async function openView(v, ctx) {
  await guard(ctx, v.n, v.swiss);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErr.push(`${v.n}: ${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => consoleErr.push(`${v.n}: pageerror: ${e.message}`));
  if (v.init === 'icons') await page.addInitScript(iconBridge, ICONS);
  await page.addInitScript(hfRunHelper);
  await page.goto(BASE + '?demo=1&frozen=1' + (v.q ? '&' + v.q : '') + v.h);
  if (v.ready) await page.evaluate(() => window.TX.demoReady);
  await page.waitForTimeout(v.wait || 1400);
  if (v.act) await v.act(page);
  return page;
}

/* Jede Ansicht in eigenem Kontext; mehrere parallel (--par=N, Standard 8). Ansichten mit Vergleichsbild (cmp)
   laufen danach, weil sie das Bild der Bezugsansicht brauchen. Ergebnisse in der Reihenfolge von VIEWS. */
async function runView(v, add) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await openView(v, ctx);
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  await page.waitForTimeout(100);
  const shot = await page.screenshot();
  fs.writeFileSync(path.join(OUT, v.n + '.png'), shot);
  shots[v.n] = shot;

  if (v.cmp && shots[v.cmp]) {
    const s = await similarity(shot, shots[v.cmp]);
    add(s > 99, `Flex-gap-Ersatz (Chrome 83) ${v.cmp}: gleiches Bild`, s.toFixed(2) + ' %');
  }
  if (v.n.endsWith('-nogap')) { await ctx.close(); return; }

  // Platzhalter: nirgends ein einzelnes «-» als Wert (einheitlich «--»)
  const dash = await page.evaluate(() => {
    const out = [], tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) { const t = n.nodeValue.trim(); if (/^[-\u2212]$/.test(t) && n.parentElement && n.parentElement.getClientRects().length) out.push(n.parentElement.className || n.parentElement.tagName); }
    document.querySelectorAll('svg text').forEach(e => { if (/^[-\u2212]$/.test(e.textContent.trim())) out.push('svg'); });
    return out;
  });
  dash.forEach(x => dashBad.push(`${v.n}: ${x}`));
  // Regelwerk: kein Inhalt ragt unten oder rechts aus seiner Karte (scrollbare Listen und Kartenkacheln ausgenommen)
  const spill = await page.evaluate(() => {
    const out = [], vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'; };
    for (const c of document.querySelectorAll('.card')) {
      if (!vis(c) || c.closest('.blur')) continue; const cr = c.getBoundingClientRect();
      for (const e of c.querySelectorAll('*')) {
        if (!vis(e) || e.matches('.ph,.shade') || e.closest('.leaflet-container,svg')) continue;
        let sc = false; for (let a = e.parentElement; a && a !== c; a = a.parentElement) { const ov = getComputedStyle(a).overflowY; if (ov === 'auto' || ov === 'scroll') { sc = true; break; } }
        if (sc) continue;
        const r = e.getBoundingClientRect();
        if (r.bottom > cr.bottom + 1 || r.right > cr.right + 1) { out.push((c.className.split(' ')[1] || 'card') + ' > ' + (e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName.toLowerCase()) + ' ' + Math.round(Math.max(r.bottom - cr.bottom, r.right - cr.right)) + ' px'); break; }
      }
    }
    return out;
  });
  spill.forEach(x => spillBad.push(`${v.n}: ${x}`));

  // Touch-Ziele
  const tt = await page.evaluate(() => {
    const sel = 'a[href],button,[role=button],[role=switch],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const out = [];
    document.querySelectorAll(sel).forEach(e => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (!r.width || !r.height || cs.visibility === 'hidden' || e.closest('[hidden]') || e.closest('#saver:not(.on)')) return;
      let p = e; while (p) { if (getComputedStyle(p).display === 'none') return; p = p.parentElement; }
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
      // Statuszeile ist genau 40 px hoch: dort 40 px Hoehe, dafuer mindestens 48 px breit
      const min = e.closest('.ctl') ? 60 : 48, minH = e.closest('#topfree') ? 40 : min;
      out.push({ t: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, min, minH });
    });
    return out;
  });
  touchN += tt.length;
  tt.filter(x => x.w < x.min - 0.01 || x.h < x.minH - 0.01).forEach(x => touchBad.push(`${v.n}: «${x.t}» ${x.w}x${x.h} (min ${x.min}x${x.minH})`));

  // Textkontrast: Text sammeln, dann Text unsichtbar machen und Hintergrund aus Pixeln lesen
  const items = await page.evaluate(() => {
    const out = [], tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 1]; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    let n;
    while ((n = tw.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement; if (!el || el.closest('svg') || el.closest('#saver:not(.on)')) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
      let op = 1, p = el, hid = false;
      while (p) { const c2 = getComputedStyle(p); if (c2.display === 'none') hid = true; op *= +c2.opacity; p = p.parentElement; }
      if (hid || op < 0.05) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rects = Array.from(rg.getClientRects()).filter(r => r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)
        .map(r => ({ x: r.x + 1, y: r.y + r.height * 0.15, w: Math.max(1, r.width - 2), h: r.height * 0.7 }));
      // nur sichtbaren Teil in Scrollbereichen
      // nur fuer Bildschirmleser (1 x 1 px) zaehlt nicht
      const eb = el.getBoundingClientRect(); if (eb.width <= 1 || eb.height <= 1) continue;
      let sc = el, vis = rects;
      while (sc) { const c3 = getComputedStyle(sc); if (/(auto|scroll|hidden)/.test(c3.overflowY)) { const b = sc.getBoundingClientRect(); vis = vis.filter(r => r.y >= b.top - 1 && r.y + r.h <= b.bottom + 1); }
        // waagrecht abgeschnittener Text (Auslassungspunkte): nur den sichtbaren Teil messen
        if (/(hidden|clip)/.test(c3.overflowX)) { const b = sc.getBoundingClientRect(); vis = vis.map(r => { const x0 = Math.max(r.x, b.left), x1 = Math.min(r.x + r.w, b.right); return Object.assign({}, r, { x: x0, w: x1 - x0 }); }).filter(r => r.w > 2); }
        sc = sc.parentElement; }
      // verdeckter Text (unter Dialog oder Banner) zaehlt nicht
      vis = vis.filter(r => { const t = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2); return t && (t === el || el.contains(t) || t.contains(el)); });
      if (!vis.length) continue;
      const c = parse(cs.color); c[3] *= op;
      out.push({ t: n.nodeValue.trim().slice(0, 40), rects: vis, c, fs: parseFloat(cs.fontSize), fw: cs.fontWeight });
    }
    return out;
  });
  await page.addStyleTag({ content: '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}' });
  await page.waitForTimeout(80);
  const bg = await page.screenshot();
  const cr = await pixelContrast(bg, items);
  contrastN += cr.length;
  cr.forEach(x => { contrastMin = Math.min(contrastMin, x.cr); if (x.cr < 4.5) contrastBad.push(`${v.n}: «${x.t}» ${x.cr.toFixed(2)}:1`); });

  // axe-core (WCAG 2 A/AA), Kontrast misst das eigene Verfahren oben
  await page.reload(); if (v.ready) await page.evaluate(() => window.TX.demoReady); await page.waitForTimeout(v.wait || 1400); if (v.act) await v.act(page);
  await page.addScriptTag({ content: axeSrc });
  const ax = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, rules: { 'color-contrast': { enabled: false } } });
    return r.violations.map(x => `${x.id} (${x.nodes.length}): ${x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`);
  });
  ax.forEach(x => axeBad.push(`${v.n}: ${x}`));

  if (v.mock) {
    const mp = path.join(MOCK, v.mock + '.png');
    if (fs.existsSync(mp)) { const s = await similarity(shot, fs.readFileSync(mp)); add(s >= 85, `Mockup-Nähe ${v.n} (Rasterbild 192x108)`, s.toFixed(1) + ' %'); }
  }
  await ctx.close();
}
const vRes = VIEWS.map(() => []);
await pool(VIEWS.map((v, i) => () => runView(v, (ok, p, d = '') => vRes[i].push([!!ok, p, d]))).filter((f, i) => !VIEWS[i].cmp));
for (let i = 0; i < VIEWS.length; i++) if (VIEWS[i].cmp) await runView(VIEWS[i], (ok, p, d = '') => vRes[i].push([!!ok, p, d]));
vRes.forEach(a => res.push(...a));

add(!consoleErr.length, 'Keine JS-Fehler oder Warnungen in der Konsole', consoleErr.length ? consoleErr.slice(0, 8).join('\n      ') : `${VIEWS.length} Ansichten`);
add(!touchBad.length, 'Touch-Ziele >= 48 CSS-px, Steuerleiste >= 60, Statuszeile 40 hoch und >= 48 breit', touchBad.length ? touchBad.slice(0, 12).join('\n      ') : `${touchN} Ziele geprüft`);
add(!contrastBad.length, 'Textkontrast >= 4.5:1 (Pixelmessung, 5-%-Quantil)', contrastBad.length ? contrastBad.slice(0, 14).join('\n      ') : `${contrastN} Textstellen, Minimum ${contrastMin.toFixed(2)}:1`);
add(!axeBad.length, 'axe-core WCAG 2.1 A/AA + Best Practice ohne Verstoss', axeBad.length ? axeBad.slice(0, 10).join('\n      ') : 'keine Verstösse');
add(!spillBad.length, 'Nichts ragt aus seiner Karte (alle Ansichten; scrollbare Listen ausgenommen)', spillBad.length ? spillBad.slice(0, 10).join(', ') : 'alle Ansichten geprüft');
add(!dashBad.length, 'Einheitlicher Platzhalter «--» (kein einzelnes «-» als Wert)', dashBad.length ? dashBad.slice(0, 8).join(', ') : 'alle Ansichten geprüft');

/* ---------- Ablaeufe ---------- */
/* Ablaeufe laufen parallel (je eigener Kontext); flow() reserviert den Platz im Ergebnis und kehrt sofort zurueck.
   Ablaeufe, die gemeinsamen Zustand des Pruefservers aendern oder lesen (Kacheln aus, swisstopo-Protokoll),
   laufen am Schluss einzeln (SOLO). flowsDone() wartet auf alle. */
const FQ = [], FSOLO = [], FRUN = [];
let fActive = 0;
const SOLO = /gesperrtem Netz|Import-Parser GPX und TCX/;
function flowPump() {
  while (fActive < PAR && FQ.length) { const j = FQ.shift(); fActive++; FRUN.push(j().finally(() => { fActive--; flowPump(); })); }
}
async function flowsDone() {
  while (FQ.length || fActive) await Promise.all(FRUN.slice());
  for (const j of FSOLO) await j();
}
async function flow(name, fn, netOk, swiss) {
  if (FLOWF && name.indexOf(FLOWF) < 0) return;
  const slot = res.length; res.push([false, name, 'nicht gelaufen']);
  const job = async () => {
    const ctx = await browser.newContext(ctxOpts); await guard(ctx, 'Ablauf «' + name.slice(0, 30) + '»', swiss);
    const page = await ctx.newPage(), errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !(netOk && /Failed to load resource/.test(m.text()))) errs.push(m.text()); });
    try { const r = await fn(page); res[slot] = [!!(r.ok && !errs.length), name, (r.d || '') + (errs.length ? ' Fehler: ' + errs.join('; ') : '')]; }
    catch (e) { res[slot] = [false, name, 'Ausnahme: ' + e.message]; }
    await ctx.close();
  };
  if (SOLO.test(name)) FSOLO.push(job); else { FQ.push(job); flowPump(); }
}
const st = p => p.evaluate(() => window.TX.api.state);
// Befehle der Oberflaeche ohne das einmalige Profil beim Laden (Gewicht, HFmax)
const log = p => p.evaluate(() => window.__txCmdLog.map(x => x.c).filter(c => c !== 'profile'));
const go = async (p, h) => { await p.evaluate(h2 => { location.hash = h2; }, h); await p.waitForTimeout(500); };

if (!ONLY.length) {
  await flow('Keine Navigation startet das Band (alle Seiten, Pläne, Zonen, Wiederholen)', async p => {
    await p.goto(BASE + '?demo=1#/'); await p.waitForTimeout(800);
    for (const h of ['#/run', '#/training', '#/interval/p-schwelle', '#/zones', '#/plans', '#/plans/edit/p-rigi', '#/apps', '#/history', '#/summary', '#/', '#/interval/p-pyramide', '#/run', '#/zones', '#/strecken', '#/strecke/homberg-runde', '#/training', '#/strecken']) await go(p, h);
    await go(p, '#/'); await p.click('[data-v="plan"]'); await p.waitForTimeout(600);
    await go(p, '#/'); await p.click('[data-v="repeat"]'); await p.waitForTimeout(600);
    await go(p, '#/zones'); await p.click('[data-z="3"]'); await p.waitForTimeout(600);
    await go(p, '#/plans'); await p.click('[data-v="start"]'); await p.waitForTimeout(600);
    const l = await log(p), s = await st(p);
    return { ok: !l.includes('start') && !l.includes('arm') && s.st === 'BEREIT' && s.elapsed === 0, d: `Befehle: ${[...new Set(l)].join(', ')} · Zustand ${s.st}` };
  });
  await flow('START-Knopf: Vollbild-Countdown wie WEITER, sendet sofort arm, start erst nach ≥ 2.5 s; Ziel Start-Tempo/Steigung; rotes ABBRECHEN an der STOP-Stelle', async p => {
    await p.goto(BASE + '?demo=1#/run'); await p.waitForTimeout(1000);
    await p.click('.side.l [data-v="3"]'); await p.waitForTimeout(300);
    const big = await p.$eval('.bigbtn', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.evaluate(() => { window.__txCmdLog.length = 0; });
    await p.click('.bigbtn'); await p.waitForTimeout(400);
    const c = await p.evaluate(() => {
      const d = document.querySelector('.cdown'), bs = Array.from(d.querySelectorAll('button')), b = bs[0], r = b.getBoundingClientRect(), n = d.querySelector('.cdt .num');
      return { full: d.getBoundingClientRect().width === innerWidth && d.getBoundingClientRect().height === innerHeight, kids: Array.from(d.children).map(e => e.className.split(' ')[0]).join(' '),
        cn: d.querySelector('[data-k="cn"]').textContent, lab: d.querySelector('.cdt .lab').textContent, tgt: n.textContent.replace(/\s+/g, ' ').trim(), n: bs.length, red: b.classList.contains('red'),
        r1: b.querySelector('.r1').textContent, sm: b.querySelector('small').textContent, x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height, above: n.getBoundingClientRect().bottom <= r.top };
    });
    const l1 = await log(p), s1 = await st(p);
    await p.waitForTimeout(3000);
    const L = await p.evaluate(() => window.__txCmdLog.map(x => ({ c: x.c, t: x.t }))), s2 = await st(p), gone = !(await p.isVisible('.cdown'));
    const arm = L.find(x => x.c === 'arm'), start = L.find(x => x.c === 'start'), dt = arm && start ? start.t - arm.t : -1;
    const ok = c.full && c.kids === 'lab cn seq cdt btn' && c.cn === '3' && c.lab === 'Ziel · Start-Tempo und Steigung' && c.tgt === '1.0 km/h · 3.0 %' && c.n === 1 && c.red && c.r1 === 'ABBRECHEN' && c.sm === 'Band bleibt stehen' &&
      Math.abs(c.x - big.x) < 2 && Math.abs(c.y - big.y) < 2 && c.h >= 60 && c.above && l1.join() === 'arm' && s1.st === 'BEREIT' && L.map(x => x.c).join() === 'arm,start' && dt >= 2500 && dt < 4000 && s2.st === 'LAEUFT' && gone;
    return { ok, d: `nach 0.4 s: [${l1}] ${s1.st}, «${c.cn}» «${c.lab}» «${c.tgt}», Knopf «${c.r1} / ${c.sm}» Mitte ${Math.round(c.x)}/${Math.round(c.y)} (START ${Math.round(big.x)}/${Math.round(big.y)}); danach [${L.map(x => x.c)}] start ${dt} ms nach arm, ${s2.st}` };
  });
  await flow('START-Countdown: ABBRECHEN und Zurücktaste senden stop statt start (löscht arm), abgewiesenes arm beendet den Countdown; start ohne arm meldet «Countdown fehlt»', async p => {
    await p.goto(BASE + '?demo=1#/run'); await p.waitForTimeout(1000);
    await p.click('.bigbtn'); await p.waitForTimeout(600); await p.click('.cdown [data-c="cancel"]'); await p.waitForTimeout(200);
    const a = !(await p.isVisible('.cdown'));
    await p.waitForTimeout(1000); await p.click('.bigbtn'); await p.waitForTimeout(500); await p.evaluate(() => window.onNativeBack());
    const b = !(await p.isVisible('.cdown'));
    // Dienst weist arm ab (z. B. Token falsch): Countdown endet sofort
    await p.evaluate(() => { const S = window.TX.sim, o = S.cmd; S.cmd = function (x) { return x && x.c === 'arm' ? { ok: false, error: 'Kein Zugriff: Token ungültig' } : o.call(S, x); }; });
    await p.waitForTimeout(1000); await p.click('.bigbtn'); await p.waitForTimeout(400);
    const c = !(await p.isVisible('.cdown')), t1 = await p.textContent('#toast');
    await p.waitForTimeout(3200);
    const l = await log(p), s = await st(p);
    await p.evaluate(() => { const S = window.TX.sim; delete S.cmd; window.TX.cmd('start'); }); await p.waitForTimeout(300);
    const t2 = await p.textContent('#toast'), s2 = await st(p);
    // Abbruch durch die Person sendet wie die Pille ein stop hinterher (löscht arm), ein abgewiesenes arm nicht
    const ok = a && b && c && /Token/.test(t1) && !l.includes('start') && l.join() === 'arm,stop,arm,stop,arm' && s.st === 'BEREIT' && t2 === 'Nicht ausgeführt: Countdown fehlt' && s2.st === 'BEREIT';
    return { ok, d: `Abbrechen ${a}, Zurücktaste ${b}, arm abgewiesen ${c} «${t1}»; Befehle [${l}] ${s.st}; start ohne arm «${t2}» ${s2.st}` };
  });
  await flow('Dienstregel arm (Simulator wie Dienst): start/resume ohne arm abgewiesen, zu früh (< 2.5 s) und verfallen (> 15 s) abgewiesen, stop löscht arm, arm gilt einmal', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/plans'); await p.waitForTimeout(800);
    const r = await p.evaluate(async () => {
      const S = window.TX.sim, c = x => { const o = S.cmd({ c: x }); return o.ok ? 'ok' : o.error; }, wait = ms => new Promise(f => setTimeout(f, ms)), o = {};
      o.noArm = c('start');
      c('arm'); o.early = c('start');
      c('arm'); S.armAt = Date.now() - 16000; o.late = c('start');
      c('arm'); await wait(2600); o.ok = c('start'); o.st1 = S.s.st;
      c('stop'); c('arm'); c('stop'); S.armAt = S.armAt ? S.armAt - 3000 : 0; o.stopClears = c('resume');
      c('arm'); await wait(2600); o.res = c('resume'); o.st2 = S.s.st;
      // arm gilt fuer genau eine Pruefung: abgewiesenes start (Schluessel) verbraucht es
      c('stop'); c('end'); S.s.pulled = 1; c('arm'); await wait(2600); o.used1 = c('start'); S.s.pulled = 0; o.used2 = c('start');
      return o;
    });
    const F = 'Countdown fehlt';
    const ok = r.noArm === F && r.early === F && r.late === F && r.ok === 'ok' && r.st1 === 'LAEUFT' && r.stopClears === F && r.res === 'ok' && r.st2 === 'LAEUFT' && r.used1 === 'Sicherheitsschlüssel fehlt' && r.used2 === F;
    return { ok, d: `ohne arm «${r.noArm}», zu früh «${r.early}», verfallen «${r.late}», nach 2.6 s ${r.ok} ${r.st1}; stop löscht «${r.stopClears}»; resume ${r.res}; verbraucht «${r.used2}»` };
  });
  await flow('Geisterklick direkt nach Seitenwechsel löst START nicht aus', async p => {
    await p.goto(BASE + '?demo=1#/'); await p.waitForTimeout(800);
    await p.evaluate(() => { location.hash = '#/run'; });
    await p.waitForTimeout(60);
    await p.evaluate(() => { const b = document.querySelector('.bigbtn'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); });
    await p.waitForTimeout(500);
    const l = await log(p);
    return { ok: !l.includes('start') && !l.includes('arm'), d: l.includes('start') ? 'gestartet!' : l.includes('arm') ? 'Countdown geöffnet!' : 'nicht gestartet, kein Countdown' };
  });
  await flow('STOP wird unter dem Finger zu START (Ende von aussen): 800 ms gesperrt', async p => {
    await p.goto(BASE + '?demo=1&szenario=lauf#/run'); await p.waitForTimeout(1000);
    await p.evaluate(() => { window.TX.sim.cmd({ c: 'end' }); });
    await p.waitForTimeout(450);
    const h = await p.evaluate(() => location.hash);
    if (h !== '#/run') await p.evaluate(() => { location.hash = '#/run'; });
    await p.waitForTimeout(700);
    await p.evaluate(() => { window.TX.sim.direct('start'); window.__txCmdLog.length = 0; });
    await p.waitForTimeout(500);
    await p.evaluate(() => { window.TX.sim.s.st = 'BEREIT'; window.TX.sim.s.speed = 0; });   // Band steht (START bei auslaufendem Band ist gesperrt, eigener Fall)
    await p.waitForTimeout(450);
    await p.click('.bigbtn');
    await p.waitForTimeout(400);
    const l1 = await log(p);
    await p.waitForTimeout(600); await p.click('.bigbtn'); await p.waitForTimeout(400);
    const l2 = await log(p);
    return { ok: !l1.includes('arm') && !l1.includes('start') && l2.includes('arm'), d: `sofort: [${l1}] nach 1 s: [${l2}] (Countdown)` };
  });
  await flow('Zurücktaste der Konsole (onNativeBack): Dialog zu, sonst eine Ebene hoch', async p => {
    await p.goto(BASE + '?demo=1#/plans/edit/p-rigi'); await p.waitForTimeout(800);
    await p.click('.avatar'); await p.waitForTimeout(200);
    await p.evaluate(() => window.onNativeBack()); await p.waitForTimeout(200);
    const dlg = await p.$$eval('body > .modal', e => e.length), h1 = await p.evaluate(() => location.hash);
    await p.evaluate(() => window.onNativeBack()); await p.waitForTimeout(400);
    const h2 = await p.evaluate(() => location.hash);
    await p.evaluate(() => window.onNativeBack()); await p.waitForTimeout(400);
    const h3 = await p.evaluate(() => location.hash);
    return { ok: dlg === 0 && h1 === '#/plans/edit/p-rigi' && h2 === '#/plans' && h3 === '#/', d: `Dialog ${dlg}, ${h1} > ${h2} > ${h3}` };
  });
  await flow('Plan starten lädt nur (BEREIT) und wechselt zur Ausführung', async p => {
    await p.goto(BASE + '?demo=1#/plans'); await p.waitForTimeout(800);
    await p.click('.tpl[data-id="p-pyramide"]'); await p.click('[data-v="start"]'); await p.waitForTimeout(900);
    const s = await st(p), h = await p.evaluate(() => location.hash), l = await log(p);
    const big = await p.textContent('.bigbtn');
    return { ok: s.st === 'BEREIT' && s.prog && s.prog.name.startsWith('Pyramide') && h === '#/interval/p-pyramide' && !l.includes('start') && /START/.test(big), d: `${h}, ${s.st}, Knopf «${big.trim()}»` };
  });
  await flow('Langes Drücken auf + wiederholt (500 ms, dann alle 250 ms), Sollwert sofort', async p => {
    await p.goto(BASE + '?demo=1#/run'); await p.waitForTimeout(1000);
    const b = await p.$('.adj.spd [data-d="0.5"]'), bb = await b.boundingBox();
    await p.mouse.move(bb.x + 20, bb.y + 20); await p.mouse.down();
    await p.waitForTimeout(80);
    const imm = await p.textContent('[data-k="sv"]');
    await p.waitForTimeout(1470); await p.mouse.up(); await p.waitForTimeout(500);
    const l = (await log(p)).filter(x => x === 'step').length, s = await st(p);
    return { ok: l >= 5 && l <= 7 && imm === '1.5' && Math.abs(s.tSpeed - (1 + 0.5 * l)) < 0.01, d: `${l} Schritte, sofort ${imm}, Soll ${s.tSpeed}` };
  });
  await flow('Schnellwahl setzt absolut, .on nur bei exaktem Wert', async p => {
    await p.goto(BASE + '?demo=1#/run'); await p.waitForTimeout(1000);
    await p.click('.side.r [data-v="10"]'); await p.waitForTimeout(500);
    const on1 = await p.$$eval('.side.r .qs .on', e => e.map(x => x.textContent));
    await p.click('.adj.spd [data-d="0.5"]'); await p.waitForTimeout(500);
    const on2 = await p.$$eval('.side.r .qs .on', e => e.map(x => x.textContent));
    const all = await p.$$eval('.qs button', e => e.map(x => x.textContent));
    return { ok: on1.join() === '10.0' && on2.length === 0 && all.every(t => /^\d+\.\d$/.test(t)), d: `nach 10: [${on1}] nach +0.5: [${on2}], Schnellwahl [${all}]` };
  });
  await flow('STOP, Pausen-Dialog, Beenden: Abschluss und Verlauf gespeichert', async p => {
    await p.goto(BASE + '?demo=1&szenario=lauf#/run'); await p.waitForTimeout(1000);
    await p.click('.bigbtn'); await p.waitForTimeout(1300);
    const dlg = await p.isVisible('.modal .dlg');
    await p.click('[data-x="end"]'); await p.waitForTimeout(1000);
    const h = await p.evaluate(() => location.hash), n = await p.evaluate(() => window.TX.runs().length);
    const s = await st(p);
    return { ok: dlg && h.startsWith('#/summary/') && n >= 1 && s.st === 'BEREIT', d: `Dialog ${dlg}, ${h.slice(0, 14)}…, ${n} Läufe, ${s.st}` };
  });
  await flow('BEREIT zeigt Nullen: Beenden, Altwerte im Dienst, Programm laden', async p => {
    await p.goto(BASE + '?demo=1&szenario=lauf#/run'); await p.waitForTimeout(1000);
    await p.click('.bigbtn'); await p.waitForTimeout(1300); await p.click('[data-x="end"]'); await p.waitForTimeout(1000);
    // Dienst setzt die Zaehler (noch) nicht zurueck
    await p.evaluate(() => { const s = window.TX.sim.s; s.elapsed = 1455; s.dist = 3.52; s.kcal = 251; s.elev = 41; });
    await go(p, '#/plans'); await p.click('.tpl[data-id="p-pyramide"]'); await p.click('[data-v="start"]'); await p.waitForTimeout(900);
    const m = await p.evaluate(() => ['t', 'd', 'k', 'p', 'x'].map(k => document.querySelector('[data-k="m' + k + '"]').textContent));
    const pt = await p.textContent('[data-k="pt"]'), cd = await p.textContent('[data-k="cd"]');
    await go(p, '#/run'); await p.waitForTimeout(400);
    const r = await p.evaluate(() => ['t', 'd', 'k', 'x'].map(k => document.querySelector('[data-k="m' + k + '"]').textContent));
    const s = await st(p);
    return { ok: s.st === 'BEREIT' && s.elapsed > 0 && m.slice(0, 3).join() === '0:00,0.00,0' && m[3] === '--:--' && /^0:00 von/.test(pt) && cd === '8:00' && r.join() === '0:00,0.00,0,0',
      d: `Intervall [${m.join(' | ')}], ${pt}, Countdown ${cd}; Schnellstart [${r.join(' | ')}]; Dienst elapsed ${s.elapsed}` };
  });
  await flow('Pause: Weiter zählt 3 · 2 · 1 mit Ton, resume erst danach', async p => {
    await p.goto(BASE + '?demo=1&szenario=pause#/run'); await p.waitForTimeout(1000);
    await p.evaluate(() => { window.__beeps = 0; const o = window.TX.beep; window.TX.beep = function (hz) { window.__beeps++; return o(hz); }; });
    const z = await p.$eval('[data-x="inclZero"]', e => ({ v: e.offsetParent !== null, d: e.disabled, t: e.querySelector('.r1').textContent.trim() }));
    await p.click('[data-x="resume"]'); await p.waitForTimeout(400);
    const ov = await p.isVisible('.cdown'), n1 = await p.textContent('.cdown [data-k="cn"]'), l1 = await log(p), s1 = await st(p);
    await p.waitForTimeout(1000); const n2 = await p.textContent('.cdown [data-k="cn"]');
    await p.waitForTimeout(2300);
    const l2 = await log(p), s2 = await st(p), ov2 = await p.isVisible('.cdown'), b = await p.evaluate(() => window.__beeps);
    return { ok: z.v && !z.d && z.t === 'STEIGUNG AUF 0' && ov && n1 === '3' && n2 === '2' && l1.join() === 'arm' && s1.st === 'PAUSE' && l2.join() === 'arm,resume' && s2.st === 'LAEUFT' && !ov2 && b === 3,
      d: `«${z.t}» aktiv ${!z.d}; Anzeige ${n1}, ${n2}; vorher [${l1}] ${s1.st}; danach [${l2}] ${s2.st}, Töne ${b}` };
  });
  await flow('WEITER-Countdown: ein roter Knopf «ABBRECHEN · Band bleibt stehen» an der STOP-Stelle, Ziel gross darüber', async p => {
    await p.goto(BASE + '?demo=1&szenario=pause#/run'); await p.waitForTimeout(1000);
    const big = await p.$eval('.pmodal .pz-m', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.click('[data-x="resume"]'); await p.waitForTimeout(400);
    const c = await p.evaluate(() => {
      const bs = Array.from(document.querySelectorAll('.cdown button')), b = bs[0], r = b.getBoundingClientRect(), t = document.querySelector('.cdown .cdt .num').getBoundingClientRect();
      return { n: bs.length, txt: b.querySelector('.r1').textContent + ' · ' + b.querySelector('small').textContent, red: b.classList.contains('red'), x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height, tgt: document.querySelector('.cdown .cdt .num').textContent.replace(/\s+/g, ' ').trim(), above: t.bottom <= r.top, tfs: parseFloat(getComputedStyle(document.querySelector('.cdown .cdt .num')).fontSize) };
    });
    await p.click('.cdown [data-c="cancel"]'); await p.waitForTimeout(3200);
    const l = await log(p), s = await st(p), gone = !(await p.isVisible('.cdown'));
    const ok = c.n === 1 && c.txt === 'ABBRECHEN · Band bleibt stehen' && c.red && Math.abs(c.x - big.x) < 2 && Math.abs(c.y - big.y) < 2 && c.h >= 60 && c.tgt === '12.5 km/h · 4.0 %' && c.above && c.tfs >= 48 && gone && !l.includes('resume') && s.st === 'PAUSE';
    return { ok, d: `${c.n} Knopf «${c.txt}», Mitte ${Math.round(c.x)}/${Math.round(c.y)} (STOP ${Math.round(big.x)}/${Math.round(big.y)}), Ziel «${c.tgt}» ${c.tfs} px darüber ${c.above}; danach ${s.st}, Befehle [${l}]` };
  });
  await flow('Pause: «STEIGUNG AUF 0» mit Zeile «Steigung bleibt 4.0 %» im Knopf, danach kurz «4.0 → 0.0», dann gesperrt (Dialog und Leiste gleich)', async p => {
    await p.goto(BASE + '?demo=1&szenario=pause#/run'); await p.waitForTimeout(1000);
    const a = await p.evaluate(() => { const b = document.querySelector('.pmodal [data-x="inclZero"]'), c = b.querySelector('[data-k="izc"]'); return { t: b.querySelector('.r1').textContent.trim(), svg: !!b.querySelector('svg'), c: c.textContent, inside: b.contains(c) }; });
    await p.click('.pmodal [data-x="inclZero"]'); await p.waitForTimeout(500);
    const fx = await p.textContent('.pmodal [data-k="izc"]'), fxBar = await p.textContent('.ctl [data-k="izc"]');
    await p.waitForTimeout(2600);
    const z = await p.evaluate(() => { const b = document.querySelector('.pmodal [data-x="inclZero"]'); return { v: b.offsetParent !== null, d: b.disabled, c: b.querySelector('[data-k="izc"]').textContent }; });
    return { ok: a.t === 'STEIGUNG AUF 0' && a.svg && a.c === 'Steigung bleibt 4.0 %' && a.inside && fx === '4.0 → 0.0' && fxBar === fx && z.v && z.d && z.c === 'Steigung ist 0.0 %',
      d: `«${a.t}» Symbol ${a.svg}, Zeile «${a.c}» im Knopf ${a.inside}; nach Druck «${fx}» (Leiste «${fxBar}»), danach «${z.c}», gesperrt ${z.d}` };
  });
  await flow('Wechseltext TX.changeText: Richtung mit Pfeil, Farbe nach Richtung, ohne Lautsprecher und «Ton bei 3, 2, 1»', async p => {
    await p.goto(BASE + '?demo=1&szenario=wechsel#/interval/p-schwelle'); await p.waitForTimeout(1200);
    const r = await p.evaluate(() => {
      const T = window.TX, b = document.querySelector('[data-k="ban"]');
      return { dn: T.changeText({ s: 13, i: 2 }, { s: 8, i: 1, k: 'r' }), up: T.changeText({ s: 8, i: 1 }, { s: 13, i: 2, k: 'h' }), eq: T.changeText({ s: 8, i: 1 }, { s: 8, i: 0, k: 'w' }),
        cls: b.className, bg: getComputedStyle(b).backgroundColor, t: b.querySelector('.hd').textContent + ' · ' + b.querySelector('.l2').textContent, svg: b.querySelectorAll('svg').length, txt: b.textContent };
    });
    const ok = r.dn === 'Gleich Erholung · Tempo sinkt ↓ auf 8.0 km/h · Steigung 1.0 %' && r.up === 'Gleich Belastung · Tempo steigt ↑ auf 13.0 km/h · Steigung 2.0 %' && /bleibt bei 8\.0 km\/h · Steigung 0\.0 %$/.test(r.eq) &&
      r.t === r.dn && /d-down/.test(r.cls) && r.bg === 'rgb(44, 105, 207)' && r.svg === 0 && !/Ton bei/.test(r.txt);
    return { ok, d: `«${r.t}» ${r.cls} ${r.bg}; steigt «${r.up.slice(17)}»; ohne Lautsprecher und ohne «Ton bei» ${r.svg === 0}` };
  });
  await flow('Namen: «×» statt « x », Zonen einheitlich «Grundlage Zone 2»', async p => {
    await p.addInitScript(() => {
      if (sessionStorage.getItem('nm')) return; sessionStorage.setItem('nm', '1');
      localStorage.setItem('tx.history.v1', JSON.stringify({ v: 1, runs: [{ id: 'n1', ts: Date.now() - 3600e3, name: 'Zone 2 · Grundlage', type: 'zones', elapsed: 1800, dist: 4.2, kcal: 300, elev: 0, avgHr: 135, maxHr: 140, hist: [] },
        { id: 'n2', ts: Date.now() - 7200e3, name: 'Hügel 6 x 2 min', type: 'interval', elapsed: 1800, dist: 4.2, kcal: 300, elev: 0, avgHr: 135, maxHr: 140, hist: [] }] }));
    });
    await p.goto(BASE + '?demo=1#/history'); await p.waitForTimeout(900);
    const h = await p.$$eval('.hrun h2', e => e.map(x => x.textContent));
    await go(p, '#/plans?f=zones'); await p.waitForTimeout(300);
    const zr = await p.$eval('.det .sg > b', e => e.textContent);
    const f = await p.evaluate(() => [window.TX.nm('Schwelle 5x4 min'), window.TX.nm('Tempo 6 x 3 min'), window.TX.nm('3 x'), window.TX.zoneName(4)]);
    await go(p, '#/zones'); await p.click('[data-z="3"]'); await p.waitForTimeout(900);
    const zp = (await st(p)).prog.name;
    const ok = h.includes('Grundlage Zone 2') && h.includes('Hügel 6 × 2 min') && zr === 'Grundlage Zone 2' && f.join('|') === 'Schwelle 5 × 4 min|Tempo 6 × 3 min|3 ×|Schwelle Zone 4' && zp === 'Tempo Zone 3' && !h.some(x => / x /.test(x));
    return { ok, d: `Verlauf [${h.join(', ')}], Vorlage «${zr}», geladen «${zp}», ${f.join(' | ')}` };
  });
  await flow('Zonentacho: Grenzen zweizeilig, Abstand zwischen den Spalten', async p => {
    await p.goto(BASE + '?demo=1&szenario=zonen#/zones'); await p.waitForTimeout(1200);
    const r = await p.evaluate(() => {
      const cols = Array.from(document.querySelectorAll('[data-k="zl"] > div'));
      const lines = cols.map(c => Array.from(c.querySelectorAll('span')).map(s => s.textContent));
      let minGap = 99;
      for (let row = 0; row < 2; row++) for (let i = 1; i < cols.length; i++) {
        const a = cols[i - 1].querySelectorAll('span')[row].getBoundingClientRect(), b = cols[i].querySelectorAll('span')[row];
        const rb = document.createRange(); rb.selectNodeContents(b); const bb = rb.getBoundingClientRect();
        const ra = document.createRange(); ra.selectNodeContents(cols[i - 1].querySelectorAll('span')[row]); const aa = ra.getBoundingClientRect();
        minGap = Math.min(minGap, bb.left - aa.right);
      }
      return { lines, minGap };
    });
    const ok = r.lines.length === 5 && r.lines.every(l => l.length === 2) && r.lines[2][0] === '143' && r.lines[2][1] === 'bis 156' && r.minGap >= 6;
    return { ok, d: `${r.lines.map(l => l.join('/')).join('  ')}; kleinster Abstand ${r.minGap.toFixed(1)} px` };
  });
  await flow('App-Hub: Untertitel sagen, was dahinter steckt (nie «statt»), keine Abzeichen, nur Fähigkeiten als Punkte, Steuerung durch Apps erst nach «Daten an Apps», YouTube überall gleich', async p => {
    await p.goto(BASE + '?demo=1#/'); await p.waitForTimeout(800);
    const yh = await p.$eval('.app[data-pkg="org.smarttube.stable"], .app[data-pkg="app.revanced.android.youtube"]', e => e.textContent.trim());
    await go(p, '#/apps'); await p.waitForTimeout(300);
    const card = async pkg => p.$eval('.ap[data-pkg="' + pkg + '"]', e => ({ pk: e.querySelector('.pk').textContent, h: e.querySelector('h2').textContent,
      pts: Array.from(e.querySelectorAll('li')).map(l => (l.className || 'y') + ':' + l.textContent.trim()) }));
    const all = await p.evaluate(() => ({ st: document.querySelectorAll('.ap .st').length, txt: document.querySelector('.agrid').textContent, bad: document.querySelectorAll('.ap li.n, .ap li.h').length, subs: Array.from(document.querySelectorAll('.ap .pk')).map(e => e.textContent) }));
    const km = await card('com.kinomap.training'), zw1 = await card('com.zwift.zwiftgame');
    const ctlRow = () => p.$eval('[data-f="ctl"]', e => ({ dis: e.disabled, sm: e.querySelector('small').textContent }));
    const inc = await ctlRow();
    await p.click('[data-f="on"]'); await p.waitForTimeout(300);
    const inc2 = await ctlRow(), on = await p.$eval('[data-f="on"]', e => e.getAttribute('aria-checked') + ' ' + e.querySelector('small').textContent);
    await p.click('[data-f="ctl"]'); await p.waitForTimeout(300);
    const flog = await p.evaluate(() => JSON.stringify(window.__txFtmsLog || []));
    const ok = yh === 'YouTubeVideos mit deinem Google-Konto' && all.subs[0] === 'Videos mit deinem Google-Konto' && all.st === 0 && !/statt|ERSATZ|BEGLEITER|BEREIT/.test(all.txt) && all.bad === 0 &&
      all.subs.join('|') === 'Videos mit deinem Google-Konto|Musik und Playlists mit deinem Google-Konto|Filme, Serien und Live-TV vom Heimserver|Videostrecken aus aller Welt|Laufen in virtuellen Welten|Audiobookshelf vom Heimserver' &&
      km.pts.join('|') === 'y:Videostrecken weltweit|y:Laufband per Bluetooth verbunden|y:Menü und Musik von unten' &&
      zw1.pts.join('|') === 'y:Virtuelle Laufwelten|y:Laufband per Bluetooth verbunden|y:Menü und Musik von unten' &&
      inc.dis && inc.sm === 'zuerst «Daten an Apps und Uhren» einschalten' && !inc2.dis && inc2.sm === 'bis 14 km/h und 10 %; Start in Kinomap und Zwift mit Countdown, STOP immer' &&
      on === 'true sichtbar als «Tread Control»' && flog === '[{"on":true},{"ctl":true}]';
    return { ok, d: `Start «${yh}»; Untertitel [${all.subs.join(' | ')}]; Abzeichen ${all.st}, Warnpunkte ${all.bad}; Kinomap [${km.pts.join('; ')}]; Zwift [${zw1.pts}]; Steuerung aus «${inc.sm}», nach «Daten an Apps» «${inc2.sm}»; ${on}; Befehle ${flog}` };
  });
  await flow('Verlauf: Balken km je Tag (4 Wochen), Kennzahlen, Liste darunter, Seite gefüllt', async p => {
    await p.goto(BASE + '?demo=1#/history'); await p.waitForTimeout(1000);
    const r = await p.evaluate(() => {
      const top = document.querySelector('.hsum').getBoundingClientRect(), list = document.querySelector('.hlist').getBoundingClientRect();
      const bars = Array.from(document.querySelectorAll('.hbars .hd')), filled = bars.filter(b => b.querySelector('i').offsetHeight > 0).length;
      const kp = Array.from(document.querySelectorAll('.hkp > div:not(.hkf) .lab')).map(e => e.textContent);
      const cards = Array.from(document.querySelectorAll('.hrun')).map(e => e.getBoundingClientRect()).filter(r2 => r2.top < innerHeight);
      const low = Math.max.apply(null, cards.map(c => Math.min(c.bottom, innerHeight)));
      return { n: bars.length, filled, kp, sep: list.top - top.bottom, fill: low / innerHeight, wl: document.querySelectorAll('.hwl div').length };
    });
    const ok = r.n === 28 && r.filled >= 3 && r.kp.join('|') === 'Läufe|Kilometer|Zeit|Ø Pace' && r.sep >= 8 && r.fill > 0.9 && r.wl === 4;
    return { ok, d: `${r.n} Tage, ${r.filled} mit Lauf, Kennzahlen [${r.kp}], Liste ${Math.round(r.sep)} px darunter, Höhe bis ${Math.round(r.fill * 100)} %` };
  });
  await flow('Diagramme: Zeitachse 8 px unter der Plotfläche, keine Linie kreuzt sie; Endwert «Ist 12.3 km/h»', async p => {
    const out = [];
    for (const [h, q, ch, xa] of [['#/run', 'szenario=lauf', '[data-k="ch"]', '[data-k="xa"]'], ['#/run', '', '[data-k="ch"]', '[data-k="xa"]'], ['#/zones', 'szenario=zonen', '[data-k="zc"]', '[data-k="zxa"]'], ['#/summary', '', '[data-k="ch"]', '[data-k="xa"]']]) {
      await p.goto(BASE + '?demo=1&frozen=1' + (q ? '&' + q : '') + h); await p.waitForTimeout(1200);
      out.push(await p.evaluate(([ch2, xa2]) => {
        const c = document.querySelector(ch2), x = document.querySelector(xa2), xr = x.getBoundingClientRect();
        let low = -1e9;
        c.querySelectorAll('path,line,circle,rect,text').forEach(e => { const r = e.getBoundingClientRect(); if (r.width || r.height) low = Math.max(low, r.bottom); });
        const lab = Array.from(c.querySelectorAll('svg text')).map(t => t.textContent.replace(/\s+/g, ' ').trim()).filter(t => /km\/h$/.test(t))[0] || '';
        return { gap: xr.top - low, lab, n: x.children.length };
      }, [ch, xa]));
    }
    const ok = out.every(o => o.gap >= 8 && o.n === 5) && /^Ist\s*12\.3\s*km\/h$/.test(out[0].lab) && /^Ist\s*\d+\.\d\s*km\/h$/.test(out[2].lab);
    return { ok, d: out.map((o, i) => `${['Lauf', 'bereit', 'Zonen', 'Abschluss'][i]} ${o.gap.toFixed(1)} px «${o.lab}»`).join('; ') };
  });
  await flow('Zonen: Tempo gesperrt bis zur Zonenwahl, zeigt Tempo min «6.0» mit «Start» (kein «--»), danach exakt state.tSpeed', async p => {
    await p.goto(BASE + '?demo=1#/zones'); await p.waitForTimeout(900);
    const a = await p.evaluate(() => ({ off: document.querySelector('.adj.spd').classList.contains('off'), sv: document.querySelector('[data-k="sv"]').textContent, si: document.querySelector('[data-k="si"]').textContent,
      dis: Array.from(document.querySelectorAll('.side.r .qs button, .adj.spd .b')).every(b => b.disabled), q: Array.from(document.querySelectorAll('.side.r .qs button')).map(b => +b.getAttribute('data-v')) }));
    await p.click('[data-z="3"]'); await p.waitForTimeout(900);
    const lim = await p.evaluate(() => window.TX.ZDEF[3]), s = await st(p);
    const b = await p.evaluate(() => ({ off: document.querySelector('.adj.spd').classList.contains('off'), sv: document.querySelector('[data-k="sv"]').textContent,
      en: Array.from(document.querySelectorAll('.side.r .qs button, .adj.spd .b')).every(b => !b.disabled), q: Array.from(document.querySelectorAll('.side.r .qs button')).map(b => +b.getAttribute('data-v')) }));
    const inR = (q, lo, hi) => q.length >= 2 && q.every(v => v >= lo && v <= hi);
    return { ok: a.off && a.sv === '6.0' && a.si === 'Start' && a.dis && inR(a.q, 6, 10.5) && !b.off && b.sv === s.tSpeed.toFixed(1) && b.sv === lim.sMin.toFixed(1) && b.en && inR(b.q, lim.sMin, lim.sMax),
      d: `vorher «${a.sv}» «${a.si}» gesperrt ${a.dis} [${a.q}]; nach Z3 «${b.sv}» (Dienst ${s.tSpeed}) [${b.q}]` };
  });
  await flow('Ist-Anzeige: Schwelle 0.2 mit 2 s Beruhigung, Pace aus Ist-Tempo, Diagrammende = Leiste (ein Zustand je Bildaufbau)', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=lauf#/run'); await p.waitForTimeout(1200);
    const snap = () => p.evaluate(() => {
      const e = document.querySelector('[data-k="si"]'), ch = Array.from(document.querySelectorAll('[data-k="ch"] svg text')).map(x => x.textContent).join(' ');
      return { sv: document.querySelector('[data-k="sv"]').textContent, si: e.textContent, on: !e.classList.contains('off'), fs: getComputedStyle(e).fontSize, pace: document.querySelector('[data-k="mp"]').textContent,
        lab: 'Ist ' + (ch.match(/Ist\s*([\d.]+)/) || ['', '?'])[1], want: window.TX.pace(window.TX.api.state.speed) };
    });
    const a = await snap();                                                    // 12.3 zu 12.5: genau 0.2, keine Anzeige
    await p.evaluate(() => { window.TX.sim.s.speed = 12.1; }); await p.waitForTimeout(900);
    const b = await snap();                                                    // 0.4 Abweichung, aber erst 0.9 s
    await p.waitForTimeout(1700);
    const c = await snap();                                                    // nach 2.6 s sichtbar
    await p.evaluate(() => { window.TX.sim.s.speed = 12.4; }); await p.waitForTimeout(700);
    const d = await snap();                                                    // wieder innerhalb 0.2: sofort weg
    const ok = a.sv === '12.5' && !a.on && a.lab === 'Ist 12.3' && a.pace === a.want && !b.on && b.lab === 'Ist 12.1' && b.pace === b.want &&
      c.on && c.si === 'Ist 12.1' && c.fs === '17px' && c.lab === 'Ist 12.1' && c.pace === '4:58' && !d.on && d.lab === 'Ist 12.4';
    return { ok, d: `0.2: sichtbar ${a.on}; 0.4 nach 0.9 s ${b.on}, nach 2.6 s «${c.si}» ${c.fs}; zurück 0.1: ${d.on}; Etikett ${a.lab} > ${c.lab} > ${d.lab}; Pace ${a.pace}/${c.pace}/${d.pace}` };
  });
  await flow('Pause-Sicherheit: Doppeltipp auf die STOP-Stelle sendet keinen Befehl, dort nur «BAND STEHT», Pausenknöpfe 1 s gesperrt', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=lauf#/run'); await p.waitForTimeout(1200);
    const c = await p.$eval('.bigbtn', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.evaluate(() => { window.__txCmdLog.length = 0; });
    await p.touchscreen.tap(c.x, c.y); await p.waitForTimeout(140);
    await p.touchscreen.tap(c.x, c.y); await p.waitForTimeout(120);
    const lk = await p.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y), row = document.querySelector('.pmodal .pzrow'), bs = Array.from(row.querySelectorAll('button'));
      return { at: el ? (el.closest('.pz-m') ? 'pz-m' : el.closest('button') ? 'button' : el.className) : 'nichts', btn: !!(el && el.closest('button,[role=button],a')), lock: row.classList.contains('lock'),
        dis: bs.every(b => b.disabled), op: bs.map(b => +getComputedStyle(b).opacity), barDis: Array.from(document.querySelectorAll('.ctl.paused .pzrow button')).every(b => b.disabled) };
    }, [c.x, c.y]);
    await p.touchscreen.tap(c.x, c.y); await p.waitForTimeout(1100);
    await p.touchscreen.tap(c.x, c.y); await p.waitForTimeout(300);
    const after = await p.evaluate(() => {
      const row = document.querySelector('.pmodal .pzrow'), m = row.querySelector('.pz-m').getBoundingClientRect(), bm = document.querySelector('.ctl .pz-m').getBoundingClientRect();
      const lab = r => Array.from(r.querySelectorAll('button')).map(b => (b.querySelector('.r1') || b).textContent.trim());
      const rs = Array.from(row.querySelectorAll('button')).map(b => b.getBoundingClientRect());
      return { lock: row.classList.contains('lock'), en: Array.from(row.querySelectorAll('button')).filter(b => !b.disabled).length, mx: m.x + m.width / 2, my: m.y + m.height / 2, mw: m.width,
        bmx: bm.x + bm.width / 2, bmy: bm.y + bm.height / 2, txt: row.querySelector('.pz-m').textContent.trim(), labs: lab(row).join('|'), barLabs: lab(document.querySelector('.ctl .pzrow')).join('|'),
        left: rs[0].right <= m.x, right: rs[1].left >= m.x + m.width && rs[2].left > rs[1].left, cd: !!document.querySelector('.cdown') };
    });
    // Leistenknopf hinter dem Modal: Treffer landet im Dialog, direkter Klick auf den Knopf sendet nichts
    const behind = await p.evaluate(() => {
      const b = document.querySelector('.ctl [data-pz="resume"]'), r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const n0 = window.__txCmdLog.length; b.click(); b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      ['inclZero', 'end'].forEach(k => document.querySelector('.ctl [data-pz="' + k + '"]').click());
      return { inModal: !!(hit && hit.closest('.pmodal')), dis: b.disabled, sent: window.__txCmdLog.length - n0 };
    });
    await p.waitForTimeout(400);
    const l = await log(p), s = await st(p);
    const ok = l.join() === 'stop' && s.st === 'PAUSE' && lk.at === 'pz-m' && !lk.btn && lk.lock && lk.dis && lk.op.every(o => o < 0.5) && lk.barDis && !after.lock && after.en === 3 &&
      Math.abs(after.mx - c.x) < 2 && Math.abs(after.my - c.y) < 2 && Math.abs(after.mw - 200) < 1 && Math.abs(after.bmx - c.x) < 2 && Math.abs(after.bmy - c.y) < 2 &&
      after.txt === 'BAND STEHT' + 'PAUSE · GESAMT 24:15' && after.labs === 'WEITER|STEIGUNG AUF 0|BEENDEN' && after.barLabs === after.labs && after.left && after.right && !after.cd &&
      behind.inModal && behind.dis && behind.sent === 0;
    return { ok, d: `4 Tipps auf ${Math.round(c.x)}/${Math.round(c.y)}: Befehle [${l}], ${s.st}; dort «${after.txt}» (${lk.at}, Knopf ${lk.btn}); Sperre ${lk.lock} Deckkraft ${lk.op.join('/')}, nach 1 s frei ${after.en}/3; ` +
      `Dialog wie Leiste [${after.labs}]; Leistenknopf hinter Modal: Treffer im Dialog ${behind.inModal}, gesperrt ${behind.dis}, gesendet ${behind.sent}` };
  });
  await flow('Kurzer Lauf (unter 2 min oder unter 0.2 km): Nachfrage, Vorgabe Verwerfen, auch über /summary/last', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/run'); await p.waitForTimeout(1000);
    const n0 = await p.evaluate(() => window.TX.runs().length);
    const short = async (el, dist) => {
      await go(p, '#/run'); await p.waitForTimeout(300);
      await p.click('.bigbtn'); await p.waitForTimeout(3400);
      await p.evaluate(([e, d]) => { const s2 = window.TX.sim.s; s2.elapsed = e; s2.dist = d; }, [el, dist]);
      await p.click('.bigbtn'); await p.waitForTimeout(1300); await p.click('.pmodal [data-x="end"]'); await p.waitForTimeout(700);
      return p.evaluate(() => { const d = document.querySelector('[role=alertdialog]'); return d ? { h: d.querySelector('h2').textContent, t: d.querySelector('#sdd').textContent, foc: document.activeElement && document.activeElement.getAttribute('data-s'), first: d.querySelector('.acts button').getAttribute('data-s') } : null; });
    };
    const a = await short(75, 0.15);
    await p.click('[data-s="drop"]'); await p.waitForTimeout(400);
    const a2 = { n: await p.evaluate(() => window.TX.runs().length), h: await p.evaluate(() => location.hash) };
    const b = await short(300, 0.12);
    await p.click('[data-s="keep"]'); await p.waitForTimeout(500);
    const b2 = { n: await p.evaluate(() => window.TX.runs().length), h: await p.evaluate(() => location.hash) };
    // Beenden ueber die Pille: Dienst hat die Zusammenfassung, die Pille oeffnet #/summary/last
    await p.evaluate(() => { window.TX.sim.lastSum = { ts: Date.now(), type: 'free', name: 'Freies Laufen', elapsed: 90, dist: 0.31, kcal: 20, elev: 0, avgHr: 120, maxHr: 130, hist: [] }; });
    await go(p, '#/summary/last'); await p.waitForTimeout(600);
    const c = await p.evaluate(() => { const d = document.querySelector('[role=alertdialog]'); return d ? d.querySelector('#sdd').textContent : null; });
    await p.evaluate(() => window.onNativeBack()); await p.waitForTimeout(400);
    const c2 = { n: await p.evaluate(() => window.TX.runs().length), h: await p.evaluate(() => location.hash), open: await p.$$eval('[role=alertdialog]', e => e.length) };
    const ok = a && a.h === 'Kurzer Lauf' && /^1:15 · 0\.15 km/.test(a.t) && a.foc === 'drop' && a.first === 'drop' && a2.n === n0 && a2.h === '#/' &&
      b && /^5:00 · 0\.12 km/.test(b.t) && b2.n === n0 + 1 && b2.h.startsWith('#/summary/') && c && /^1:30 · 0\.31 km/.test(c) && c2.n === n0 + 1 && c2.h === '#/' && !c2.open;
    return { ok, d: `«${a && a.h}» «${a && a.t.slice(0, 16)}» Vorgabe ${a && a.foc}: verworfen ${a2.n - n0}, ${a2.h}; 5:00/0.12 km gespeichert ${b2.n - n0}; /summary/last «${(c || '').slice(0, 16)}», Zurücktaste verwirft, ${c2.h}` };
  });
  await flow('Gegen sich selbst laufen und Bestzeiten: Kachel «Gegner» im Lauf einer Vorlage, Bestzeit 5 km und bereinigte Pace in der Zusammenfassung', async p => {
    await p.goto(BASE + '?demo=1#/'); await p.waitForTimeout(400);
    await p.evaluate(() => {
      const H = (min, kmh, incl) => { const h = []; for (let t = 0; t <= min * 60; t += 10) h.push([t, kmh, incl, 140]); return h; };
      const now = Date.now();
      localStorage.setItem('tx.history.v1', JSON.stringify({ v: 2, runs: [
        { id: 'g2', ts: now - 3600e3, name: 'Hügel', type: 'frei', elapsed: 1500, dist: 5.0, kcal: 400, elev: 200, avgHr: 150, maxHr: 160, hist: H(25, 12, 4) },
        { id: 'g1', ts: now - 86400e3, name: 'Schwelle 5 × 4 min', planId: 'p-schwelle', type: 'interval', elapsed: 2880, dist: 7.2, kcal: 500, elev: 0, avgHr: 150, maxHr: 170, hist: H(48, 9, 0) },
        { id: 'g0', ts: now - 2 * 86400e3, name: 'Alt', type: 'frei', elapsed: 1800, dist: 5.0, kcal: 400, elev: 0, avgHr: 150, maxHr: 160, hist: H(30, 10, 0) }] }));
    });
    await p.goto(BASE + '?demo=1&szenario=intervall#/'); await p.waitForTimeout(600);
    await p.evaluate(() => { location.hash = TX.trainHash(TX.api.state); }); await p.waitForTimeout(1500);
    const a = await p.evaluate(() => { const e = document.querySelector('[data-k="mk"]'), m = e && e.closest('.m');
      return { lab: m && m.querySelector('.lab').textContent, v: e && e.textContent, u: m && m.querySelector('small').textContent, cls: m && m.className }; });
    await p.evaluate(() => { location.hash = '#/summary/g2'; }); await p.waitForTimeout(800);
    const b = await p.evaluate(() => ({ recs: Array.from(document.querySelectorAll('.sumh .rec')).map(x => x.textContent.trim()), gap: (document.querySelector('.sumh .gapp') || {}).textContent || '' }));
    const ok = /^(Gegner|Bestzeit)$/.test(a.lab) && /^\d+:\d\d$/.test(a.v) && /^(vor|hinter|gleich)$/.test(a.u) &&
      b.recs.some(x => /^5 km 25:00$/.test(x)) && /^bereinigt \d:\d\d \/km$/.test(b.gap);
    return { ok, d: `Kachel «${a.lab}» ${a.v} ${a.u} (${a.cls}); Zusammenfassung [${b.recs}] «${b.gap}»` };
  });
  await flow('Verlauf: einmalige Bereinigung kurzer Alt-Einträge (unter 120 s UND unter 0.2 km), Fassung im Schlüssel tx.history.v1', async p => {
    await p.addInitScript(() => {
      if (sessionStorage.getItem('hc')) return; sessionStorage.setItem('hc', '1');
      const r = (id, e, d) => ({ id, ts: Date.now() - 3600e3, name: 'Freies Laufen', type: 'frei', elapsed: e, dist: d, kcal: 1, elev: 0, avgHr: 0, maxHr: 0, hist: [] });
      localStorage.setItem('tx.history.v1', JSON.stringify({ v: 1, runs: [r('k1', 60, 0.1), r('k2', 60, 0.5), r('k3', 300, 0.1), r('k4', 30, 0.05), r('k5', 1800, 4.2)] }));
    });
    await p.goto(BASE + '?demo=1#/history'); await p.waitForTimeout(800);
    const a = await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('tx.history.v1')); return { v: o.v, ids: o.runs.map(r => r.id).join(), rm: o.cleaned && o.cleaned.removed, cards: document.querySelectorAll('.hrun').length }; });
    // spaeter (bewusst) gespeicherter kurzer Lauf bleibt: Bereinigung nur einmal
    await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('tx.history.v1')); o.runs.unshift({ id: 'k6', ts: Date.now(), name: 'Kurz', type: 'frei', elapsed: 50, dist: 0.1, kcal: 1, elev: 0, avgHr: 0, maxHr: 0, hist: [] }); localStorage.setItem('tx.history.v1', JSON.stringify(o)); });
    await p.reload(); await p.waitForTimeout(800);
    const b = await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('tx.history.v1')); return { v: o.v, ids: o.runs.map(r => r.id).join() }; });
    const ok = a.v === 2 && a.ids === 'k2,k3,k5' && a.rm === 2 && a.cards === 3 && b.v === 2 && b.ids === 'k6,k2,k3,k5';
    return { ok, d: `nach Start v${a.v} [${a.ids}] entfernt ${a.rm}, ${a.cards} Karten; nach Neuladen v${b.v} [${b.ids}]` };
  });
  await flow('Schalter «Herstellerleiste ausblenden»: Schlüssel hideBar, alter Wert übernommen, an TreadNative.setPref', async p => {
    await p.addInitScript(() => {
      window.__calls = [];
      window.TreadNative = { token: () => 't', installed: () => '[]', launch: () => true, setPref: (k, v) => { window.__calls.push(k + '=' + v); } };
      if (!sessionStorage.getItem('hb')) { sessionStorage.setItem('hb', '1'); localStorage.setItem('tx.prefs.v1', JSON.stringify({ insetApps: false })); }
    });
    await p.route('**/api/state**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, st: 'BEREIT', err: '', speed: 0, incline: 0, tSpeed: 8, tIncl: 0, hr: 70, hrOk: true, pulled: 0, safe: 1, elapsed: 0, dist: 0, kcal: 0, elev: 0, src: 'ui', prog: null }) }));
    await p.goto(BASE + '#/apps'); await p.waitForTimeout(800);
    const a = await p.evaluate(() => { const b = document.querySelector('[data-p="hideBar"]'); return { t: b.firstChild.firstChild.textContent, sub: b.querySelector('small').textContent, on: b.getAttribute('aria-checked'), calls: window.__calls.slice(), old: !!document.querySelector('[data-p="insetApps"]') }; });
    await p.click('[data-p="hideBar"]'); await p.waitForTimeout(200);
    await p.reload(); await p.waitForTimeout(800);
    const b = await p.evaluate(() => ({ on: document.querySelector('[data-p="hideBar"]').getAttribute('aria-checked'), calls: window.__calls.slice(), pref: JSON.parse(localStorage.getItem('tx.prefs.v1')).hideBar }));
    const ok = a.t === 'Herstellerleiste ausblenden' && a.sub === 'eigene Statuszeile oben, Apps im Vollbild' && a.on === 'false' && a.calls.join() === 'hideBar=false' && !a.old &&
      b.on === 'true' && b.pref === true && b.calls.length === 0;
    return { ok, d: `«${a.t}» / «${a.sub}»; aus altem insetApps=false: ${a.on}, an Konsole [${a.calls}]; nach Antippen und Neuladen ${b.on}, kein erneutes Senden ${b.calls.length === 0}` };
  });
  await flow('Wechselbanner wie die Pille: zentriert über der Steuerleiste, Text zentriert, «0:08» und Überschrift in einer Zeile gleich gross und fett (ohne Kasten), zweite Zeile kleiner; Balken springen nicht', async p => {
    const bars = async q => { await p.goto(BASE + '?demo=1&frozen=1&szenario=' + q + '#/interval/p-schwelle'); await p.waitForTimeout(1200);
      return p.evaluate(() => { const r = document.querySelector('[data-k="bars"]').getBoundingClientRect(), b = document.querySelector('[data-k="cur"], [data-k="bars"] .b:first-child').getBoundingClientRect(); return { t: r.top, h: r.height, w: r.width, bh: b.height }; }); };
    const a = await bars('intervall'), b = await bars('wechsel');
    const r = await p.evaluate(() => {
      const ban = document.querySelector('[data-k="ban"]'), br = ban.getBoundingClientRect(), ctl = document.querySelector('.ctl').getBoundingClientRect(), bn = ban.querySelector('.bn'), hd = ban.querySelector('.hd'), l2 = ban.querySelector('.l2');
      const cs = e => getComputedStyle(e);
      return { on: ban.classList.contains('on'), cx: br.left + br.width / 2, bottom: br.bottom, ctlTop: ctl.top, ta: cs(ban).textAlign, bn: bn.textContent, hd: hd.textContent, l2: l2.textContent,
        same: cs(bn).fontSize === cs(hd).fontSize && cs(bn).fontWeight === cs(hd).fontWeight, smaller: parseFloat(cs(l2).fontSize) < parseFloat(cs(hd).fontSize), box: cs(bn).backgroundColor, svg: ban.querySelectorAll('svg').length,
        oneLine: Math.abs(bn.getBoundingClientRect().top - hd.getBoundingClientRect().top) < 8 };
    });
    const ok = r.on && Math.abs(a.t - b.t) < 0.5 && Math.abs(a.h - b.h) < 0.5 && Math.abs(a.bh - b.bh) < 0.5 && Math.abs(r.cx - 640) < 2 && r.bottom <= r.ctlTop && r.ctlTop - r.bottom < 40 && r.ta === 'center' &&
      /^0:0\d$/.test(r.bn) && r.hd === 'Gleich Erholung' && /^Tempo (sinkt ↓|steigt ↑|bleibt)/.test(r.l2) && r.same && r.smaller && r.oneLine && (r.box === 'rgba(0, 0, 0, 0)' || r.box === 'transparent') && r.svg === 0;
    return { ok, d: `Balken ohne/mit Banner ${a.t.toFixed(1)}/${b.t.toFixed(1)} px; Banner Mitte ${Math.round(r.cx)} px, ${Math.round(r.ctlTop - r.bottom)} px über der Steuerleiste, Text ${r.ta}; «${r.bn} ${r.hd}» gleich gross ${r.same}, eine Zeile ${r.oneLine}, ohne Kasten (${r.box}); «${r.l2}» kleiner ${r.smaller}` };
  });
  await flow('Intervallprofil: eine Dezimalstelle, Achsenlabels, aktueller Abschnitt gross', async p => {
    await p.goto(BASE + '?demo=1&szenario=wechsel#/interval/p-schwelle'); await p.waitForTimeout(1300);
    const r = await p.evaluate(() => {
      const bl = Array.from(document.querySelectorAll('[data-k="bars"] .b span')).map(e => e.textContent).filter(Boolean);
      const il = Array.from(document.querySelectorAll('[data-k="incs"] i')).map(e => e.textContent).filter(Boolean);
      const ax = Array.from(document.querySelectorAll('.prof .ax')).map(e => e.textContent.trim()).filter(Boolean);
      const cur = document.querySelector('[data-k="bars"] .b.cur span'), oth = document.querySelector('[data-k="bars"] .b:not(.cur) span');
      const ban = document.querySelector('[data-k="ban"]').getBoundingClientRect(), leg = document.querySelector('.prof .legend').getBoundingClientRect(), cl = cur.getBoundingClientRect();
      return { bl, il, ax, cf: parseFloat(getComputedStyle(cur).fontSize), of: parseFloat(getComputedStyle(oth).fontSize), cw: getComputedStyle(cur).fontWeight, ban: ban.height > 0, over: ban.top <= leg.top && ban.bottom >= leg.bottom, gap: cl.top - ban.bottom };
    });
    const d1 = s => s.every(t => /^\d+\.\d$/.test(t));
    return { ok: r.bl.length > 3 && d1(r.bl) && d1(r.il) && r.ax.join('|') === 'Tempo km/h|Steigung %' && r.cf > r.of && r.cw === '900' && r.ban,
      d: `Balken [${r.bl.slice(0, 4)}…], Steigung [${r.il.slice(0, 4)}…], Achsen [${r.ax.join(', ')}], aktuell ${r.cf}/${r.of} px, Banner über der Legende ${r.over}, ${Math.round(r.gap)} px über dem aktuellen Etikett` };
  });
  await flow('Plan-Detail: Liste bis Auslaufen, Scrollhinweis, Zeitanteile in Balkenreihenfolge', async p => {
    await p.goto(BASE + '?demo=1#/plans'); await p.waitForTimeout(1000);
    const res = [];
    for (const id of ['p-schwelle', 'p-pyramide']) {
      await p.click('.tpl[data-id="' + id + '"]'); await p.waitForTimeout(400);
      const a = await p.evaluate(() => {
        const l = document.querySelector('.seglist'), w = document.querySelector('.segwrap'), rows = l.querySelectorAll('.sg');
        const last = rows[rows.length - 1].querySelector('b').textContent, scr = l.scrollHeight > l.clientHeight + 2, more = w.classList.contains('more');
        l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll'));
        const lr = l.getBoundingClientRect(), rr = rows[rows.length - 1].getBoundingClientRect();
        const bar = Array.from(document.querySelectorAll('.mbar i')).map(e => e.style.background), leg = Array.from(document.querySelectorAll('.mleg i')).map(e => e.style.background);
        return { last, scr, more, more2: w.classList.contains('more'), vis: rr.bottom <= lr.bottom + 1, ord: bar.join() === leg.join(), n: rows.length };
      });
      res.push(a);
    }
    const ok = res.every(a => a.last === 'Auslaufen' && a.vis && a.more === a.scr && !a.more2 && a.ord) && res[1].scr;
    return { ok, d: res.map((a, i) => `${['Schwelle', 'Pyramide'][i]}: ${a.n} Zeilen, letzte «${a.last}», scrollbar ${a.scr}, Verlauf ${a.more} > ${a.more2}, Reihenfolge ${a.ord}`).join('; ') };
  });
  await flow('App-Hub: alle fünf Apps mit eigenem Bild (img/apps, geladen), keine Platzhalter, nicht installierte nur dezent abgeblendet', async p => {
    await p.addInitScript(() => { window.TreadNative = { token: () => 't', installed: () => JSON.stringify(['org.smarttube.stable', 'org.jellyfin.mobile']), launch: () => true, setPref: () => {} }; });
    await p.goto(BASE + '?demo=1#/apps'); await p.waitForTimeout(1200);
    const r = await p.evaluate(async () => {
      const ar = Array.from(document.querySelectorAll('.fit .ar'));
      const urls = ar.map(e => (e.style.backgroundImage.match(/url\("?([^")]+)"?\)/) || [])[1]);
      const loaded = await Promise.all(urls.map(u => new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = u; })));
      const na = Array.from(document.querySelectorAll('.ap.na'));
      return { n: ar.length, urls, loaded, ph: document.querySelectorAll('.fit .ar.ph, .phlg').length, na: na.length, op: na.map(e => +getComputedStyle(e.querySelector('.ar')).opacity), txt: na.map(e => getComputedStyle(e.querySelector('h2')).opacity) };
    });
    const ok = r.n === 6 && r.ph === 0 && r.urls.join() === 'img/apps/youtube.jpg,img/apps/ytmusic.jpg,img/apps/jellyfin.jpg,img/apps/kinomap.jpg,img/apps/zwift.jpg,img/apps/hoerbuecher.jpg' && r.loaded.every(w => w >= 400) && r.na === 4 && r.op.every(o => o < 0.6) && r.txt.every(o => o === '1');
    return { ok, d: `${r.n} Bilder [${r.urls.map(u => u.split('/').pop()).join(', ')}] Breite ${r.loaded.join('/')} px; Platzhalter ${r.ph}; nicht installiert ${r.na}, Bild-Deckkraft ${r.op.join('/')}` };
  });
  await flow('Intervall: Banner 10 s vor Wechsel, Ton bei 3, 2, 1', async p => {
    await p.goto(BASE + '?demo=1&szenario=wechsel#/interval/p-schwelle');
    await p.evaluate(() => { window.__beeps = 0; const o = window.TX.beep; window.TX.beep = function (hz) { window.__beeps++; return o(hz); }; });
    await p.waitForTimeout(1200);
    const ban = await p.isVisible('[data-k="ban"]'), txt = await p.textContent('[data-k="ban"]');
    await p.waitForTimeout(8200);
    const beeps = await p.evaluate(() => window.__beeps), ban2 = await p.isVisible('[data-k="ban"]');
    return { ok: ban && beeps === 3 && !ban2, d: `Banner «${txt}», Töne ${beeps}, danach Banner ${ban2 ? 'noch da' : 'weg'}` };
  });
  await flow('Fehler-Banner mit Quittieren bei FEHLER', async p => {
    await p.goto(BASE + '?demo=1&szenario=fehler#/run'); await p.waitForTimeout(1000);
    const t = await p.textContent('#alerts'), b = await p.isVisible('[data-x="ack"]');
    await p.evaluate(() => { window.TX.sim.s.pulled = 0; }); await p.click('[data-x="ack"]'); await p.waitForTimeout(800);
    const s = await st(p), t2 = await p.textContent('#alerts');
    return { ok: /Sicherheitsschlüssel/.test(t) && b && s.st === 'BEREIT' && !t2.trim(), d: `«${t.trim().slice(0, 40)}», nach Quittieren ${s.st}` };
  });
  await flow('Bildschirmschoner: nicht bei Musik, Berührung beendet ihn ohne Klick darunter', async p => {
    await p.goto(BASE + '?demo=1&saver=1#/run'); await p.waitForTimeout(300);
    const mus = await p.evaluate(() => !!(window.TX.media && window.TX.media.st && window.TX.media.st.playing));
    await p.waitForTimeout(1500);
    const onMus = await p.isVisible('#saver.on');   // Demo spielt Musik: kein Bildschirmschoner
    await p.evaluate(() => window.TX.media.cmd('toggle')); await p.waitForTimeout(2300);
    const on = await p.isVisible('#saver.on'), pos1 = await p.$eval('#saver .blk', e => e.style.transform);
    const box = await p.$eval('.bigbtn', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.mouse.click(box.x, box.y); await p.waitForTimeout(900);
    const off = !(await p.isVisible('#saver.on')), l = await log(p);
    return { ok: !(mus && onMus) && on && off && !l.includes('start') && !l.includes('arm') && /translate/.test(pos1), d: `bei Musik ${onMus ? 'an!' : 'aus'}, an ${on}, aus ${off}, Befehle [${l}]` };
  });
  await flow('Vorlagen: anlegen, bearbeiten (+/-, Block, verschieben), speichern, löschen', async p => {
    await p.goto(BASE + '?demo=1#/plans/edit/neu'); await p.waitForTimeout(900);
    await p.fill('#ename', 'Testplan Audit');
    await p.click('[data-e="addblock"]'); await p.click('[data-f="s"][data-p="1"][data-d="1"]'); await p.click('[data-e="down"][data-p="0"]');
    await p.click('[data-f="rep"][data-p="3"][data-d="1"]');
    await p.click('[data-e="save"]'); await p.waitForTimeout(600);
    const pl = await p.evaluate(() => window.TX.plans().filter(x => x.name === 'Testplan Audit')[0]);
    const ok1 = pl && pl.items.length === 4 && pl.items[3].rep === 4 && pl.items[0].s === 12.5;
    await p.goto(BASE + '?demo=1#/plans/edit/' + pl.id); await p.waitForTimeout(700);
    await p.click('[data-e="delplan"]'); await p.click('[data-e="delplan"]'); await p.waitForTimeout(500);
    const gone = await p.evaluate(id => !window.TX.plan(id), pl.id), stored = await p.evaluate(() => !!localStorage.getItem('tx.plans.v1'));
    return { ok: ok1 && gone && stored, d: `gespeichert ${!!ok1}, gelöscht ${gone}, Schlüssel tx.plans.v1 ${stored}` };
  });
  await flow('Apps: Kachel startet über TreadNative.launch, Schalter rufen setPref', async p => {
    await p.addInitScript(() => {
      window.__calls = [];
      window.TreadNative = { token: () => 't', installed: () => JSON.stringify(['org.smarttube.stable', 'org.jellyfin.mobile']),
        launch: k => { window.__calls.push('launch:' + k); return true; }, setPref: (k, v) => { window.__calls.push('pref:' + k + '=' + v); } };
    });
    await p.route('**/api/state**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, st: 'BEREIT', err: '', speed: 0, incline: 0, tSpeed: 8, tIncl: 0, hr: 70, hrOk: true, pulled: 0, safe: 1, elapsed: 0, dist: 0, kcal: 0, elev: 0, src: 'ui', prog: null }) }));
    await p.goto(BASE + '#/apps'); await p.waitForTimeout(900);
    await p.click('.ap[data-pkg="org.jellyfin.mobile"]'); await p.click('.ap[data-pkg="com.kinomap.training"]'); await p.click('[data-p="pillGraph"]'); await p.click('[data-p="hideBar"]');
    const c = await p.evaluate(() => window.__calls), na = await p.$$eval('.ap.na', e => e.length), demo = await p.evaluate(() => document.documentElement.classList.contains('is-demo'));
    const tv = await p.$$eval('.ap[data-pkg="org.jellyfin.androidtv"]', e => e.length);
    return { ok: c.includes('launch:org.jellyfin.mobile') && !c.some(x => x.includes('kinomap')) && c.includes('pref:pillGraph=false') && c.includes('pref:hideBar=true') && c[c.length - 1] === 'pref:hideBar=false' && na === 4 && !tv && !demo, d: `${c.join(', ')}; grau: ${na}` };
  });
  await flow('Zone laden: program, dann speed auf Tempo min; Leiste «Start», Hinweis ohne Puls', async p => {
    await p.goto(BASE + '?demo=1&puls=0#/zones'); await p.waitForTimeout(900);
    await p.click('[data-z="3"]'); await p.waitForTimeout(900);
    const l = await log(p), s = await st(p), pz = s.prog;
    const sub = await p.textContent('[data-k="si"]'), big = await p.textContent('.bigbtn'), sMin = await p.evaluate(() => window.TX.ZDEF[3].sMin);
    const iP = l.indexOf('program'), iS = l.lastIndexOf('speed');
    await p.click('.bigbtn'); await p.waitForTimeout(400);
    const cdn = await p.evaluate(() => { const e = document.querySelector('.cdown .cdn'); return e ? e.textContent : ''; });
    await p.waitForTimeout(3000);
    const s2 = await st(p);
    return { ok: cdn === 'startet ohne Automatik' && iP >= 0 && iS > iP && Math.abs(s.tSpeed - sMin) < 0.01 && pz && pz.type === 'zones' && /Start/.test(sub) && /startet ohne Automatik/.test(big) && s2.st === 'LAEUFT',
      d: `Befehle [${l}], Soll ${s.tSpeed} (min ${sMin}), Unterzeile «${sub}», Knopf «${big.trim()}», Countdown «${cdn}», danach ${s2.st}` };
  });
  await flow('Zone mit Pulssignal: START ohne Zusatzhinweis, Pulsquelle «plausibel»', async p => {
    await p.goto(BASE + '?demo=1#/zones'); await p.waitForTimeout(900);
    const pst = await p.textContent('[data-k="pst"]');
    await p.click('[data-z="2"]'); await p.waitForTimeout(900);
    const big = await p.textContent('.bigbtn');
    return { ok: pst === 'plausibel' && !/ohne Automatik/.test(big) && /START/.test(big), d: `Pulsquelle «${pst}», Knopf «${big.trim()}»` };
  });
  await flow('App-Hub bei laufendem Band: Tempo und STOP oben rechts', async p => {
    await p.goto(BASE + '?demo=1&szenario=lauf#/apps'); await p.waitForTimeout(1000);
    const chip = await p.textContent('.runchip'), stopV = await p.isVisible('.runchip .stopb');
    const box = await p.$eval('.runchip', e => { const r = e.getBoundingClientRect(); return { x: r.x, r: r.right, y: r.y }; });
    await p.click('.runchip .stopb'); await p.waitForTimeout(600);
    const s = await st(p);
    return { ok: /km\/h/.test(chip) && stopV && box.x > 640 && box.y < 80 && s.st === 'PAUSE', d: `«${chip.trim()}», STOP ${stopV}, x ${Math.round(box.x)}, danach ${s.st}` };
  });
  await flow('Farben: Belastung orange (Plankarte, Abschnittsmarke, Startkachel), nie rot', async p => {
    await p.goto(BASE + '?demo=1#/plans'); await p.waitForTimeout(1000);
    const card = await p.$eval('.tpl[data-id="p-schwelle"] .mini path[stroke]', e => e.getAttribute('stroke'));
    const mark = await p.$$eval('.det .sg .c', e => e.map(x => x.style.background));
    await p.goto(BASE + '?demo=1#/'); await p.waitForTimeout(900);
    const tile = await p.$eval('[data-k="v2"] path[stroke]', e => e.getAttribute('stroke'));
    const red = mark.some(x => /--hr|255, 77, 94/.test(x));
    return { ok: card === '#ff7a1a' && tile === '#ff7a1a' && mark.some(x => /--warn/.test(x)) && !red, d: `Karte ${card}, Kachel ${tile}, Marken ${[...new Set(mark)].join(' ')}` };
  });
  await flow('Statuszeile: genau 40 px, rechts «Di 27.10.» «10:05», WLAN-Strichsymbol, Zahnrad ruft TreadNative.openSettings; Marke nur ohne Kopf', async p => {
    await p.addInitScript(() => {
      window.__calls = [];
      window.TreadNative = { token: () => 't', installed: () => '[]', launch: () => true, setPref: () => {}, openSettings: () => { window.__calls.push('openSettings'); return true; } };
    });
    let mode = 'BEREIT';
    await p.route('**/api/state**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, st: mode, err: '', speed: mode === 'LAEUFT' ? 8 : 0, incline: 0, tSpeed: 8, tIncl: 0, hr: 70, hrOk: true, pulled: 0, safe: 1, elapsed: mode === 'LAEUFT' ? 30 : 0, dist: 0, kcal: 0, elev: 0, src: 'ui', prog: null }) }));
    await p.goto(BASE + '#/plans'); await p.waitForTimeout(900);
    const bar = () => p.evaluate(() => {
      const b = document.getElementById('topfree'), r = b.getBoundingClientRect(), cs = getComputedStyle(b), vis = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const dt = b.querySelector('[data-k="sbdt"]'), tm = b.querySelector('[data-k="sbtm"]'), w = b.querySelector('[data-k="sbw"]'), g = b.querySelector('[data-k="sbg"]'), br = b.querySelector('.sbrand');
      const ref = n => { const d = document.createElement('div'); d.innerHTML = window.TX.I(n); return d.firstChild.outerHTML; };
      const now = new Date(), T = window.TX, rr = b.querySelector('.sbr').getBoundingClientRect();
      return { h: r.height, top: r.top, bg: cs.backgroundColor, fs: getComputedStyle(dt).fontSize, col: getComputedStyle(dt).color, dt: dt.textContent, tm: tm.textContent,
        wantDt: T.WD2[now.getDay()] + ' ' + T.dshort(now.getTime()), wantTm: T.hm(now.getTime()), right: Math.round(rr.right), rTop: rr.top, rBot: rr.bottom,
        wifi: !!w.querySelector('svg') && w.querySelector('svg').outerHTML === ref('wifi'), wifiOff: !!w.querySelector('svg') && w.querySelector('svg').outerHTML === ref('wifiOff'), wl: w.getAttribute('aria-label'),
        gear: vis(g), gearSvg: !!g.querySelector('svg') && g.querySelector('svg').outerHTML === ref('gear'), brand: vis(br), dtVis: vis(dt), appTop: document.getElementById('app').getBoundingClientRect().top };
    });
    const a = await bar();
    await p.click('#topfree [data-k="sbg"]'); await p.waitForTimeout(200);
    const c1 = await p.evaluate(() => window.__calls.slice());
    await p.evaluate(() => { location.hash = '#/run'; }); await p.waitForTimeout(500);
    const b = await bar();
    // waehrend des Laufs oeffnet das Zahnrad nichts
    mode = 'LAEUFT'; await p.waitForTimeout(900);
    await p.click('#topfree [data-k="sbg"]'); await p.waitForTimeout(300);
    const c2 = await p.evaluate(() => window.__calls.slice()), toast = await p.textContent('#toast');
    // ohne Netz: Symbol mit Schraegstrich
    await p.context().setOffline(true); await p.waitForTimeout(300);
    const off = await bar();
    await p.context().setOffline(false); await p.waitForTimeout(1500);
    const on = await bar();
    const ok = a.h === 40 && a.top === 0 && a.appTop === 40 && a.bg === 'rgb(0, 0, 0)' && a.fs === '15px' && a.col === 'rgb(164, 169, 187)' && a.dt === a.wantDt && /^(Mo|Di|Mi|Do|Fr|Sa|So) \d\d\.\d\d\.$/.test(a.dt) &&
      a.tm === a.wantTm && /^\d\d:\d\d$/.test(a.tm) && a.right >= 1270 && a.rTop >= 0 && a.rBot <= 40 && a.wifi && a.wl === 'WLAN verbunden' && a.gear && a.gearSvg && !a.brand && c1.join() === 'openSettings' &&
      b.brand && b.dtVis && c2.length === 1 && /nach dem Lauf/.test(toast) && off.wifiOff && off.wl === 'Keine Verbindung' && on.wifi;
    return { ok, d: `${a.h} px, «${a.dt}» «${a.tm}» ${a.fs} ${a.col}, rechts bis ${a.right} px; WLAN ${a.wifi} (offline ${off.wifiOff} «${off.wl}», wieder ${on.wifi}); Zahnrad [${c1}], im Lauf «${toast.trim()}»; Marke Pläne ${a.brand}, Schnellstart ${b.brand}` };
  });
  await flow('Statuszeile mit hideBar aus: Zeile leer und schwarz (Herstellerleiste liegt dort), Schalter blendet sofort um', async p => {
    await p.goto(BASE + '?demo=1#/apps'); await p.waitForTimeout(900);
    const vis = () => p.evaluate(() => { const b = document.getElementById('topfree'), v = s => { const e = b.querySelector(s); return !!e && e.getClientRects().length > 0; };
      return { r: v('.sbr'), dt: v('[data-k="sbdt"]'), g: v('[data-k="sbg"]'), br: v('.sbrand'), h: b.getBoundingClientRect().height, bg: getComputedStyle(b).backgroundColor }; });
    const a = await vis();
    await p.click('[data-p="hideBar"]'); await p.waitForTimeout(200);
    const b = await vis();
    await go(p, '#/run'); const c = await vis();
    await p.reload(); await p.waitForTimeout(900); const d = await vis();
    await go(p, '#/apps'); await p.click('[data-p="hideBar"]'); await p.waitForTimeout(200); const e = await vis();
    const ok = a.r && a.dt && a.g && !b.r && !b.dt && !b.g && !c.r && !c.br && !d.r && b.h === 40 && b.bg === 'rgb(0, 0, 0)' && e.r && e.dt;
    return { ok, d: `an: Uhr ${a.dt} Zahnrad ${a.g}; aus: Uhr ${b.dt}, Marke im Lauf ${c.br}, nach Neuladen ${d.r}, Höhe ${b.h} ${b.bg}; wieder an: ${e.r}` };
  });
  await flow('«Zuletzt» aus dem Verlauf (planId, sonst Name), gespeicherte Werte ignoriert und entfernt, leer «--», Start schreibt nichts in die Vorlage', async p => {
    const day = 864e5, t0 = Date.now();
    await p.addInitScript(([t, d]) => {
      if (sessionStorage.getItem('zl')) return; sessionStorage.setItem('zl', '1');
      const r = (id, ts, name, planId) => ({ id, ts, name, planId, type: 'interval', elapsed: 1800, dist: 4.2, kcal: 300, elev: 0, avgHr: 135, maxHr: 140, hist: [] });
      localStorage.setItem('tx.history.v1', JSON.stringify({ v: 2, runs: [r('a', t - 3 * d, 'Alter Name Rigi', 'p-rigi'), r('b', t - 5 * d, 'Pyramide 1-2-3-2-1', null), r('c', t - 9 * d, 'Pyramide 1-2-3-2-1', null), r('e', t - 2 * d, 'Hügel Rigi', 'p-anders')] }));
      // Vorlagen frisch anlegen lassen; danach bekommen alle ein altes gespeichertes «last», das ignoriert werden muss
      localStorage.removeItem('tx.plans.v1');
      window.__seedLast = t - 1 * d;
    }, [t0, day]);
    await p.goto(BASE + '?demo=1&frozen=1#/plans'); await p.waitForTimeout(900);
    await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('tx.plans.v1')); o.plans.forEach(x => { x.last = window.__seedLast; }); localStorage.setItem('tx.plans.v1', JSON.stringify(o)); location.reload(); });
    await p.waitForTimeout(1200);
    const card = () => p.evaluate(() => { const o = {}; document.querySelectorAll('.tpl[data-id]').forEach(e => { o[e.getAttribute('data-id')] = e.querySelector('[data-k="last"]').textContent; }); return o; });
    const c = await card(), T = await p.evaluate(([t, d]) => ({ rigi: window.TX.dshort(t - 3 * d), pyr: window.TX.dshort(t - 5 * d), today: window.TX.dshort(Date.now()) }), [t0, day]);
    await p.click('.tpl[data-id="p-rigi"]'); await p.waitForTimeout(200);
    const det = await p.textContent('[data-k="dlast"]');
    // Plan starten (laden) schreibt kein «last» in die Vorlage
    await p.click('.tpl[data-id="p-pyramide"]'); await p.click('[data-v="start"]'); await p.waitForTimeout(900);
    const stored = await p.evaluate(() => localStorage.getItem('tx.plans.v1'));
    // Lauf dieser Vorlage beenden: Datensatz mit planId, Karte zeigt heute
    await p.click('.bigbtn'); await p.waitForTimeout(3400);
    await p.evaluate(() => { const s = window.TX.sim.s; s.elapsed = 400; s.dist = 1.2; });
    await p.click('.bigbtn'); await p.waitForTimeout(1300); await p.click('.pmodal [data-x="end"]'); await p.waitForTimeout(900);
    const rec = await p.evaluate(() => window.TX.runs()[0]);
    await go(p, '#/plans'); await p.waitForTimeout(300);
    const c2 = await card();
    // leerer Verlauf: ueberall «--»
    await p.evaluate(() => { localStorage.setItem('tx.history.v1', JSON.stringify({ v: 2, runs: [] })); });
    await p.goto(BASE + '?demo=1&frozen=1&leer=1#/plans'); await p.waitForTimeout(900);
    const c3 = await card(), det3 = await p.textContent('[data-k="dlast"]');
    const ok = c['p-rigi'] === 'zuletzt ' + T.rigi && c['p-pyramide'] === 'zuletzt ' + T.pyr && c['p-schwelle'] === 'zuletzt --' && det === T.rigi && !/"last"/.test(stored) &&
      rec.planId === 'p-pyramide' && c2['p-pyramide'] === 'zuletzt ' + T.today && Object.values(c3).every(x => x === 'zuletzt --') && det3 === '--';
    return { ok, d: `Rigi «${c['p-rigi']}» (planId, Name abweichend), Pyramide «${c['p-pyramide']}» (Name, jüngster), Schwelle «${c['p-schwelle']}» (gespeichert ignoriert); Detail «${det}»; nach Lauf planId ${rec.planId} «${c2['p-pyramide']}»; leer [${[...new Set(Object.values(c3))]}] Detail «${det3}»` };
  });
  await flow('Pausen-Statusfeld wie in der Pille: nicht knopfartig (transparent, kein Rahmen, 56 hoch), graues Stopp-Quadrat plus «BAND STEHT», Dialog und Leiste gleich, Tipp bewirkt nichts', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=lauf#/run'); await p.waitForTimeout(1200);
    await p.click('.bigbtn'); await p.waitForTimeout(450);
    const geo = () => p.evaluate(() => Array.from(document.querySelectorAll('.pz-m')).map(m => {
      const disp = m.parentNode.parentNode.classList.contains('paused') || m.closest('.pmodal');
      const r = m.getBoundingClientRect(), cs = getComputedStyle(m), cx = r.x + r.width / 2, b = m.querySelector('b'), sv = b.querySelector('svg'), ref = document.createElement('div');
      ref.innerHTML = window.TX.I('stop', 1);
      const ctr = e => { const rg = document.createRange(); rg.selectNodeContents(e); const q = rg.getBoundingClientRect(); return q.x + q.width / 2; };
      return { where: m.closest('.pmodal') ? 'Dialog' : 'Leiste', shown: !!disp, lock: m.parentNode.classList.contains('lock'), bg: cs.backgroundColor, bw: cs.borderTopWidth, bs: cs.borderTopStyle, sh: cs.boxShadow, h: r.height, w: r.width,
        t: b.textContent.trim(), ls: parseFloat(getComputedStyle(b).letterSpacing) / parseFloat(getComputedStyle(b).fontSize), svg: !!sv && sv.outerHTML === ref.firstChild.outerHTML, ic: sv ? getComputedStyle(sv).color : '', tc: getComputedStyle(b).color,
        role: m.getAttribute('role'), btn: !!m.closest('button,[role=button],a'), op: +cs.opacity, db: Math.abs(ctr(b) - cx), ds: Math.abs(ctr(m.querySelector('small')) - cx) };
    }));
    const a = await geo();
    await p.waitForTimeout(1100);
    const b = await geo();
    await p.evaluate(() => { window.__txCmdLog.length = 0; document.getElementById('toast').classList.remove('on'); });
    await p.click('.pmodal .pz-m'); await p.waitForTimeout(250);
    const on1 = await p.evaluate(() => document.getElementById('toast').classList.contains('on')), l = await log(p), s = await st(p);
    const grey = c => { const m = c.match(/\d+/g).map(Number); return Math.max(m[0], m[1], m[2]) - Math.min(m[0], m[1], m[2]) < 30; };
    const flat = g => g.length === 2 && g.every(x => x.bg === 'rgba(0, 0, 0, 0)' && (x.bw === '0px' || x.bs === 'none') && x.sh === 'none' && x.op === 1 && Math.abs(x.h - 56) < 0.5 && Math.abs(x.w - 200) < 0.5 &&
      x.t === 'BAND STEHT' && x.ls >= 0.05 && x.svg && grey(x.ic) && grey(x.tc) && x.role === 'status' && !x.btn && x.db < 1.5 && x.ds < 1) &&
      JSON.stringify(Object.assign({}, g[0], { where: 0, shown: 0 })) === JSON.stringify(Object.assign({}, g[1], { where: 0, shown: 0 }));
    const ok = flat(a) && flat(b) && a.some(x => x.lock) && !b.some(x => x.lock) && !on1 && !l.length && s.st === 'PAUSE';
    return { ok, d: `${a.map(x => x.where).join('+')}: Grund ${a[0].bg}, Rahmen ${a[0].bw}, ${a[0].w}x${a[0].h} px, «${a[0].t}» Sperrung ${a[0].ls.toFixed(2)} em, Quadrat ${a[0].ic}; gesperrt gleich ${flat(a)}; Tipp: Hinweis ${on1}, Befehle [${l}], ${s.st}` };
  });
  await flow('Aktionsknöpfe in Versalien mit Sperrung wie die Pille (START, STOP, WEITER, STEIGUNG AUF 0, BEENDEN, ABBRECHEN), Reiter in Satzschreibung', async p => {
    const lab = e => (e.querySelector('.r1') || e).textContent.replace(/\s+/g, ' ').trim();
    const grab = sel => p.evaluate(([q, f]) => { const fn = new Function('e', 'return (' + f + ')(e)'); return Array.from(document.querySelectorAll(q)).filter(e => e.getClientRects().length).map(e => {
      const t = e.querySelector('.r1') || e, cs = getComputedStyle(t); return { t: fn(e), ls: parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize) }; }); }, [sel, lab.toString()]);
    await p.goto(BASE + '?demo=1&frozen=1#/run'); await p.waitForTimeout(1000);
    const a = await grab('.ctl .bigbtn'), tabs = await p.evaluate(() => Array.from(document.querySelectorAll('.tabs .tab')).map(e => e.textContent.trim()));
    await p.goto(BASE + '?demo=1&frozen=1&szenario=lauf#/run'); await p.waitForTimeout(1000);
    const b = await grab('.ctl .bigbtn');
    await p.click('.bigbtn'); await p.waitForTimeout(1300);
    const c = await grab('.pmodal .pzb'), d = await grab('.ctl .pzb');
    await p.click('.pmodal [data-x="resume"]'); await p.waitForTimeout(200);
    const e = await grab('.cdown .cdx');
    const all = [...a, ...b, ...c, ...e];
    const ok = all.map(x => x.t).join('|') === 'START|STOP|WEITER|STEIGUNG AUF 0|BEENDEN|ABBRECHEN' && all.every(x => x.t === x.t.toUpperCase() && x.ls >= 0.05 && x.ls <= 0.1) &&
      c.map(x => x.t).join() === d.map(x => x.t).join() && tabs.length === 0;
    await p.goto(BASE + '?demo=1&frozen=1#/plans'); await p.waitForTimeout(800);
    const tb = await p.evaluate(() => Array.from(document.querySelectorAll('.tabs .tab')).map(e => e.textContent.trim()));
    const ok2 = tb.join('|') === 'Start|Training|Pläne|Apps|Verlauf';
    return { ok: ok && ok2, d: all.map(x => `${x.t} ${x.ls.toFixed(2)} em`).join(', ') + `; Reiter [${tb.join(', ')}]` };
  });
  await flow('App steuert (FTMS): Chip «Kinomap steuert» im Laufkopf, Tipp gibt die Steuerung an die Konsole zurück (appRelease)', async p => {
    const cmds = [];
    await p.addInitScript(() => { window.TreadNative = { token: () => 't', installed: () => '[]', launch: () => true, setPref: () => {} }; });
    await p.route('**/api/state**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, st: 'LAEUFT', err: '', note: '', speed: 10, incline: 2, tSpeed: 10, tIncl: 2, hr: 140, hrOk: true, pulled: 0, safe: 1, elapsed: 600, dist: 1.6, kcal: 120, elev: 10, src: 'app', app: 'Kinomap', appCtl: true, prog: null }) }));
    await p.route('**/api/cmd', r => { try { cmds.push(JSON.parse(r.request().postData() || '{}').c); } catch (e) {} r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
    await p.goto(BASE + '#/run'); await p.waitForTimeout(1500);
    const c = await p.evaluate(() => { const b = document.querySelector('.appchip'); if (!b) return null; const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), al: b.getAttribute('aria-label'), h: r.height }; });
    if (c) { await p.click('.appchip'); await p.waitForTimeout(400); }
    const ok = !!c && c.t === 'Kinomap steuert' && c.al === 'Steuerung durch Kinomap beenden' && c.h >= 48 && cmds.includes('appRelease');
    return { ok, d: c ? `Chip «${c.t}» (${c.al}), Höhe ${c.h}; Befehle [${cmds.join(', ')}]` : 'kein Chip' };
  });
  await flow('Profil und Bildschirm: Gewicht vorhanden, Bildschirmschoner-Minuten und Standby der Konsole (10/15/30 min, Aus) einstellbar, Dialog passt auf den Bildschirm', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/'); await p.waitForTimeout(900);
    await p.click('[data-g="profile"]'); await p.waitForTimeout(400);
    const a = await p.evaluate(() => { const d = document.querySelector('.pdlg'), r = d.getBoundingClientRect();
      return { fit: r.top >= 0 && r.bottom <= innerHeight, kg: !!d.querySelector('[data-k="kg"]'), sv: d.querySelector('[data-k="sv"]').textContent,
        erp: Array.from(d.querySelectorAll('[data-erp]')).map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join(',') }; });
    await p.click('[data-sv="1"]'); await p.click('[data-erp="0"]'); await p.click('[data-x="ok"]'); await p.waitForTimeout(300);
    const b = await p.evaluate(() => ({ min: window.TX.prefs().saverMin, cmd: window.__txCmdLog.filter(x => x.c === 'standby').map(x => JSON.stringify(x)).join(), erp: window.TX.api.state.erp }));
    const ok = a.fit && a.kg && a.sv === '5 min' && a.erp === '10 min*,15 min,30 min,Aus' && b.min === 10 && /"i":0/.test(b.cmd) && b.erp === 0;
    return { ok, d: `passt ${a.fit}, Gewicht ${a.kg}, Bildschirmschoner «${a.sv}», Standby [${a.erp}]; gespeichert ${b.min} min, Befehl ${b.cmd}, Zustand ${b.erp}` };
  });
  await flow('Gesperrter Schalter «Apps dürfen Tempo und Steigung steuern»: grau, Schloss, Grund «zuerst Daten an Apps einschalten», nimmt nichts an', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/apps'); await p.waitForTimeout(900);
    const r = () => p.evaluate(() => { const b = document.querySelector('[data-f="ctl"]'), lk = b.querySelector('svg'), ref = document.createElement('div'); ref.innerHTML = window.TX.I('lock');
      const tg = b.querySelector('.tg'), on = document.querySelector('[data-f="on"]');
      return { dis: b.disabled, ad: b.getAttribute('aria-disabled'), ch: b.getAttribute('aria-checked'), sm: b.querySelector('small').textContent, lock: !!lk && lk.outerHTML === ref.firstChild.outerHTML, off: tg.classList.contains('off'),
        col: getComputedStyle(b).color, norm: getComputedStyle(on).color, tgbg: getComputedStyle(tg).backgroundColor, calls: (window.__txFtmsLog || []).length }; });
    const a = await r();
    await p.evaluate(() => { const b = document.querySelector('[data-f="ctl"]'); b.click(); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await p.click('[data-f="ctl"]', { force: true }); await p.waitForTimeout(200);
    const b = await r();
    const ok = a.dis && a.ad === 'true' && a.ch === 'false' && a.sm === 'zuerst «Daten an Apps und Uhren» einschalten' && a.lock && a.off && a.col !== a.norm && a.col === 'rgb(164, 169, 187)' && a.tgbg !== 'rgb(47, 210, 122)' &&
      b.ch === 'false' && b.off && b.calls === 0;
    return { ok, d: `gesperrt ${a.dis} (aria ${a.ad}), Schloss ${a.lock}, «${a.sm}», Farbe ${a.col}; nach Tippen ${b.ch}, Befehle ${b.calls}` };
  });
  await flow('Startseite: ohne Verlauf «Schnellstart» statt «Letzten Lauf wiederholen», mit Verlauf Wiederholen aktiv', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&leer=1#/'); await p.waitForTimeout(900);
    const a = await p.evaluate(() => Array.from(document.querySelectorAll('.hero [data-k="acts"] > *')).map(e => ({ t: e.textContent.trim(), h: e.getAttribute('href'), dis: !!e.disabled, v: e.getAttribute('data-v') })));
    await p.click('.hero [data-v="quick"]'); await p.waitForTimeout(500);
    const h = await p.evaluate(() => location.hash), l = await log(p);
    await p.evaluate(() => localStorage.clear()); await p.goto(BASE + '?demo=1&frozen=1#/'); await p.waitForTimeout(900);
    const b = await p.evaluate(() => Array.from(document.querySelectorAll('.hero [data-k="acts"] > *')).map(e => ({ t: e.textContent.trim(), dis: !!e.disabled })));
    const ok = a.length === 2 && a[1].t === 'Schnellstart' && a[1].h === '#/run' && !a.some(x => x.v === 'repeat' || x.dis && x.t !== 'Plan starten') && h === '#/run' && !l.includes('start') && !l.includes('arm') &&
      b.length === 2 && b[1].t === 'Letzten Lauf wiederholen' && !b[1].dis;
    return { ok, d: `leer [${a.map(x => x.t).join(', ')}] → ${h}, Befehle [${l}]; mit Verlauf [${b.map(x => x.t + (x.dis ? ' (gesperrt)' : '')).join(', ')}]` };
  });
  await flow('Echte App-Symbole: TreadNative.icon ersetzt Platzhalter auf Startseite, App-Hub und Vorschau, gerundet; ohne icon bleiben die Platzhalter', async p => {
    await p.addInitScript(iconBridge, ICONS);
    await p.goto(BASE + '?demo=1&frozen=1#/'); await p.waitForTimeout(900);
    const pick = () => p.evaluate(sel => Array.from(document.querySelectorAll(sel)).map(e => { const im = e.querySelector('img'), cs = getComputedStyle(e);
      return { real: e.classList.contains('real'), img: !!im && /^data:image\/png;base64,/.test(im.src) && im.naturalWidth === 144, alt: im ? im.getAttribute('alt') : null, svg: !!e.querySelector('svg'), r: parseFloat(cs.borderTopLeftRadius), ov: cs.overflow, w: e.getBoundingClientRect().width,
        iw: im ? im.getBoundingClientRect().width : 0 }; }), '.app .lg, .ap .lg, .phlg');
    const a = await pick(), calls = await p.evaluate(() => window.__calls.filter(c => c.startsWith('icon:')).length);
    await go(p, '#/apps'); await p.waitForTimeout(300);
    const b = await pick(), calls2 = await p.evaluate(() => window.__calls.filter(c => c.startsWith('icon:')).length);
    const ctx2 = await browser.newContext(ctxOpts), p2 = await ctx2.newPage();
    await p2.goto(BASE + '?demo=1&frozen=1#/apps'); await p2.waitForTimeout(900);
    const c = await p2.evaluate(() => ({ real: document.querySelectorAll('.real').length, img: document.querySelectorAll('.lg img, .phlg img').length, ph: Array.from(document.querySelectorAll('.ap .lg')).every(e => !!e.querySelector('svg') && e.style.background) }));
    await ctx2.close();
    const good = x => x.real && x.img && x.alt === '' && !x.svg && x.r >= 12 && x.ov === 'hidden' && Math.abs(x.iw - x.w) < 1;
    const ok = a.length === 6 && a.every(good) && b.length === 6 && b.every(good) && calls === 6 && calls2 === 6 && c.real === 0 && c.img === 0 && c.ph;
    return { ok, d: `Start ${a.filter(good).length}/${a.length}, App-Hub ${b.filter(good).length}/${b.length} (Ecken ${[...new Set(b.map(x => x.r))].join('/')} px), Abfragen je Paket einmal ${calls}/${calls2}; Demo ohne icon: Platzhalter ${c.ph}, Bilder ${c.img}` };
  });
  await flow('Leerer Verlauf: Wochenraster 4 Wochen (Mo bis So, heute markiert) mit Hinweis «Noch keine Läufe. Starte mit Schnellstart oder einem Plan.» und Knopf, keine leere Fläche', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&leer=1#/history'); await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.hcg .hcr:not(.hch)')), hd = Array.from(document.querySelectorAll('.hcg .hch span')).map(e => e.textContent).filter(Boolean);
      const cells = rows.map(rw => rw.querySelectorAll('.hcd').length), now = document.querySelectorAll('.hcd.now'), d = new Date();
      const mon = rows[0].querySelector('.hcd b').textContent, cal = document.querySelector('.hcal').getBoundingClientRect(), hint = document.querySelector('.hcm');
      const btn = hint.querySelector('.btn.go'), body = document.querySelector('main').getBoundingClientRect();
      return { hd: hd.join(','), cells: cells.join(','), now: now.length, nowTxt: now[0] ? now[0].querySelector('b').textContent : '', today: String(d.getDate()), mon, monWant: (() => { const w = new Date(window.TX.weekStart(Date.now())); w.setDate(w.getDate() - 21); return String(w.getDate()); })(),
        p: hint.querySelector('p').textContent, bt: btn.textContent.trim(), bh: btn.getAttribute('href'), fill: (cal.bottom - body.top) / (innerHeight - body.top), chart: !!document.querySelector('.hbars'), list: !!document.querySelector('.hlist'), old: !!document.querySelector('.hempty') };
    });
    await p.click('.hcm .btn.go'); await p.waitForTimeout(400);
    const h = await p.evaluate(() => location.hash);
    const ok = r.hd === 'Mo,Di,Mi,Do,Fr,Sa,So' && r.cells === '7,7,7,7' && r.now === 1 && r.nowTxt === r.today && r.mon === r.monWant && r.p === 'Noch keine Läufe. Starte mit Schnellstart oder einem Plan.' &&
      r.bt === 'Schnellstart' && r.bh === '#/run' && r.fill > 0.95 && !r.chart && !r.list && !r.old && h === '#/run';
    return { ok, d: `Kopf [${r.hd}], Zellen [${r.cells}], heute «${r.nowTxt}», erster Montag ${r.mon}; «${r.p}» Knopf «${r.bt}» → ${h}; Höhe bis ${Math.round(r.fill * 100)} %, leere Balkenfläche ${r.chart}` };
  });
  await flow('Nach Unterbrechung (note «Nach Unterbrechung…»): «Weiter mit 3.0 km/h (Gehtempo)», Countdown-Ziel state.tSpeed, normale Pause ohne Hinweis', async p => {
    await p.goto(BASE + '?demo=1&szenario=pause#/run'); await p.waitForTimeout(1000);
    const n = await p.evaluate(() => ({ pw: document.querySelector('.pmodal [data-k="pw"]').hidden, rsc: document.querySelector('.pmodal [data-k="rsc"]').textContent, h: document.querySelector('.pmodal [data-x="resume"]').getBoundingClientRect().height }));
    await p.goto(BASE + '?demo=1&szenario=nachfehler#/run'); await p.waitForTimeout(1000);
    const a = await p.evaluate(() => {
      const d = document.querySelector('.pmodal'), pw = d.querySelector('[data-k="pw"]'), rb = d.querySelector('[data-x="resume"]');
      return { vis: !pw.hidden && pw.getClientRects().length > 0, t: d.querySelector('[data-k="pwt"]').textContent, n: d.querySelector('[data-k="pwn"]').textContent, rsc: rb.querySelector('[data-k="rsc"]').textContent,
        bar: document.querySelector('.ctl [data-k="rsc"]').textContent, r1: rb.querySelector('.r1').textContent.trim(), note: d.querySelector('[data-k="pn"]').textContent, st: window.TX.api.state.tSpeed,
        fit: d.querySelector('.dlg').getBoundingClientRect().bottom <= d.querySelector('.pzrow').getBoundingClientRect().top - 8 && d.querySelector('.dlg').getBoundingClientRect().top >= 40 };
    });
    await p.click('.pmodal [data-x="resume"]'); await p.waitForTimeout(300);
    const c = await p.evaluate(() => ({ lab: document.querySelector('.cdown .cdt .lab').textContent, tgt: document.querySelector('.cdown .cdt .num').textContent.replace(/\s+/g, ' ').trim() }));
    await p.waitForTimeout(3300);
    const s = await st(p), l = await log(p);
    const ok = n.pw && n.rsc === '' && n.h === 76 && a.vis && a.t === 'Weiter mit 3.0 km/h (Gehtempo)' && /^Nach Unterbrechung/.test(a.n) && a.rsc === 'mit 3.0 km/h · Gehtempo' && a.bar === a.rsc && a.r1 === 'WEITER' &&
      /sanft auf 3\.0 km\/h/.test(a.note) && a.st === 3 && a.fit && c.lab === 'Ziel · Gehtempo nach Unterbrechung' && c.tgt === '3.0 km/h · 4.0 %' && s.st === 'LAEUFT' && s.tSpeed === 1 && s.hold > 0 && s.holdTo === 3 && /^Einlaufen/.test(s.note) && l.filter(x => x === 'resume').length === 1;
    return { ok, d: `normal: Hinweis aus ${n.pw}, WEITER einzeilig; nachfehler: «${a.t}» / «${a.n.slice(0, 40)}…», WEITER «${a.r1}» + «${a.rsc}» (Leiste gleich ${a.bar === a.rsc}); Countdown «${c.lab}» «${c.tgt}»; danach ${s.st} Soll ${s.tSpeed}` };
  });
  await flow('Abschluss: Kilometerliste mit Ausblendverlauf, solange nicht alle Zeilen sichtbar sind', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/summary'); await p.waitForTimeout(1000);
    const a = await p.evaluate(() => {
      const w = document.querySelector('[data-k="spw"]'), l = w.querySelector('.splist'), af = getComputedStyle(w, '::after');
      const r = { n: l.querySelectorAll('.sp').length, scr: l.scrollHeight > l.clientHeight + 2, more: w.classList.contains('more'), less: w.classList.contains('less'), op: af.opacity, bg: af.backgroundImage };
      l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll'));
      r.more2 = w.classList.contains('more'); r.less2 = w.classList.contains('less');
      return r;
    });
    // kurzer Lauf mit zwei Kilometern: alles sichtbar, kein Verlauf
    await p.evaluate(() => { const r = window.TX.runs()[0], h = []; for (let t = 0; t <= 700; t += 10) h.push([t, 11, 1, 140]); window.TX.saveRun({ id: 'kurz2', ts: Date.now(), name: 'Freies Laufen', type: 'frei', elapsed: 700, dist: 2.1, kcal: 150, elev: 0, avgHr: 140, maxHr: 145, hist: h }); location.hash = '#/summary/kurz2'; });
    await p.waitForTimeout(600);
    const b = await p.evaluate(() => { const w = document.querySelector('[data-k="spw"]'), l = w.querySelector('.splist'); return { n: l.querySelectorAll('.sp').length, scr: l.scrollHeight > l.clientHeight + 2, more: w.classList.contains('more') }; });
    const ok = a.scr && a.more && !a.less && a.op === '1' && /gradient/.test(a.bg) && !a.more2 && a.less2 && !b.scr && !b.more && b.n === 2;
    return { ok, d: `${a.n} km, scrollbar ${a.scr}: unten Verlauf ${a.more} (Deckkraft ${a.op}), nach Scrollen unten ${a.more2} oben ${a.less2}; ${b.n} km ohne Scrollen: Verlauf ${b.more}` };
  });
  await flow('Echter Dienst: Befehle mit X-Token per POST /api/cmd, START als arm und nach ≥ 2.5 s start', async p => {
    const seen = [];
    await p.addInitScript(() => { window.TreadNative = { token: () => 'abc123', installed: () => '[]', launch: () => true }; });
    await p.route('**/api/state**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, st: 'BEREIT', err: '', speed: 0, incline: 0, tSpeed: 8, tIncl: 0, hr: 0, hrOk: false, pulled: 0, safe: 1, elapsed: 0, dist: 0, kcal: 0, elev: 0, src: 'ui', prog: null, hist: [] }) }));
    await p.route('**/api/cmd', r => { if (JSON.parse(r.request().postData() || '{}').c !== 'profile') seen.push({ m: r.request().method(), t: r.request().headers()['x-token'], b: r.request().postData(), at: Date.now() }); r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
    await p.goto(BASE + '#/run'); await p.waitForTimeout(1200);
    await p.click('.side.l [data-v="3"]'); await p.click('.bigbtn'); await p.waitForTimeout(3500);
    const cs = seen.map(x => JSON.parse(x.b).c), dt = seen.length === 3 ? seen[2].at - seen[1].at : -1;
    return { ok: cs.join() === 'incline,arm,start' && seen.every(x => x.m === 'POST' && x.t === 'abc123') && dt >= 2500, d: seen.map(x => x.b).join(' ') + `, start ${dt} ms nach arm` };
  });
  /* ================= Runde 11: Geisterklick, Einlaufen, Geraetetasten, Profil, Geraete ================= */
  await flow('Geisterklick: Tipp auf «Starten» in den Plänen, danach ein Klick ohne eigenes Aufsetzen auf Schnellwahl/Plus der neuen Seite erzeugt keinen speed/incline/step; echter Tipp wirkt', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/plans'); await p.waitForTimeout(900);
    await p.click('.tpl[data-id="p-schwelle"]'); await p.waitForTimeout(300);
    const sb = await p.$eval('.det [data-v="start"]', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.evaluate(() => { window.__txCmdLog.length = 0; });
    await p.touchscreen.tap(sb.x, sb.y); await p.waitForTimeout(150);
    const h = await p.evaluate(() => location.hash);
    // Geisterklick: Klickereignis ohne vorheriges Aufsetzen auf Schnellwahl, Plus, relative Steigung und Startkarte
    const g = await p.evaluate(() => { const hit = []; ['.side.r .qs button:last-child', '.side.l .qs button:last-child', '.adj.spd [data-d="0.5"]', '.adj.inc [data-d="0.5"]'].forEach(sel => {
      const b = document.querySelector(sel); if (!b) return; hit.push(sel); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); }); return hit.length; });
    await p.waitForTimeout(500);
    const l1 = (await log(p)).filter(c => /speed|incline|step/.test(c));
    await p.waitForTimeout(400);
    const chip = await p.$eval('.side.r .qs button:last-child', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, v: e.getAttribute('data-v') }; });
    await p.touchscreen.tap(chip.x, chip.y); await p.waitForTimeout(400);
    const l2 = await log(p), s = await st(p);
    const ok = h === '#/interval/p-schwelle' && g === 4 && l1.length === 0 && l2.includes('speed') && Math.abs(s.tSpeed - +chip.v) < 0.01;
    return { ok, d: `nach «Starten» ${h}; ${g} Geisterklicks: Befehle [${l1}]; echter Tipp auf ${chip.v}: [${[...new Set(l2)]}] Soll ${s.tSpeed}` };
  });
  await flow('Einlaufen: Start mit 1.0 km/h für 15 s, Hinweis «Einlaufen · 1.0 km/h · noch N s, dann X km/h», letzte 10 s orange mit Tönen 3, 2, 1, Programm-Soll «geplant»; Countdown nennt den Anlauf; Schnellstart mit 1.0 vorbelegt', async p => {
    await p.goto(BASE + '?demo=1#/run'); await p.waitForTimeout(1200);
    const q = await p.evaluate(() => ({ sv: document.querySelector('[data-k="sv"]').textContent, t: window.TX.api.state.tSpeed }));
    await p.goto(BASE + '?demo=1#/interval/p-schwelle'); await p.waitForTimeout(1500);
    await p.click('.bigbtn'); await p.waitForTimeout(400);
    const cdh = await p.textContent('.cdown .cdh');
    await p.waitForTimeout(3400);
    const a = await p.evaluate(() => { const s = window.TX.api.state, hb = document.getElementById('holdbar'); return { st: s.st, ts: s.tSpeed, hold: s.hold, to: s.holdTo, hb: hb.hidden ? '' : hb.textContent, soon: hb.classList.contains('d-up'), tsp: document.querySelector('[data-k="tsp"]').textContent, sv: document.querySelector('[data-k="ts"]').textContent }; });
    await p.evaluate(() => { window.__beeps = 0; const o = window.TX.beep; window.TX.beep = function (hz) { window.__beeps++; return o(hz); }; window.TX.sim.hold = 9.5; });
    await p.waitForTimeout(1300);
    const b = await p.evaluate(() => { const hb = document.getElementById('holdbar'); return { hb: hb.textContent, soon: hb.classList.contains('d-up'), bg: getComputedStyle(hb).backgroundColor }; });
    await p.waitForTimeout(9500);
    const c = await p.evaluate(() => ({ n: window.__beeps, ts: window.TX.api.state.tSpeed, hold: window.TX.api.state.hold, hidden: document.getElementById('holdbar').hidden }));
    const ok = q.sv === '1.0' && q.t === 1 && cdh === 'Start mit 1.0 km/h, nach 15 s 8.0 km/h' && a.st === 'LAEUFT' && a.ts === 1 && a.hold > 10 && a.to === 8 && /^Einlaufen · 1\.0 km\/h · noch \d+ s, dann 8\.0 km\/h$/.test(a.hb.trim()) && !a.soon &&
      a.tsp === 'geplant 8.0 km/h' && a.sv === '1.0' && b.soon && /^0:0\dTempo steigt auf 8\.0 km\/hEinlaufen mit 1\.0 km\/h endet$/.test(b.hb) && c.n === 3 && c.ts >= 4 && !c.hold && c.hidden;
    return { ok, d: `Schnellstart ${q.sv}; Countdown «${cdh}»; im Lauf Band ${a.ts}, «${a.hb.trim()}», Programm «${a.tsp}»; letzte 10 s «${b.hb.trim()}» ${b.bg}; Töne ${c.n}, danach ${c.ts} km/h, Hinweis weg ${c.hidden}` };
  });
  await flow('Gerätetasten: START-Taste zeigt den Vollbild-Countdown des Dienstes (state.cd) ohne eigenes arm/start; ABBRECHEN sendet stop; Drehregler-Werte (src taste) werden übernommen', async p => {
    await p.goto(BASE + '?demo=1#/run'); await p.waitForTimeout(1200);
    await p.evaluate(() => { window.__txCmdLog.length = 0; window.TX.sim.hwKey('go'); }); await p.waitForTimeout(700);
    const a = await p.evaluate(() => { const d = document.querySelector('.cdown'); return d ? { cls: d.className, cn: d.querySelector('[data-k="cn"]').textContent, lab: d.querySelector('.cdt .lab').textContent, cd: window.TX.api.state.cd } : null; });
    await p.waitForTimeout(3200);
    const b = await p.evaluate(() => ({ st: window.TX.api.state.st, open: !!document.querySelector('.cdown') })), l1 = await log(p);
    await p.evaluate(() => { window.TX.sim.hwKey('go'); }); await p.waitForTimeout(700);
    await p.evaluate(() => { window.TX.sim.hwKey('go'); }); await p.waitForTimeout(700);
    const open2 = await p.isVisible('.cdown.cd-hw'); await p.click('.cdown [data-c="cancel"]'); await p.waitForTimeout(3500);
    const c = await p.evaluate(() => ({ st: window.TX.api.state.st, cd: window.TX.api.state.cd, open: !!document.querySelector('.cdown') })), l2 = await log(p);
    await p.evaluate(() => { const S = window.TX.sim; S.hwKey('su'); S.hwKey('su'); S.hwKey('iu'); }); await p.waitForTimeout(700);
    const d = await p.evaluate(() => ({ sv: document.querySelector('[data-k="sv"]').textContent, iv: document.querySelector('[data-k="iv"]').textContent, src: window.TX.api.state.src, ts: window.TX.api.state.tSpeed }));
    const ok = a && /cd-hw/.test(a.cls) && +a.cn >= 2 && a.cd >= 2 && a.lab === 'Gestartet mit der Taste am Gerät' && b.st === 'LAEUFT' && !b.open && !l1.includes('arm') && !l1.includes('start') &&
      open2 && c.st === 'PAUSE' && !c.cd && !c.open && l2.join() === 'stop' && d.src === 'taste' && d.sv === d.ts.toFixed(1) && d.iv === '0.5';
    return { ok, d: `Taste: Countdown «${a && a.cn}» (cd ${a && a.cd}) «${a && a.lab}», danach ${b.st}, Befehle der Oberfläche [${l1}]; zweiter Anlauf abgebrochen: [${l2}] ${c.st}; Drehregler: Tempo ${d.sv}, Steigung ${d.iv}, src ${d.src}` };
  });
  await flow('Profil: Gewicht (35 bis 200 kg, Standard 75) neben HFmax, «für die Kalorienberechnung», Speichern sendet profile an den Dienst, beim Laden einmal gesendet; Link zu den Geräten', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/'); await p.waitForTimeout(2500);
    const l0 = await p.evaluate(() => window.__txCmdLog.filter(x => x.c === 'profile').map(x => x.b.weight + '/' + x.b.hfmax));
    await p.click('.avatar'); await p.waitForTimeout(300);
    const a = await p.evaluate(() => ({ kg: document.querySelector('[data-k="kg"]').textContent, t: document.querySelector('.pkg').textContent, dev: document.querySelector('.pdlg a[href="#/geraete"]') ? 1 : 0 }));
    await p.click('[data-w="1"]'); await p.click('[data-w="1"]'); await p.waitForTimeout(150); await p.click('[data-x="ok"]'); await p.waitForTimeout(600);
    const b = await p.evaluate(() => ({ cmd: window.__txCmdLog.filter(x => x.c === 'profile').map(x => x.b.weight + '/' + x.b.hfmax).pop(), store: JSON.parse(localStorage.getItem('tx.profile.v1')).kg, w: window.TX.api.state.weight }));
    const ok = l0.length === 1 && l0[0] === '75/184' && a.kg === '75' && /für die Kalorienberechnung/.test(a.t) && a.dev && b.cmd === '77/184' && b.store === 77 && b.w === 77;
    return { ok, d: `beim Laden [${l0}]; Dialog ${a.kg} kg «${a.t}», Link Geräte ${a.dev}; nach +2: profile ${b.cmd}, gespeichert ${b.store}, Dienst ${b.w} kg` };
  });
  await flow('Geräte: Pulsmesser suchen, «HRM 600» verbinden, Live-Puls und Quelle Bluetooth, entfernen; Lautsprecher öffnet die Bluetooth-Einstellungen; erreichbar über Apps und Profil', async p => {
    await p.addInitScript(() => { window.__bt = 0; window.TreadNative = { token: () => 't', installed: () => '[]', launch: () => true, setPref: () => {}, openBluetooth: () => { window.__bt++; return true; } }; });
    await p.goto(BASE + '?demo=1#/apps'); await p.waitForTimeout(900);
    await p.click('.devlink'); await p.waitForTimeout(800);
    const h = await p.evaluate(() => location.hash), a = await p.textContent('[data-k="hrbox"]');
    await p.click('[data-v="scan"]'); await p.waitForTimeout(3600);
    const f = await p.$$eval('.frow2 b', e => e.map(x => x.textContent));
    await p.click('.frow2 [data-con]'); await p.waitForTimeout(2600);
    const b = await p.evaluate(() => ({ box: document.querySelector('[data-k="hrbox"]').textContent, hr: +document.querySelector('.hrv .num').textContent, src: window.TX.api.state.hrSrc, chip: (document.querySelector('.hrchip') || {}).textContent || '' }));
    await p.click('[data-v="bt"]'); await p.waitForTimeout(200);
    const bt = await p.evaluate(() => window.__bt), aud = await p.evaluate(() => Array.from(document.querySelectorAll('.audr')).map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    await p.click('[data-v="forget"]'); await p.waitForTimeout(1500);
    const c = await p.textContent('[data-k="hrbox"]');
    const ok = h === '#/geraete' && /Kein Pulsmesser/.test(a) && f[0] === 'HRM 600' && /Verbunden/.test(b.box) && /HRM 600/.test(b.box) && b.hr >= 120 && b.hr <= 135 && b.src === 'bluetooth' && /Bluetooth/.test(b.chip) && bt === 1 && /Kein Pulsmesser/.test(c) && aud.length === 1 && /^Wohnzimmer ?Sonos Roam · verbunden/.test(aud[0].trim());
    return { ok, d: `${h}: «${a.trim()}»; gefunden [${f}]; verbunden «${b.box.replace(/\s+/g, ' ').trim()}» ${b.hr} bpm, Quelle ${b.src}, Kopf «${b.chip.trim()}»; Lautsprecher [${aud}], openBluetooth ${bt}×; entfernt «${c.trim()}»` };
  });
  await flow('Pulsmenü am Pulschip: Status, Suchen mit Liste, Verbinden schliesst, Trennen, Hinweis Forerunner, «Alle Geräte»; Tipp ausserhalb schliesst ohne Wirkung darunter; 20 s ohne Eingabe schliesst; Steuerleiste bleibt frei', async p => {
    await p.goto(BASE + '?demo=1#/'); await p.waitForTimeout(1200);
    const chip0 = await p.textContent('[data-g="hrmenu"]');
    await p.click('[data-g="hrmenu"]'); await p.waitForTimeout(800);
    const a = await p.evaluate(() => { const m = document.querySelector('.hrmenu'), r = m.getBoundingClientRect(), c = document.querySelector('[data-g="hrmenu"]').getBoundingClientRect();
      return { st: m.querySelector('.hmst').textContent, hint: m.querySelector('.hmhint').textContent, all: m.querySelector('.hmall').getAttribute('href'), below: r.top >= c.bottom, bottom: r.bottom, h: innerHeight, hash: location.hash }; });
    await p.click('.hrmenu [data-hm="scan"]'); await p.waitForTimeout(3300);
    const f = await p.$$eval('.hrmenu .hmrow b', e => e.map(x => x.textContent));
    await p.click('.hrmenu [data-hm="con"]'); await p.waitForTimeout(2600);
    const b = await p.evaluate(() => ({ open: !!document.querySelector('.hrmenu'), chip: document.querySelector('[data-g="hrmenu"]').textContent.replace(/\s+/g, ' ').trim(), src: window.TX.api.state.hrSrc }));
    await p.click('[data-g="hrmenu"]'); await p.waitForTimeout(800);
    const tr = await p.isVisible('.hrmenu [data-hm="forget"]');
    // Tipp ausserhalb (auf die Kachel Schnellstart): Menue zu, keine Navigation
    // Punkt auf einer Kachel ausserhalb des Menues (das Menue sitzt unter dem Pulschip)
    const card = await p.evaluate(() => { const m = document.querySelector('.hrmenu').getBoundingClientRect();
      for (const e of document.querySelectorAll('a.mode, a.card')) { const r = e.getBoundingClientRect(), x = r.x + 30, y = r.bottom - 30;
        if (r.width && (x < m.left || x > m.right || y < m.top || y > m.bottom) && document.elementFromPoint(x, y) && e.contains(document.elementFromPoint(x, y))) return { x, y }; }
      return { x: 40, y: 600 }; });
    await p.touchscreen.tap(card.x, card.y); await p.waitForTimeout(500);
    const c = await p.evaluate(() => ({ open: !!document.querySelector('.hrmenu'), hash: location.hash }));
    await p.click('[data-g="hrmenu"]'); await p.waitForTimeout(20800);
    const d = await p.evaluate(() => !!document.querySelector('.hrmenu'));
    const ok = /Kein Pulsmesser verbunden/.test(a.st) && /Herzfrequenz übertragen/.test(a.hint) && a.all === '#/geraete' && a.below && a.bottom <= a.h - 112 && f[0] === 'HRM 600' && !b.open && /^Bluetooth ?\d+ bpm$/.test(b.chip) && b.src === 'bluetooth' &&
      tr && !c.open && c.hash === '#/' && !d;
    return { ok, d: `Chip «${chip0.trim()}»; Menü «${a.st.replace(/\s+/g, ' ').trim()}», unten bei ${Math.round(a.bottom)} von ${a.h} px; gefunden [${f}]; nach Verbinden offen ${b.open}, Chip «${b.chip}»; Trennen ${tr}; Tipp ausserhalb: offen ${c.open}, ${c.hash} (Tipp bei ${Math.round(card.x)}/${Math.round(card.y)}); nach 20 s offen ${d}` };
  });
  await flow('Zurück verlässt die Oberfläche nie: Pfeil auf der Startseite ausgeblendet (Platz bleibt), sonst eine Ebene höher bzw. #/; Zurücktaste gleich, nie history.back oder TreadNative.leave', async p => {
    await p.addInitScript(() => { window.__left = 0; window.TreadNative = { token: () => 't', installed: () => '[]', launch: () => true, setPref: () => {}, leave: () => { window.__left++; } }; });
    // fremde Seite davor im Verlauf: history.back wuerde dorthin fuehren
    await p.goto(BASE + 'img/apps/youtube.jpg'); await p.goto(BASE + '?demo=1#/apps'); await p.waitForTimeout(900);
    const out = [];
    const tap = async () => { await p.click('.hback'); await p.waitForTimeout(400); out.push(await p.evaluate(() => location.hash || location.pathname)); };
    await tap();                                                     // Apps > Start
    const home = await p.evaluate(() => { const b = document.querySelector('.hback'), r = b.getBoundingClientRect(), br = document.querySelector('.brand').getBoundingClientRect(); return { vis: getComputedStyle(b).visibility, w: r.width, brand: Math.round(br.left) }; });
    await p.evaluate(() => { window.onNativeBack(); }); await p.waitForTimeout(400); out.push(await p.evaluate(() => location.hash || location.pathname));
    await p.evaluate(() => { location.hash = '#/geraete'; }); await p.waitForTimeout(500); await tap();          // Geraete > Apps
    await p.evaluate(() => { location.hash = '#/strecke/homberg-runde'; }); await p.waitForTimeout(1500); await p.click('[data-v="back"]'); await p.waitForTimeout(400); out.push(await p.evaluate(() => location.hash));   // Strecke > Strecken
    await p.evaluate(() => { location.hash = '#/plans/edit/p-rigi'; }); await p.waitForTimeout(500); await p.evaluate(() => window.onNativeBack()); await p.waitForTimeout(400); out.push(await p.evaluate(() => location.hash));
    await p.evaluate(() => window.onNativeBack()); await p.waitForTimeout(400); out.push(await p.evaluate(() => location.hash));
    await p.evaluate(() => window.onNativeBack()); await p.waitForTimeout(400); out.push(await p.evaluate(() => location.href.indexOf('?demo=1') > 0 ? location.hash : 'VERLASSEN'));
    const left = await p.evaluate(() => window.__left);
    const ok = out.join() === '#/,#/,#/apps,#/strecken,#/plans,#/,#/' && home.vis === 'hidden' && home.w >= 48 && left === 0;
    return { ok, d: `Weg [${out.join(' > ')}]; Startseite: Pfeil ${home.vis}, Platz ${Math.round(home.w)} px, Marke bei ${home.brand} px; TreadNative.leave ${left}×` };
  });
  await flow('Stufentest HFmax: Vorlage (Typ Test, 10 min 8.0, 17 Stufen 9.0 bis 17.0 je 1 min, 5 min 6.0, Steigung 1 %, Dienstgrenzen), bei alten Listen einmal nachgetragen, gelöscht bleibt gelöscht', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/plans?f=test'); await p.waitForTimeout(1200);
    const TXT = 'Ab Minute 10 steigt das Tempo jede Minute um 0.5 km/h. Laufen bis zur Erschöpfung, dann STOP (Bildschirm oder Taste) und Auslaufen. Nur gesund und ausgeruht, Sicherheitsschlüssel befestigen, Pulsgurt verwenden.';
    const a = await p.evaluate(() => {
      const TX = window.TX, pl = TX.plan('p-hfmax'), pr = TX.toProgram(pl), sg = pr.segs;
      return { n: document.querySelectorAll('.tpl[data-id]').length, chip: document.querySelector('.tpl[data-id] .tp').textContent, fil: document.querySelector('.filters a.on').textContent.trim(),
        desc: document.querySelector('[data-k="det"] .mut').textContent, rows: Array.from(document.querySelectorAll('[data-k="det"] .sg > b')).map(e => e.textContent),
        type: pr.type, segs: sg.length, tot: sg.reduce((x, y) => x + y.d, 0), first: sg[0], last: sg[sg.length - 1], st: sg.slice(1, 18).map(x => x.s).join(','),
        allH: sg.slice(1, 18).every(x => x.d === 60 && x.k === 'h'), inc: sg.every(x => x.i === 1), lim: sg.every(x => x.d >= 5 && x.d <= 7200 && x.s >= 0.8 && x.s <= 20) && sg.length <= 200 };
    });
    // alte gespeicherte Liste ohne die neue Vorlage: einmal nachtragen; danach loeschen und neu laden: bleibt weg
    const b = await p.evaluate(() => { const TX = window.TX; localStorage.setItem('tx.plans.v1', JSON.stringify({ v: 1, plans: TX.defaultPlans().filter(x => x.id !== 'p-hfmax') }));
      const n1 = TX.plans().filter(x => x.id === 'p-hfmax').length; TX.delPlan('p-hfmax'); const n2 = TX.plans().filter(x => x.id === 'p-hfmax').length; return { n1, n2, all: TX.plans().length }; });
    const ok = a.n === 1 && a.chip === 'TEST' && a.fil === 'Test' && a.desc === TXT && a.rows[0] === 'Einlaufen' && a.rows[1] === 'Stufe 1' && a.rows[17] === 'Stufe 17' && a.rows[18] === 'Auslaufen' &&
      a.type === 'interval' && a.segs === 19 && a.tot === 1920 && a.first.d === 600 && a.first.s === 8 && a.last.d === 300 && a.last.s === 6 && a.st === '9,9.5,10,10.5,11,11.5,12,12.5,13,13.5,14,14.5,15,15.5,16,16.5,17' && a.allH && a.inc && a.lim &&
      b.n1 === 1 && b.n2 === 0 && b.all === 6;
    return { ok, d: `${a.n} Kachel «${a.chip}», Filter «${a.fil}», ${a.rows.length} Zeilen [${a.rows[0]}, ${a.rows[1]} … ${a.rows[17]}, ${a.rows[18]}]; Programm ${a.type} ${a.segs} Abschnitte, ${a.tot} s, Stufen ${a.st}, Steigung 1 % ${a.inc}, Grenzen ${a.lim}; Beschreibung ${a.desc === TXT ? 'wörtlich' : '«' + a.desc + '»'}; nachgetragen ${b.n1}, nach Löschen ${b.n2}` };
  });
  await flow('Stufentest HFmax im Lauf: «STUFE 13/17», Max-Puls bisher gross (= höchster Wert seit Start), Pulskurve ausgeblendet, «Stufe 14» als Nächstes; Pause nennt Max-Puls und Auswertung; BEENDEN → Zusammenfassung mit höchstem Puls und «Als HFmax übernehmen (N)» → Profil und {"c":"profile","hfmax","weight"}; Auslaufen lädt 5 min 6.0 km/h', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=stufentest#/interval/p-hfmax'); await p.waitForTimeout(1500);
    const a = await p.evaluate(() => { const TX = window.TX, r = document.querySelector('.v-int'); let mx = 0; TX.api.series().forEach(x => { if (x[3] > mx) mx = x[3]; }); if (TX.api.state.hr > mx) mx = TX.api.state.hr;
      return { ph: r.querySelector('[data-k="ph"]').textContent, hfm: +r.querySelector('[data-k="hfm"]').textContent, mx, vis: !r.querySelector('[data-k="hfx"]').hidden, fs: parseFloat(getComputedStyle(r.querySelector('.hfx .num')).fontSize),
        hrc: getComputedStyle(r.querySelector('[data-k="hrc"]')).display, nt: r.querySelector('[data-k="nt"]').textContent, nb: r.querySelector('.next').getBoundingClientRect().bottom, cb: r.querySelector('.now').getBoundingClientRect().bottom }; });
    await p.goto(BASE + '?demo=1&frozen=1&szenario=stufentest-pause#/interval/p-hfmax'); await p.waitForTimeout(1600);
    const pn = await p.textContent('.pmodal [data-k="pn"]');
    await p.evaluate(() => { window.__txCmdLog.length = 0; });
    await p.click('.pmodal [data-x="end"]'); await p.waitForTimeout(1200);
    const b = await p.evaluate(() => { const r = window.TX.runs()[0], bt = document.querySelector('[data-v="hfset"]');
      return { h: location.hash, max: r.maxHr, plan: r.planId, big: (document.querySelector('[data-k="hfmx"]') || {}).textContent, bt: bt && bt.textContent.trim(), h1: document.querySelector('.sumh h1').textContent }; });
    await p.click('[data-v="hfset"]'); await p.waitForTimeout(500);
    const c = await p.evaluate(() => ({ hf: window.TX.profile().hf, cmd: window.__txCmdLog.filter(x => x.c === 'profile').map(x => x.b), bt: document.querySelector('[data-v="hfset"]').disabled, prof: document.querySelector('[data-k="hfprof"]').textContent }));
    await p.evaluate(() => { window.__txCmdLog.length = 0; });
    await p.click('[data-v="cool"]'); await p.waitForTimeout(700);
    const d = await p.evaluate(() => { const pr = window.__txCmdLog.filter(x => x.c === 'program').map(x => x.b.p)[0]; return { h: location.hash, segs: pr && pr.segs, st: window.TX.api.state.st, start: window.__txCmdLog.some(x => x.c === 'start' || x.c === 'arm') }; });
    const ok = a.ph === 'STUFE 13/17' && a.vis && a.hfm === a.mx && a.hfm > 0 && a.fs >= 50 && a.hrc === 'none' && /^Stufe 14 1:00 · 15\.5 km\/h$/.test(a.nt) && a.nb <= a.cb &&
      /höchster Puls \d+ bpm/.test(pn) && /BEENDEN zeigt die Auswertung/.test(pn) && /«Auslaufen» oben rechts/.test(pn) &&
      b.h.startsWith('#/summary/') && b.plan === 'p-hfmax' && b.max > 0 && b.big.startsWith(String(b.max)) && b.bt === `Als HFmax übernehmen (${b.max})` && b.h1 === 'Test abgeschlossen!' &&
      c.hf === b.max && c.cmd.length === 1 && c.cmd[0].hfmax === b.max && c.cmd[0].weight === 75 && c.bt && c.prof === `HFmax im Profil: ${b.max} bpm` &&
      d.h === '#/interval/aktiv' && d.segs && d.segs.length === 1 && d.segs[0].d === 300 && d.segs[0].s === 6 && d.segs[0].i === 1 && d.st === 'BEREIT' && !d.start;
    return { ok, d: `«${a.ph}», Max-Puls ${a.hfm} (Verlauf ${a.mx}), ${a.fs} px, Kurve ${a.hrc}, als Nächstes «${a.nt}», Karte passt ${a.nb <= a.cb}; Pause «${pn.slice(0, 60)}…»; ${b.h.slice(0, 10)}… «${b.h1}» ${b.max} bpm, Knopf «${b.bt}»; danach Profil ${c.hf}, gesendet ${JSON.stringify(c.cmd)}; Auslaufen ${d.h} ${JSON.stringify(d.segs)} ${d.st}, kein Start ${!d.start}` };
  });
  await flow('Stufentest HFmax ohne Puls und mit unplausiblem Wert: «ohne Pulsmesser nicht auswertbar» ohne Knopf; 142 bpm nur nach Rückfrage (Abbrechen ändert nichts)', async p => {
    await p.addInitScript(hfRunHelper);
    await p.goto(BASE + '?demo=1&frozen=1#/'); await p.waitForTimeout(1000);
    await p.evaluate(() => window.__hfRun(0)); await p.waitForTimeout(700);
    const a = await p.evaluate(() => ({ why: document.querySelector('[data-k="hfwhy"]').textContent, bt: !!document.querySelector('[data-v="hfset"]'), big: document.querySelector('[data-k="hfmx"]').textContent }));
    await p.evaluate(() => window.__hfRun(142)); await p.waitForTimeout(700);
    const hf0 = await p.evaluate(() => window.TX.profile().hf);
    await p.click('[data-v="hfset"]'); await p.waitForTimeout(300);
    const q = await p.textContent('.modal h2');
    await p.click('.modal [data-c="no"]'); await p.waitForTimeout(300);
    const hf1 = await p.evaluate(() => window.TX.profile().hf);
    await p.click('[data-v="hfset"]'); await p.waitForTimeout(300); await p.click('.modal [data-c="ok"]'); await p.waitForTimeout(400);
    const hf2 = await p.evaluate(() => window.TX.profile().hf);
    const ok = /ohne Pulsmesser nicht auswertbar/.test(a.why) && !a.bt && /^--/.test(a.big) && q === '142 bpm als HFmax?' && hf1 === hf0 && hf2 === 142;
    return { ok, d: `ohne Puls «${a.why}», Knopf ${a.bt}, Wert «${a.big}»; 142: Rückfrage «${q}», Abbrechen ${hf0} → ${hf1}, Übernehmen → ${hf2}` };
  });
  await flow('Ventilator auf der Geräteseite: Karte mit Name und Status, AUTO | AUS | 25 | 50 | 75 | 100 (AUTO blau), Stufe in %, keine Hilfekästen; Stufenwahl, Trennen, Suchen; Kopf mit Laufchip passt', async p => {
    await p.goto(BASE + '?demo=1&szenario=lauf#/geraete'); await p.waitForTimeout(1500);
    const a = await p.evaluate(() => { const c = document.querySelector('section[aria-label="Ventilator"]'), on = c.querySelector('.fanseg .on'), av = document.querySelector('.head .avatar').getBoundingClientRect();
      return { st: c.querySelector('[data-k="fanbox"] .lab').textContent, nm: c.querySelector('[data-k="fanbox"] b').textContent, seg: Array.from(c.querySelectorAll('.fanseg button')).map(b => b.textContent).join('|'),
        on: on && on.textContent, bg: on && getComputedStyle(on).backgroundColor, lv: c.querySelector('.fanlv b').textContent, note: c.querySelector('.fannote').textContent, hint: document.querySelectorAll('.v-dev .guide').length,
        btn: Array.from(c.querySelectorAll('[data-k="fanact"] button')).map(b => b.textContent.trim()).join(','), avR: av.right, W: innerWidth }; });
    const log = () => p.evaluate(() => JSON.stringify((window.__txFanLog || []).slice(-1)[0]));
    await p.click('[data-fl="75"]'); await p.waitForTimeout(400);
    const b = { l: await log(), on: await p.textContent('.fanseg .on'), lv: await p.textContent('.fanlv b') };
    await p.click('[data-fl="off"]'); await p.waitForTimeout(400);
    const c = { l: await log(), on: await p.textContent('.fanseg .on'), lv: await p.textContent('.fanlv b') };
    await p.click('[data-fl="auto"]'); await p.waitForTimeout(400);
    const d = { l: await log(), on: await p.textContent('.fanseg .on') };
    await p.click('[data-f="forget"]'); await p.waitForTimeout(400);
    const e = { l: await log(), box: await p.textContent('[data-k="fanbox"]'), seg: await p.$$eval('.fanseg', x => x.length) };
    await p.click('[data-f="scan"]'); await p.waitForTimeout(500);
    const f = { l: await log(), btn: (await p.textContent('[data-f="scan"]')).trim() };
    await p.waitForTimeout(6200);
    const g = await p.evaluate(() => ({ st: document.querySelector('[data-k="fanbox"] .lab').textContent, seg: document.querySelectorAll('.fanseg button').length }));
    const ok = a.st === 'verbunden' && a.nm === 'F1_22D6' && a.seg === 'AUTO|AUS|25|50|75|100' && a.on === 'AUTO' && a.bg === 'rgb(43, 120, 160)' && / %$/.test(a.lv) &&
      a.note === 'Automatik: aus in Bereit, im Lauf nach Tempo, Steigung und Puls; Handwahl gilt bis Laufende' && a.hint === 0 &&
      a.btn === 'Suchen,Trennen' && a.avR <= a.W && b.l === '{"a":"level","v":75}' && b.on === '75' && b.lv === '75 %' && c.l === '{"a":"off"}' && c.on === 'AUS' && c.lv === '0 %' && d.l === '{"a":"auto"}' && d.on === 'AUTO' &&
      e.l === '{"a":"forget"}' && /Kein Ventilator verbunden/.test(e.box) && e.seg === 0 && f.l === '{"a":"scan"}' && f.btn === 'Suche läuft' && g.st === 'verbunden' && g.seg === 6;
    return { ok, d: `«${a.st}» ${a.nm}, [${a.seg}] aktiv ${a.on} ${a.bg}, ${a.lv}, Knöpfe ${a.btn}, Kopf bis ${Math.round(a.avR)} von ${a.W} px; 75 → ${b.l} ${b.on} ${b.lv}; AUS → ${c.l} ${c.lv}; AUTO → ${d.l}; Trennen → ${e.l} «${e.box.trim()}»; Suchen → ${f.l} «${f.btn}», danach ${g.st}` };
  });
  await flow('Ventilator am echten Dienst: GET /api/fan alle 2 s bei sichtbarer Seite, Befehle als POST /api/fan mit Token', async p => {
    let gets = 0; const posts = [];
    await p.addInitScript(() => { window.TreadNative = { token: () => 'tok9', installed: () => '[]', launch: () => true, setPref: () => {} }; });
    await p.route('**/api/state**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, st: 'BEREIT', err: '', speed: 0, incline: 0, tSpeed: 1, tIncl: 0, hr: 70, hrOk: true, pulled: 0, safe: 1, elapsed: 0, dist: 0, kcal: 0, elev: 0, src: 'ui', prog: null }) }));
    await p.route('**/api/fan', r => {
      if (r.request().method() === 'POST') { posts.push({ t: r.request().headers()['x-token'], b: r.request().postData() }); return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
      gets++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, state: 'bereit', name: 'F1_22D6', address: 'E8:1B:4C:22:D6:01', auto: false, level: 62, target: 62, manual: true, connected: true, awake: true }) });
    });
    await p.goto(BASE + '#/geraete'); await p.waitForTimeout(1000);
    const g0 = gets; await p.waitForTimeout(4100); const g1 = gets;
    const lv = await p.textContent('.fanlv b'), on = await p.$$eval('.fanseg .on', x => x.length);
    await p.click('[data-fl="50"]'); await p.waitForTimeout(500);
    await p.goto(BASE + '#/'); await p.waitForTimeout(300); const g2 = gets; await p.waitForTimeout(2500); const g3 = gets;
    const ok = g1 - g0 >= 2 && g1 - g0 <= 3 && lv === '62 %' && on === 0 && posts.length === 1 && posts[0].t === 'tok9' && posts[0].b === '{"a":"level","v":50}' && g3 === g2;
    return { ok, d: `${g1 - g0} Abfragen in 4.1 s, Anzeige ${lv} (keine Stufe markiert: ${on === 0}); POST ${posts.map(x => x.b + ' Token ' + x.t).join(', ')}; nach Verlassen ${g3 - g2} weitere Abfragen` };
  });
  await flow('Mini-Player im Kopf: Cover, Titel, nur Wiedergabe/Pause und leiser/lauter (gleich gross); Lautstärke-Anzeige; Tipp auf Cover öffnet das Player-Fenster mit Quelle, zurück/vor, Lautstärkebalken; Wechsel zu Hörbüchern während Musik läuft; Abspielgerät wählen', async p => {
    await p.goto(BASE + '?demo=1#/plans'); await p.waitForTimeout(1500);
    const a = await p.evaluate(() => { const m = document.querySelector('.head .mp'); if (!m) return null; const bs = Array.from(m.querySelectorAll('.mpb'));
      return { t: m.querySelector('.mpt b').textContent, ar: m.querySelector('.mpt small').textContent, img: m.querySelector('.mpo img').getAttribute('src'), btn: bs.map(b => b.getAttribute('data-mp')).join(),
        sz: Array.from(new Set(bs.map(b => Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)))).join(), bar: parseFloat(m.querySelector('.mpbar').style.width), h: m.getBoundingClientRect().height }; });
    await p.click('.head .mp [data-mp="toggle"]'); await p.waitForTimeout(500);
    const b = await p.evaluate(() => ({ pl: window.TX.media.st.playing, lab: document.querySelector('.head .mp .pp').getAttribute('aria-label') }));
    const v0 = await p.evaluate(() => window.TX.media.st.vol);
    await p.click('.head .mp [data-mp="volUp"]'); await p.waitForTimeout(250);
    const vb = await p.evaluate(() => { const e = document.querySelector('.mpvb'); return e && getComputedStyle(e).display !== 'none' ? e.textContent : ''; });
    await p.waitForTimeout(600); const v1 = await p.evaluate(() => window.TX.media.st.vol);
    await p.click('.head .mp .mpo'); await p.waitForTimeout(400);
    const f = await p.evaluate(() => { const m = document.querySelector('.mppanel'); return m ? { src: Array.from(m.querySelectorAll('.mps')).map(x => x.querySelector('b').textContent + (x.classList.contains('on') ? '*' : '')).join(), ctl: Array.from(m.querySelectorAll('.mpctl .mpb')).map(x => x.getAttribute('data-mp')).join(), seg: m.querySelectorAll('.mpsteps i').length, w: m.getBoundingClientRect().width } : null; });
    await p.click('.mppanel .mpctl [data-mp="next"]'); await p.waitForTimeout(500);
    const c = await p.textContent('.mppanel .mpnt b');
    await p.locator('.mppanel .mps').nth(1).click(); await p.waitForTimeout(800);
    const d = await p.evaluate(() => ({ app: window.TX.media.st.app, pl: window.TX.media.st.playing, ctl: Array.from(document.querySelectorAll('.mppanel .mpctl .mpb')).map(x => x.getAttribute('data-mp')).join(), on: document.querySelector('.mppanel .mps.on b').textContent, src: getComputedStyle(document.querySelector('.head .mpsrc')).backgroundColor }));
    const sb = await p.$eval('.mppanel .mpsteps', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.2, y: r.top + r.height / 2 }; });
    await p.mouse.click(sb.x, sb.y); await p.waitForTimeout(400);
    const v2 = await p.evaluate(() => window.TX.media.st.vol);
    const o0 = await p.$$eval('.mppanel .mpout', e => e.map(x => x.querySelector('b').textContent + (x.classList.contains('on') ? '*' : '')).join());
    await p.locator('.mppanel .mpout').nth(0).click(); await p.waitForTimeout(800);
    const o1 = await p.evaluate(() => ({ on: document.querySelector('.mppanel .mpout.on b').textContent, out: window.TX.media.st.out }));
    await p.click('.mppanel [data-mpp="open"]'); await p.waitForTimeout(300);
    const t = await p.textContent('#toast'), open = await p.$$eval('.mppanel', e => e.length);
    const ok = a && a.t === 'Morgenlicht über dem See' && a.ar === 'Nordwind' && a.img === 'img/apps/ytmusic.jpg' && a.btn === 'toggle,volDown,volUp' && !a.sz.includes(',') && a.bar > 0 && a.h <= 64 && !b.pl && b.lab === 'Wiedergabe' &&
      v1 === v0 + 1 && /Lautstärke \d+\/15/.test(vb) && f && f.src === 'YouTube Music*,Hörbücher' && f.ctl === 'prev,toggle,next' && f.seg === 15 && f.w >= 480 &&
      c === 'Lauf durch die Nacht' && d.app === 'Hörbücher' && d.pl && d.on === 'Hörbücher' && d.ctl === 'back30,toggle,fwd30' && d.src === 'rgb(47, 210, 122)' && v2 === 3 && /Hörbücher/.test(t) && open === 0 && o0 === 'Konsole,Wohnzimmer*,JBL Flip 5' && o1.on === 'Konsole' && o1.out === 'geraet';
    return { ok, d: `«${a && a.t}» / «${a && a.ar}», Knöpfe [${a && a.btn}] ${a && a.sz} px, Fortschritt ${a && a.bar} %, Höhe ${a && a.h} px; Pause → ${b.lab}; lauter ${v0} → ${v1}, Anzeige «${vb}»; Fenster [${f && f.src}] [${f && f.ctl}] ${f && f.seg} Stufen ${f && Math.round(f.w)} px; vor → «${c}»; Quelle → ${d.app} spielt ${d.pl} [${d.ctl}] ${d.src}; Balken 20 % → ${v2}; Abspielgerät [${o0}] → ${o1.on} (${o1.out}); App → «${t}», Fenster offen ${open}` };
  });
  await flow('Mini-Player ohne Wiedergabe: Kapsel «Musik» öffnet das Player-Fenster mit beiden Quellen; Quelle wählen startet die Wiedergabe; in Trainingsansichten kompakt (Cover, Wiedergabe, leiser, lauter, ohne Titel)', async p => {
    await p.goto(BASE + '?demo=1&musik=aus#/'); await p.waitForTimeout(1300);
    const a = await p.textContent('.head [data-mp="panel"]');
    await p.click('.head [data-mp="panel"]'); await p.waitForTimeout(300);
    const m = await p.$$eval('.mppanel .mps b', e => e.map(x => x.textContent)), em = await p.$$eval('.mppanel .mpempty', e => e.length);
    await p.locator('.mppanel .mps').nth(0).click(); await p.waitForTimeout(800);
    const s1 = await p.evaluate(() => ({ act: window.TX.media.st.active, app: window.TX.media.st.app, cap: !!document.querySelector('.head .mp') }));
    await p.goto(BASE + '?demo=1&frozen=1&szenario=intervall#/interval/p-schwelle'); await p.waitForTimeout(1500);
    const c = await p.evaluate(() => { const m2 = document.querySelector('.thead .mp.compact'); return m2 ? { btn: Array.from(m2.querySelectorAll('.mpb')).map(b => b.getAttribute('data-mp')).join(), t: m2.querySelectorAll('.mpt').length } : null; });
    await p.goto(BASE + '?demo=1&frozen=1#/interval/p-schwelle'); await p.waitForTimeout(1500);
    const d = await p.evaluate(() => { const ctr = document.querySelector('.thead .ctr').getBoundingClientRect(), rt = document.querySelector('.thead .rt').getBoundingClientRect(); return { gap: rt.left - ctr.right, r: rt.right, vw: innerWidth }; });
    await p.goto(BASE + '?demo=1#/'); await p.waitForTimeout(1500);
    const av = await p.evaluate(() => { const e = document.querySelector('.head .avatar'); return e ? innerWidth - e.getBoundingClientRect().right : 99; });
    const ok = /Musik/.test(a) && m.join() === 'YouTube Music,Hörbücher' && em === 1 && s1.act && s1.app === 'YouTube Music' && s1.cap && c && c.btn === 'toggle,volDown,volUp' && c.t === 0 && d.gap >= 0 && d.r <= d.vw && av >= 0;
    return { ok, d: `Kapsel «${a.trim()}»; Fenster [${m}], Hinweis «Nichts läuft» ${em}; Quelle → ${s1.app} aktiv ${s1.act}; Lauf kompakt [${c && c.btn}], Titel ${c && c.t}; Abstand zur Mitte ${Math.round(d.gap)} px; Avatar ${Math.round(av)} px vom Rand` };
  });
  await flow('STOP wirkt beim ersten Tipp, auch wenn Player-Fenster oder Pulsmenü offen ist; das Player-Fenster lässt STOP frei', async p => {
    const res = [];
    for (const which of ['player', 'puls']) {
      const stops = [];
      // Puls: Menue in BEREIT offen gelassen, dann startet der Lauf (Geraetetaste) und STOP erscheint im Kopf
      await p.goto(BASE + (which === 'player' ? '?demo=1&szenario=intervall&n=p#/run' : '?demo=1&n=h#/plans')); await p.waitForTimeout(1800);
      const sel = which === 'player' ? '.bigbtn' : '#stoptest';
      await p.evaluate(() => { const o = window.TX.cmd; window.__stops = []; window.TX.cmd = function (c) { window.__stops.push(c); return o.apply(this, arguments); }; });
      if (which === 'player') await p.click('.thead .mp .mpo'); else await p.click('[data-g="hrmenu"]');
      await p.waitForTimeout(400);
      if (which === 'puls') await p.evaluate(() => { const b = document.createElement('button'); b.id = 'stoptest'; b.className = 'stopb'; b.setAttribute('data-g', 'stop'); b.textContent = 'STOP';
        b.style.cssText = 'position:fixed;left:20px;top:300px;width:120px;height:60px;z-index:5'; document.body.appendChild(b); });
      const open = await p.evaluate(w => !!document.querySelector(w === 'player' ? '.mppanel' : '.hrmenu'), which);
      const free = which !== 'player' || await p.evaluate(() => document.querySelector('.mppanel').getBoundingClientRect().bottom <= document.querySelector('.bigbtn').getBoundingClientRect().top);
      const cls = await p.$eval(sel, e => e.className + ' ' + (e.getAttribute('data-g') || ''));
      const box = await p.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await p.mouse.click(box.x, box.y); await p.waitForTimeout(300);
      const st = await p.evaluate(() => window.__stops.join());
      res.push({ which, open, cls, st, free });
    }
    const ok = res.every(r => r.open && r.free && /stop/.test(r.cls) && /stop/.test(r.st));
    return { ok, d: res.map(r => `${r.which}: offen ${r.open}, STOP frei ${r.free}, Knopf «${r.cls}», Befehle [${r.st}]`).join('; ') };
  });
  await flow('STOP in Grenzfällen: in FEHLER bei laufendem Band aktiv, ohne Dienst direkt auf den Herstellerbus, schon beim Drücken (ohne Loslassen)', async p => {
    let mode = 'fehler'; const posts = [];
    await p.addInitScript(() => { window.__direct = 0; window.TreadNative = { token: () => 'tk1', installed: () => '[]', launch: () => true, setPref: () => {}, stopDirect: () => { window.__direct++; return true; } }; });
    const base = { ok: true, err: 'Herstellerbus getrennt', speed: 6, incline: 0, tSpeed: 6, tIncl: 0, hr: 120, hrOk: true, pulled: -1, safe: 1, elapsed: 600, dist: 1.2, kcal: 90, elev: 0, src: 'ui', prog: null };
    await p.route('**/api/state**', r => { if (mode === 'tot') return r.abort(); r.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.assign({}, base, { st: mode === 'fehler' ? 'FEHLER' : 'LAEUFT' })) }); });
    await p.route('**/api/cmd', r => { posts.push(r.request().postData()); r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
    await p.goto(BASE + '#/run'); await p.waitForTimeout(1500);
    const a = await p.$eval('.bigbtn', e => ({ c: e.className, d: e.disabled, t: e.textContent.trim() }));
    const al = await p.textContent('#alerts');
    const bb = await p.$eval('.bigbtn', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(bb.x, bb.y); await p.mouse.down(); await p.waitForTimeout(300);
    const onDown = posts.filter(x => /"stop"/.test(x)).length;
    await p.mouse.move(bb.x + 400, bb.y - 300); await p.mouse.up(); await p.waitForTimeout(300);   // Finger rutscht ab: kein click
    mode = 'lauf'; await p.waitForTimeout(1600); mode = 'tot'; await p.waitForTimeout(9000);
    const b = await p.$eval('.bigbtn', e => ({ c: e.className, d: e.disabled, t: e.textContent.trim() }));
    await p.click('.bigbtn'); await p.waitForTimeout(400);
    const dir = await p.evaluate(() => window.__direct);
    const ok = /stop/.test(a.c) && !a.d && /läuft aus/.test(al) && onDown === 1 && /stop/.test(b.c) && !b.d && dir === 1;
    return { ok, d: `FEHLER mit 6 km/h: Knopf «${a.t}» (${a.c}, gesperrt ${a.d}), Banner «${al.trim().slice(0, 60)}»; STOP beim Drücken ${onDown}x; ohne Dienst Knopf «${b.t}» (${b.c}) → direkter STOP ${dir}x` };
   }, true);
  await flow('Lauf, den der Dienst ohne Oberfläche beendet hat, wird beim Start nachgetragen (einmal, kein Doppel)', async p => {
    await p.addInitScript(() => { window.TreadNative = { token: () => 'tk', installed: () => '[]', launch: () => true, setPref: () => {} }; });
    await p.route('**/api/state**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, st: 'BEREIT', err: '', speed: 0, incline: 0, tSpeed: 1, tIncl: 0, hr: 0, hrOk: false, pulled: 0, safe: 1, elapsed: 0, dist: 0, kcal: 0, elev: 0, src: '', prog: null }) }));
    const TS = Date.now() - 8 * 3600e3;   // 8 h alt: ueber Nacht beendet
    await p.route('**/api/summary', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ts: TS, elapsed: 1500, dist: 4.1, kcal: 300, elev: 20, avgHr: 150, maxHr: 171, name: 'Freies Laufen', type: 'free', hist: [] }) }));
    await p.goto(BASE + '#/'); await p.waitForTimeout(3500);
    const a = await p.evaluate(ts => ({ n: window.TX.runs().filter(r => r.id === 's' + ts).length, t: document.querySelector('#toast') ? document.querySelector('#toast').textContent : '' }), TS);
    await p.reload(); await p.waitForTimeout(3500);
    const b = await p.evaluate(ts => window.TX.runs().filter(r => r.id === 's' + ts).length, TS);
    return { ok: a.n === 1 && /nachgetragen/.test(a.t) && b === 1, d: `nach Start ${a.n} Lauf, «${a.t}»; nach Neuladen ${b}` };
  });
  await flow('Stufentest: «Zum Auslaufen» springt im Lauf direkt in den letzten Abschnitt (skipTo), dort ausgeblendet', async p => {
    await p.goto(BASE + '?demo=1&szenario=stufentest#/interval/p-hfmax'); await p.waitForTimeout(1800);
    const a = await p.evaluate(() => { const b = document.querySelector('[data-v="cool"]'); const r = b && b.getBoundingClientRect(); return { vis: !!(b && !b.hidden && r.height), h: r ? r.height : 0, idx: window.TX.api.state.prog.idx, n: window.TX.api.state.prog.n }; });
    await p.click('[data-v="cool"]'); await p.waitForTimeout(1500);
    const b = await p.evaluate(() => ({ idx: window.TX.api.state.prog.idx, n: window.TX.api.state.prog.n, hid: !document.querySelector('[data-v="cool"]'), t: document.querySelector('#toast').textContent }));
    const ok = a.vis && a.h >= 48 && a.idx < a.n && b.idx === b.n && b.hid && /Auslaufen mit 6.0/.test(b.t);
    return { ok, d: `vorher Abschnitt ${a.idx}/${a.n}, Knopf ${Math.round(a.h)} px; danach ${b.idx}/${b.n}, ausgeblendet ${b.hid}, «${b.t}»` };
  });
  await flow('Mini-Player am echten Dienst: GET /api/media, Cover über /api/media/art?v=, lauter als POST /api/media/cmd mit Token; Quelle ohne Sitzung startet die App; nicht installierte Quelle ausgegraut', async p => {
    const seen = [];
    await p.addInitScript(() => { window.__l = []; window.TreadNative = { token: () => 'abc123', installed: () => JSON.stringify(['app.revanced.android.apps.youtube.music', 'com.audiobookshelf.app']), launch: x => { window.__l.push(x); return true; }, setPref: () => {} }; });
    await p.route('**/api/state**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, st: 'BEREIT', err: '', speed: 0, incline: 0, tSpeed: 1, tIncl: 0, hr: 70, hrOk: true, pulled: 0, safe: 1, elapsed: 0, dist: 0, kcal: 0, elev: 0, src: 'ui', prog: null }) }));
    await p.route('**/api/media', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, active: true, pkg: 'app.revanced.android.apps.youtube.music', app: 'YouTube Music', playing: true, title: 'Testtitel', artist: 'Testband', album: '', dur: 200, pos: 50, art: 7, canNext: true, canPrev: true, vol: 5, volMax: 15, out: 'geraet',
      sources: [{ pkg: 'app.revanced.android.apps.youtube.music', app: 'YouTube Music', installed: true, session: true, playing: true, title: 'Testtitel' }, { pkg: 'com.audiobookshelf.app', app: 'Hörbücher', installed: true, session: false, playing: false, title: '' }] }) }));
    await p.route('**/api/media/art**', r => r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(path.join(WWW, 'img/apps/ytmusic.jpg')) }));
    await p.route('**/api/media/cmd', r => { const b = r.request().postData(); seen.push({ t: r.request().headers()['x-token'], b }); r.fulfill({ contentType: 'application/json', body: JSON.parse(b).a === 'source' ? '{"ok":false,"error":"start"}' : '{"ok":true}' }); });
    await p.goto(BASE + '#/plans'); await p.waitForTimeout(1500);
    const a = await p.evaluate(() => ({ t: document.querySelector('.head .mpt b').textContent, img: document.querySelector('.head .mpo img').getAttribute('src') }));
    await p.click('.head [data-mp="volUp"]'); await p.waitForTimeout(500);
    await p.click('.head .mp .mpo'); await p.waitForTimeout(400);
    const out = await p.textContent('.mppanel .mpvl span'), st2 = await p.textContent('.mppanel .mps:nth-child(2) small');
    await p.locator('.mppanel .mps').nth(1).click(); await p.waitForTimeout(600);
    const l = await p.evaluate(() => window.__l.join()), open = await p.$$eval('.mppanel', e => e.length), toast = await p.textContent('#toast');
    const ok = a.t === 'Testtitel' && a.img === '/api/media/art?v=7' && seen.length === 2 && seen.every(x => x.t === 'abc123') && JSON.parse(seen[0].b).a === 'volUp' &&
      JSON.parse(seen[1].b).a === 'source' && JSON.parse(seen[1].b).pkg === 'com.audiobookshelf.app' && l === 'com.audiobookshelf.app' && open === 0 && !/Wiedergabe:/.test(toast) && /5\/15/.test(out) && st2 === 'nicht gestartet';
    return { ok, d: `«${a.t}», Cover ${a.img}; Befehle ${seen.map(x => x.b + ' (Token ' + x.t + ')').join(', ')}; Ausgabe «${out}»; Hörbücher «${st2}» → App ${l}, Fenster offen ${open}` };
  });
  await flow('Verbindungsverlust: Hinweis und gesperrte Steuerung', async p => {
    await p.addInitScript(() => { window.TreadNative = { token: () => 't' }; });
    await p.route('**/api/state**', r => r.abort());
    await p.goto(BASE + '#/run'); await p.waitForTimeout(4500);
    const t = await p.textContent('#alerts'), dis = await p.$eval('.bigbtn', e => e.disabled);
    return { ok: /Keine Verbindung/.test(t) && dis, d: `«${t.trim().slice(0, 40)}», START gesperrt ${dis}` };
  }, true);

  /* ================= Streckenmodus ================= */
  const RSAMPLES = ['homberg-runde', 'hallwilersee-runde', 'arosa-weisshorn', 'homberg-runde', 'hallwilersee-runde', 'arosa-weisshorn'].filter((id, i, a) => a.indexOf(id) === i).filter(id => fs.existsSync(path.join(WWW, 'strecken', id + '.json')));
  const rFirst = RSAMPLES[0] || 'homberg-runde';
  // Java-Klassen (RoutePlan, RouteSim, PlanDump) frisch bauen
  const SIMD = path.join(HERE, 'sim');
  let javaOk = true, javaErr = '';
  try { execFileSync('javac', ['-d', 'cls', '../../src/com/gapsch/treadctl/RoutePlan.java', 'RouteSim.java', 'PlanDump.java'], { cwd: SIMD, stdio: 'pipe' }); }
  catch (e) { javaOk = false; javaErr = String(e.stderr || e.message).slice(0, 200); }

  await flow('Strecke: JS-Planung (Demo) gleich Java-Planung RoutePlan (RouteSim und PlanDump, alle Schalter inkl. GPX-Höhen): gleiche Abschnitte, gleiche Tempi, gleiche Planzeit', async p => {
    if (!javaOk) return { ok: false, d: 'javac: ' + javaErr };
    await p.goto(BASE + '?demo=1&frozen=1#/strecken'); await p.waitForTimeout(600);
    const CASES = [['homberg-runde', 6300, 'terrain', 1, 0, 0], ['homberg-runde', 6300, 'even', 1, 0, 0], ['homberg-runde', 4500, 'terrain', 0.5, 0, 0], ['homberg-runde', 6300, 'terrain', 1, 0, 1],
      ['hallwilersee-runde', 5400, 'terrain', 1, 0, 0], ['hallwilersee-runde', 6600, 'even', 0.5, 0, 1], ['arosa-weisshorn', 27000, 'terrain', 1, 1, 0], ['arosa-weisshorn', 27000, 'terrain', 0.5, 1, 0], ['arosa-weisshorn', 30000, 'even', 1, 1, 1]]
      .map(c => RSAMPLES.includes(c[0]) ? c : ['homberg-runde'].concat(c.slice(1)));
    const out = [], tmp = fs.mkdtempSync('/tmp/strecke-');
    for (const [id, tg, mode, sc, tr, gpx] of CASES) {
      const prof = SAMPLE(id).prof, f = path.join(tmp, id + '.txt');
      fs.writeFileSync(f, prof.map(q => q[0] + ' ' + q[1]).join('\n') + '\n');
      // ohne GPX-Hoehen die Ausgabe von RouteSim (wie der Dienst), mit GPX-Hoehen PlanDump (7-Argument-Variante)
      const j = JSON.parse(execFileSync('java', gpx ? ['-cp', 'cls', 'PlanDump', f, String(tg), mode, String(sc), String(tr), '1'] : ['-cp', 'cls', 'RouteSim', f, String(tg), mode, String(sc), String(tr)], { cwd: SIMD }).toString());
      const js = await p.evaluate(([pr, a]) => {
        const fx = (v, d) => Math.sign(v) * Number(Math.abs(v).toFixed(d)) || 0;
        const r = window.TX.RoutePlan.build(pr.map(q => q[0]), pr.map(q => q[1]), a[0], a[1] !== 'even', a[2], !!a[3], !!a[4]);
        const secs = []; for (let i = 0; i < r.n; i++) secs.push([fx(r.a[i], 0), fx(r.b[i], 0), fx(r.sp[i], 1), fx(r.in[i], 1), fx(r.g[i], 1)]);
        return { secs, plan: fx(r.total, 1), capped: r.capped };
      }, [prof, [tg, mode, sc, tr, gpx]]);
      let diff = js.secs.length === j.secs.length ? 0 : 1000;
      if (!diff) js.secs.forEach((s, i) => { if (s.join() !== j.secs[i].map(v => +v || 0).join()) diff++; });
      out.push({ k: `${id} ${tg}s ${mode} ${sc} ${tr ? 'Trail' : 'Strasse'}${gpx ? ' GPX' : ''}`, n: j.secs.length, diff, plan: js.plan === j.plan, cap: js.capped === j.capped, tgt: Math.abs(j.plan - tg) <= 2 });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    const ok = out.every(o => o.diff === 0 && o.plan && o.cap);
    return { ok, d: out.map(o => `${o.k}: ${o.n} Abschnitte, Abweichung ${o.diff}${o.plan ? '' : ', Planzeit verschieden'}${o.tgt ? '' : ' (Ziel nicht erreichbar)'}`).join('; ') };
  });
  await flow('Strecke: Import-Parser GPX und TCX, alle 10 m neu abgetastet, Distanz ±0.5 %, swisstopo (gemockt): Formfelder LV95, sr 2056, nb_points, distinct_points, Zuordnung über dist', async p => {
    swissLog.length = 0;
    await p.goto(BASE + '?demo=1&frozen=1#/strecken'); await p.waitForTimeout(800);
    const r = await p.evaluate(async ids => {
      const R = window.TX.rte, a = await R.get(ids[0]), b = await R.get(ids[1] || ids[0]);
      const gpx = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Meta</name></metadata><trk><name>Testlauf GPX</name><trkseg>' +
        a.pts.filter((q, i) => i % 2 === 0 || i === a.pts.length - 1).map(q => `<trkpt lat="${q[0]}" lon="${q[1]}"><ele>${(q[2] + 4).toFixed(1)}</ele><time>2026-10-27T10:00:00Z</time></trkpt>`).join('') + '</trkseg></trk></gpx>';
      const tcx = '<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Courses><Course><Name>Testlauf TCX</Name><Track>' +
        b.pts.filter((q, i) => i % 2 === 0 || i === b.pts.length - 1).map(q => `<Trackpoint><Time>2026-10-27T10:00:00Z</Time><Position><LatitudeDegrees>${q[0]}</LatitudeDegrees><LongitudeDegrees>${q[1]}</LongitudeDegrees></Position><AltitudeMeters>${q[2]}</AltitudeMeters></Trackpoint>`).join('') +
        '<Trackpoint><Time>2026-10-27T10:00:01Z</Time></Trackpoint></Track></Course></Courses></TrainingCenterDatabase>';
      const g = await R.fromText(gpx, { fileName: 'test.gpx' }), t = await R.fromText(tcx, { fileName: 'test.tcx' });
      // Hoehe je Punkt gegen die Beispielstrecke (gleiche Distanz) und Abstand der Punkte
      const eDiff = (res, ref) => { let s = 0; res.route.pts.forEach(q => { s += Math.abs(q[2] - R.eAt(ref.prof, q[3] * ref.d / res.route.d)); }); return s / res.route.pts.length; };
      const steps = g.route.pts.slice(1, -1).map((q, i) => q[3] - g.route.pts[i][3]);
      let bad = ''; try { R.parse('<html><body>kein GPX</body></html>'); } catch (e) { bad = e.message; }
      let empty = ''; try { R.parse('<gpx><trk><name>x</name></trk></gpx>'); } catch (e) { empty = e.message; }
      const inLen = (r0) => R.lenOf(r0.pts.filter((q, i) => i % 2 === 0 || i === r0.pts.length - 1));
      return { gin: inLen(a), tin: inLen(b), gd: g.route.d, gn: g.route.name, gk: g.kind, gh: g.route.hoehe, gw: g.warn, ge: eDiff(g, a), ad: a.d, st: Math.max.apply(null, steps.map(x => Math.abs(x - 10))),
        td: t.route.d, tn: t.route.name, tk: t.kind, te: eDiff(t, b), bd: b.d, prof: g.route.prof.length === g.route.pts.length, thumb: g.route.thumb.length, art: g.route.art, bad, empty, up: g.route.up, aup: a.up };
    }, RSAMPLES.length ? RSAMPLES : ['homberg-runde']);
    const f = swissLog[0] || {}, lvOk = f.first && f.first[0] > 2480000 && f.first[0] < 2840000 && f.first[1] > 1070000 && f.first[1] < 1300000;
    // Distanz gegen die Laenge der eingelesenen Linie (Punkte alle 20 m, ohne Zitterglaettung)
    const dg = Math.abs(r.gd - r.gin) / r.gin * 100, dt = Math.abs(r.td - r.tin) / r.tin * 100;
    const ok = dg <= 0.5 && dt <= 0.5 && r.gn === 'Testlauf GPX' && r.gk === 'gpx' && r.tn === 'Testlauf TCX' && r.tk === 'tcx' && r.gh === 'swisstopo swissALTI3D' && !r.gw && r.ge < 2 && r.te < 2 && r.st < 1e-6 &&
      swissLog.length >= 2 && f.sr === '2056' && f.distinct === 'true' && f.nb === f.n && f.n <= 3000 && lvOk && r.prof && r.thumb > 50 && /kein gültiges GPX|Unbekanntes Format/.test(r.bad) && /Keine Streckenpunkte/.test(r.empty) && Math.abs(r.up - r.aup) / r.aup < 0.1;
    return { ok, d: `GPX ${(r.gd / 1000).toFixed(3)} km (Linie ${(r.gin / 1000).toFixed(3)}, ${dg.toFixed(2)} %), TCX ${(r.td / 1000).toFixed(3)} km (Linie ${(r.tin / 1000).toFixed(3)}, ${dt.toFixed(2)} %), Schritt 10 m (Abweichung ${r.st.toFixed(6)}); ` +
      `swisstopo ${swissLog.length} Anfragen, sr ${f.sr}, nb_points ${f.nb}/${f.n}, distinct ${f.distinct}, erster Punkt E ${Math.round(f.first && f.first[0])} N ${Math.round(f.first && f.first[1])}; Höhe mittl. Abw. ${r.ge.toFixed(2)}/${r.te.toFixed(2)} m (Antwort mit Zusatzpunkt); +${r.up} m (Beispiel ${r.aup}); Fehler «${r.bad}» «${r.empty}»` };
  }, false, true);
  await flow('Strecke: Import ohne Internet nimmt GPX-Höhen (hoehe gpx, Hinweis), Abbruch swisstopo blockiert nicht; ohne Höhen ausserhalb der Schweiz klare Meldung', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/strecken'); await p.waitForTimeout(800);
    const r = await p.evaluate(async id => {
      const R = window.TX.rte, a = await R.get(id), t0 = Date.now();
      const mk = (ele, dLat) => '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' + a.pts.filter((q, i) => i % 5 === 0).map(q => `<trkpt lat="${q[0] + dLat}" lon="${q[1]}">${ele ? '<ele>' + q[2] + '</ele>' : ''}</trkpt>`).join('') + '</trkseg></trk></gpx>';
      const o = await R.fromText(mk(true, 0), { fileName: 'Lauf_ohne_Netz.gpx' }), ms = Date.now() - t0;
      let e1 = '', e2 = '';
      try { await R.fromText(mk(false, 5), { fileName: 'x.gpx' }); } catch (e) { e1 = e.message; }
      try { await R.fromText(mk(false, 0), { fileName: 'y.gpx' }); } catch (e) { e2 = e.message; }
      return { h: o.route.hoehe, w: o.warn, n: o.route.name, ms, e1, e2 };
    }, rFirst);
    const ok = r.h === 'gpx' && /Ohne Internet/.test(r.w) && r.n === 'Lauf ohne Netz' && r.ms < 9000 && /Höhen fehlen/.test(r.e1) && /keine Höhen/.test(r.e2);
    return { ok, d: `Höhe «${r.h}» «${r.w}» nach ${r.ms} ms, Name «${r.n}»; ausserhalb CH ohne Höhen «${r.e1}»; CH ohne Netz und ohne Höhen «${r.e2}»` };
  }, true, 'offline');
  await flow('Strecke: Import-Dialog (Dateiliste der Konsole: USB-Symbol, Grösse, Datum), Name änderbar, Art mit Vorschlag, Speichern legt die Strecke an und lädt Kacheln einmal vor', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/strecken'); await p.waitForTimeout(1200);
    await p.click('.rtop [data-v="import"]'); await p.waitForSelector('.frow');
    const l = await p.$$eval('.frow', e => e.map(x => ({ n: x.querySelector('.fn b').textContent, s: x.querySelector('.fs').textContent, sub: x.querySelector('.fn small').textContent, usb: x.querySelector('.fic').classList.contains('usb') })));
    await p.click('.frow:nth-child(3)'); await p.waitForSelector('.ierr', { timeout: 5000 }); const err = await p.textContent('.ierr');
    await p.click('[data-a="back"]'); await p.waitForSelector('.frow'); await p.click('.frow'); await p.waitForSelector('.irev', { timeout: 8000 });
    const v = await p.evaluate(() => ({ nm: document.querySelector('#iname').value, art: document.querySelector('[data-art].on').getAttribute('data-art'), src: document.querySelector('.isrc').textContent }));
    await p.fill('#iname', 'Meine Seerunde'); await p.click('[data-art="trail"]'); await p.waitForTimeout(100);
    await p.click('[data-a="save"]'); await p.waitForTimeout(1500);
    const h = await p.evaluate(() => location.hash), o = await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('tx.demo.routes.v1') || '{}'); const k = Object.keys(d)[0]; return k ? { id: k, n: d[k].name, art: d[k].art, pts: d[k].pts.length, th: d[k].thumb.length, hoehe: d[k].hoehe } : null; });
    const ts = await p.evaluate(() => window.TX.rte.tileStatus());
    const ok = l.length === 3 && l[0].usb && /USB-Stick · \d\d\.\d\d\.\d{4} \d\d:\d\d/.test(l[0].sub) && /^\d+ KB$/.test(l[0].s) && /Import nicht möglich/.test(err) && v.nm === 'Hallwilersee Abendrunde' && v.art === 'strasse' && /swisstopo/.test(v.src) &&
      o && o.id === 'meine-seerunde' && o.n === 'Meine Seerunde' && o.art === 'trail' && o.pts > 1000 && h === '#/strecke/meine-seerunde' && ts.total > 0;
    return { ok, d: `Liste [${l.map(x => x.n + (x.usb ? ' (USB)' : '') + ' ' + x.s).join(', ')}]; defekt «${err.replace(/\s+/g, ' ').trim().slice(0, 60)}»; Vorschlag «${v.nm}» ${v.art}; gespeichert ${o && o.id} «${o && o.n}» ${o && o.art}, ${o && o.pts} Punkte, Höhe ${o && o.hoehe}; ${h}; Kacheln vorgeladen ${ts.total}` };
  }, false, true);
  await flow('Strecke: Bibliothek zeigt Beispiele (Name, Ort, Distanz, Höhenmeter, Art, Abzeichen, Kartenvorschau, Profil); eigene Strecke löschbar mit Bestätigung, Beispiele nicht', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/strecken'); await p.waitForTimeout(800);
    await p.evaluate(async id => { const R = window.TX.rte, a = await R.get(id), c = JSON.parse(JSON.stringify(a)); c.id = 'meine-runde'; c.name = 'Meine Runde'; delete c.datum; c.importiert = '27.10.2026'; c.offiziell = false; c.thumb = R.thumb(c.pts, 120); await R.save(c); }, rFirst);
    await p.reload(); await p.waitForTimeout(1800);
    const cards = () => p.$$eval('.rwrap', e => e.map(x => ({ n: x.querySelector('h2').textContent, kp: x.querySelector('.rkp').textContent.replace(/\s+/g, ' ').trim(), b: Array.from(x.querySelectorAll('.rb')).map(b => b.textContent.trim()).join('/'),
      del: !!x.querySelector('.rdel'), svg: !!x.querySelector('.rmini svg path'), prof: !!x.querySelector('.rmp svg path') })));
    const a = await cards(), fil = await p.$$eval('.filters a', e => e.map(x => x.textContent.trim()));
    await p.click('.rdel'); await p.waitForTimeout(200);
    const dlg = await p.evaluate(() => { const d = document.querySelector('[role=alertdialog]'); return d ? d.querySelector('h2').textContent + ' | ' + d.querySelector('.mut').textContent : ''; });
    await p.click('[data-c="ok"]'); await p.waitForTimeout(800);
    const b = await cards(), left = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tx.demo.routes.v1') || '{}')).length);
    const own = a.find(x => x.n === 'Meine Runde'), smp = a.filter(x => x.n !== 'Meine Runde');
    const ok = a.length === RSAMPLES.length + 1 && own && own.del && /EIGENE/.test(own.b) && smp.length === RSAMPLES.length && smp.every(x => !x.del && /BEISPIEL/.test(x.b) && x.svg && x.prof && /\d+\.\d km\s*\d+ m\s*\d+ m/.test(x.kp)) &&
      fil.join('|') === `Alle ${RSAMPLES.length + 1}|Strasse ${a.filter(x => /STRASSE/.test(x.b)).length}|Trail ${a.filter(x => /TRAIL/.test(x.b)).length}|Eigene 1` && /Strecke löschen\?/.test(dlg) && b.length === RSAMPLES.length && left === 0;
    return { ok, d: `${a.length} Karten: ${a.map(x => `${x.n} [${x.b}] ${x.kp.slice(0, 26)}${x.del ? ' löschbar' : ''}`).join('; ')}; Filter [${fil.join(', ')}]; «${dlg.slice(0, 40)}» → ${b.length} Karten` };
  });
  await flow('Strecke: Streckenseite lädt das Programm nur mit Kennung (type route, id, target, mode, scale; Befehl unter 4 KB, kein prof) nur vor, Zielzeit/Pace gekoppelt, Änderungen laden neu (entprellt), Planvorschau aus prog.secs', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/strecke/' + rFirst); await p.waitForTimeout(2600);
    const ref = SAMPLE(rFirst);
    const progs = () => p.evaluate(() => window.__txCmdLog.filter(x => x.c === 'program').map(x => x.b.p));
    const ui = () => p.evaluate(() => ({ tv: document.querySelector('[data-k="tv"]').textContent, pv: document.querySelector('[data-k="pv"]').textContent, pbox: document.querySelector('[data-k="pbox"]').textContent.replace(/\s+/g, ' '),
      bars: document.querySelectorAll('.rprof svg rect').length, st: window.TX.api.state }));
    const a0 = await progs(), u0 = await ui(), p0 = a0[a0.length - 1];
    await p.click('[data-st="t"][data-d="1"]'); await p.waitForTimeout(250); await p.click('[data-st="t"][data-d="1"]'); await p.waitForTimeout(1300);
    const a1 = await progs(), u1 = await ui();
    await p.click('[data-st="p"][data-d="-1"]'); await p.waitForTimeout(1200);
    const u2 = await ui();
    await p.click('[data-mode="even"]'); await p.waitForTimeout(1200); await p.click('[data-sc="0.5"]'); await p.waitForTimeout(1200);
    const a3 = await progs(), u3 = await ui(), l = await log(p);
    const km = ref.d / 1000, T = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
    const pace2 = Math.round(u1.st.prog.target / km) - 5, last = a3[a3.length - 1];
    const sz = await p.evaluate(() => Math.max.apply(null, window.__txCmdLog.filter(x => x.c === 'program').map(x => JSON.stringify(x.b).length)));
    const ok = p0 && p0.type === 'route' && p0.id === rFirst && Object.keys(p0).sort().join() === 'id,mode,scale,target,type' && sz < 4096 && u0.st.prog.name === ref.name && p0.mode === 'terrain' && p0.scale === 1 && p0.target === u0.st.prog.target &&
      u0.tv === T(p0.target) && u0.pv === T(p0.target / km) + '/km' && /Planzeit/.test(u0.pbox) && Math.abs(u0.st.prog.total - p0.target) <= 2 && u0.bars >= Math.floor(km) &&
      a1.length === a0.length + 1 && a1[a1.length - 1].target === p0.target + 120 && u1.tv === T(p0.target + 120) && u2.st.prog.target === Math.round(pace2 * km) && u2.pv === T(pace2) + '/km' &&
      last.mode === 'even' && last.scale === 0.5 && u3.st.prog.mode === 'even' && u3.st.prog.scale === 0.5 && u3.st.st === 'BEREIT' && !l.includes('start') && !l.includes('arm');
    return { ok, d: `geladen ${p0 && p0.type} [${p0 && Object.keys(p0)}] ${sz} Byte, Name im Dienst «${u0.st.prog.name}», Ziel ${u0.tv}, Pace ${u0.pv}, ${u0.pbox.slice(0, 40)}…; +2 min: ${a1.length - a0.length} neues Programm (entprellt) ${u1.tv}; Pace −5 s: ${u2.pv} → ${u2.tv}; Gleichmässig + 50 %: ${last.mode} ${last.scale}; Befehle [${[...new Set(l)]}]` };
  });
  await flow('Strecke: Laufansicht zeigt Soll-Pace gross, Ist-Pace, Rückstand/Vorsprung, Prognose, km; Karte grün gelaufen bis genau zur Position, rot offen; Profil mit Fortschritt an derselben Stelle', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=strecke#/strecke/' + rFirst); await p.evaluate(() => window.TX.demoReady); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => {
      const T = window.TX, R = T.rte, st = T.api.state, pr = st.prog, m = R._lastMap, done = m.lines.done.getLatLngs(), rest = m.lines.rest.getLatLngs();
      let len = 0; for (let i = 1; i < done.length; i++) len += R.hav([done[i - 1].lat, done[i - 1].lng], [done[i].lat, done[i].lng]);
      const want = R.posAt(R.cache[pr.id].pts, pr.x).ll, end = done[done.length - 1], endOff = R.hav([end.lat, end.lng], want);
      const svg = document.querySelector('.rprof svg'), w = +svg.getAttribute('width'), dash = svg.querySelector('line[stroke-dasharray="4 4"]'), green = !!svg.querySelector('path[stroke="#2fd27a"]'), red = !!svg.querySelector('path[stroke="#ff4d5e"]');
      const q = s => (document.querySelector(s) || {}).textContent || '';
      return { x: pr.x, D: pr.D, len, endOff, join: rest[0].equals(done[0]) && rest.length > done.length, dc: m.lines.done.options.color, rc: m.lines.rest.options.color, px: +dash.getAttribute('x1'), want: 62 + pr.x / pr.D * (w - 62 - 10), green, red,
        sp: q('[data-k="sp"]'), spWant: R.pace(pr.pace), spFs: parseFloat(getComputedStyle(document.querySelector('.spv')).fontSize), ip: q('[data-k="ip"]'), dl: q('[data-k="dl"]'), dlc: document.querySelector('[data-k="dl"]').className, delta: pr.delta,
        eta: q('[data-k="eta"]'), etaWant: T.time(pr.eta), kd: q('[data-k="kd"]'), gb: q('[data-k="gb"]'), ns: q('[data-k="ns"]'), pt: q('[data-k="pt"]') };
    });
    const dOk = r.delta > 2 ? /^\+\d+:\d\dhinter Plan$/.test(r.dl) && /bh/.test(r.dlc) : r.delta < -2 ? /^\u2212\d+:\d\dvor Plan$/.test(r.dl) && /ah/.test(r.dlc) : /im Plan/.test(r.dl);
    // rot liegt einmal ganz unter gruen (Leistung), beide beginnen am Start; Ende der gruenen Linie genau an der Position; Laenge der Linie (Sehnen alle 10 m) auf 1 % gleich der Banddistanz
    const ok = r.endOff < 1 && Math.abs(r.len - r.x) < Math.max(25, r.x * 0.01) && r.join && r.dc === '#2fd27a' && r.rc === '#ff4d5e' && Math.abs(r.px - r.want) < 2 && r.green && r.red && r.sp === r.spWant && r.spFs >= 100 && /^\d+:\d\d$/.test(r.ip) && dOk &&
      r.eta === r.etaWant && r.kd === (r.x / 1000).toFixed(1) && /^Strecke [\u2212]?\d+\.\d %/.test(r.gb) && /^in \d+ m · Pace/.test(r.ns) && r.pt === 'km ' + (r.x / 1000).toFixed(1) + ' von ' + (r.D / 1000).toFixed(1);
    return { ok, d: `x ${r.x} m: grüne Linie endet ${r.endOff.toFixed(2)} m neben der Position, Länge ${Math.round(r.len)} m, Rot ganze Strecke darunter ${r.join}; Profilmarke ${r.px.toFixed(1)} px (soll ${r.want.toFixed(1)}); Soll-Pace «${r.sp}» ${r.spFs} px, Ist «${r.ip}», «${r.dl}» (delta ${r.delta}), Prognose ${r.eta}, «${r.gb}», «${r.ns}»` };
  });
  await flow('Strecke: Tempo von Hand bleibt Versatz bis «Zurück zum Plan»; Steigung relativ «−1/Plan/+1» gilt nur bis zum nächsten Steigungswechsel; next.i ohne Versatz', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=strecke#/strecke/' + rFirst); await p.evaluate(() => window.TX.demoReady); await p.waitForTimeout(2000);
    const labs = await p.$$eval('.ctl .side.l .qs button', e => e.map(x => x.textContent));
    await p.click('.adj.spd [data-d="0.5"]'); await p.waitForTimeout(900);
    const a = await p.evaluate(() => ({ o: window.TX.api.state.prog.offS, chip: (document.querySelector('.offc .ot b') || {}).textContent || '', hint: (document.querySelector('.offc .ot small') || {}).textContent || '', ts: window.TX.api.state.tSpeed, sp: window.TX.sim.p.rp.sp[window.TX.sim.p.seg] }));
    const b = await p.evaluate(() => { const S = window.TX.sim, i0 = S.p.seg; let n = 0; while (S.p.seg === i0 && n++ < 3000) S.step(1); for (let k = 0; k < 6; k++) S.step(1);
      const rp = S.p.rp, j = S.p.iseg > S.p.seg && rp.early(S.p.iseg) ? S.p.iseg : S.p.seg; return { i: S.p.seg, ts: S.s.tSpeed, want: Math.round((rp.sp[j] + 0.5) * 10) / 10, o: S.p.offS }; });
    await p.waitForTimeout(600);
    await p.click('.ctl [data-ri="1"]'); await p.waitForTimeout(900);
    const c = await p.evaluate(() => { const st = window.TX.api.state, pr = st.prog; return { oi: pr.offI, ti: st.tIncl, plan: window.TX.sim.p.rp.in[window.TX.sim.p.iseg], hint: (document.querySelector('.offc .ot small') || {}).textContent || '',
      planOn: document.querySelector('.ctl [data-ri="0"]').classList.contains('on'), nexti: pr.next ? pr.next.i : null, nextPlan: pr.next ? window.TX.sim.p.rp.in[pr.idx] : null }; });
    const d = await p.evaluate(() => { const S = window.TX.sim, i0 = S.p.iseg; let n = 0; while (S.p.iseg === i0 && n++ < 3000) S.step(1); return { oi: S.p.offI, ti: S.s.tIncl, want: S.p.rp.in[S.p.iseg], os: S.p.offS }; });
    await p.waitForTimeout(600);
    await p.click('.ctl [data-ri="1"]'); await p.waitForTimeout(700); await p.click('.ctl [data-ri="0"]'); await p.waitForTimeout(700);
    const e = await p.evaluate(() => ({ oi: window.TX.api.state.prog.offI, os: window.TX.api.state.prog.offS, cmd: window.__txCmdLog.filter(x => x.c === 'routeOffset').map(x => x.b.s + '/' + x.b.i).pop() }));
    await p.click('[data-v="replan"]'); await p.waitForTimeout(900);
    const f = await p.evaluate(() => ({ o: window.TX.api.state.prog.offS, chip: !!document.querySelector('.offc'), ts: window.TX.api.state.tSpeed, want: window.TX.sim.p.rp.sp[window.TX.sim.p.seg], cmd: window.__txCmdLog.filter(x => x.c === 'routeOffset').map(x => x.b.s + '/' + x.b.i).pop() }));
    const ok = labs.join('|') === '\u22121|Plan|+1' && a.o === 0.5 && a.chip === 'Plan +0.5 km/h' && /Tempo von Hand/.test(a.hint) && Math.abs(a.ts - (a.sp + 0.5)) < 0.06 && Math.abs(b.ts - b.want) < 0.06 && b.o === 0.5 &&
      c.oi === 1 && Math.abs(c.ti - (c.plan + 1)) < 0.06 && c.hint === 'Steigung von Hand bis zum nächsten Wechsel' && !c.planOn && (c.nexti === null || c.nexti === c.nextPlan) &&
      d.oi === 0 && Math.abs(d.ti - d.want) < 0.06 && d.os === 0.5 && e.oi === 0 && e.os === 0.5 && e.cmd === '0.5/0' && f.o === 0 && !f.chip && Math.abs(f.ts - f.want) < 0.06 && f.cmd === '0/0';
    return { ok, d: `Schnellwahl [${labs}]; Tempo +0.5: «${a.chip}» «${a.hint}», Soll ${a.ts}; nächster Abschnitt ${b.i}: ${b.ts} (Plan + 0.5 = ${b.want}); Steigung +1: Versatz ${c.oi}, Band ${c.ti} (Plan ${c.plan}), «${c.hint}», next.i ${c.nexti} = Plan ${c.nextPlan}; ` +
      `nach Steigungswechsel Versatz ${d.oi}, Band ${d.ti} = Plan ${d.want}, Tempo-Versatz bleibt ${d.os}; «Plan» sendet routeOffset ${e.cmd}; Zurück zum Plan ${f.cmd}, Soll ${f.ts} = ${f.want}` };
  });
  await flow('Strecke: Simulator wie Core: Einlaufen 15 s mit 1.0 km/h, dann Tempo-Rampe (Stufen 3 km/h alle 4 s, Handeingabe bricht ab), Auslaufen zählt erst ab 3.3 km/h, Freilauf über 3.5 km/h, Watchdog hält Tempo und Steigung, toChange/toFinish', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/strecke/' + rFirst); await p.waitForTimeout(2200);
    const r = await p.evaluate(id => {
      const S = new window.TX.Sim(), o = {};
      S.cmd({ c: 'program', p: { type: 'route', id, target: 4200, mode: 'terrain', scale: 1 } });
      o.want = S.s.tSpeed; S.direct('start'); o.t0 = S.s.tSpeed; o.h0 = S.snap(false).hold; o.ht = S.snap(false).holdTo;
      for (let k = 0; k < 4; k++) S.step(1); o.t4 = S.s.tSpeed;
      for (let k = 0; k < 11; k++) S.step(1); o.t15 = S.s.tSpeed; for (let k = 0; k < 4; k++) S.step(1); o.t19 = S.s.tSpeed; for (let k = 0; k < 4; k++) S.step(1); o.t8 = S.s.tSpeed;
      S.cmd({ c: 'step', what: 'speed', d: 0.5 }); o.man = S.s.tSpeed; for (let k = 0; k < 6; k++) S.step(1); o.man6 = S.s.tSpeed;
      const pr = S.routeProg(false); o.toC = pr.toChange; o.toF = pr.toFinish; o.D = pr.D; o.x = pr.x;
      const rp = S.p.rp, i = rp.idxAt(pr.x); const xr = Math.min(rp.D, S.s.dist * 1000); o.toCwant = Math.max(0, Math.round((rp.in[i + 1] !== rp.in[i] ? rp.a[i + 1] - rp.lead(i + 1) : rp.a[i + 1]) - xr));
      // Watchdog: Programm erhoeht weder Tempo noch Steigung
      S.leaseLost = true; const ts = S.s.tSpeed, ti = S.s.tIncl; S.setS(ts + 2, 'programm'); S.setI(ti + 2, 'programm'); o.wd = S.s.tSpeed === ts && S.s.tIncl === ti; S.setS(ts - 1, 'programm'); o.wdDown = S.s.tSpeed === Math.round((ts - 1) * 10) / 10; S.leaseLost = false;
      // Ziel und Auslaufen
      S.s.dist = (rp.D - 2) / 1000; S.s.speed = 12; S.step(1); S.step(1); o.fin = S.p.finish; o.ft = S.s.tSpeed; o.fi = S.s.tIncl;
      for (let k = 0; k < 3; k++) S.step(1); o.endT3 = S.endT; o.sp3 = S.s.speed;
      for (let k = 0; k < 30 && S.s.st === 'LAEUFT'; k++) S.step(1); o.st = S.s.st;
      // Freilauf: zweiter Lauf, im Auslaufen auf 5 km/h
      const F = new window.TX.Sim(); F.cmd({ c: 'program', p: { type: 'route', id, target: 4200, mode: 'terrain', scale: 1 } }); F.direct('start'); F.s.dist = (rp.D - 2) / 1000; F.s.speed = 12; F.step(1); F.step(1);
      F.cmd({ c: 'speed', v: 5 }); for (let k = 0; k < 40; k++) F.step(1); o.freeSt = F.s.st; o.freeNote = F.s.note; o.freeT = F.endT;
      return o;
    }, rFirst);
    const ok = r.want > 10 && r.t0 === 1 && r.h0 === 15 && r.ht === r.want && r.t4 === 1 && Math.abs(r.t15 - 4) < 0.06 && Math.abs(r.t19 - 7) < 0.06 && Math.abs(r.t8 - 10) < 0.06 && Math.abs(r.man6 - r.man) < 0.06 &&
      r.toC === r.toCwant && r.toF === Math.max(0, Math.round(r.D - r.x)) && r.wd && r.wdDown && r.fin && r.ft === 3 && r.fi === 0 && r.endT3 >= 0 && r.endT3 < 3 && r.st === 'PAUSE' &&
      r.freeSt === 'LAEUFT' && r.freeNote === 'Freilauf nach Programmende, STOP beendet den Lauf' && r.freeT === -1;
    return { ok, d: `Start ${r.want} km/h: Einlaufen ${r.t0} km/h (${r.h0} s, Ziel ${r.ht}), nach 4 s ${r.t4}, nach 15 s ${r.t15}, nach 19 s ${r.t19}, nach 23 s ${r.t8}; Handeingabe ${r.man} bleibt ${r.man6}; toChange ${r.toC} (${r.toCwant}), toFinish ${r.toF}; Watchdog hält ${r.wd}, senkt ${r.wdDown}; Ziel ${r.ft} km/h ${r.fi} %, nach 3 s Auslauf-Zähler ${r.endT3.toFixed(1)} (Ist ${r.sp3.toFixed(1)}), dann ${r.st}; Freilauf ${r.freeSt} «${r.freeNote}»` };
  });
  await flow('Strecke: nach Unterbrechung (Schlüssel, quittiert, 3 km/h) gross die Plan-Pace, Gehtempo als Hinweis, keine Gehtempo-Prognose, grosses «Zurück zum Plan»', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=strecke-unterbrechung#/strecke/' + rFirst); await p.evaluate(() => window.TX.demoReady); await p.waitForTimeout(2000);
    const a = await p.evaluate(() => { const pr = window.TX.api.state.prog, b = document.querySelector('.offc.big [data-v="replan"]'), q = k => (document.querySelector('[data-k="' + k + '"]') || {}).textContent || '';
      return { os: pr.offS, t: (document.querySelector('.offc .ot b') || {}).textContent || '', t2: (document.querySelector('.offc .ot small') || {}).textContent || '', plan: Math.round((pr.sec.s - pr.offS) * 10) / 10, h: b ? b.getBoundingClientRect().height : 0, ts: window.TX.api.state.tSpeed,
        lab: (document.querySelector('.spl .lab') || {}).textContent, sp: q('sp'), sps: q('sps'), eta: q('eta'), etas: q('etas') }; });
    const pace = s => { const m = /^(\d+):(\d\d)$/.exec(s); return m ? +m[1] * 60 + +m[2] : 0; };
    const ok = a.os <= -3 && a.ts === 3 && a.t === 'Gehtempo nach Unterbrechung' && a.t2.indexOf(a.plan.toFixed(1) + ' km/h') > 0 && a.h >= 56 &&
      a.lab === 'Plan-Pace' && Math.abs(pace(a.sp) - 3600 / a.plan) <= 2 && /Gehtempo/.test(a.sps) && a.eta === '--' && /Zurück zum Plan/.test(a.etas);
    return { ok, d: `Versatz ${a.os}; gross «${a.lab} ${a.sp}» («${a.sps}»); Prognose «${a.eta}» («${a.etas}»); Hinweis «${a.t}» / «${a.t2}», Knopf ${Math.round(a.h)} px hoch` };
  });
  await flow('Strecke: Wechselbanner und Töne wie die Pille (Steigung ab 1 % oder Tempo ab 1 km/h, 10 s vorher, Ton bei 3, 2, 1)', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=strecke#/strecke/' + rFirst); await p.evaluate(() => window.TX.demoReady); await p.waitForTimeout(1500);
    const unit = await p.evaluate(() => { const C = window.TX.rte.change, sec = { s: 12, i: 0, g: 0 }, st = { speed: 12, tSpeed: 12, tIncl: 0 };
      return { sp: C({ sec, next: { s: 10.8, i: 0.5 }, toChange: 30, toNext: 99 }, st), inc: C({ sec, next: { s: 12, i: 1.0 }, toChange: 30, toNext: 99 }, st), none: C({ sec, next: { s: 11.5, i: 0.5 }, toChange: 30 }, st),
        off: C({ sec: { s: 12, i: 2.0, g: 0 }, next: { s: 12, i: 1.0 }, toChange: 30, offI: 2.0 }, { speed: 12, tSpeed: 12, tIncl: 2.0 }),
        fin: C({ sec, next: null, toFinish: 25, D: 21000, x: 20975 }, st) }; });
    // bis kurz vor einen grossen Wechsel vorspulen
    await p.evaluate(() => { window.__beeps = 0; const o = window.TX.beep; window.TX.beep = function (hz) { window.__beeps++; return o(hz); };
      const S = window.TX.sim; let n = 0; while (n++ < 4000) { const ch = window.TX.rte.change(S.routeProg(false), S.s); if (ch && ch.big && ch.sec <= 9 && ch.sec > 5) break; S.step(1); } S.s.speed = S.s.tSpeed; });
    await p.waitForTimeout(1200);
    const b = await p.evaluate(() => ({ on: document.querySelector('[data-k="ban"]').classList.contains('on'), t: document.querySelector('[data-k="ban"] .l1').textContent }));
    for (let k = 0; k < 8; k++) { await p.evaluate(() => { window.TX.sim.step(1); }); await p.waitForTimeout(450); }
    const n = await p.evaluate(() => window.__beeps);
    // Zielbanner im letzten Abschnitt (gruen, mit Toenen)
    await p.evaluate(() => { const S = window.TX.sim; S.s.dist = (S.p.rp.D - 15) / 1000; S.step(1); window.TX.api.poke(); });
    await p.waitForTimeout(1200);
    const f = await p.evaluate(() => { const b = document.querySelector('[data-k="ban"]'); return { on: b.classList.contains('on'), fin: b.classList.contains('d-fin'), t: b.querySelector('.l1').textContent + ' | ' + b.querySelector('.l2').textContent, bg: getComputedStyle(b).backgroundColor }; });
    const ok = unit.sp.big && unit.inc.big && !unit.none.big && unit.off.big && unit.off.dI === -1 && unit.fin.finish && unit.fin.big && unit.sp.sec === 9 && unit.fin.sec === 8 && b.on && /^0:0\d(Steigung|Tempo) [↑↓] auf /.test(b.t) && n >= 2 && n <= 3 &&
      f.on && f.fin && /^0:0\dZiel \| Band läuft auf 3 km\/h aus und hält danach an$/.test(f.t);
    return { ok, d: `Regel (toChange, gegen aktuelles Soll): Tempo −1.2 ${unit.sp.big} in ${unit.sp.sec} s, Steigung +1 ${unit.inc.big}, je 0.5 ${unit.none.big}, von Hand 2 % auf Plan 1 % ${unit.off.big}; Banner «${b.t}»; Töne ${n}; Ziel «${f.t}» ${f.bg}` };
  });
  await flow('Strecke: START-Schutz: unerreichbare Zielzeit (Tempo am Anschlag) fragt vor dem Countdown mit Klartext nach; Abbrechen sendet nichts, Trotzdem starten zählt 3, 2, 1', async p => {
    await p.addInitScript(id => { if (!sessionStorage.getItem('ss')) { sessionStorage.setItem('ss', '1'); localStorage.setItem('tx.routeprefs.v1', JSON.stringify({ [id]: { target: 3700, mode: 'terrain', scale: 1 } })); } }, rFirst);
    await p.goto(BASE + '?demo=1#/strecke/' + rFirst); await p.waitForTimeout(3000);
    const pr = await p.evaluate(() => window.TX.api.state.prog);
    await p.evaluate(() => { window.__txCmdLog.length = 0; }); await p.click('.bigbtn'); await p.waitForTimeout(400);
    const a = await p.evaluate(() => { const d = document.querySelector('.csdlg'); return d ? { h: d.querySelector('h2').textContent, t: d.querySelector('.cst').textContent, cd: !!document.querySelector('.cdown') } : null; });
    await p.click('.csdlg [data-c="no"]'); await p.waitForTimeout(400);
    const l1 = await log(p);
    await p.waitForTimeout(500); await p.click('.bigbtn'); await p.waitForTimeout(300); await p.click('.csdlg [data-c="ok"]'); await p.waitForTimeout(400);
    const cd = await p.isVisible('.cdown'); await p.click('.cdown [data-c="cancel"]'); await p.waitForTimeout(300);
    const l2 = await log(p);
    const ok = pr.total - pr.target > 30 && a && a.h === 'Plan prüfen' && /nicht erreichbar/.test(a.t) && !a.cd && l1.length === 0 && cd && l2.join() === 'arm,stop';
    return { ok, d: `Ziel ${pr.target} s, Plan ${pr.total} s; «${a && a.h}»: «${a && a.t.slice(0, 80)}…»; Abbrechen: [${l1}]; Trotzdem: Countdown ${cd}, [${l2}]` };
  });
  await flow('Strecke: alle Beispielstrecken (auch arosa-weisshorn) laden per Kennung, Befehl unter 4 KB; Startwert der Zielzeit nach Riegel, ohne Vorschlags- und Hinweiszeilen; Einheit km überall klein', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/strecken'); await p.waitForTimeout(800);
    const out = [];
    for (const id of RSAMPLES) {
      await go(p, '#/strecke/' + id); await p.waitForTimeout(2200);
      out.push(await p.evaluate(id2 => { const c = window.__txCmdLog.filter(x => x.c === 'program' && x.b.p.id === id2).pop(), st = window.TX.api.state;
        return { id: id2, size: c ? JSON.stringify(c.b).length : 0, ok: !!(st.prog && st.prog.id === id2 && st.prog.n > 0), n: st.prog && st.prog.n, km: /\bKM\b/.test(document.body.innerText) }; }, id));
    }
    const r = await p.evaluate(() => { const runs = window.TX.runs().filter(x => x.dist >= 3 && x.elapsed > 0 && x.elapsed / x.dist >= 180 && x.elapsed / x.dist <= 720).slice(0, 12); let km = 0, t = 0; runs.forEach(x => { km += x.dist; t += x.elapsed; }); return { n: runs.length, D1: km / runs.length, P: t / km }; });
    const ref = SAMPLE(rFirst), deq = (ref.d + 4.5 * ref.up) / 1000, T2 = r.P * r.D1 * Math.pow(deq / r.D1, 1.06), want = Math.round(T2 / (T2 >= 3600 ? 300 : 60)) * (T2 >= 3600 ? 300 : 60);
    await go(p, '#/strecke/' + rFirst); await p.waitForTimeout(1500);
    const tg = await p.evaluate(() => window.TX.api.state.prog.target), rows = await p.$$eval('.sugg, .rright .pnote, .rright .pwarn', e => e.length);
    const ok = out.length === RSAMPLES.length && out.every(o => o.ok && o.size > 0 && o.size < 4096 && !o.km) && tg === want && rows === 0;
    return { ok, d: out.map(o => `${o.id}: ${o.size} Byte, ${o.n} Abschnitte`).join('; ') + `; Startwert Zielzeit nach Riegel aus ${r.n} Läufen (Ø ${r.D1.toFixed(1)} km): ${tg} s (erwartet ${want}); keine Vorschlags- und Hinweiszeilen ${rows === 0}; «KM» gross nirgends` };
  });
  await flow('Strecke: GPX-Import glättet Zittern (Mittel über 3 Punkte nur bei Abstand unter 15 m) und zeigt Datei- und Streckendistanz', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/strecken'); await p.waitForTimeout(600);
    const r = await p.evaluate(async () => {
      const R = window.TX.rte, pts = [], pts2 = [];
      // 2 km gerade Linie nach Norden, alle 3 m ein Punkt mit ±2 m Zittern; dazu eine Route mit 200 m Abstand (bleibt unveraendert)
      for (let i = 0; i <= 667; i++) { const j = ((i * 7919) % 13) / 13 - 0.5; pts.push([47.0 + i * 3 / 111195, 8.0 + j * 4 / 75800, 400]); }
      for (let i = 0; i <= 10; i++) pts2.push([47.0 + i * 200 / 111195, 8.0 + (i % 2) * 50 / 75800, 400]);
      const raw = R.lenOf(pts), sm = R.lenOf(R.dejitter(pts)), r2 = R.lenOf(pts2), s2 = R.lenOf(R.dejitter(pts2));
      // gleichmaessige Kurve (Kreis r = 60 m, Punkte alle 5 m): bleibt unveraendert
      const arc = []; for (let i = 0; i <= 60; i++) { const w = i * 5 / 60; arc.push([47 + Math.sin(w) * 60 / 111195, 8 + (1 - Math.cos(w)) * 60 / 75800, 400]); }
      const sample = await R.get('homberg-runde'), sl = R.lenOf(sample.pts), sd = R.lenOf(R.dejitter(sample.pts));
      return { raw, sm, r2, s2, a1: R.lenOf(arc), a2: R.lenOf(R.dejitter(arc)), sl, sd };
    });
    await p.click('.rtop [data-v="import"]'); await p.waitForSelector('.frow'); await p.click('.frow'); await p.waitForSelector('.irev', { timeout: 8000 });
    const isub = await p.textContent('.isub');
    const ok = r.raw > 2100 && r.sm < r.raw - 100 && Math.abs(r.s2 - r.r2) < 1e-6 && Math.abs(r.a2 - r.a1) < 1e-6 && /^Datei \d+\.\d km, \d+ Punkte$/.test(isub);
    return { ok, d: `Zittern: Rohlänge ${Math.round(r.raw)} m, geglättet ${Math.round(r.sm)} m (wahr 2001 m); weite Punkte unverändert ${Math.round(r.r2)} = ${Math.round(r.s2)} m; gleichmässige Kurve unverändert ${r.a1.toFixed(1)} = ${r.a2.toFixed(1)} m; ` +
      `Aargau HM (Punkte alle 10 m) ${Math.round(r.sl)} → ${Math.round(r.sd)} m (${((r.sl - r.sd) / r.sl * 100).toFixed(2)} %); Anzeige «${isub}»` };
  }, false, true);
  await flow('Strecke: Ziel erreicht (finish), Band 3 km/h, nach 10 s PAUSE mit «Ziel erreicht», BEENDEN: Zusammenfassung mit Strecke, Zielzeit gegen gelaufene Zeit', async p => {
    await p.goto(BASE + '?demo=1&frozen=1&szenario=strecke-ziel#/strecke/' + rFirst); await p.evaluate(() => window.TX.demoReady); await p.waitForTimeout(2000);
    const a = await p.evaluate(() => ({ fin: (document.querySelector('.fin .fl') || {}).textContent, ft: (document.querySelector('.fin .ft') || {}).textContent, ts: window.TX.api.state.tSpeed, ti: window.TX.api.state.tIncl, pr: window.TX.api.state.prog, st: window.TX.api.state.st, note: window.TX.api.state.note }));
    await p.evaluate(() => { const S = window.TX.sim; for (let i = 0; i < 40 && S.s.st === 'LAEUFT'; i++) S.step(1); }); await p.waitForTimeout(2000);
    const b = await p.evaluate(() => ({ st: window.TX.api.state.st, pl: (document.querySelector('.pmodal [data-k="pl"]') || {}).textContent }));
    await p.click('.pmodal [data-x="end"]'); await p.waitForTimeout(1500);
    const c = await p.evaluate(() => { const r = window.TX.runs()[0]; return { h: location.hash, rt: r.route, type: r.type, h1: document.querySelector('.sumh h1').textContent, card: (document.querySelector('.rsum') || {}).textContent || '', hm: Array.from(document.querySelectorAll('.bigk > div')).map(e => e.textContent).filter(t => /Höhenmeter/.test(t)).join(''), map: !!document.querySelector('.rsm svg path'), prof: !!document.querySelector('.rsp svg path') }; });
    const ok = a.fin === 'ZIEL ERREICHT' && a.pr.finish && a.pr.done && a.ts === 3 && a.ti === 0 && a.st === 'LAEUFT' && a.note === 'Ziel erreicht' && b.st === 'PAUSE' && /^Ziel erreicht · \d+:\d\d:\d\d \(Vorgabe \d+:\d\d:\d\d\)$/.test(b.pl) &&
      c.h.startsWith('#/summary/') && c.rt && c.rt.finish && c.rt.t === a.pr.t && c.rt.target === a.pr.target && c.type === 'route' && c.h1 === 'Ziel erreicht!' && /Vorgabe/.test(c.card) && /Zeit bis Ziel/.test(c.card) && /inkl\. Auslaufen/.test(c.card) && /von \d+ m/.test(c.hm) && c.map && c.prof;
    return { ok, d: `«${a.fin}» ${a.ft}, Soll ${a.ts} km/h, Notiz «${a.note}»; nach 10 s ${b.st} «${b.pl}»; Abschluss ${c.h.slice(0, 12)}… «${c.h1}», Strecke Ziel ${c.rt && c.rt.target} s gegen ${c.rt && c.rt.t} s, Karte ${c.map}, Profil ${c.prof}` };
  });
  await flow('Strecke: Leaflet 1.9.4 lokal, Karte Zoom 11 bis 16 mit Ausschnittgrenze, Kacheln nur Stufe 12 bis 16 und nur über /tiles des Dienstes, Luftbild «luft» in der Schweiz, abgedunkelt, Quelle «© swisstopo SWISSIMAGE»', async p => {
    await p.goto(BASE + '?demo=1&frozen=1#/strecke/' + rFirst); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => {
      const m = window.TX.rte._lastMap.map, imgs = Array.from(document.querySelectorAll('.leaflet-tile')).map(i => i.src);
      return { v: window.L && window.L.version, src: Array.from(document.scripts).map(s => s.getAttribute('src')).filter(s => /leaflet/.test(s || '')), css: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(l => l.getAttribute('href')),
        zmin: m.getMinZoom(), zmax: m.getMaxZoom(), mb: !!m.options.maxBounds, n: imgs.length, ext: imgs.filter(u => !u.startsWith(location.origin + '/tiles/')).length, grau: imgs.filter(u => /\/tiles\/luft\//.test(u)).length, flt: getComputedStyle(document.querySelector('.leaflet-tile')).filter, attr: (document.querySelector('.leaflet-control-attribution') || {}).textContent || '', z: imgs.map(u => +new URL(u).pathname.split('/')[3]) };
    });
    const ok = r.v === '1.9.4' && r.src.join() === 'lib/leaflet/leaflet.js' && r.css.includes('lib/leaflet/leaflet.css') && r.zmin === 11 && r.zmax === 16 && r.mb && r.n > 0 && r.ext === 0 && r.grau === r.n && r.z.every(z => z >= 12 && z <= 16) && /brightness\(0\.62\) saturate\(0\.85\)/.test(r.flt) && /swisstopo SWISSIMAGE/.test(r.attr);
    return { ok, d: `Leaflet ${r.v} aus ${r.src}, Zoom ${r.zmin} bis ${r.zmax}, Grenze ${r.mb}; ${r.n} Kacheln, alle /tiles/luft ${r.grau === r.n}, Filter «${r.flt}», Quelle «${r.attr}», Zoomstufen ${[...new Set(r.z)].join('/')}` };
  });
  await flow('Strecke: Laufansicht bei vollständig gesperrtem Netz (keine Kacheln, kein fremder Host): Linie, Punkt, Profil und Soll-Pace funktionieren', async p => {
    tilesOn = false; const n0 = tileReq;
    await p.goto(BASE + '?demo=1&frozen=1&szenario=strecke#/strecke/' + rFirst); await p.evaluate(() => window.TX.demoReady); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => ({ line: document.querySelectorAll('.rmap path.leaflet-interactive, .rmap svg path').length, me: !!document.querySelector('.mk-me'), prof: !!document.querySelector('.rprof svg path[stroke="#2fd27a"]'),
      sp: document.querySelector('[data-k="sp"]').textContent, start: !!document.querySelector('.mk-start'), ziel: !!document.querySelector('.mk-ziel') }));
    tilesOn = true;
    const ok = r.line >= 3 && r.me && r.prof && /^\d+:\d\d$/.test(r.sp) && r.start && r.ziel;
    return { ok, d: `Kacheln leer (${tileReq - n0} Anfragen an 127.0.0.1), Linien ${r.line}, Punkt ${r.me}, Start/Ziel ${r.start}/${r.ziel}, Profil ${r.prof}, Soll-Pace «${r.sp}»` };
  });
}
await flowsDone();
add(!extReq.length, 'Kein Zugriff auf fremde Hosts: jede Anfrage ausser 127.0.0.1 abgefangen (alle Ansichten und Abläufe, Ausnahme gemockter swisstopo-Import)', extReq.length ? extReq.slice(0, 8).join('\n      ') : 'keine Anfrage nach aussen');

/* ---------- Lighthouse ---------- */
if (!NOLH && !ONLY.length) {
  try {
    const { default: lighthouse } = await import('lighthouse');
    const chromeLauncher = await import('chrome-launcher');
    const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags: ['--headless=new', '--no-sandbox'] });
    const r = await lighthouse(BASE + '?demo=1#/', { port: chrome.port, onlyCategories: ['accessibility'], logLevel: 'error' },
      { extends: 'lighthouse:default', settings: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1280, height: 720, deviceScaleFactor: 1.5, disabled: false }, onlyCategories: ['accessibility'] } });
    const sc = Math.round(r.lhr.categories.accessibility.score * 100);
    const failed = Object.values(r.lhr.audits).filter(a => a.score !== null && a.score < 1 && a.scoreDisplayMode === 'binary').map(a => a.id);
    add(sc >= 95, 'Lighthouse Accessibility Startseite >= 95', sc + (failed.length ? ' (offen: ' + failed.join(', ') + ')' : ''));
    await chrome.kill();
  } catch (e) { add(false, 'Lighthouse Accessibility Startseite >= 95', 'nicht ausführbar: ' + e.message); }
}

/* ---------- Statische Pruefungen ---------- */
function walk(d) { return fs.readdirSync(d).flatMap(f => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : [p]; }); }
// Streckendaten (strecken/*.json) zaehlen nicht zur Oberflaeche
const files = walk(WWW).filter(f => !f.includes(path.sep + 'strecken' + path.sep)), size = files.reduce((s, f) => s + fs.statSync(f).size, 0);
add(size < 1.5 * 1024 * 1024, 'Gesamtgrösse assets/www ohne Streckendaten < 1.5 MB', (size / 1024).toFixed(0) + ' KB in ' + files.length + ' Dateien');
const text = files.filter(f => /\.(html|css|js)$/.test(f)).map(f => [path.relative(WWW, f), fs.readFileSync(f, 'utf8')]);
const bad = [];
for (const [f, s] of text) {
  if (/[\u2013\u2014]/.test(s)) bad.push(f + ': Gedankenstrich');
  if (/\u00df/.test(s)) bad.push(f + ': Eszett');
}
add(!bad.length, 'Texte ohne Gedankenstriche und ohne Eszett', bad.join(', ') || 'sauber');
{ // Regelwerk der Gestaltung (notes/gestaltungsregeln.md): Radien, Schrift, Laufweite, Abstaende im Raster, Chip-Hoehen; Pille: Schrift und Radien
  const g = [...pruefeCss(fs.readFileSync(path.join(WWW, 'css/app.css'), 'utf8')), ...pruefePille(fs.readFileSync(path.join(HERE, '../src/com/gapsch/treadctl/OverlayService.java'), 'utf8'))];
  add(!g.length, 'Gestaltungsregeln: Radien 4/8/12/14/18/24, Schriftstufen, Laufweite 1.2 px, Abstände im 4-px-Raster, Chips 32 px; Pille gleich', g.slice(0, 12).join(', ') || 'eingehalten');
}
// Erlaubt sind nur XML-Namensraeume (keine Anfragen) und der swisstopo-Hoehendienst, den der Import einmal nutzt
// (Verbesserung, ohne Netz bleiben die GPX-Hoehen); CSS-Kommentare zaehlen nicht.
const EXT_OK = { 'www.w3.org': 'XML-Namensraum', 'www.topografix.com': 'GPX-Namensraum', 'www.garmin.com': 'TCX-Namensraum', 'api3.geo.admin.ch': 'swisstopo-Höhen beim Import' };
const ext = [], extOk = new Set();
for (const [f, s0] of text) {
  const s = f.endsWith('.css') ? s0.replace(/\/\*[\s\S]*?\*\//g, '') : s0;
  (s.match(/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}\//gi) || []).forEach(u => { const h = u.replace(/^(https?:)?\/\//, '').replace(/\/$/, ''); if (EXT_OK[h]) extOk.add(h); else ext.push(f + ': ' + u); });
  if (/@import|fonts\.googleapis|@font-face[^}]*url\(\s*['"]?https?:/.test(s)) ext.push(f + ': @import/Webfont');
}
add(!ext.length, 'Keine externen Ressourcen, keine Webfonts, keine CDN', ext.join(', ') || 'nur lokale Dateien; erlaubt: ' + [...extOk].map(h => h + ' (' + EXT_OK[h] + ')').join(', '));
const compat = [];
const JSX = [[/\?\.[a-zA-Z_$[(]/, 'optionale Verkettung ?. (Chrome 80)'], [/\?\?/, 'Nullish ?? (Chrome 80)'], [/\?\?=|\|\|=|&&=/, 'logische Zuweisung (Chrome 85)'], [/\.replaceAll\(/, 'replaceAll (85)'], [/\.at\(-?\d/, '.at() (92)'], [/structuredClone/, 'structuredClone (98)'],
  [/Object\.hasOwn\b/, 'Object.hasOwn (93)'], [/findLast/, 'findLast (97)'], [/replaceChildren/, 'replaceChildren (86)'], [/\s#[a-z]\w*\s*\(/, 'private Methode (84)'], [/\bawait\s+import\(/, 'dynamischer Import']];
const CSSX = [[/backdrop-filter/, 'backdrop-filter (76)'], [/\binset\s*:/, 'inset (87)'], [/aspect-ratio/, 'aspect-ratio (88)'], [/:is\(|:where\(|:has\(/, ':is/:where/:has'], [/:focus-visible/, ':focus-visible (86)'], [/\bclamp\(/, null]];
for (const [f, s] of text) {
  if (f.endsWith('.js')) JSX.forEach(([re, m]) => { if (re.test(s)) compat.push(f + ': ' + m); });
  const css = f.endsWith('.css') ? s : (s.match(/style="[^"]*"|cssText\s*=\s*'[^']*'/g) || []).join(' ');
  CSSX.forEach(([re, m]) => { if (m && re.test(css)) compat.push(f + ': ' + m); });
}
add(!compat.length, 'Chrome-74-Regeln (statisch: kein ?. ??, kein backdrop-filter, CSS; Flex-gap per Ersatz)', compat.join(', ') || 'keine neueren Funktionen gefunden');

/* ---------- Ausgabe ---------- */
await browser.close(); server.close();
const okN = res.filter(r => r[0]).length;
console.log('\nUI-Audit Tread Control (' + new Date().toLocaleString('de-CH') + ')');
console.log('Bilder: ' + OUT + '\n');
res.forEach(([ok, p, d]) => console.log((ok ? '[OK]     ' : '[FEHLER] ') + p + (d ? '\n      ' + d : '')));
console.log(`\nErgebnis: ${okN} von ${res.length} Punkten erfüllt`);
process.exit(okN === res.length ? 0 : 1);
