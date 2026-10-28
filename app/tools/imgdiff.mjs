// Hilfswerkzeug: Bereich mit Unterschieden zwischen zwei PNG (gleiche Groesse), Ausgabe in CSS-px (Faktor 1.5).
// Aufruf: node imgdiff.mjs a.png b.png
import { chromium } from 'playwright';
import fs from 'node:fs';
const [a, b] = process.argv.slice(2);
const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const p = await br.newPage();
const r = await p.evaluate(async ({ a, b }) => {
  const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
  const [A, B] = await Promise.all([load(a), load(b)]);
  const get = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const da = get(A), db = get(B), W = A.width, H = A.height, boxes = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4; if (Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]) < 90) continue;
    const key = Math.floor(y / 90) + ':' + Math.floor(x / 160); boxes[key] = (boxes[key] || 0) + 1;
  }
  return Object.entries(boxes).filter(e => e[1] > 30).map(([k, n]) => { const [r, c] = k.split(':').map(Number); return `x ${Math.round(c * 160 / 1.5)} y ${Math.round(r * 90 / 1.5)}: ${n}`; });
}, { a: 'data:image/png;base64,' + fs.readFileSync(a).toString('base64'), b: 'data:image/png;base64,' + fs.readFileSync(b).toString('base64') });
console.log(r.join('\n') || 'gleich');
await br.close();
