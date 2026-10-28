// Browser-Trace einer Ansicht am Geraet: lange Aufgaben (> 40 ms) und ihre Bestandteile (nur mit files/webdebug).
// Aufruf: node perf-trace.mjs '<pfad>' [sekunden]
import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9333'); const ctx = b.contexts()[0], p = ctx.pages()[0], cdp = await ctx.newCDPSession(p);
const O = new URL(p.url()).origin, path = process.argv[2], sec = +(process.argv[3] || 10);
await p.goto(O + path, { waitUntil: 'load' }); await p.waitForTimeout(2500);
const ev = [];
cdp.on('Tracing.dataCollected', d => ev.push(...d.value));
const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
await p.waitForTimeout(sec * 1000);
await cdp.send('Tracing.end'); await done;
const main = ev.filter(e => e.name === 'RunTask' && e.dur > 40000);
const kids = ['FunctionCall', 'TimerFire', 'EvaluateScript', 'UpdateLayoutTree', 'Layout', 'Paint', 'ParseHTML', 'PrePaint', 'Layerize', 'UpdateLayer', 'HitTest', 'MajorGC', 'MinorGC', 'FireAnimationFrame', 'ResourceReceivedData', 'XHRReadyStateChange', 'Commit', 'RasterTask'];
console.log('lange Aufgaben', main.length);
main.slice(0, 8).forEach(m => {
  const sub = ev.filter(e => e.ts >= m.ts && e.ts <= m.ts + m.dur && e.tid === m.tid && kids.includes(e.name) && e.dur);
  const agg = {}; sub.forEach(e => { agg[e.name] = (agg[e.name] || 0) + e.dur / 1000; });
  const fn = sub.filter(e => e.name === 'FunctionCall' || e.name === 'TimerFire').map(e => (e.args && e.args.data && (e.args.data.functionName || e.args.data.url || '')) + '').slice(0, 3);
  console.log(Math.round(m.dur / 1000) + ' ms', JSON.stringify(Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, Math.round(v)]))), fn.join(' | '));
});
await p.goto(O + '/#/'); await b.close();
