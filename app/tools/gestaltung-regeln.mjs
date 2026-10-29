// Regelwerk der Gestaltung (docs/de/design-rules.md, intern notes/gestaltungsregeln.md) als Pruefung: erlaubte Stufen fuer Radien, Schrift, Laufweite,
// Abstaende und Hoehen in app.css und in der Pille (OverlayService.java). Liefert eine Liste der Verstoesse.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

export const REGELN = {
  radius: [0, 1, 4, 8, 12, 14, 18, 24],               // Balken, Chips, Felder/Symbolknoepfe, Textknoepfe/Flaechen in Karten, Karten/grosse Knoepfe, Dialoge
  rund: /^(\.avatar|\.kmk|\.mpsrc|\.tg::after|\.tg|.*\.dot|.*::before|.*::after)$/,   // 50 %: nur Profilbild, Marker, Punkte, Schalter
  text: [13, 15, 17, 20, 22, 26, 30, 34, 42, 60, 72], // Text, Ueberschriften, Zahlen; ab 90 px Sonderanzeigen (Countdown, Uhr)
  symbol: [16, 20, 24, 28, 34, 40],
  laufweite: [1.2],                                 // gesperrte Grossbuchstaben; kleiner als 1 px als Feinkorrektur erlaubt
  hoehe: [32, 48, 56, 60, 76],                      // Chip, Knopf, Hauptknopf, Zeile, START/STOP
};
const ICON = /(\.i|\.ico|\.ic|\.ri|\.aui|\.dli|\.pic|\.ii|\.tb|\.hci|\.fic|\.fic2|\.dico|\.mmi|\.mmi \.i|\.hback|\.hbtn|\.favb|\.ebtn|\.rdel|\.mpb|\.mpb\.big|\.mpx|\.mpn|\.sbg|\.fgo|\.fz|\.spk \.i|\.mpcov|\.phlg|\.fl|\.adj \.b|\.mpout>\.i|\.rban)$/;
const AUSNAHME_SCHRIFT = /(\.kmk|leaflet)/;          // Kartenmarker und Quellenangabe der Karte
const AUSNAHME_LAUFWEITE = /^(\.brand|\.sbrand|\.bw|\.fl|\.cdown \.seq)$/;   // Wortmarke und Grossanzeigen
const ok4 = v => v <= 4 || v % 4 === 0 || v === 18;  // Raster 4 px; 18 px = Seitenrand (--gx)

export function pruefeCss(css) {
  const bad = [];
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((m = re.exec(clean))) {
    const sel = m[1].trim().replace(/\s+/g, ' ').split(',').pop().trim(), body = m[2];
    const d = (p) => { const r = new RegExp('(?:^|;|\\s)' + p + '\\s*:\\s*([^;}]+)').exec(body); return r ? r[1].trim() : null; };
    const r = d('border-radius');
    if (r && !/var\(|inherit/.test(r)) {
      const parts = r.split(/\s+/);
      if (parts.length === 1) {
        if (r === '50%') { if (!REGELN.rund.test(sel)) bad.push(sel + ': Radius 50 %'); }
        else if (/px$/.test(r) && !REGELN.radius.includes(parseFloat(r)) && !(sel === '.tg')) bad.push(sel + ': Radius ' + r);
      }
    }
    const f = d('font-size');
    if (f && /px$/.test(f) && !AUSNAHME_SCHRIFT.test(sel)) {
      const v = parseFloat(f);
      if (v < 90 && !(ICON.test(sel) ? REGELN.symbol : REGELN.text).includes(v)) bad.push(sel + ': Schrift ' + f);
    }
    const ls = d('letter-spacing');
    if (ls && /px$/.test(ls)) { const v = parseFloat(ls); if (v >= 1 && !REGELN.laufweite.includes(v) && !AUSNAHME_LAUFWEITE.test(sel)) bad.push(sel + ': Laufweite ' + ls); }
    for (const p of ['gap', 'padding', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right']) {
      const v = d(p); if (!v || /calc|var\(/.test(v)) continue;
      (v.match(/-?\d*\.?\d+px/g) || []).forEach(x => { if (!ok4(Math.abs(parseFloat(x)))) bad.push(sel + ': ' + p + ' ' + x); });
    }
    if (/\.chip$/.test(sel)) { const h = d('height'); if (h && /px$/.test(h) && ![32, 48, 56].includes(parseFloat(h))) bad.push(sel + ': Chip-Hoehe ' + h); }
  }
  return bad;
}

export function pruefePille(java) {
  const bad = [];
  (java.match(/COMPLEX_UNIT_DIP, (\d+)\)/g) || []).forEach(x => { const v = +x.match(/(\d+)\)/)[1]; if (v < 90 && v !== 12 && ![...REGELN.text, ...REGELN.symbol].includes(v)) bad.push('Pille: Schrift ' + v); });
  (java.match(/\bround\([^;]*?dp\((\d+)\)/g) || []).forEach(x => { const v = +x.match(/dp\((\d+)\)$/)[1]; if (!REGELN.radius.includes(v)) bad.push('Pille: Radius ' + v); });
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const css = fs.readFileSync(path.join(HERE, '../assets/www/css/app.css'), 'utf8');
  const java = fs.readFileSync(path.join(HERE, '../src/com/gapsch/treadctl/OverlayService.java'), 'utf8');
  const b = [...pruefeCss(css), ...pruefePille(java)];
  console.log(b.length ? b.join('\n') : 'Regelwerk eingehalten'); console.log(b.length + ' Abweichungen');
}
