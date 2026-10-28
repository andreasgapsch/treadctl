// CPU-Profil und laufende Animationen einer Ansicht am Geraet (Chrome-Werkzeuge, files/webdebug).
// Aufruf: node perf-profil.mjs '<pfad>' [sekunden]
import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = b.contexts()[0], p = ctx.pages()[0], cdp = await ctx.newCDPSession(p);
const ORIGIN = new URL(p.url()).origin, path = process.argv[2] || '/?demo=1&szenario=strecke#/strecke/homberg-runde', sec = +(process.argv[3] || 6);
await p.goto(ORIGIN + path, { waitUntil: 'load' }); await p.waitForTimeout(2500);
const anim = await p.evaluate(() => document.getAnimations().map(a => (a.animationName || a.constructor.name) + ' @' + (a.effect && a.effect.target ? (a.effect.target.className && a.effect.target.className.baseVal !== undefined ? a.effect.target.className.baseVal : a.effect.target.className) : '')).slice(0, 20));
console.log('Animationen', anim.length, JSON.stringify(anim));
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
await p.waitForTimeout(sec * 1000);
const { profile } = await cdp.send('Profiler.stop');
// Selbstzeit je Funktion
const dt = {}, byId = {}; profile.nodes.forEach(n => byId[n.id] = n);
const tot = {}; for (let i = 0; i < profile.samples.length; i++) { const n = byId[profile.samples[i]], f = n.callFrame; const k = (f.functionName || '(anonym)') + ' ' + (f.url.split('/').pop()) + ':' + (f.lineNumber + 1); tot[k] = (tot[k] || 0) + (profile.timeDeltas[i] || 0); }
const all = Object.values(tot).reduce((a, b) => a + b, 0);
Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([k, v]) => console.log((v / 1000).toFixed(0).padStart(6) + ' ms ' + (v / all * 100).toFixed(1).padStart(5) + ' %  ' + k));
await p.goto(ORIGIN + '/#/'); await b.close();
