// Leistung der Oberflaeche am echten Geraet messen (WebView per Chrome-Werkzeuge, nur mit files/webdebug).
// Aufruf: adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>; node perf-messung.mjs [ansichten]
// Je Ansicht: Aufbauzeit (Hash-Wechsel bis zwei ruhige Frames), 8 s Ruhe: Bilder je s, lange Aufgaben, Hauptthread-Last.
import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = b.contexts()[0], p = ctx.pages()[0];
const cdp = await ctx.newCDPSession(p);
await cdp.send('Performance.enable');
const ORIGIN = new URL(p.url()).origin;
const VIEWS = [
  ['start', '/#/'], ['training', '/#/train'], ['plaene', '/#/plans'], ['apps', '/#/apps'], ['verlauf', '/#/history'],
  ['strecken', '/#/strecken'], ['strecke-planung', '/#/strecke/homberg-runde'], ['geraete', '/#/geraete'],
  ['lauf-demo', '/?demo=1&szenario=lauf#/run'], ['intervall-demo', '/?demo=1&szenario=intervall#/interval/p-schwelle'],
  ['zonen-demo', '/?demo=1&szenario=zonen#/zones'], ['strecke-lauf-demo', '/?demo=1&szenario=strecke#/strecke/homberg-runde'],
  ['stufentest-demo', '/?demo=1&szenario=stufentest#/interval/p-hfmax'],
];
const only = process.argv.slice(2);
const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const rows = [];
for (const [name, path] of VIEWS) {
  if (only.length && !only.includes(name)) continue;
  const url = ORIGIN + path, sameDoc = new URL(url).search === new URL(p.url()).search;
  const t0 = Date.now();
  if (sameDoc) await p.evaluate(h => { window.__navT = performance.now(); location.hash = h; }, new URL(url).hash);
  else await p.goto(url, { waitUntil: 'load' });
  // Aufbau: bis zwei Frames hintereinander < 34 ms liegen (nach dem Hash-Wechsel bzw. Laden)
  const build = await p.evaluate(() => new Promise(res => {
    const s = window.__navT || performance.timeOrigin && 0, st = performance.now(); let last = st, calm = 0;
    const f = t => { const d = t - last; last = t; calm = d < 34 ? calm + 1 : 0; if (calm >= 2 || t - st > 5000) res(Math.round(t - (window.__navT || st))); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  const load = Date.now() - t0;
  await p.waitForTimeout(1500);
  // 8 s Ruhe: Frames, lange Aufgaben, Last
  await p.evaluate(() => { window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: false }); } catch (e) {} });
  const m0 = await metric();
  const fr = await p.evaluate(() => new Promise(res => { let n = 0, worst = 0, last = performance.now(); const st = last;
    const f = t => { n++; worst = Math.max(worst, t - last); last = t; if (t - st < 8000) requestAnimationFrame(f); else res({ n, worst: Math.round(worst), ms: t - st }); }; requestAnimationFrame(f); }));
  const m1 = await metric();
  const lt = await p.evaluate(() => window.__lt.slice());
  const busy = k => ((m1[k] - m0[k]) / (fr.ms / 1000) * 100);
  rows.push({ name, build, load, fps: Math.round(fr.n / (fr.ms / 1000)), worst: fr.worst, longtasks: lt.length, ltmax: Math.round(Math.max(0, ...lt)),
    task: busy('TaskDuration').toFixed(1), script: busy('ScriptDuration').toFixed(1), layout: busy('LayoutDuration').toFixed(1), style: busy('RecalcStyleDuration').toFixed(1),
    heap: Math.round(m1.JSHeapUsedSize / 1048576), nodes: m1.Nodes });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
await p.goto(ORIGIN + '/#/');
await b.close();
