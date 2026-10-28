// SVG-Diagramme aus den RouteSim-Ergebnissen: Hoehenprofil, Bandsteigung, Plan- und Simulationstempo ueber die Distanz.
// Aufruf: node diagramme.mjs <ergebnis.json> <profil.txt> <titel> <ausgabe.svg>
import fs from 'node:fs';
const [, , resF, profF, title, outF] = process.argv;
const r = JSON.parse(fs.readFileSync(resF, 'utf8'));
const prof = fs.readFileSync(profF, 'utf8').trim().split('\n').map(l => l.split(/\s+/).map(Number));
const W = 1100, H = 440, L = 56, R = 56, T = 60, B = 40, pw = W - L - R;
const D = r.D;
const X = d => L + d / D * pw;
const eMin = Math.min(...prof.map(p => p[1])), eMax = Math.max(...prof.map(p => p[1]));
const eh = 150, eTop = T;                       // Hoehenband oben
const Ye = e => eTop + eh - (e - eMin) / Math.max(1, eMax - eMin) * eh;
const sTop = T + eh + 30, sh = 150;            // Tempo/Steigung unten
const sp = r.secs.map(s => s[2]), sMin = Math.floor(Math.min(...sp, ...r.tl.map(t => t[2]).filter(v => v > 1)) - 1), sMax = Math.ceil(Math.max(...sp) + 1);
const Ys = v => sTop + sh - (v - sMin) / (sMax - sMin) * sh;
const Yi = v => sTop + sh - v / 15 * sh;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter,Arial,sans-serif" font-size="12">`;
o += `<rect width="${W}" height="${H}" fill="#fff"/>`;
o += `<text x="${L}" y="22" font-size="15" font-weight="700" fill="#1b1e27">${esc(title)}</text>`;
// Raster km
const step = D > 30000 ? 5000 : 2000;
for (let d = 0; d <= D; d += step) {
  o += `<line x1="${X(d)}" x2="${X(d)}" y1="${T}" y2="${sTop + sh}" stroke="#e6e8ee"/>`;
  o += `<text x="${X(d)}" y="${H - 14}" text-anchor="middle" fill="#5b6070">${d / 1000} km</text>`;
}
// Hoehe
let pa = `M${X(0)},${eTop + eh}`; for (const p of prof) pa += `L${X(p[0]).toFixed(1)},${Ye(p[1]).toFixed(1)}`; pa += `L${X(D)},${eTop + eh}Z`;
o += `<path d="${pa}" fill="#cfe9d9" stroke="#2a9d5c" stroke-width="1.5"/>`;
o += `<text x="${L - 6}" y="${Ye(eMax) + 4}" text-anchor="end" fill="#2a9d5c">${Math.round(eMax)} m</text><text x="${L - 6}" y="${Ye(eMin)}" text-anchor="end" fill="#2a9d5c">${Math.round(eMin)} m</text>`;
// Bandsteigung (Stufen)
let pi = ''; r.secs.forEach((s, k) => { pi += `${k ? 'L' : 'M'}${X(s[0]).toFixed(1)},${Yi(s[3]).toFixed(1)}L${X(s[1]).toFixed(1)},${Yi(s[3]).toFixed(1)}`; });
o += `<path d="${pi}" fill="none" stroke="#d9a400" stroke-width="2"/>`;
// Plantempo (Stufen) und Simulation
let ps = ''; r.secs.forEach((s, k) => { ps += `${k ? 'L' : 'M'}${X(s[0]).toFixed(1)},${Ys(s[2]).toFixed(1)}L${X(s[1]).toFixed(1)},${Ys(s[2]).toFixed(1)}`; });
o += `<path d="${ps}" fill="none" stroke="#3d8bff" stroke-width="2.5"/>`;
let pv = ''; r.tl.forEach((t, k) => { pv += `${k ? 'L' : 'M'}${X(t[1]).toFixed(1)},${Ys(Math.max(sMin, t[2])).toFixed(1)}`; });
o += `<path d="${pv}" fill="none" stroke="#1b1e27" stroke-width="1" stroke-dasharray="3 3"/>`;
for (const v of [sMin, sMax]) o += `<text x="${L - 6}" y="${Ys(v) + 4}" text-anchor="end" fill="#3d8bff">${v} km/h</text>`;
o += `<text x="${W - R + 6}" y="${Yi(15) + 4}" fill="#b08600">15 %</text><text x="${W - R + 6}" y="${Yi(0) + 4}" fill="#b08600">0 %</text>`;
// Legende
const lg = [['#2a9d5c', 'Höhe (swisstopo, geglättet)'], ['#d9a400', 'Bandsteigung'], ['#3d8bff', 'Plantempo'], ['#1b1e27', 'Simuliertes Bandtempo']];
lg.forEach(([c, t], k) => { o += `<rect x="${L + k * 200}" y="34" width="14" height="4" fill="${c}"/><text x="${L + 20 + k * 200}" y="40" fill="#3b4050">${t}</text>`; });
o += '</svg>';
fs.writeFileSync(outF, o);
console.log('geschrieben', outF);
