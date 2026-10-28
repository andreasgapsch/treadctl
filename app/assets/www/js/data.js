/* Daten: Vorlagen, Verlauf, Einstellungen, Profil, Pulszonen, Umrechnungen. Alles in localStorage. */
(function () {
  'use strict';
  var TX = window.TX;
  var K = { plans: 'tx.plans.v1', hist: 'tx.history.v1', prefs: 'tx.prefs.v1', prof: 'tx.profile.v1', active: 'tx.active.v1' };
  TX.KEYS = K;
  TX.LIM = { sMin: 0.8, sMax: 20, iMin: 0, iMax: 15, dMin: 10, dMax: 7200 };

  function load(k, def) {
    try { var s = localStorage.getItem(k); if (s == null) return def; var v = JSON.parse(s); return v == null ? def : v; } catch (e) { return def; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  TX.load = load; TX.save = save;

  /* ---------- Profil und Pulszonen ---------- */
  TX.profile = function () {
    var p = load(K.prof, {}) || {};
    // Demo (Bilder, Pruefungen): neutraler Name statt des gespeicherten Profils
    var nm = /[?&]demo=1/.test(location.search) ? 'Läufer' : typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 30) : 'Läufer';
    return { name: nm, hf: TX.clamp(Math.round(+p.hf || 184), 120, 230),
      kg: TX.clamp(Math.round(+p.kg || 75), 35, 200) };
  };
  TX.saveProfile = function (p) { save(K.prof, { name: p.name, hf: p.hf, kg: p.kg }); };
  // Gewicht und HFmax an den Dienst (Kalorienberechnung, Zonen)
  TX.sendProfile = function () { var p = TX.profile(); return TX.api.cmd('profile', { weight: p.kg, hfmax: p.hf }); };
  TX.initials = function (n) {
    var w = String(n || '').trim().split(/\s+/);
    return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : (w[0] || '').charAt(1) || '')).toUpperCase();
  };
  // Grenzen in % HFmax: Z1 bis 70, Z2 70 bis 77, Z3 bis 85, Z4 bis 92, Z5 darueber
  TX.zones = function (hf) {
    hf = hf || TX.profile().hf;
    var e1 = Math.floor(hf * 0.70), e2 = Math.round(hf * 0.77), e3 = Math.round(hf * 0.85), e4 = Math.round(hf * 0.92);
    return [
      { z: 1, lo: Math.round(hf * 0.5), hi: e1 - 1, txt: '<' + e1 },
      { z: 2, lo: e1, hi: e2, txt: e1 + ' bis ' + e2 },
      { z: 3, lo: e2 + 1, hi: e3, txt: (e2 + 1) + ' bis ' + e3 },
      { z: 4, lo: e3 + 1, hi: e4, txt: (e3 + 1) + ' bis ' + e4 },
      { z: 5, lo: e4 + 1, hi: hf, txt: (e4 + 1) + '+' }
    ];
  };
  // 0 = kein Puls, -1 = Ruhe, 1 bis 5 = Zone
  TX.zoneOf = function (hr, hf) {
    if (!(hr > 0)) return 0;
    var zs = TX.zones(hf);
    if (hr < zs[0].lo) return -1;
    for (var i = 4; i >= 0; i--) if (hr >= zs[i].lo) return zs[i].z;
    return 1;
  };
  // Zonennamen einheitlich «Grundlage Zone 2» (Anzeige, Vorlagen, geladene Zonenprogramme)
  TX.ZN = ['', 'Erholung', 'Grundlage', 'Tempo', 'Schwelle', 'Maximum'];
  TX.zoneName = function (z) { return TX.ZN[z] ? TX.ZN[z] + ' Zone ' + z : 'Zone ' + z; };
  // Zonengrenzen zweizeilig fuer enge Spalten: oben Anfang, unten Ende
  TX.zoneTxt2 = function (x) {
    if (x.z === 1) return ['unter', String(x.hi + 1)];
    if (x.z === 5) return [String(x.lo), 'und höher'];
    return [String(x.lo), 'bis ' + x.hi];
  };
  TX.ZC = ['', 'var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];
  TX.ZT = ['', '#97a6bb', '#6ea8ff', '#2fd27a', '#ff8a3a', '#ff7884'];
  TX.ZHEX = ['#7d8fa8', '#7d8fa8', '#3d8bff', '#2fd27a', '#ff7a1a', '#ff4d5e'];
  // Sekunden je Zone aus dem Verlauf (Abstand der Punkte, hoechstens 30 s je Punkt)
  TX.zoneTimes = function (hist, hf) {
    var t = [0, 0, 0, 0, 0, 0];
    (hist || []).forEach(function (p, i) {
      var z = TX.zoneOf(p[3], hf); if (z < 0) z = 1;
      var dt = i ? Math.max(0, Math.min(30, p[0] - hist[i - 1][0])) : 0;
      if (z > 0) t[z] += dt;
    });
    return t;
  };

  /* ---------- Einstellungen ---------- */
  // hideBar: Konsole blendet die Herstellerleiste ueber Fremd-Apps aus (frueher Schluessel insetApps, gleicher Schalter)
  var PREF_DEF = { pill: true, pillGraph: true, autoCollapse: true, hideBar: true, range: 20 };
  TX.prefs = function () {
    var p = load(K.prefs, {}) || {}, o = {};
    if (!('hideBar' in p) && ('insetApps' in p)) p.hideBar = !!p.insetApps;
    for (var k in PREF_DEF) o[k] = (k in p) ? p[k] : PREF_DEF[k];
    o.zone = p.zone || null; return o;
  };
  TX.setPref = function (k, v) { var p = load(K.prefs, {}) || {}; p[k] = v; save(K.prefs, p); };

  /* ---------- Anzeige von Namen ----------
     Namen vom Dienst oder aus alten Daten: «5 x 4 min» und «5x4» werden zu «5 × 4», «Zone 2 · Grundlage» zu «Grundlage Zone 2». */
  TX.nm = function (n) {
    var s = String(n == null ? '' : n);
    s = s.replace(/(\d)\s*[xX]\s*(?=\d)/g, '$1 × ').replace(/(^|\s)[xX](?=\s|$)/g, '$1×');
    var m = /^Zone ([1-5]) · (.+)$/.exec(s);
    if (m && TX.ZN[+m[1]] === m[2]) s = TX.zoneName(+m[1]);
    return s;
  };

  /* ---------- Wechseltext (Banner hier, native Pille baut ihn gleich nach) ----------
     cur: {s, i} aktuelle Sollwerte; next: {s, i, k, name?} naechster Abschnitt.
     Ergebnis z. B. «Gleich Erholung · Tempo sinkt ↓ auf 8.0 km/h · Steigung 1.0 %».
     TX.changeDir liefert 'up', 'down' oder 'same' (Farbe: Erhoehung orange, Senkung blau). */
  TX.changeDir = function (cur, next) {
    var a = +(cur && cur.s) || 0, b = +(next && next.s) || 0;
    return b > a + 0.05 ? 'up' : b < a - 0.05 ? 'down' : 'same';
  };
  TX.changeText = function (cur, next) {
    if (!next) return '';
    var nm = next.name || (next.k === 'h' ? 'Belastung' : next.k === 'r' ? 'Erholung' : 'Auslaufen');
    var dir = TX.changeDir(cur, next);
    var t = dir === 'up' ? 'Tempo steigt ↑ auf ' : dir === 'down' ? 'Tempo sinkt ↓ auf ' : 'Tempo bleibt bei ';
    return 'Gleich ' + nm + ' · ' + t + TX.f1(next.s) + ' km/h · Steigung ' + TX.f1(next.i) + ' %';
  };

  /* ---------- Vorlagen ---------- */
  TX.TYPES = { interval: 'Intervall', zones: 'Zonen', huegel: 'Hügel', ziel: 'Ziel', test: 'Test' };
  TX.KIND = { w: 'Ein-/Auslaufen', h: 'Belastung', r: 'Erholung' };
  TX.KC = { w: 'var(--z1)', h: 'var(--warn)', r: 'var(--z2)' };
  function sg(m, s, i, k) { return { d: Math.round(m * 60), s: s, i: i, k: k }; }
  TX.ZDEF = [null,
    { s0: 6.5, sMin: 5.0, sMax: 8.0 }, { s0: 8.0, sMin: 6.0, sMax: 10.5 }, { s0: 9.5, sMin: 7.0, sMax: 12.0 },
    { s0: 11.0, sMin: 8.0, sMax: 14.0 }, { s0: 12.0, sMin: 9.0, sMax: 16.0 }];
  TX.defaultPlans = function () {
    return [
      { id: 'p-schwelle', name: 'Schwelle 5 × 4 min', type: 'interval', fav: true, days: [1, 4],
        desc: 'Fünf harte Abschnitte an der Schwelle mit kurzer Trabpause. Für Halbmarathon-Tempo.',
        items: [sg(10, 8.0, 1.0, 'w'), { rep: 5, items: [sg(4, 13.0, 2.0, 'h'), sg(2, 8.0, 1.0, 'r')] }, sg(8, 7.0, 0.0, 'w')] },
      { id: 'p-grundlage', name: 'Grundlage Zone 2', type: 'zones', fav: false, days: [2, 6],
        desc: 'Ruhiger Dauerlauf, das Tempo folgt dem Puls im Zielband.',
        zone: { z: 2, dur: 2700, s0: 8.0, sMin: 6.0, sMax: 10.5, i: 1.0 } },
      { id: 'p-pyramide', name: 'Pyramide 1-2-3-2-1', type: 'interval', fav: false, days: [],
        desc: 'Belastungen von 1 bis 3 min und zurück, Erholung gleich lang.',
        items: [sg(8, 8.0, 1.0, 'w'), sg(1, 12.0, 1.0, 'h'), sg(1, 8.0, 1.0, 'r'), sg(2, 12.5, 1.0, 'h'), sg(2, 8.0, 1.0, 'r'),
          sg(3, 13.0, 1.0, 'h'), sg(3, 8.0, 1.0, 'r'), sg(2, 12.5, 1.0, 'h'), sg(2, 8.0, 1.0, 'r'), sg(1, 12.0, 1.0, 'h'), sg(11, 7.0, 0.0, 'w')] },
      { id: 'p-rigi', name: 'Hügel Rigi', type: 'huegel', fav: false, days: [],
        desc: 'Drei Anstiege bis 9 % bei ruhigem Tempo, dazwischen flach.',
        items: [sg(5, 8.0, 1.0, 'w'), { rep: 3, items: [sg(3, 9.0, 4.0, 'h'), sg(3, 9.0, 7.0, 'h'), sg(3, 8.5, 9.0, 'h'), sg(2, 8.0, 1.0, 'r')] }, sg(2, 7.0, 0.0, 'w')] },
      { id: 'p-10km', name: '10 km Ziel', type: 'ziel', fav: false, days: [0],
        desc: 'Gleichmässig auf 10 km, Zielzeit 52 min.',
        items: [sg(5, 9.0, 1.0, 'w'), sg(44, 12.0, 1.0, 'h'), sg(3, 9.0, 1.0, 'w')] },
      { id: 'p-feierabend', name: 'Lockerer Feierabend', type: 'zones', fav: false, days: [],
        desc: 'Locker auslaufen nach einem langen Tag, Puls in Zone 1.',
        zone: { z: 1, dur: 1800, s0: 9.0, sMin: 6.0, sMax: 10.0, i: 0.5 } },
      TX.hfTestPlan()
    ];
  };
  // Stufentest HFmax: 10 min Einlaufen 8.0, dann jede Minute +0.5 km/h von 9.0 bis 17.0 (17 Stufen), 5 min Auslaufen 6.0; Steigung 1 %
  TX.HFTEST = 'p-hfmax';
  TX.hfTestPlan = function () {
    var st = []; for (var v = 9.0; v <= 17.0001; v += 0.5) st.push(sg(1, TX.r1(v), 1.0, 'h'));
    return { id: TX.HFTEST, name: 'Stufentest HFmax', type: 'test', fav: false, days: [],
      desc: 'Ab Minute 10 steigt das Tempo jede Minute um 0.5 km/h. Laufen bis zur Erschöpfung, dann STOP (Bildschirm oder Taste) und Auslaufen. Nur gesund und ausgeruht, Sicherheitsschlüssel befestigen, Pulsgurt verwenden.',
      items: [sg(10, 8.0, 1.0, 'w')].concat(st, [sg(5, 6.0, 1.0, 'w')]) };
  };
  // Test-Vorlage (Typ test) zu einem Plan oder Lauf
  TX.isTest = function (p) { return !!(p && p.type === 'test'); };
  function cleanSeg(x) {
    var L = TX.LIM;
    return { d: TX.clamp(Math.round(+x.d || 60), L.dMin, L.dMax), s: TX.clamp(TX.r1(+x.s || 8), L.sMin, L.sMax),
      i: TX.clamp(TX.r1(+x.i || 0), L.iMin, L.iMax), k: (x.k === 'h' || x.k === 'r') ? x.k : 'w' };
  }
  function cleanPlan(p) {
    if (!p || typeof p !== 'object' || !p.id || !p.name) return null;
    var o = { id: String(p.id), name: String(p.name).slice(0, 60), type: TX.TYPES[p.type] ? p.type : 'interval', desc: String(p.desc || '').slice(0, 300),
      fav: !!p.fav, days: Array.isArray(p.days) ? p.days.filter(function (d) { return d >= 0 && d <= 6; }) : [] };
    // «Zuletzt» steht nicht in der Vorlage (alte Werte p.last fallen weg), sondern kommt aus dem Verlauf: TX.lastRunOf
    if (o.type === 'zones') {
      var z = p.zone || {}, zd = TX.ZDEF[TX.clamp(+z.z || 2, 1, 5)];
      o.zone = { z: TX.clamp(+z.z || 2, 1, 5), dur: TX.clamp(Math.round(+z.dur || 2700), 300, 14400), s0: TX.clamp(+z.s0 || zd.s0, 0.8, 20),
        sMin: TX.clamp(+z.sMin || zd.sMin, 0.8, 20), sMax: TX.clamp(+z.sMax || zd.sMax, 0.8, 20), i: TX.clamp(+z.i || 0, 0, 15) };
      if (o.zone.sMax < o.zone.sMin) o.zone.sMax = o.zone.sMin;
    } else {
      o.items = (Array.isArray(p.items) ? p.items : []).map(function (it) {
        if (it && it.rep) return { rep: TX.clamp(Math.round(+it.rep), 1, 30), items: (it.items || []).map(cleanSeg) };
        return cleanSeg(it || {});
      });
      if (!o.items.length) o.items = [cleanSeg({ d: 600, s: 8, i: 1, k: 'w' })];
    }
    return o;
  }
  TX.cleanPlan = cleanPlan;
  TX.plans = function () {
    var raw = load(K.plans, null);
    if (!raw || !Array.isArray(raw.plans)) { var d = TX.defaultPlans(); save(K.plans, { v: 1, plans: d, add: [TX.HFTEST] }); return d; }
    var l = raw.plans.map(cleanPlan).filter(Boolean);
    // neue Standardvorlagen einmalig nachtragen (raw.add merkt sich, was schon angeboten wurde; geloeschte kommen nicht zurueck)
    var add = Array.isArray(raw.add) ? raw.add : [];
    if (add.indexOf(TX.HFTEST) < 0) {
      if (!l.some(function (p) { return p.id === TX.HFTEST; })) l.push(TX.hfTestPlan());
      save(K.plans, { v: 1, plans: l, add: add.concat([TX.HFTEST]) });
      return l;
    }
    // alte gespeicherte «last»-Werte einmalig entfernen (Zuletzt kommt aus dem Verlauf)
    if (raw.plans.some(function (p) { return p && typeof p === 'object' && 'last' in p; })) TX.savePlans(l);
    return l;
  };
  TX.savePlans = function (list) { var raw = load(K.plans, null); return save(K.plans, { v: 1, plans: list, add: raw && Array.isArray(raw.add) ? raw.add : [TX.HFTEST] }); };
  TX.plan = function (id) { var l = TX.plans(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; };
  TX.putPlan = function (p) {
    p = cleanPlan(p); if (!p) return false;
    var l = TX.plans(), i = -1;
    l.forEach(function (x, k) { if (x.id === p.id) i = k; });
    if (i >= 0) l[i] = p; else l.push(p);
    return TX.savePlans(l) ? p : false;
  };
  TX.delPlan = function (id) { TX.savePlans(TX.plans().filter(function (p) { return p.id !== id; })); };

  // Wiederholbloecke aufloesen
  TX.expand = function (p) {
    var out = [];
    (p.items || []).forEach(function (it) {
      if (it.rep) { for (var r = 0; r < it.rep; r++) it.items.forEach(function (s) { out.push({ d: s.d, s: s.s, i: s.i, k: s.k }); }); }
      else out.push({ d: it.d, s: it.s, i: it.i, k: it.k });
    });
    return out;
  };
  TX.planStats = function (p) {
    if (p.type === 'zones') { var z = p.zone; return { dur: z.dur, dist: z.s0 * z.dur / 3600, maxS: z.sMax, maxI: z.i, segs: null }; }
    var segs = TX.expand(p), dur = 0, dist = 0, maxS = 0, maxI = 0;
    segs.forEach(function (s) { dur += s.d; dist += s.s * s.d / 3600; maxS = Math.max(maxS, s.s); maxI = Math.max(maxI, s.i); });
    return { dur: dur, dist: dist, maxS: maxS, maxI: maxI, segs: segs };
  };
  // Programm fuer POST cmd program
  TX.toProgram = function (p) {
    if (p.type === 'zones') {
      var z = p.zone, zs = TX.zones()[z.z - 1];
      return { type: 'zones', name: p.name, lo: zs.lo, hi: zs.hi, dur: z.dur, sMin: z.sMin, sMax: z.sMax, i: z.i, s0: z.s0 };
    }
    return { type: 'interval', name: p.name, segs: TX.expand(p) };
  };
  // Beschriftung eines Abschnitts
  TX.segName = function (segs, idx) {
    var s = segs[idx]; if (!s) return '';
    if (s.k === 'h') return 'Belastung';
    if (s.k === 'r') return 'Erholung';
    for (var j = 0; j < idx; j++) if (segs[j].k === 'h') return 'Auslaufen';
    return 'Einlaufen';
  };
  // Nummer der Belastung (1-basiert) und Anzahl
  TX.hardNo = function (segs, idx) {
    var n = 0, c = 0;
    segs.forEach(function (s, j) { if (s.k === 'h') { n++; if (j <= idx) c = n; } });
    return { c: c, n: n };
  };

  /* ---------- Aktives Programm (Abschnittsliste fuer die Anzeige) ---------- */
  TX.setActive = function (plan, prog) { save(K.active, { planId: plan ? plan.id : null, name: prog.name, type: prog.type, segs: prog.segs || null, prog: prog, ts: Date.now() }); };
  TX.active = function (name) { var a = load(K.active, null); return a && (!name || a.name === name) ? a : null; };

  /* ---------- Verlauf ----------
     Fassung 2: einmalige Bereinigung kurzer Alt-Eintraege (unter 120 s UND unter 0.2 km), danach nie wieder. */
  var HIST_V = 2;
  (function () {
    var raw = load(K.hist, null);
    if (!raw || !Array.isArray(raw.runs) || (+raw.v || 1) >= HIST_V) return;
    var keep = raw.runs.filter(function (r) { return !(r && +r.elapsed < 120 && +r.dist < 0.2); });
    save(K.hist, { v: HIST_V, runs: keep, cleaned: { at: Date.now(), removed: raw.runs.length - keep.length } });
  })();
  TX.runs = function () { var r = load(K.hist, null); return r && Array.isArray(r.runs) ? r.runs.filter(function (x) { return x && x.id && x.ts; }) : []; };
  TX.run = function (id) { var l = TX.runs(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; };
  function thin(h, max) {
    if (!h || h.length <= max) return h || [];
    var f = h.length / max, o = [];
    for (var i = 0; i < max; i++) o.push(h[Math.floor(i * f)]);
    o.push(h[h.length - 1]); return o;
  }
  TX.saveRun = function (rec) {
    rec.hist = thin((rec.hist || []).filter(function (p) { return Array.isArray(p) && p.length >= 4; }).map(function (p) {
      return [Math.round(p[0]), TX.r1(p[1]), TX.r1(p[2]), Math.round(p[3])];
    }), 720);
    var l = TX.runs().filter(function (r) { return r.id !== rec.id; });
    l.unshift(rec); l = l.slice(0, 200);
    var raw = load(K.hist, null), o = { v: HIST_V, runs: l };
    if (raw && raw.cleaned) o.cleaned = raw.cleaned;
    while (l.length && !save(K.hist, o)) l.pop();
    return rec;
  };
  // Juengster gespeicherter Lauf einer Vorlage: gleiche planId, bei Laeufen ohne planId gleicher Name
  TX.lastRunOf = function (p, runs) {
    if (!p) return null;
    var best = null, nm = TX.nm(p.name);
    (runs || TX.runs()).forEach(function (r) {
      var hit = r.planId ? r.planId === p.id : TX.nm(r.name) === nm;
      if (hit && (!best || r.ts > best.ts)) best = r;
    });
    return best;
  };
  // Lauf-Datensatz aus Zustand, Verlauf und Antwort von "end"
  TX.makeRun = function (st, hist, sum) {
    sum = sum || {}; hist = (sum.hist && sum.hist.length ? sum.hist : hist) || [];
    // Vorlage des Laufs: aus dem aktiven Programm gleichen Namens (geladen ueber Pläne oder Startseite)
    var pn = sum.name || (st && st.prog ? st.prog.name : ''), act = pn ? TX.active(pn) : null;
    var hrs = hist.map(function (p) { return p[3]; }).filter(function (v) { return v > 0; });
    var avg = hrs.length ? Math.round(hrs.reduce(function (a, b) { return a + b; }, 0) / hrs.length) : 0;
    var g = function (k) { return sum[k] != null ? +sum[k] : +(st && st[k]) || 0; };
    return { id: sum.ts ? 's' + sum.ts : TX.uid('r'), ts: sum.ts || Date.now(), name: sum.name || (st && st.prog ? st.prog.name : 'Freies Laufen'),
      type: st && st.prog ? st.prog.type : sum.route ? 'route' : 'frei', elapsed: Math.round(g('elapsed')), dist: Math.round(g('dist') * 100) / 100 || 0,
      kcal: Math.round(g('kcal')), elev: Math.round(g('elev')), avgHr: sum.avgHr != null ? Math.round(sum.avgHr) : avg,
      maxHr: sum.maxHr != null ? Math.round(sum.maxHr) : (hrs.length ? Math.max.apply(null, hrs) : 0), hist: hist, planId: act && act.planId ? act.planId : null,
      route: routeOf(st, sum) };
  };
  // Streckenlauf: Kennzahlen aus summary.route, dazu eine duenne Linie und das Profil fuer die kleine Karte im Abschluss
  function routeOf(st, sum) {
    var r = sum.route, p = st && st.prog && st.prog.type === 'route' ? st.prog : null;
    if (!r && !p) return null;
    r = r || { id: p.id, D: p.D, target: p.target, plan: p.total, finish: !!p.finish, x: p.x, up: p.up, offS: p.offS, t: p.t };
    var o = { id: r.id, D: +r.D || 0, target: +r.target || 0, plan: +r.plan || 0, finish: !!r.finish, x: +r.x || 0, up: +r.up || 0, offS: +r.offS || 0 };
    // Zeit am Ziel (Programmzeit, ohne Auslaufen); ohne Zustand die Laufzeit
    o.t = r.t != null ? Math.round(+r.t) : p && p.t != null ? Math.round(+p.t) : null;
    var f = TX.rte && TX.rte.cache[r.id];
    if (f) {
      o.name = f.name; o.ort = f.ort || ''; o.line = TX.rte.thumb(f.pts, 140);
      o.prof = TX.rte.thinProf(f.prof, 160).map(function (q) { return [Math.round(q[0]), Math.round(q[1])]; });
    }
    return o;
  }
  // Kilometer-Abschnitte aus dem Verlauf
  TX.splits = function (hist) {
    var out = [], d = 0, km = 1, t0 = 0, hrs = [];
    for (var i = 1; i < (hist || []).length; i++) {
      var a = hist[i - 1], b = hist[i], dt = b[0] - a[0]; if (dt <= 0 || dt > 60) continue;
      var dd = (a[1] + b[1]) / 2 * dt / 3600;
      if (b[3] > 0) hrs.push(b[3]);
      if (d + dd >= km) {
        var tk = a[0] + (km - d) / dd * dt;
        out.push({ km: km, sec: tk - t0, hr: hrs.length ? Math.round(hrs.reduce(function (x, y) { return x + y; }, 0) / hrs.length) : 0 });
        t0 = tk; hrs = []; km++;
      }
      d += dd;
    }
    return out;
  };
  // Lauf als Vorlage: Abschnitte aus Tempo und Steigung, kurze Stuecke zusammengelegt
  TX.runToPlan = function (run) {
    var h = run.hist || [], segs = [];
    if (h.length < 2) {
      var sp = run.elapsed > 0 ? TX.clamp(TX.r1(run.dist / run.elapsed * 3600 * 2) / 2, 0.8, 20) : 8;
      segs = [{ d: TX.clamp(run.elapsed || 1800, 60, 7200), s: sp, i: 0, k: 'h' }];
    } else {
      for (var i = 1; i < h.length; i++) {
        var dt = TX.clamp(h[i][0] - h[i - 1][0], 0, 60), s = Math.round(h[i][1] * 2) / 2, ic = Math.round(h[i][2] * 2) / 2;
        if (s < 0.8) continue;
        var L = segs[segs.length - 1];
        if (L && L.s === s && L.i === ic) L.d += dt; else segs.push({ d: dt, s: s, i: ic });
      }
      var lim = 30;
      while (true) {
        var changed = true;
        while (changed) {
          changed = false;
          for (var j = 0; j < segs.length; j++) {
            if (segs[j].d < lim && segs.length > 1) {
              var t = j > 0 ? j - 1 : j + 1; segs[t].d += segs[j].d; segs.splice(j, 1); changed = true; break;
            }
          }
          for (var m = segs.length - 1; m > 0; m--) if (segs[m].s === segs[m - 1].s && segs[m].i === segs[m - 1].i) { segs[m - 1].d += segs[m].d; segs.splice(m, 1); }
        }
        if (segs.length <= 30) break; lim *= 2;
      }
      if (!segs.length) segs = [{ d: 600, s: 8, i: 0 }];
      var sorted = segs.map(function (x) { return x.s; }).sort(function (a, b) { return a - b; }), med = sorted[Math.floor(sorted.length / 2)];
      segs.forEach(function (x, k) {
        x.d = TX.clamp(Math.round(x.d / 15) * 15 || 15, 15, 7200);
        x.k = (k === 0 || k === segs.length - 1) && x.s < med ? 'w' : (x.s >= med ? 'h' : 'r');
      });
    }
    return { id: TX.uid('p'), name: (run.name === 'Freies Laufen' ? 'Lauf' : run.name) + ' vom ' + TX.dshort(run.ts), type: 'interval', desc: 'Aus dem Lauf vom ' + TX.dshort(run.ts) + ' übernommen.',
      fav: false, days: [], items: segs };
  };
  // Woche (Montag 0:00) zu einem Zeitpunkt
  TX.weekStart = function (ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); var wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d.getTime(); };
  TX.weekStats = function (ts) {
    var ws = TX.weekStart(ts), we = ws + 7 * 864e5, days = [0, 0, 0, 0, 0, 0, 0], n = 0, km = 0, sec = 0;
    TX.runs().forEach(function (r) {
      if (r.ts >= ws && r.ts < we) { var wd = (new Date(r.ts).getDay() + 6) % 7; days[wd] += r.dist; n++; km += r.dist; sec += r.elapsed; }
    });
    return { days: days, n: n, km: km, sec: sec, pace: km > 0.2 ? sec / km : 0, ws: ws,
      label: ws === TX.weekStart(Date.now()) ? 'Diese Woche' : 'Woche vom ' + TX.dshort(ws) };
  };
  // Eine Quelle fuer «Diese Woche» (Start, Abschluss, Verlauf): Kilometer (unter 1 km auf 0.01) und Anzahl Laeufe
  TX.weekText = function (wk) { return TX.km(wk.km) + ' km in ' + wk.n + (wk.n === 1 ? ' Lauf' : ' Läufen'); };
  // Durchschnittspace aus Distanz und Zeit, ab 0.01 km
  TX.avgPace = function (dist, sec) { return dist >= 0.01 && sec > 0 ? TX.time(sec / dist) : '--:--'; };
  // Naechste Vorlage: heute im Wochenplan, sonst Favorit, sonst erste
  TX.nextPlan = function () {
    var l = TX.plans(), wd = new Date().getDay(), i;
    for (i = 0; i < l.length; i++) if (l[i].days.indexOf(wd) >= 0) return l[i];
    for (i = 0; i < l.length; i++) if (l[i].fav) return l[i];
    return l[0] || null;
  };
})();
