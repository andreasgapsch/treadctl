/* Verbindung zum Dienst (API v3) und Demo-Modus mit simuliertem Band. */
(function () {
  'use strict';
  var TX = window.TX;
  var N = window.TreadNative;
  var q = location.search;
  var demo = !N || /[?&]demo=1/.test(q);

  var api = TX.api = { demo: demo, state: null, hist: [], histVer: 0, live: [], liveVer: 0, offline: false, fails: 0, needHist: false, ls: [], rplan: null, rplanVer: 0 };
  // Kennung eines geladenen Streckenplans
  api.rkey = function (p) { return p ? [p.id, p.target, p.mode, p.scale, p.total, p.n].join('|') : ''; };
  // Plan des aktuellen Programms (oder null, wenn noch nicht abgeholt)
  api.routePlan = function (p) { return p && api.rplan && api.rplan.key === api.rkey(p) ? api.rplan : null; };
  api.on = function (fn) { api.ls.push(fn); };
  function emit() { api.ls.forEach(function (fn) { try { fn(api.state); } catch (e) { setTimeout(function () { throw e; }); } }); }

  /* ---------- echter Dienst ---------- */
  function withTimeout(p, ms, ctl) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { if (ctl) ctl.abort(); rej(new Error('Zeitüberschreitung')); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  var real = {
    state: function (hist) {
      var ctl = window.AbortController ? new AbortController() : null;
      var tk = api.token(), hd = tk ? { 'X-Token': tk } : {};   // mit Token zaehlt die Abfrage als Lebenszeichen fuer den Watchdog
      return withTimeout(fetch('/api/state' + (hist ? '?hist=1' : ''), { cache: 'no-store', headers: hd, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), 2500, ctl);
    },
    cmd: function (body) {
      var tok = '';
      try { tok = String(N.token() || ''); } catch (e) { tok = ''; }
      var ctl = window.AbortController ? new AbortController() : null;
      return withTimeout(fetch('/api/cmd', { method: 'POST', cache: 'no-store', signal: ctl ? ctl.signal : undefined,
        headers: { 'Content-Type': 'application/json', 'X-Token': tok }, body: JSON.stringify(body) })
        .then(function (r) {
          if (r.status === 403) return { ok: false, error: 'Kein Zugriff: Token ungültig' };
          return r.json().catch(function () { return { ok: r.ok, error: r.ok ? '' : 'HTTP ' + r.status }; });
        }), 4000, ctl);
    }
  };

  /* Allgemeine Anfrage an den Dienst (Strecken, Kacheln); mit Token bei POST und DELETE */
  api.token = function () { try { return String(N && N.token ? N.token() || '' : ''); } catch (e) { return ''; } };
  api.req = function (method, url, body) {
    var ctl = window.AbortController ? new AbortController() : null, h = { 'Content-Type': 'application/json' };
    if (method !== 'GET') h['X-Token'] = api.token();
    return withTimeout(fetch(url, { method: method, cache: 'no-store', signal: ctl ? ctl.signal : undefined, headers: h, body: body != null ? JSON.stringify(body) : undefined })
      .then(function (r) {
        if (r.status === 403) return { ok: false, error: 'Kein Zugriff: Token ungültig' };
        return r.json().catch(function () { return { ok: r.ok, error: r.ok ? '' : 'HTTP ' + r.status }; });
      }), 15000, ctl).catch(function (e) { return { ok: false, error: 'Dienst antwortet nicht (' + (e && e.message || 'Fehler') + ')' }; });
  };

  /* ---------- Demo: simuliertes Band nach API v3 ---------- */
  function Sim() {
    this.s = { ok: true, st: 'BEREIT', err: '', speed: 0, incline: 0, tSpeed: 1.0, tIncl: 0.0, hr: 72, hrOk: true, hrSrc: 'geraet', weight: 75, pulled: 0, safe: 1,
      elapsed: 0, dist: 0, kcal: 0, elev: 0, src: 'ui', prog: null, note: '' };
    this.p = null; this.hist = []; this.hrv = 72; this.zt = 0; this.lastSum = null; this.manualAt = 0; this.armAt = 0; this.endT = -1; this.rampT = -1; this.rampLeft = 0; this.rampFrom = 'programm'; this.hold = 0; this.holdTo = -1; this.hwAt = 0; this.hwResume = false;
  }
  /* Countdown-Pflicht wie im Dienst: start und resume nur 2.5 bis 15 s nach arm.
     Jede Pruefung verbraucht arm (auch eine abgewiesene), stop loescht es. */
  Sim.prototype.armed = function () { var d = Date.now() - this.armAt; this.armAt = 0; return d >= 2500 && d <= 15000; };
  // nur Demo-Aufbau und Pruefskript: Befehl mit 3 s zurueckdatiertem arm (ersetzt den sichtbaren Countdown)
  Sim.prototype.direct = function (c) { this.armAt = Date.now() - 3000; return this.cmd({ c: c }); };
  Sim.prototype.loadSeg = function (i) {
    var p = this.p, sg = p.segs[i]; p.idx = i; p.segT = 0;
    // waehrend des Einlaufens wartet das Programm-Tempo (wie Core.applySpeed)
    if (sg) { if (this.hold > 0) this.holdTo = sg.s; else this.s.tSpeed = sg.s; this.s.tIncl = sg.i; this.s.src = 'programm'; }
  };
  Sim.prototype.step = function (dt) {
    var s = this.s, p = this.p, run = s.st === 'LAEUFT';
    var tgtS = run ? s.tSpeed : 0;
    var rate = run ? 1.2 : 2.0;
    if (s.speed < tgtS) s.speed = Math.min(tgtS, s.speed + rate * dt); else s.speed = Math.max(tgtS, s.speed - rate * dt);
    if (s.st !== 'FEHLER') { if (s.incline < s.tIncl) s.incline = Math.min(s.tIncl, s.incline + 0.6 * dt); else s.incline = Math.max(s.tIncl, s.incline - 0.6 * dt); }
    var moving = s.speed > 0.3;
    var tgt = 68 + (moving ? 12 + s.speed * 5.8 + s.incline * 2.2 : 0);
    this.hrv += (tgt - this.hrv) * (1 - Math.exp(-dt / 22));
    s.hr = Math.round(this.hrv + 1.2 * Math.sin(s.elapsed / 37) + 0.8 * Math.sin(s.elapsed / 11));
    if (this.noHr) { s.hr = 0; s.hrOk = false; }
    // Demo: Bluetooth-Pulsmesser verbunden (Geraete-Seite)
    if (this.hrBle) { s.hr = Math.round(127 + 2.5 * Math.sin(Date.now() / 4000)); s.hrOk = true; }
    if (run) {
      s.elapsed += dt;
      var dd = s.speed * dt / 3600; s.dist += dd; s.elev += dd * 1000 * s.incline / 100; s.kcal += dd * (s.weight || 75) * 0.96 * (1 + s.incline / 12);
      if (p && p.type !== 'route') p.t += dt;
      if (p && p.type === 'route') this.routeStep(dt);
      else if (p && p.type === 'interval') {
        p.segT += dt;
        while (p.segs[p.idx] && p.segT >= p.segs[p.idx].d) {
          var over = p.segT - p.segs[p.idx].d;
          if (p.idx + 1 >= p.segs.length) { p.segT = p.segs[p.idx].d; this.finish(); break; }
          this.loadSeg(p.idx + 1); p.segT = over;
        }
      } else if (p && p.type === 'zones') {
        p.segT += dt; this.zt += dt;
        if (this.zt >= 5) {
          this.zt = 0;
          if (p.auto && s.hrOk && Date.now() - this.manualAt >= 120000) {
            if (s.hr > p.hi) s.tSpeed = Math.max(p.sMin, TX.r1(s.tSpeed - 0.3));
            else if (s.hr < p.lo && s.elapsed > 300) s.tSpeed = Math.min(p.sMax, TX.r1(s.tSpeed + 0.2));
            s.src = 'zone';
          }
        }
        if (p.segT >= p.dur) { p.segT = p.dur; this.finish(); }
      }
      var last = this.hist[this.hist.length - 1];
      if (!last || s.elapsed - last[0] >= 2) this.hist.push([Math.round(s.elapsed), TX.r1(s.speed), TX.r1(s.incline), s.hr]);
    }
    // Geraetetaste START: eigener 3-s-Countdown im Dienst, dann start bzw. resume ueber den normalen Weg
    if (this.hwAt > 0 && Date.now() >= this.hwAt) { this.hwAt = 0; s.note = ''; this.direct(this.hwResume ? 'resume' : 'start'); }
    // Einlaufen: 15 s mit 1.0 km/h, dann Stufen zum Ziel (Core.beginHold)
    if (s.st === 'LAEUFT' && this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) { this.hold = 0; var ht = this.holdTo; this.holdTo = -1; s.note = ''; if (ht > 1.05) this.rampSpeed(ht, 'programm'); }
    }
    if (s.st === 'LAEUFT' && this.rampT > 0 && this.hold <= 0) { this.rampLeft -= dt; if (this.rampLeft <= 0) this.rampSpeed(this.rampT, this.rampFrom); }
    // nach Programmende (Strecke): die 10 s bis STOP zaehlen erst im Gehtempo (Ist hoechstens 3.3 km/h)
    if (this.endT >= 0 && s.st === 'LAEUFT') { if (s.speed <= 3.3) this.endT += dt; if (this.endT >= 10) { this.endT = -1; this.rampT = -1; s.st = 'PAUSE'; s.src = 'programm'; s.note = 'Programm beendet'; } }
  };
  /* ---------- Strecke wie Core.runRoute ---------- */
  function fl1(v) { return TX.r1(Math.fround(v)); }
  // wie Core.applySpeed: ohne Lebenszeichen (Watchdog) regeln Programme nicht hoch
  Sim.prototype.setS = function (v, from) {
    v = Math.max(0.8, Math.min(20, fl1(v)));
    if (this.leaseLost && (from === 'programm' || from === 'zone') && v > this.s.tSpeed) { this.rampT = -1; return; }
    if (this.hold > 0 && (from === 'programm' || from === 'zone')) { this.holdTo = v; return; }   // Einlaufen: Programm wartet
    this.s.tSpeed = v; this.s.src = from;
  };
  // ohne Lebenszeichen erhoeht ein Programm auch die Steigung nicht
  Sim.prototype.setI = function (v, from) { v = Math.max(0, Math.min(15, fl1(v))); if (this.leaseLost && from === 'programm' && v > this.s.tIncl) return; this.s.tIncl = v; this.s.src = from; };
  // Tempo setzen; Aenderungen ueber 3 km/h in Stufen von 3 km/h alle 4 s (Core.rampSpeed)
  Sim.prototype.rampSpeed = function (v, from) {
    var s = this.s; v = Math.max(0.8, Math.min(20, v));
    if (s.st === 'LAEUFT' && Math.abs(v - s.tSpeed) > 3.0) { this.setS(s.tSpeed + (v > s.tSpeed ? 3.0 : -3.0), from); this.rampT = v; this.rampLeft = 4; this.rampFrom = from; }
    else { this.rampT = -1; this.setS(v, from); }
  };
  // Tempo im Auslaufen ueber 3.5 km/h: Programm bleibt beendet, das Band laeuft frei (Core.freeRun)
  Sim.prototype.freeRun = function (v) {
    var p = this.p;
    if (p && p.done && this.endT >= 0 && v > 3.5) { this.endT = -1; this.s.note = 'Freilauf nach Programmende, STOP beendet den Lauf'; }
  };
  // Anlauf wie im Dienst (Start, Weiter): 15 s mit 1.0 km/h, danach in Stufen zum Soll
  Sim.prototype.softStart = function () {
    var s = this.s, want = Math.max(0.8, s.tSpeed); this.rampT = -1;
    if (want > 1.05) { this.holdTo = want; this.hold = 15; s.tSpeed = 1.0; s.note = 'Einlaufen mit 1.0 km/h'; } else { this.holdTo = -1; this.hold = 0; s.tSpeed = want; }
  };
  Sim.prototype.endHold = function () { if (this.hold > 0) { this.hold = 0; this.holdTo = -1; this.s.note = ''; } };
  // Taste oder Drehregler der Konsole (wie Core.hwKey): go, stop, su/sd (Tempo ±0.1), iu/id (Steigung ±0.5)
  Sim.prototype.hwKey = function (k) {
    var s = this.s;
    if (k === 'stop') { this.armAt = 0; this.hwAt = 0; return this.cmd({ c: 'stop' }); }
    if (k === 'go') {
      if (s.st === 'LAEUFT') return this.cmd({ c: 'stop' });
      if (this.hwAt > 0) return;
      if ((s.st === 'BEREIT' || s.st === 'PAUSE') && s.pulled === 0 && s.safe === 1) { this.hwResume = s.st === 'PAUSE'; this.hwAt = Date.now() + 3000; s.note = 'Band läuft in 3 s an · STOP bricht ab'; }
      return;
    }
    if (s.st === 'FEHLER') return;
    if (k === 'su' || k === 'sd') { this.rampT = -1; this.endHold(); this.freeRun(s.tSpeed + (k === 'su' ? 0.1 : -0.1)); s.tSpeed = Math.max(0.8, TX.r1(s.tSpeed + (k === 'su' ? 0.1 : -0.1))); s.src = 'taste'; this.routeSpeedOffset(); }
    if (k === 'iu' || k === 'id') { s.tIncl = TX.clamp(TX.r1(s.tIncl + (k === 'iu' ? 0.5 : -0.5)), 0, 15); s.src = 'taste'; this.routeInclOffset(); }
  };
  Sim.prototype.routeStep = function (dt) {
    var p = this.p, rp = p.rp, s = this.s;
    if (p.done) return;
    p.t += dt;
    var x = s.dist * 1000;
    if (x >= rp.D) { p.done = true; p.finish = true; p.finishT = p.t; this.rampT = -1; this.setS(Math.min(s.tSpeed, 3), 'programm'); this.setI(0, 'programm'); this.endT = 0; s.note = 'Ziel erreicht'; return; }
    var i = rp.idxAt(x);
    if (i !== p.seg) { p.seg = i; this.routeSpeed(rp.sp[i] + p.offS); }
    // Steigung mit Vorlauf aus dem Soll-Tempo; innerhalb eines Abschnitts nie zurueckspringen
    var ii = rp.inclIdxAt(x, s.tSpeed, 0);
    if (ii < p.iseg && p.iseg <= i + 1 && p.iseg >= i) ii = p.iseg;
    if (ii !== p.iseg) {
      p.iseg = ii; p.offI = 0;                          // Handeingabe Steigung gilt nur bis zum naechsten Wechsel
      this.setI(rp.in[ii], 'programm');
      // Anstieg: das langsamere Tempo zusammen mit der Steigung vorziehen
      if (ii === i + 1 && rp.early(ii)) this.routeSpeed(rp.sp[ii] + p.offS);
    }
  };
  Sim.prototype.routeSpeed = function (v) { this.rampSpeed(v, 'programm'); };
  // Handeingabe Tempo: Versatz bis «Zurück zum Plan» (Core.routeSpeedOffset)
  Sim.prototype.routeSpeedOffset = function () {
    var p = this.p; if (!p || p.type !== 'route') return;
    var rp = p.rp, i = Math.max(0, p.iseg > p.seg ? p.iseg : p.seg);
    if (p.iseg > p.seg && !(rp.in[p.iseg] > rp.in[p.seg] && rp.sp[p.iseg] < rp.sp[p.seg])) i = Math.max(0, p.seg);
    p.offS = Math.round((TX.r1(this.s.tSpeed) - rp.sp[i]) * 10) / 10.0;
  };
  // Handeingabe Steigung: gilt bis zum naechsten Steigungswechsel (Core.routeInclOffset)
  Sim.prototype.routeInclOffset = function () {
    var p = this.p; if (!p || p.type !== 'route') return;
    p.offI = Math.round((TX.r1(this.s.tIncl) - p.rp.in[Math.max(0, p.iseg)]) * 10) / 10.0;
  };
  Sim.prototype.routeProg = function (full) {
    var p = this.p, rp = p.rp, x = Math.min(rp.D, this.s.dist * 1000), i = Math.max(0, Math.min(rp.n - 1, rp.idxAt(x)));
    var sec = function (k, oi) { return { a: Math.round(rp.a[k]), b: Math.round(rp.b[k]), s: fl1(rp.sp[k] + p.offS), i: fl1(Math.max(0, Math.min(15, rp.in[k] + oi))), g: Math.round(rp.g[k] * 10) / 10.0 }; };
    var tp = rp.tPlanAt(x), rest = 0;
    for (var k = i; k < rp.n; k++) { var l = rp.b[k] - Math.max(rp.a[k], x); if (l > 0) rest += l / (Math.max(0.8, rp.sp[k] + p.offS) / 3.6); }
    var o = { type: 'route', name: p.name, id: p.id, D: Math.round(rp.D), x: Math.round(x), idx: i + 1, n: rp.n, sec: sec(i, p.offI), next: i + 1 < rp.n ? sec(i + 1, 0) : null,
      toNext: Math.round(rp.b[i] - x), toFinish: Math.max(0, Math.round(rp.D - x)), pace: Math.round(3600.0 / Math.max(0.8, rp.sp[i] + p.offS)), tPlan: Math.round(tp), delta: Math.round(p.t - tp), eta: Math.round(p.t + rest),
      total: Math.round(rp.total), target: Math.round(p.target), t: Math.round(p.t), left: Math.round(rest), offS: p.offS, offI: p.offI, ele: Math.round(rp.eleAt(x)),
      up: Math.round(rp.up), down: Math.round(rp.down), capped: rp.capped, mode: p.mode, scale: p.scale, finish: p.finish };
    if (i + 1 < rp.n) { var cs = rp.in[i + 1] !== rp.in[i] ? rp.a[i + 1] - rp.lead(i + 1) : rp.a[i + 1]; o.toChange = Math.max(0, Math.round(cs - x)); }
    if (full) {
      o.secs = []; for (k = 0; k < rp.n; k++) o.secs.push([Math.round(rp.a[k]), Math.round(rp.b[k]), rp.sp[k], rp.in[k], Math.round(rp.g[k] * 10) / 10.0, Math.round(rp.tA[k])]);
      o.prof = []; var st = Math.max(1, Math.floor(rp.pd.length / 400));
      for (k = 0; k < rp.pd.length; k += st) o.prof.push([Math.round(rp.pd[k]), Math.round(rp.pe[k] * 10) / 10.0]);
      o.prof.push([Math.round(rp.D), Math.round(rp.pe[rp.pe.length - 1] * 10) / 10.0]);
    }
    o.done = !!p.done;
    return o;
  };
  Sim.prototype.finish = function () { var s = this.s; if (this.p) this.p.done = true; s.st = 'PAUSE'; s.tSpeed = Math.max(0.8, s.tSpeed); s.src = 'programm'; };
  Sim.prototype.snap = function (withHist) {
    var s = this.s, p = this.p, o = {};
    for (var k in s) o[k] = s[k];
    o.speed = TX.r1(s.speed); o.incline = TX.r1(s.incline); o.elapsed = Math.floor(s.elapsed); o.dist = Math.round(s.dist * 100) / 100;
    o.kcal = Math.round(s.kcal); o.elev = Math.round(s.elev);
    if (p && p.type === 'interval') {
      var total = 0, done = 0;
      p.segs.forEach(function (x, i) { total += x.d; if (i < p.idx) done += x.d; });
      var cur = p.segs[p.idx], nx = p.segs[p.idx + 1];
      // wie der Dienst: idx 1-basiert, vollstaendige Abschnittsliste, t seit Programmstart
      o.prog = { type: 'interval', name: p.name, idx: p.idx + 1, n: p.segs.length, segLeft: Math.max(0, cur.d - Math.floor(p.segT)), segDur: cur.d,
        left: Math.max(0, total - done - Math.floor(p.segT)), total: total, kind: cur.k, next: nx ? { d: nx.d, s: nx.s, i: nx.i, k: nx.k } : null,
        segs: p.segs.map(function (x) { return { d: x.d, s: x.s, i: x.i, k: x.k }; }), t: done + Math.floor(p.segT), done: !!p.done };
    } else if (p && p.type === 'zones') {
      o.prog = { type: 'zones', name: p.name, left: Math.max(0, p.dur - Math.floor(p.segT)), total: p.dur, t: Math.floor(p.segT),
        auto: p.auto && Date.now() - this.manualAt >= 120000, autoOn: p.auto, lo: p.lo, hi: p.hi, sMin: p.sMin, sMax: p.sMax, done: !!p.done };
    } else if (p && p.type === 'route') o.prog = this.routeProg(withHist);
    else o.prog = null;
    if (this.hold > 0) { o.hold = Math.ceil(this.hold); o.holdTo = TX.r1(this.holdTo); }
    if (this.hwAt > 0) o.cd = Math.max(1, Math.ceil((this.hwAt - Date.now()) / 1000));
    o.hrSrc = this.hrBle ? 'bluetooth' : s.hr > 0 ? 'geraet' : '';
    if (withHist) o.hist = this.hist.slice();
    return o;
  };
  Sim.prototype.cmd = function (b) {
    var s = this.s, c = b && b.c, L = TX.LIM;
    var no = function (e) { return { ok: false, error: e }; };
    switch (c) {
      case 'start':
        if (s.st !== 'BEREIT') return no('Start nur aus BEREIT');
        if (!this.armed()) return no('Countdown fehlt');
        if (s.pulled !== 0 || s.safe !== 1) return no('Sicherheitsschlüssel fehlt');
        s.st = 'LAEUFT'; s.elapsed = 0; s.dist = 0; s.kcal = 0; s.elev = 0; this.hist = []; s.src = 'ui'; s.note = '';
        if (this.p) { this.p.segT = 0; this.p.t = 0; this.p.done = false; if (this.p.type === 'interval') this.loadSeg(0); if (this.p.type === 'route') { this.p.seg = 0; this.p.iseg = 0; this.p.finish = false; this.p.finishT = -1; } }
        this.endT = -1; this.softStart();
        return { ok: true };
      case 'arm': this.armAt = Date.now(); return { ok: true };
      // wie der Dienst: stop gilt immer (loescht arm), haelt nur ein laufendes Band an
      case 'stop': this.armAt = 0; this.endT = -1; this.rampT = -1; this.hold = 0; this.holdTo = -1; this.hwAt = 0; if (s.st === 'LAEUFT') s.st = 'PAUSE';
        if (this.frozen) s.speed = 0;   // eingefrorene Demo (Bilder, Prüfungen): kein Auslaufen, Band steht sofort
        return { ok: true };
      case 'resume':
        if (s.st !== 'PAUSE') return no('Nicht pausiert');
        if (!this.armed()) return no('Countdown fehlt');
        if (this.p && this.p.type !== 'route' && this.p.segT >= (this.p.type === 'zones' ? this.p.dur : this.p.segs[this.p.idx].d) && (this.p.type === 'zones' || this.p.idx >= this.p.segs.length - 1)) this.p = null;
        s.st = 'LAEUFT'; s.note = ''; this.softStart(); return { ok: true };
      case 'end':
        if (s.st === 'BEREIT') { if (this.p) { this.p = null; return { ok: true }; } return no('Kein Lauf aktiv'); }
        if (s.st === 'FEHLER') return no('Erst quittieren');
        var hr = this.hist.map(function (x) { return x[3]; });
        var sum = { ts: Date.now(), type: this.p ? this.p.type : 'free', name: this.p ? this.p.name : 'Freies Laufen', elapsed: Math.floor(s.elapsed), dist: Math.round(s.dist * 100) / 100, kcal: Math.round(s.kcal),
          elev: Math.round(s.elev), avgHr: hr.length ? Math.round(hr.reduce(function (a, x) { return a + x; }, 0) / hr.length) : 0, maxHr: hr.length ? Math.max.apply(null, hr) : 0, hist: this.hist.slice() };
        if (this.p && this.p.type === 'route') { var q = this.p; sum.route = { id: q.id, D: Math.round(q.rp.D), target: Math.round(q.target), plan: Math.round(q.rp.total), finish: !!q.finish, x: Math.round(Math.min(q.rp.D, s.dist * 1000)), up: Math.round(q.rp.up), offS: q.offS, t: Math.round(q.finishT >= 0 ? q.finishT : q.t) }; }
        this.endT = -1;
        s.st = 'BEREIT'; s.tIncl = 0; s.tSpeed = 1.0; this.hold = 0; this.holdTo = -1; s.elapsed = 0; s.dist = 0; s.kcal = 0; s.elev = 0; s.note = ''; this.p = null; this.hist = []; this.lastSum = sum;
        return { ok: true, summary: sum };
      // Handeingabe pausiert die Zonen-Automatik nur waehrend des Laufs; in BEREIT wird nur vorgeladen
      case 'speed': if (typeof b.v !== 'number') return no('v fehlt'); if (s.st === 'LAEUFT') this.manualAt = Date.now(); this.rampT = -1; this.endHold(); this.freeRun(b.v); s.tSpeed = TX.clamp(TX.r1(b.v), L.sMin, L.sMax); s.src = 'ui'; this.routeSpeedOffset(); return { ok: true };
      case 'incline': if (typeof b.v !== 'number') return no('v fehlt'); if (s.st === 'LAEUFT') this.manualAt = Date.now(); s.tIncl = TX.clamp(TX.r1(b.v), L.iMin, L.iMax); s.src = 'ui'; this.routeInclOffset(); return { ok: true };
      case 'step':
        if (Math.abs(b.d) > 0.5 || !b.d) return no('d höchstens ±0.5');
        if (s.st === 'LAEUFT') this.manualAt = Date.now();
        if (b.what === 'speed') { this.rampT = -1; this.endHold(); this.freeRun(s.tSpeed + b.d); }
        if (b.what === 'speed') s.tSpeed = TX.clamp(TX.r1(s.tSpeed + b.d), L.sMin, L.sMax);
        else if (b.what === 'incline') s.tIncl = TX.clamp(TX.r1(s.tIncl + b.d), L.iMin, L.iMax);
        else return no('what unbekannt');
        s.src = 'ui'; if (b.what === 'incline') this.routeInclOffset(); else this.routeSpeedOffset(); return { ok: true };
      case 'skipTo':   // wie Core: nur vorwaerts im Intervall, im Lauf oder in der Pause
        if (!this.p || this.p.type !== 'interval') return no('kein Intervallprogramm');
        if (s.st !== 'LAEUFT' && s.st !== 'PAUSE') return no('nur im Lauf oder in der Pause');
        if (!(b.idx > this.p.idx && b.idx < this.p.segs.length)) return no('nur vorwärts innerhalb des Programms');
        this.loadSeg(b.idx); return { ok: true };
      case 'program':
        if (s.st !== 'BEREIT') return no('Programm nur in BEREIT laden');
        var p = b.p;
        if (!p || !p.type) return no('Programm fehlt');
        if (p.type === 'interval') {
          if (!p.segs || !p.segs.length) return no('Keine Abschnitte');
          this.p = { type: 'interval', name: p.name, segs: p.segs.slice(), idx: 0, segT: 0, t: 0 }; this.loadSeg(0);
        } else if (p.type === 'zones') {
          this.p = { type: 'zones', name: p.name, lo: p.lo, hi: p.hi, dur: p.dur, sMin: p.sMin, sMax: p.sMax, auto: true, segT: 0, t: 0 };
          s.tSpeed = TX.clamp(p.s0, p.sMin, p.sMax); s.tIncl = Math.min(8, p.i);
        } else if (p.type === 'route') {
          // wie Core.loadProgram: ohne prof liest der Dienst Profil, Art und Hoehenquelle aus der Bibliothek (nur id)
          if (!p.prof) {
            var f = TX.rte && TX.rte.cache[p.id];
            if (!f) return no('Strecke unbekannt');
            var q0 = {}; for (var kk in p) q0[kk] = p[kk];
            q0.prof = f.prof; if (!('trail' in q0)) q0.trail = f.art === 'trail';
            if (!('hoehe' in q0)) q0.hoehe = String(f.hoehe || '').indexOf('gpx') === 0 ? 'gpx' : 'swisstopo';
            if (!('name' in q0)) q0.name = f.name;
            p = q0;
          }
          var pr = p.prof;
          if (!Array.isArray(pr) || pr.length < 2 || pr.length > 20000) return no('Profil ungültig');
          var pd = [], pe = [];
          for (var k = 0; k < pr.length; k++) {
            pd.push(+pr[k][0]); pe.push(+pr[k][1]);
            if (k > 0 && pd[k] < pd[k - 1]) return no('Profil nicht aufsteigend');
            if (pe[k] < -500 || pe[k] > 9000) return no('Höhe ausserhalb der Grenzen');
          }
          var sc = p.scale === 0.5 ? 0.5 : 1.0, rp;
          try { rp = TX.RoutePlan.build(pd, pe, +p.target, p.mode !== 'even', sc, !!p.trail, p.hoehe === 'gpx'); } catch (e) { return no(e.message); }
          this.p = { type: 'route', name: p.name, id: p.id, target: +p.target, mode: p.mode === 'even' ? 'even' : 'terrain', scale: sc, rp: rp, offS: 0, offI: 0, seg: 0, iseg: 0, t: 0, done: false, finish: false, finishT: -1 };
          this.setS(rp.sp[0], 'programm'); this.setI(rp.in[0], 'programm'); this.endT = -1;
          s.elapsed = 0; s.dist = 0; s.kcal = 0; s.elev = 0; this.hist = [];
        } else return no('Typ unbekannt');
        return { ok: true };
      case 'auto': if (!this.p || this.p.type !== 'zones') return no('Kein Zonenprogramm'); this.p.auto = !!b.on; this.manualAt = 0; return { ok: true };
      case 'clearProgram': if (s.st === 'BEREIT') this.p = null; return { ok: true };
      case 'routeOffset':
        if (!this.p || this.p.type !== 'route') return no('keine Strecke geladen');
        this.p.offS = Math.max(-15, Math.min(15, +b.s || 0)); this.p.offI = Math.max(-15, Math.min(15, +b.i || 0));
        this.rampSpeed(this.p.rp.sp[Math.max(0, this.p.seg)] + this.p.offS, 'ui'); this.setI(this.p.rp.in[Math.max(0, this.p.iseg)] + this.p.offI, 'ui'); return { ok: true };
      case 'ack':
        if (s.st !== 'FEHLER') return no('Kein Fehler');
        if (s.speed > 0 || s.pulled !== 0) return no('Erst wenn das Band steht und der Schlüssel steckt');
        // wie Core: Fehler waehrend eines Streckenlaufs: PAUSE mit Gehtempo, der Plan laeuft relativ zum aktuellen Tempo weiter
        if (this.errRun && this.p && this.p.type === 'route') {
          this.errRun = false; s.st = 'PAUSE'; s.err = ''; s.tSpeed = Math.min(s.tSpeed, 3);
          s.note = 'Nach Unterbrechung: Weiter mit ' + TX.f1(s.tSpeed) + ' km/h (Gehtempo)'; this.routeSpeedOffset(); return { ok: true };
        }
        s.st = 'BEREIT'; s.err = ''; s.elapsed = 0; s.dist = 0; s.kcal = 0; s.elev = 0; this.hist = []; this.p = null; return { ok: true };
      case 'profile':
        s.weight = Math.max(35, Math.min(200, b.weight != null ? +b.weight : s.weight)); this.hfmax = Math.max(120, Math.min(230, b.hfmax != null ? +b.hfmax : this.hfmax || 184)); return { ok: true };
      case 'inclZero': if (s.st !== 'PAUSE') return no('Nur in PAUSE'); s.tIncl = 0; return { ok: true };
    }
    return no('Befehl unbekannt');
  };
  Sim.prototype.ff = function (sec, script) {
    for (var t = 0; t < sec; t++) { if (script) script(this, Math.floor(this.s.elapsed)); this.step(1); }
    this.s.speed = this.s.st === 'LAEUFT' ? this.s.tSpeed : this.s.speed; this.s.incline = this.s.tIncl;
  };
  // Freier Lauf mit wechselndem Tempo, damit der Verlauf nach etwas aussieht
  function freeScript(sim, t) {
    var tbl = [[0, 8.0, 1.0], [60, 10.5, 1.0], [300, 11.0, 3.0], [600, 10.5, 3.0], [850, 12.0, 5.5], [1100, 10.5, 5.5], [1200, 11.0, 2.0], [1320, 12.5, 4.0]];
    for (var i = tbl.length - 1; i >= 0; i--) if (t >= tbl[i][0]) { sim.s.tSpeed = tbl[i][1]; sim.s.tIncl = tbl[i][2]; break; }
  }
  TX.Sim = Sim; TX.freeScript = freeScript;

  var sim = null, src = real;
  if (demo) {
    sim = new Sim(); TX.sim = sim; window.__txCmdLog = [];
    // ?puls=0: Demo ohne Pulssignal (wie ohne Brustgurt)
    if (/[?&]puls=0/.test(q)) { sim.noHr = true; sim.s.hr = 0; sim.s.hrOk = false; }
    var m = /[?&]szenario=([a-z-]+)/.exec(q), sz = m ? m[1] : '';
    var planBy = function (id) { var p = TX.plan(id) || TX.defaultPlans().filter(function (x) { return x.id === id; })[0]; return p; };
    var loadPlan = function (id) { var pl = planBy(id), pr = TX.toProgram(pl); sim.cmd({ c: 'program', p: pr }); TX.setActive(pl, pr); };
    if (sz === 'lauf' || sz === 'pause' || sz === 'fehler') {
      sim.direct('start'); sim.ff(sz === 'fehler' ? 600 : 1455, freeScript); sim.s.tSpeed = 12.5; sim.s.tIncl = 4.0; sim.s.speed = 12.3; sim.s.incline = 4.0;
      if (sz === 'pause') { sim.cmd({ c: 'stop' }); sim.s.speed = 0; }
      if (sz === 'fehler') { sim.s.st = 'FEHLER'; sim.s.err = 'Sicherheitsschlüssel gezogen'; sim.s.pulled = 1; sim.s.speed = 0; }
    } else if (sz === 'nachfehler') {
      // Schluessel waehrend des Laufs gezogen und wieder gesteckt: Dienst haelt den Lauf in PAUSE, Weiter faehrt nur auf Gehtempo
      sim.direct('start'); sim.ff(1455, freeScript); sim.s.tIncl = 4.0; sim.s.incline = 4.0;
      sim.s.st = 'PAUSE'; sim.s.speed = 0; sim.s.tSpeed = 3.0; sim.s.note = 'Nach Unterbrechung: Sicherheitsschlüssel war gezogen. Der Lauf bleibt erhalten.';
    } else if (sz === 'intervall' || sz === 'wechsel') {
      loadPlan('p-schwelle'); sim.direct('start'); sim.ff(sz === 'wechsel' ? 1552 : 1399);
    } else if (sz === 'intervall-start') {
      // gerade gestartet: Einlaufen mit 1.0 km/h, das Programm wartet
      loadPlan('p-schwelle'); sim.direct('start'); sim.ff(3);
    } else if (sz === 'stufentest' || sz === 'stufentest-pause') {
      // Stufentest HFmax in Stufe 13 (15.0 km/h); -pause: danach STOP
      loadPlan('p-hfmax'); sim.direct('start'); sim.ff(600 + 12 * 60 + 25);
      if (sz === 'stufentest-pause') { sim.cmd({ c: 'stop' }); sim.s.speed = 0; }
    } else if (sz === 'zonen') {
      loadPlan('p-grundlage'); sim.direct('start'); sim.ff(1025);
    } else if (sz === 'plan-bereit') {
      loadPlan('p-schwelle');
    }
    // Streckenmodus: Strecke laden (asynchron), dann wie oben vorspulen. ?strecke=<id>, sonst Homberg-Runde
    var rid = (/[?&]strecke=([a-z0-9-]+)/.exec(q) || [])[1] || 'homberg-runde';
    TX.demoReady = /^strecke/.test(sz) ? new Promise(function (r) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { r(); }); else r(); }).then(function () { return TX.rte.get(rid); }).then(function (r) {
      var D = r.d || r.prof[r.prof.length - 1][0], tg = r.art === 'trail' ? Math.round(D / 1000 * 480 / 300) * 300 : Math.round(D / 1000 * 300 / 60) * 60;
      var pf = TX.rte.prefs(r.id); if (pf && pf.target) tg = pf.target;
      var res = sim.cmd({ c: 'program', p: { type: 'route', id: r.id, target: tg, mode: 'terrain', scale: 1.0 } });
      if (!res.ok || sz === 'strecke-bereit') return;
      sim.direct('start');
      var s = sim.s, n = 0, stepOff = false, back = false, goal = sz === 'strecke' || sz === 'strecke-versatz' || sz === 'strecke-unterbrechung' ? 12.0 : 1e9;
      while (n++ < 40000 && s.dist < goal && !(sim.p && sim.p.finish)) {
        // kurz langsamer gelaufen (Handeingabe), spaeter zurueck zum Plan: ergibt einen Rueckstand
        if (!stepOff && s.dist >= 5) { stepOff = true; sim.cmd({ c: 'step', what: 'speed', d: -0.4 }); }
        if (!back && s.dist >= 8) { back = true; sim.cmd({ c: 'routeOffset', s: 0, i: 0 }); }
        sim.step(1);
      }
      if (sz === 'strecke-versatz') { sim.cmd({ c: 'step', what: 'speed', d: 0.5 }); sim.cmd({ c: 'step', what: 'incline', d: 0.5 }); sim.cmd({ c: 'step', what: 'incline', d: 0.5 }); }
      // Schluessel gezogen und wieder gesteckt, quittiert: PAUSE mit 3 km/h, Plan relativ dazu (grosser negativer Versatz)
      if (sz === 'strecke-unterbrechung') { sim.errRun = true; s.st = 'FEHLER'; s.speed = 0; sim.cmd({ c: 'ack' }); sim.direct('resume'); for (var w = 0; w < 18; w++) sim.step(1); }
      if (sz === 'strecke-ziel') for (var k = 0; k < 3; k++) sim.step(1);
      if (sz === 'strecke-ende') for (k = 0; k < 40 && s.st === 'LAEUFT'; k++) sim.step(1);
      s.speed = s.st === 'LAEUFT' ? s.tSpeed : 0; s.incline = s.tIncl;
    }) : Promise.resolve();
    // Beispiel-Verlauf fuer die Demo, falls leer
    if (!TX.runs().length && !/[?&]leer=1/.test(q)) {
      var d0 = new Date(); d0.setHours(18, 30, 0, 0);
      // r[2]: Lauf nach Vorlage (fuer «Zuletzt» in den Plänen)
      [[9, 2400], [6, 2900], [4, 1900], [2, 2900, 'p-schwelle'], [1, 2600]].forEach(function (r) {
        var s2 = new Sim(), pl = r[2] ? planBy(r[2]) : null;
        if (pl) s2.cmd({ c: 'program', p: TX.toProgram(pl) });
        s2.direct('start'); s2.ff(r[1], pl ? null : freeScript);
        var res = s2.cmd({ c: 'end' }), rec = TX.makeRun(null, res.summary.hist, res.summary);
        if (pl) { rec.planId = pl.id; rec.type = pl.type; }
        rec.ts = d0.getTime() - r[0] * 864e5; rec.id = 'demo' + r[0]; TX.saveRun(rec);
      });
    }
    var lastT = Date.now();
    sim.frozen = /[?&]frozen=1/.test(q);
    if (!sim.frozen) setInterval(function () { var t = Date.now(), dt = Math.min(1, (t - lastT) / 1000); lastT = t; sim.step(dt); }, 100);
    src = {
      state: function (hist) { return Promise.resolve(sim.snap(hist)); },
      cmd: function (b) { window.__txCmdLog.push({ c: b.c, b: b, hash: location.hash, t: Date.now() }); return Promise.resolve(sim.cmd(b)); }
    };
    document.documentElement.classList.add('is-demo');
  }

  /* ---------- Live-Ende des Verlaufs ----------
     Der Dienst liefert den Verlauf alle 2 s. Dazwischen sammelt die Oberflaeche aus den Zustandsabfragen
     einen Punkt je Sekunde, damit das Diagramm ab den ersten Sekunden zeichnet. */
  function liveTail(s) {
    var L = api.live, last = L[L.length - 1];
    if (s.st === 'BEREIT' || s.st === 'OFF' || (last && s.elapsed < last[0] - 1)) { if (L.length) { api.live = []; api.liveVer++; } return; }
    if (s.st !== 'LAEUFT') return;
    if (!last || s.elapsed - last[0] >= 1) {
      L.push([s.elapsed, TX.r1(s.speed), TX.r1(s.incline), s.hrOk === false ? 0 : (s.hr || 0)]);
      if (L.length > 30) L.splice(0, L.length - 30);
      api.liveVer++;
    }
  }
  // Verlauf des Dienstes plus Live-Punkte danach
  api.series = function () {
    var h = api.hist || [], t0 = h.length ? h[h.length - 1][0] : -1;
    return h.concat(api.live.filter(function (p) { return p[0] > t0; }));
  };

  /* ---------- Abfrage-Schleife: 400 ms, Verlauf alle 2 s ---------- */
  var timer = 0, busy = false, histAt = 0, again = false;
  // Abfragetakt: 400 ms, solange das Band in Gebrauch ist oder ein Countdown laeuft; in BEREIT 1 s (spart Last in Dienst und WebView)
  function busyNow() { var s = api.state; return !s || api.offline || s.st !== 'BEREIT' || s.cd > 0 || s.hold > 0 || s.speed > 0.3; }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(tick, ms != null ? ms : (document.hidden ? 2000 : busyNow() ? 400 : 1000)); }
  function tick() {
    clearTimeout(timer);
    if (busy) { again = true; return; }
    busy = true;
    var wantH = api.needHist && Date.now() - histAt >= 2000;
    src.state(wantH).then(function (s) {
      busy = false;
      if (!s || typeof s !== 'object' || !s.st) throw new Error('Antwort ohne Zustand');   // Fehlerantwort nie als Zustand uebernehmen
      api.fails = 0; api.offline = false;
      if (wantH) { histAt = Date.now(); if (Array.isArray(s.hist)) { api.hist = s.hist; api.histVer++; } }
      // Streckenplan (Abschnitte, Profil) kommt nur mit ?hist=1: aufbewahren, solange dasselbe Programm geladen ist
      if (s.prog && s.prog.type === 'route' && Array.isArray(s.prog.secs)) { api.rplan = { key: api.rkey(s.prog), secs: s.prog.secs, prof: s.prog.prof || null }; api.rplanVer++; }
      if (s.st === 'BEREIT' && api.hist.length) { api.hist = []; api.histVer++; }
      liveTail(s);
      api.state = s; emit();
      if (again) { again = false; schedule(0); } else schedule();
    }).catch(function () {
      busy = false; api.fails++;
      if (api.fails >= 3 && !api.offline) { api.offline = true; emit(); }
      schedule(1000);
    });
  }
  api.poke = function (withHist) { if (withHist) histAt = 0; schedule(0); };
  api.start = function () { tick(); };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) api.poke(); });

  // Verlauf sofort frisch holen (vor "end")
  api.freshHist = function () {
    return src.state(true).then(function (s) { if (s && Array.isArray(s.hist)) { api.hist = s.hist; api.histVer++; histAt = Date.now(); } return api.hist; }, function () { return api.hist; });
  };

  // Letzte Zusammenfassung des Dienstes (GET /api/summary)
  api.summary = function () {
    if (sim) return Promise.resolve(sim.lastSum);
    var ctl = window.AbortController ? new AbortController() : null;
    return withTimeout(fetch('/api/summary', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), 2500, ctl).catch(function () { return null; });
  };

  api.cmd = function (c, extra) {
    var body = { c: c };
    if (extra) for (var k in extra) body[k] = extra[k];
    // STOP ohne Dienst: direkt auf den Herstellerbus (native Bruecke), alles andere bleibt gesperrt
    var direct = function (why) {
      var ok = false; try { ok = !!(N && N.stopDirect && N.stopDirect()); } catch (e) { ok = false; }
      return ok ? { ok: true, direct: true } : { ok: false, error: why };
    };
    if (api.offline) return Promise.resolve(c === 'stop' ? direct('Keine Verbindung zum Dienst') : { ok: false, error: 'Keine Verbindung zum Dienst' });
    // STOP: antwortet der Dienst nicht innert 600 ms, zusaetzlich direkt (doppelt schadet nicht, warten schon)
    var answered = false, early = null, tm = c === 'stop' ? setTimeout(function () { if (!answered) early = direct('Dienst antwortet langsam'); }, 600) : 0;
    return src.cmd(body).then(function (r) {
      answered = true; clearTimeout(tm); api.poke(); r = r || { ok: false, error: 'Antwort leer' };
      return c === 'stop' && !r.ok ? (early && early.ok ? early : direct(r.error)) : r;
    }, function (e) {
      answered = true; clearTimeout(tm);
      var why = 'Dienst antwortet nicht (' + (e && e.message || 'Fehler') + ')';
      return c === 'stop' ? (early && early.ok ? early : direct(why)) : { ok: false, error: why };
    });
  };

  /* ---------- Pulsmesser (Bluetooth) ueber den Dienst: GET /api/hr, POST /api/hr/scan|connect|forget ----------
     In der Demo nachgebildet: ein gefundener «HRM 600», Verbinden setzt den Puls auf rund 128. */
  var hrd = { state: 'aus', name: '', address: '', hr: 0, scanning: false, bt: true, found: [], scanAt: 0, conAt: 0 };
  function hrDemo() {
    var t = Date.now();
    if (hrd.scanning && t - hrd.scanAt > 2500) { hrd.scanning = false; hrd.found = [{ address: 'F4:3A:6B:21:9C:07', name: 'HRM 600', rssi: -58 }, { address: 'D2:11:7E:40:AA:31', name: 'Forerunner 970', rssi: -71 }]; }
    if (hrd.state === 'verbinde' && t - hrd.conAt > 1200) { hrd.state = 'verbunden'; if (sim) sim.hrBle = true; }
    if (hrd.state === 'verbunden' && sim) { sim.s.hr = Math.round(127 + 2.5 * Math.sin(t / 4000)); sim.s.hrOk = true; }
    hrd.hr = hrd.state === 'verbunden' && sim ? sim.s.hr : 0;
    return { ok: true, state: hrd.state, name: hrd.name, address: hrd.address, hr: hrd.hr, scanning: hrd.scanning, bt: hrd.bt, found: hrd.found.slice() };
  }
  api.hr = {
    status: function () {
      if (demo) return Promise.resolve(hrDemo());
      var ctl = window.AbortController ? new AbortController() : null;
      return withTimeout(fetch('/api/hr', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.json(); }), 3000, ctl).catch(function () { return null; });
    },
    scan: function () { if (demo) { hrd.scanning = true; hrd.scanAt = Date.now(); hrd.found = []; return Promise.resolve({ ok: true }); } return api.req('POST', '/api/hr/scan', {}); },
    connect: function (address, name) {
      if (demo) { hrd.state = 'verbinde'; hrd.address = address; hrd.name = name; hrd.conAt = Date.now(); return Promise.resolve({ ok: true }); }
      return api.req('POST', '/api/hr/connect', { address: address, name: name });
    },
    forget: function () { if (demo) { hrd.state = 'aus'; hrd.name = ''; hrd.address = ''; if (sim) sim.hrBle = false; return Promise.resolve({ ok: true }); } return api.req('POST', '/api/hr/forget', {}); }
  };

  /* Ventilator CYCPLUS F1 (GET/POST /api/fan, Dienst 4.6); Demo: F1_22D6 verbunden, Automatik nach Tempo, Steigung und Puls */
  var fnd = { state: 'bereit', name: 'F1_22D6', address: 'E8:1B:4C:22:D6:01', auto: true, level: 0, manual: false, awake: true, scanAt: 0, conAt: 0 };
  if (demo && /[?&]luefter=hand/.test(q)) { fnd.auto = false; fnd.manual = true; fnd.level = 75; }
  if (demo && /[?&]luefter=keiner/.test(q)) { fnd.state = 'kein Ventilator'; fnd.name = ''; fnd.address = ''; }
  function fanDemo() {
    var t = Date.now();
    if (fnd.state === 'suche' && t - fnd.scanAt > 2500) { fnd.state = 'verbinde'; fnd.name = 'F1_22D6'; fnd.address = 'E8:1B:4C:22:D6:01'; fnd.conAt = t; }
    if (fnd.state === 'verbinde' && t - fnd.conAt > 1200) fnd.state = 'bereit';
    var con = fnd.state === 'bereit';
    if (con && fnd.auto && sim) {
      var s = sim.s, hf = TX.profile().hf, run = s.st === 'LAEUFT', h = s.hrOk && s.hr > 0 ? s.hr / hf : 0;
      fnd.level = !run ? 0 : Math.round(Math.max(15, Math.min(100, 15 + 8 * Math.max(0, s.speed - 5) + 2.5 * s.incline + 25 * Math.max(0, Math.min(1, (h - 0.7) / 0.2)))));
    }
    return { ok: true, state: fnd.state, name: fnd.name, address: fnd.address, auto: con && fnd.auto, level: con ? fnd.level : 0, target: con ? fnd.level : 0, manual: con && fnd.manual, connected: con, awake: con && fnd.level > 0 };
  }
  api.fan = {
    status: function () {
      if (demo) return Promise.resolve(fanDemo());
      var ctl = window.AbortController ? new AbortController() : null;
      return withTimeout(fetch('/api/fan', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.json(); }), 3000, ctl).catch(function () { return null; });
    },
    // a: scan | connect | forget | auto | level (v 5..100) | off
    cmd: function (a, v) {
      var b = { a: a }; if (a === 'level') b.v = v;
      if (demo) {
        window.__txFanLog = (window.__txFanLog || []).concat([b]);
        if (a === 'scan') { fnd.state = 'suche'; fnd.scanAt = Date.now(); fnd.name = ''; fnd.address = ''; }
        else if (a === 'forget') { fnd.state = 'kein Ventilator'; fnd.name = ''; fnd.address = ''; fnd.level = 0; }
        else if (fnd.state !== 'bereit') return Promise.resolve({ ok: false, error: 'nicht verbunden' });
        else if (a === 'auto') { fnd.auto = true; fnd.manual = false; }
        else if (a === 'level') { fnd.auto = false; fnd.manual = true; fnd.level = Math.max(5, Math.min(100, Math.round(v))); }
        else if (a === 'off') { fnd.auto = false; fnd.manual = true; fnd.level = 0; }
        return Promise.resolve({ ok: true });
      }
      return api.req('POST', '/api/fan', b);
    }
  };

  /* Laufband als Bluetooth-Geraet fuer Apps und Uhren (GET/POST /api/ftms): FTMS und Laufsensor; Demo: aus */
  var ftd = { ok: true, on: false, ctl: false, name: 'Tread Control', maxS: 14, maxI: 10, state: 'aus', advertising: false, clients: [] };
  api.ftms = {
    status: function () {
      if (demo) return Promise.resolve(JSON.parse(JSON.stringify(ftd)));
      var ctl = window.AbortController ? new AbortController() : null;
      return withTimeout(fetch('/api/ftms', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.json(); }), 3000, ctl).catch(function () { return null; });
    },
    // b: { on, ctl, maxS, maxI, name }
    set: function (b) {
      if (demo) {
        for (var k in b) ftd[k] = b[k];
        if (!ftd.on) ftd.ctl = false;
        ftd.state = ftd.on ? 'bereit' : 'aus'; ftd.advertising = ftd.on;
        window.__txFtmsLog = (window.__txFtmsLog || []).concat([b]);
        return Promise.resolve(JSON.parse(JSON.stringify(ftd)));
      }
      return api.req('POST', '/api/ftms', b);
    }
  };

  /* Gekoppelte Bluetooth-Audiogeraete mit Verbindungsstatus (GET /api/bt/audio); Demo: ein Sonos Roam «Wohnzimmer» */
  api.btAudio = function () {
    if (demo) return Promise.resolve({ ok: true, audio: [{ name: 'Wohnzimmer (SONOS 0062)', address: 'C4:38:75:62:00:62', connected: true }] });
    var ctl = window.AbortController ? new AbortController() : null;
    return withTimeout(fetch('/api/bt/audio', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.json(); }), 3000, ctl).catch(function () { return null; });
  };

  /* ---------- Native Bruecke ---------- */
  var iconCache = {};
  TX.native = {
    installed: function () {
      if (!N || typeof N.installed !== 'function') return demo ? ['org.smarttube.stable', 'app.revanced.android.apps.youtube.music', 'org.jellyfin.mobile', 'com.kinomap.training', 'com.zwift.zwiftgame', 'com.audiobookshelf.app'] : null;
      try { var a = JSON.parse(N.installed()); return Array.isArray(a) ? a : null; } catch (e) { return null; }
    },
    launch: function (pkg) {
      if (!N || typeof N.launch !== 'function') return demo ? 'demo' : false;
      try { var r = N.launch(pkg); return r !== false; } catch (e) { return false; }
    },
    setPref: function (k, v) {
      if (!N || typeof N.setPref !== 'function') return;
      try { N.setPref(String(k), String(v)); } catch (e) { /* Dienst ohne Einstellung */ }
    },
    // Echtes App-Symbol (data:image/png, 144 px) oder '' (Demo, nicht installiert, aeltere Bruecke); einmal je Paket abfragen
    icon: function (pkg) {
      if (!N || typeof N.icon !== 'function') return '';
      if (pkg in iconCache) return iconCache[pkg];
      var u = '';
      try { u = String(N.icon(pkg) || ''); } catch (e) { u = ''; }
      return (iconCache[pkg] = /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(u) ? u : '');
    },
    // Android-Bluetooth-Einstellungen (Lautsprecher, Kopfhoerer koppeln)
    openBluetooth: function () {
      if (!N || typeof N.openBluetooth !== 'function') return demo ? 'demo' : false;
      try { return N.openBluetooth() !== false; } catch (e) { return false; }
    },
    // Zahnrad der Statuszeile: native Seite oeffnet die Herstellereinstellungen
    hasSettings: function () { return !!(N && typeof N.openSettings === 'function') || demo; },
    openSettings: function () {
      if (!N || typeof N.openSettings !== 'function') return demo ? 'demo' : false;
      try { return N.openSettings() !== false; } catch (e) { return false; }
    }
  };
})();
