#!/usr/bin/env node
// Misst die Gestaltung aller Ansichten im Demo-Modus (1280x720 CSS, Faktor 1.5 wie auf der Konsole) und sucht
// Uneinheitlichkeiten: Schriftgroessen und -staerken, Farben ausserhalb der Palette, Radien, Innenabstaende, Abstaende
// zwischen Karten, Hoehen gleicher Bausteine, abgeschnittene Texte, Ueberlappungen. Ausgabe: JSON nach argv[2].
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.join(HERE, '../assets/www');
const OUT = process.argv[2] || '/tmp/design-messung.json';
const TY = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (u.startsWith('/api/') || u.startsWith('/tiles/')) { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end('{"ok":true}'); return; }
  const f = path.join(WWW, u === '/' ? 'index.html' : u);
  if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': TY[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const B = `http://127.0.0.1:${srv.address().port}/`;
const VIEWS = [
  ['start', '', '#/'], ['apps', '', '#/apps'], ['plaene', '', '#/plans'], ['verlauf', '', '#/history'], ['geraete', '', '#/geraete'],
  ['strecken', '', '#/strecken'], ['strecke-plan', '', '#/strecke/homberg-runde'], ['schnellstart', '', '#/run'], ['zonen-plan', '', '#/zones'],
  ['intervall-plan', '', '#/interval/p-schwelle'], ['editor', '', '#/plans/edit/p-rigi'], ['zusammenfassung', 'lauf', '#/summary'],
  ['lauf', 'lauf', 'T'], ['pause', 'pause', 'T'], ['fehler', 'fehler', 'T'], ['intervall-lauf', 'intervall', 'T'], ['zonen-lauf', 'zonen', 'T'],
  ['strecke-lauf', 'strecke', 'T'], ['stufentest', 'stufentest', 'T'], ['profil', '', 'P'],
];
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 }); const p = await ctx.newPage();
const res = {};
for (const [name, sz, h] of VIEWS) {
  await p.goto(B + '?demo=1' + (sz ? '&szenario=' + sz : '') + '#/'); await p.waitForTimeout(900);
  if (h === 'T') await p.evaluate(() => { location.hash = TX.trainHash(TX.api.state); });
  else if (h === 'P') await p.click('.avatar');
  else await p.evaluate(x => { location.hash = x; }, h);
  await p.waitForTimeout(1500);
  if (name === 'zusammenfassung') { await p.evaluate(() => TX.sim.cmd({ c: 'end' })); await p.waitForTimeout(1500); }
  res[name] = await p.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(e).visibility !== 'hidden'; };
    const sel = e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    const path2 = e => (e.parentElement ? sel(e.parentElement) + ' > ' : '') + sel(e);
    const o = { font: {}, weight: {}, color: {}, bg: {}, radius: {}, pad: {}, gap: {}, ctlH: {}, chipH: {}, iconSz: {}, ls: {}, clip: [], overlap: [], cardGap: [] };
    const add = (k, v, ex) => { if (!o[k][v]) o[k][v] = { n: 0, ex: ex }; o[k][v].n++; };
    const all = Array.from(document.querySelectorAll('body *')).filter(vis);
    for (const e of all) {
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const hasText = Array.from(e.childNodes).some(n => n.nodeType === 3 && n.nodeValue.trim());
      if (hasText) {
        add('font', cs.fontSize, path2(e)); add('weight', cs.fontWeight, path2(e)); add('color', cs.color, path2(e));
        if (cs.textTransform === 'uppercase') add('ls', cs.letterSpacing, path2(e));
        if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1) o.clip.push(path2(e) + ' «' + e.textContent.trim().slice(0, 30) + '»');
      }
      const bgc = cs.backgroundColor; if (bgc && bgc !== 'rgba(0, 0, 0, 0)') { add('bg', bgc, path2(e)); add('radius', cs.borderTopLeftRadius, path2(e)); if (r.width > 120 && r.height > 60) add('pad', cs.paddingTop + ' ' + cs.paddingLeft, path2(e)); }
      if ((cs.display.includes('flex') || cs.display.includes('grid')) && cs.gap !== 'normal' && e.children.length > 1) add('gap', cs.gap, path2(e));
      const ctl = e.matches('button, a.btn, [role=radio], [role=switch], input, select');
      if (ctl && r.height > 0) add('ctlH', Math.round(r.height) + 'px', path2(e));
      if (e.matches('.chip')) add('chipH', Math.round(r.height) + 'px r=' + cs.borderTopLeftRadius, path2(e));
      if (e.tagName.toLowerCase() === 'svg' && e.closest('button, a')) add('iconSz', Math.round(r.width) + 'x' + Math.round(r.height), path2(e.closest('button, a')));
    }
    // Abstaende zwischen benachbarten Karten
    const cards = Array.from(document.querySelectorAll('.card')).filter(vis).map(e => e.getBoundingClientRect());
    for (let i = 0; i < cards.length; i++) for (let j = 0; j < cards.length; j++) {
      if (i === j) continue; const a = cards[i], c = cards[j];
      const vOverlap = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top), hOverlap = Math.min(a.right, c.right) - Math.max(a.left, c.left);
      if (vOverlap > 20 && c.left >= a.right - 1 && c.left - a.right < 60) o.cardGap.push(Math.round(c.left - a.right));
      if (hOverlap > 20 && c.top >= a.bottom - 1 && c.top - a.bottom < 60) o.cardGap.push(Math.round(c.top - a.bottom));
    }
    // Inhalt, der unten oder rechts aus seiner Karte ragt (ausser in scrollbaren Listen)
    o.spill = [];
    for (const c of document.querySelectorAll('.card')) {
      if (!vis(c)) continue; const cr = c.getBoundingClientRect();
      for (const e of c.querySelectorAll('*')) {
        if (!vis(e) || e.matches('.ph,.shade') || e.closest('.leaflet-container')) continue;
        let sc = false; for (let a = e.parentElement; a && a !== c; a = a.parentElement) { const ov = getComputedStyle(a).overflowY; if (ov === 'auto' || ov === 'scroll') { sc = true; break; } }
        if (sc) continue;
        const r = e.getBoundingClientRect(); if (r.height < 2) continue;
        if (r.bottom > cr.bottom + 1 || r.right > cr.right + 1) { o.spill.push(sel(c) + ' > ' + path2(e) + ' (' + Math.round(Math.max(r.bottom - cr.bottom, r.right - cr.right)) + ' px)'); break; }
      }
    }
    // Ueberlappende Knoepfe (nicht verschachtelt)
    const btn = Array.from(document.querySelectorAll('button, a.btn')).filter(vis);
    for (let i = 0; i < btn.length; i++) for (let j = i + 1; j < btn.length; j++) {
      if (btn[i].contains(btn[j]) || btn[j].contains(btn[i])) continue;
      const a = btn[i].getBoundingClientRect(), c = btn[j].getBoundingClientRect();
      const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), hh = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (w > 4 && hh > 4) o.overlap.push(sel(btn[i]) + ' / ' + sel(btn[j]));
    }
    return o;
  });
}
await b.close(); srv.close();
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
// Zusammenfassung ueber alle Ansichten
const tot = {};
for (const v of Object.values(res)) for (const k of ['font', 'weight', 'color', 'bg', 'radius', 'pad', 'gap', 'ctlH', 'chipH', 'iconSz', 'ls']) {
  tot[k] = tot[k] || {}; for (const [val, x] of Object.entries(v[k])) { tot[k][val] = tot[k][val] || { n: 0, ex: x.ex }; tot[k][val].n += x.n; }
}
for (const k of Object.keys(tot)) {
  const e = Object.entries(tot[k]).sort((a, c) => c[1].n - a[1].n);
  console.log(`\n${k}: ${e.length} Werte`); e.slice(0, 40).forEach(([val, x]) => console.log(`  ${String(x.n).padStart(4)}  ${val}   z. B. ${x.ex}`));
}
const cg = {}; Object.values(res).forEach(v => v.cardGap.forEach(g => { cg[g] = (cg[g] || 0) + 1; }));
console.log('\nAbstand zwischen Karten (px: Anzahl):', JSON.stringify(cg));
for (const [n, v] of Object.entries(res)) { if (v.clip.length) console.log(`abgeschnitten in ${n}: ${[...new Set(v.clip)].slice(0, 8).join(' | ')}`); if (v.spill.length) console.log(`ragt heraus in ${n}: ${[...new Set(v.spill)].slice(0, 6).join(' | ')}`); if (v.overlap.length) console.log(`Ueberlappung in ${n}: ${[...new Set(v.overlap)].slice(0, 6).join(' | ')}`); }
