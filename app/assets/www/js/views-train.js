/* Trainingsseiten: Schnellstart, Intervall/Plan, Zonen. */
(function () {
  'use strict';
  var TX = window.TX, I = TX.I, esc = TX.esc, $ = TX.$;

  function setT(root, k, v) { var e = root.querySelector('[data-k="' + k + '"]'); if (e && e.textContent !== v) e.textContent = v; return e; }
  // Schrift verkleinern, bis der Text in eine Zeile passt
  function fit(e, max, min) { if (!e) return; var f = max; e.style.fontSize = f + 'px'; while (e.scrollWidth > e.clientWidth + 1 && f > min) e.style.fontSize = (--f) + 'px'; }
  function thinPts(a, max) {
    if (a.length <= max) return a;
    var f = a.length / max, o = [];
    for (var i = 0; i < max; i++) o.push(a[Math.floor(i * f)]);
    o.push(a[a.length - 1]); return o;
  }
  var discardBtn = '<button class="btn ghost" data-v="discard">' + I('x') + ' Verwerfen</button>';
  var coolBtn = '<button class="btn ghost" data-v="cool" aria-label="Zum Auslaufen springen">' + I('down') + ' Auslaufen</button>';   // Stufentest: Programmaktion im Kopf
  function discard() { return TX.cmd('clearProgram'); }

  /* ---------- Live-Verlauf in drei Bahnen: Tempo, Puls, Steigung ----------
     Endwert-Etiketten rechts auf Hoehe des Kurvenendes, Fenster ab der ersten Sekunde an die Laufzeit angepasst. */
  var GUT = 118, NOHR = TX.NA + ' bpm · kein Signal';
  function histChart(el, hist, st, rangeSec) {
    var tEnd = Math.max(st ? st.elapsed : 0, hist.length ? hist[hist.length - 1][0] : 0), xMin, xMax;
    if (rangeSec && tEnd > rangeSec) { xMax = tEnd; xMin = xMax - rangeSec; } else { xMin = 0; xMax = Math.max(tEnd, 2); }
    var h = hist.filter(function (p) { return p[0] >= xMin - 2; });
    // Kurvenende = derselbe Zustand wie Etikett und Steuerleiste (ein Zustand je Bildaufbau)
    if (st && st.st === 'LAEUFT' && h.length && st.elapsed > h[h.length - 1][0]) h = h.concat([[st.elapsed, st.speed, st.incline, st.hr > 0 && st.hrOk !== false ? st.hr : 0]]);
    if (h.length < 2) return null;
    h = thinPts(h, 600);
    var maxS = 10, maxI = 4, sp = [], ic = [], hr = [], hMin = 999, hMax = 0;
    h.forEach(function (p) {
      maxS = Math.max(maxS, p[1] * 1.1); maxI = Math.max(maxI, p[2] * 1.15); sp.push([p[0], p[1]]); ic.push([p[0], p[2]]);
      if (p[3] > 0) { hr.push([p[0], p[3]]); hMin = Math.min(hMin, p[3]); hMax = Math.max(hMax, p[3]); }
    });
    var lastS = sp[sp.length - 1][1], lastI = ic[ic.length - 1][1], lastH = hr.length ? hr[hr.length - 1][1] : 0;
    if (st && st.st === 'LAEUFT') { lastS = st.speed; lastI = st.incline; lastH = st.hr > 0 && st.hrOk !== false ? st.hr : (hr.length ? lastH : 0); }
    var hLo = Math.max(40, Math.min(hMin, 100) - 8), hHi = Math.max(hMax + 8, hLo + 40);
    TX.chart(el, [
      { pts: sp, min: 0, max: maxS, c: '#3d8bff', fill: 0.18, wd: 3, band: [0, 0.44], lab: TX.f1(lastS), pre: 'Ist', unit: 'km/h', end: true },
      { pts: hr, min: hLo, max: hHi, c: '#ff4d5e', fill: 0, wd: 2.4, band: [0.52, 0.76], lab: hr.length ? (lastH ? String(lastH) : TX.NA) : null, unit: 'bpm', none: NOHR, end: true },
      { pts: ic, min: 0, max: maxI, c: '#ffd43b', step: true, stepEnd: xMax, fill: 0.35, wd: 2, band: [0.84, 1], lab: TX.f1(lastI), pre: 'Ist', unit: '%', end: true }
    ], { xMin: xMin, xMax: xMax, seps: [0.48, 0.80], gutter: GUT, padB: 3 });
    return { xMin: xMin, xMax: xMax };
  }
  TX.histChart = histChart;
  // Vor dem Lauf: dieselben drei Bahnen leer, rechts die vorgeladenen Sollwerte und der Puls
  function readyChart(el, st, msg) {
    var hv = st && st.hr > 0 && st.hrOk !== false ? st.hr : 0;
    TX.chart(el, [
      { pts: [], c: '#3d8bff', band: [0, 0.44], lab: TX.f1(st ? st.tSpeed : 0), pre: 'Soll', unit: 'km/h', none: msg, end: true },
      { pts: [], c: '#ff4d5e', band: [0.52, 0.76], lab: hv ? String(hv) : null, unit: 'bpm', none: hv ? '' : NOHR, end: true },
      { pts: [], c: '#ffd43b', band: [0.84, 1], lab: TX.f1(st ? st.tIncl : 0), pre: 'Soll', unit: '%', end: true }
    ], { xMin: 0, xMax: 1, seps: [0.48, 0.80], gutter: GUT, padB: 3 });
  }
  // Minuten als Achsenwert: ganze Minuten als Zahl, sonst m:ss
  function mAx(v) { return v === Math.round(v) ? String(v) : TX.time(v * 60); }
  function axisLabels(xa, win, st, range, empty) {
    var lab;
    if (range && (empty || win.xMin > 0)) lab = ['−' + range + ' min', '−' + mAx(range * 3 / 4), '−' + mAx(range / 2), '−' + mAx(range / 4), 'jetzt'];
    else if (empty) lab = ['0:00', '', '', '', 'jetzt'];
    else if (win.xMax < 20) lab = ['0:00', '', '', '', TX.time(win.xMax)];
    else lab = [0, 1, 2, 3, 4].map(function (k) { return TX.time(win.xMax * k / 4); });
    var html = lab.map(function (t) { return '<span>' + t + '</span>'; }).join('');
    if (xa.innerHTML !== html) xa.innerHTML = html;
  }

  /* ================= Schnellstart ================= */
  TX.views.run = function () {
    var pf = TX.prefs(), range = pf.range === 0 ? 0 : (pf.range === 5 ? 5 : 20), lastKey = '';
    var root = document.createElement('div'); root.className = 'screen v-run'; root.setAttribute('role', 'main');
    root.innerHTML = TX.theadHtml({ title: 'Freies Laufen', prog: false }) + TX.mrowHtml({ l: 'Höhenmeter', u: 'm' }) +
      '<div class="main"><section class="card gcard" aria-label="Live-Verlauf"><div data-k="hint"></div><div class="gtop"><h2 class="lab">Live-Verlauf</h2>' +
      '<div class="legend"><span><i style="background:var(--spd)"></i>Tempo</span><span><i style="background:var(--hr)"></i>Puls</span><span><i style="background:var(--inc)"></i>Steigung</span></div>' +
      '<div class="seg" role="group" aria-label="Zeitraum"><button data-v="r5">5 min</button><button data-v="r20">20 min</button><button data-v="r0">Alles</button></div></div>' +
      '<div class="chart" data-k="ch" style="flex:1;min-height:0"></div><div class="xaxis" data-k="xa" style="padding-right:' + GUT + 'px"></div></section>' +
      '<section class="card zcard" aria-label="Herzfrequenz"><h2 class="lab" style="color:var(--hr);font-size:13px">' + I('heart', 1) + ' Herzfrequenz</h2>' +
      '<div class="zn" data-k="zn">RUHE</div><div class="big num" data-k="hr">--</div><div class="mut" style="font-size:15px;margin-top:4px" data-k="hrs"></div>' +
      '<div class="zbar" data-k="zb"><i style="background:var(--z1)">1</i><i style="background:var(--z2)">2</i><i style="background:var(--z3)">3</i><i style="background:var(--z4)">4</i><i style="background:var(--z5)">5</i></div>' +
      '<div class="mut" style="font-size:15px;margin-top:16px" data-k="zt"></div></section></div>';
    var cb = TX.ctlBar(); root.appendChild(cb.el);
    function segOn() { TX.$$('.seg button', root).forEach(function (b) { var on = b.getAttribute('data-v') === 'r' + range; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    segOn();
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      var v = b.getAttribute('data-v');
      if (v.charAt(0) === 'r') { range = +v.slice(1); TX.setPref('range', range); segOn(); lastKey = ''; view.update(TX.api.state); }
      if (v === 'discard') discard();
    });
    var view = {
      el: root, needHist: true,
      update: function (st) {
        if (!st) return;
        var s = st.st, hf = TX.profile().hf;
        TX.progHead(root, st, null);
        TX.headAct(root, s === 'BEREIT' && st.prog ? { k: 'discard', html: discardBtn } : null);
        setT(root, 'sub', s === 'BEREIT' ? (st.pulled === 1 ? 'Sicherheitsschlüssel einstecken' : 'Tempo frei wählen, dann START') :
          s === 'LAEUFT' ? 'Schnellstart · seit ' + TX.time(st.elapsed) : s === 'PAUSE' ? 'Schnellstart · ' + TX.time(st.elapsed) : s === 'FEHLER' ? (st.err || 'Störung') : '');
        TX.updMrow(root, st, String(s === 'BEREIT' ? 0 : Math.round(st.elev || 0)));
        // geladener Plan: START faehrt den Plan, deshalb deutlich zeigen
        var hint = $('[data-k="hint"]', root), hk = st.prog ? st.prog.name + s : '';
        if (hint.getAttribute('data-h') !== hk) {
          hint.setAttribute('data-h', hk);
          hint.innerHTML = st.prog ? '<div class="hint">' + I('warn') + '<span>' + (st.prog.type === 'zones' ? 'Zonenprogramm' : st.prog.type === 'route' ? 'Strecke' : 'Plan') + ' «' + esc(TX.nm(st.prog.name)) + '» ist geladen' +
            (s === 'BEREIT' ? ', START fährt dieses Programm.' : '.') + '</span><a class="btn ghost" href="' + TX.trainHash(st) + '">Zum Programm</a></div>' : '';
        }
        // Puls und Zone
        var z = TX.zoneOf(st.hr, hf), zn = $('[data-k="zn"]', root);
        zn.textContent = z === 0 ? 'KEIN PULS' : z < 0 ? 'RUHE' : 'ZONE ' + z;
        zn.style.color = z > 0 ? TX.ZC[z] : 'var(--z1)';
        setT(root, 'hr', st.hr > 0 ? String(st.hr) : '--');
        var srcT = st.hrSrc === 'bluetooth' ? 'Bluetooth' : 'Brustgurt';
        setT(root, 'hrs', st.hr > 0 ? (s === 'BEREIT' ? 'bpm · ' + (st.hrOk ? srcT + ' verbunden' : 'Signal unsicher') : 'bpm · ' + Math.round(st.hr / hf * 100) + ' % HFmax · ' + srcT) : 'Brustgurt anlegen');
        TX.$$('[data-k="zb"] i', root).forEach(function (e, i) { var on = s !== 'BEREIT' && z === i + 1; e.classList.toggle('on', on); e.textContent = on ? 'Z' + (i + 1) : String(i + 1); });
        var hist = TX.busy(st) || s === 'FEHLER' ? TX.api.series() : [];
        if (z > 0 && s !== 'BEREIT') setT(root, 'zt', 'Zeit in Zone ' + z + ': ' + TX.time(TX.zoneTimes(hist, hf)[z]));
        else setT(root, 'zt', 'Zonen aus Profil: HFmax ' + hf);
        // Verlauf: neu zeichnen bei neuem Verlauf oder neuem Live-Punkt
        var key = TX.api.histVer + '|' + TX.api.liveVer + '|' + range + '|' + s + (hist.length < 2 ? '|' + st.tSpeed + '|' + st.tIncl + '|' + (st.hrOk ? st.hr : 0) :
          s === 'LAEUFT' ? '|' + st.elapsed + '|' + st.speed + '|' + st.incline + '|' + st.hr + '|' + st.hrOk : '');
        if (key !== lastKey) {
          lastKey = key;
          var ch = $('[data-k="ch"]', root), xa = $('[data-k="xa"]', root);
          var win = histChart(ch, hist, st, range * 60), empty = !win;
          if (empty) { readyChart(ch, st, s === 'BEREIT' || s === 'OFF' ? 'Der Verlauf beginnt mit START' : 'Verlauf startet'); win = { xMin: 0, xMax: 1 }; }
          axisLabels(xa, win, st, range, empty);
        }
        cb.update(st);
      },
      destroy: function () { cb.destroy(); }
    };
    return view;
  };

  /* ================= Intervall / Plan =================
     Sobald state.prog existiert, kommt alles aus dem Dienst: Kopf, Abzeichen, Countdown,
     «Als Nächstes», Profil (prog.segs) und Markierung (prog.t). Vorher nur Vorschau der Vorlage. */
  function badgeOf(segs, i0, kind, test) {
    if (kind === 'h') { var hn = TX.hardNo(segs, i0); return (test ? 'STUFE' : 'BELASTUNG') + (hn.n ? ' ' + hn.c + '/' + hn.n : ''); }
    return kind === 'r' ? 'ERHOLUNG' : 'EIN-/AUSLAUFEN';
  }
  TX.badgeOf = badgeOf;
  TX.views.interval = function (prm) {
    var id = prm[0] || 'aktiv', plan = id !== 'aktiv' ? TX.plan(id) : null;
    var planSegs = plan && plan.type !== 'zones' ? TX.expand(plan) : null;
    var root = document.createElement('div'); root.className = 'screen v-int'; root.setAttribute('role', 'main');
    var segs = null, starts = [], hts = [], tot = 0, segKey = '', loadTried = false, markKey = '', barsW = 0;
    // Stufentest HFmax: Vorlage vom Typ test (direkt oder ueber das aktive Programm)
    var isTest = function (pr) { if (plan) return TX.isTest(plan); var a = pr && TX.active(pr.name); return !!(a && a.planId && TX.isTest(TX.plan(a.planId))); };
    var test = false, hfMax = 0, hfKey = '';
    var segNm = function (idx) { return test && segs[idx] && segs[idx].k === 'h' ? 'Stufe ' + TX.hardNo(segs, idx).c : TX.segName(segs, idx); };
    var cb = TX.ctlBar({ incQ: [0, 2, 4], spdQ: [8, 10, 12], block: function (st) { return st.prog ? '' : 'Plan wird geladen'; } });
    root.innerHTML = TX.theadHtml({ title: plan ? TX.nm(plan.name) : 'Plan', prog: true }) + TX.mrowHtml({ l: 'Restzeit' }) +
      '<div class="main"><section class="card now" aria-label="Aktueller Abschnitt"><span class="phase" data-k="ph">BEREIT</span><div class="cd num" data-k="cd">0:00</div>' +
      '<div class="mut" style="font-size:15px" data-k="cdl">verbleibend in diesem Abschnitt</div><div class="ring"><i data-k="ring"></i></div>' +
      '<div class="tgt"><div><div class="lab" style="color:#5c9dff">Soll Tempo</div><div class="num"><span data-k="ts">0.0</span><small>km/h</small></div><div class="tplan" data-k="tsp"></div></div>' +
      '<div><div class="lab" style="color:var(--inc)">Soll Steigung</div><div class="num"><span data-k="ti">0.0</span><small>%</small></div></div></div>' +
      // Test: Max-Puls bisher gross statt der Abschnittskurve
      '<div class="hfx" data-k="hfx" hidden><div class="lab" style="color:var(--hr)">Max-Puls bisher</div><div class="hfrow"><div class="num"><span data-k="hfm">--</span><small>bpm</small></div>' +
      '<div class="hfr"><div>jetzt <b data-k="hfn">--</b> bpm</div><div class="mut" data-k="hfq"></div></div></div><div class="hfp" data-k="hfp"></div></div>' +
      '<div class="lab hrcl" style="margin-top:16px">Puls in diesem Abschnitt</div><div class="chart" data-k="hrc" style="height:56px;flex:none;margin-top:4px"></div>' +
      '<div class="next"><span class="dot" data-k="ndot"></span><div><div class="lab" data-k="nl">Als Nächstes</div><div class="t2" data-k="nt"></div></div></div></section>' +
      '<section class="card prof" aria-label="Profil">' +
      // Wechselbanner: Overlay ueber dem oberen Rand des Profils, die Balken bleiben stehen
      '<div class="banner xban" data-k="ban" role="status"></div>' +
      '<div class="phd"><h2 class="lab">Profil</h2><div class="legend"><span><i style="background:var(--z1)"></i>Ein-/Auslaufen</span>' +
      '<span><i style="background:var(--warn)"></i>Belastung</span><span><i style="background:var(--z2)"></i>Erholung</span><span><i style="background:var(--inc)"></i>Steigung</span></div></div>' +
      '<div class="pbody"><div class="prow pbar"><div class="ax"><b>Tempo</b> km/h</div><div class="bars" data-k="bars"></div></div>' +
      '<div class="prow pinc"><div class="ax"><b>Steigung</b> %</div><div class="incs" data-k="incs"></div></div>' +
      '<div class="prow ptl"><div class="ax"></div><div class="tl" data-k="tl"></div></div></div></section></div>';
    root.appendChild(cb.el);
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      if (b.getAttribute('data-v') === 'discard') discard().then(function (r) { if (r.ok) TX.go('#/plans'); });
      // Stufentest: erschoepft, direkt ins Auslaufen (letzter Abschnitt; der Dienst stuft in 3-km/h-Schritten ab)
      if (b.getAttribute('data-v') === 'cool' && segs) TX.cmd('skipTo', { idx: segs.length - 1 }).then(function (r) { if (r && r.ok) TX.toast('Auslaufen mit ' + TX.f1(segs[segs.length - 1].s) + ' km/h'); });
    });
    // Profil: Lage und Breite nach Zeit, damit Marke und Umrandung exakt zusammenpassen; Y-Skala 0 bis max + 10 %
    function buildBars(sg) {
      var mx = 0, h = '', inc = '';
      starts = []; hts = []; tot = 0;
      sg.forEach(function (s) { starts.push(tot); tot += s.d; mx = Math.max(mx, s.s); });
      var top = Math.max(1, mx * 1.1);
      sg.forEach(function (s) { hts.push(s.s / top * 100); });
      // Etiketten ohne Ueberlappung: breite Balken immer, schmale (z. B. Minutenstufen) im Abstand von mindestens 46 px
      var W = $('[data-k="bars"]', root).clientWidth, LBL = 46, lab = [];
      barsW = W;
      if (!W) sg.forEach(function (s) { lab.push(s.d / tot > 0.025); });
      else {
        var cx = sg.map(function (s, k) { return (starts[k] + s.d / 2) / tot * W; }), bw = sg.map(function (s) { return s.d / tot * W; }), last = -1e9;
        sg.forEach(function (s, k) { lab.push(bw[k] >= LBL); });
        sg.forEach(function (s, k) {
          if (lab[k]) { last = cx[k]; return; }
          var nxt = 1e9; for (var q = k + 1; q < sg.length; q++) if (lab[q]) { nxt = cx[q]; break; }
          if (bw[k] >= 18 && cx[k] - last >= LBL && nxt - cx[k] >= LBL) { lab[k] = true; last = cx[k]; }
        });
      }
      sg.forEach(function (s, k) {
        var pos = 'left:calc(' + (starts[k] / tot * 100).toFixed(3) + '% + 1.5px);width:calc(' + (s.d / tot * 100).toFixed(3) + '% - 3px)';
        // Werte immer mit einer Stelle; Einheit steht einmal an der Achse
        var wide = lab[k];
        // Flaeche als eigenes Element: erledigt = 40 % Deckkraft plus Schraffur, Etikett bleibt voll lesbar ueber dem Balken
        h += '<div class="b k-' + s.k + '" style="' + pos + ';height:' + hts[k].toFixed(1) + '%"><i class="f" style="background-color:' + TX.KC[s.k] + '"></i><span>' + (wide ? TX.f1(s.s) : '') + '</span></div>';
        inc += '<i style="' + pos + '">' + (wide ? TX.f1(s.i) : '') + '</i>';
      });
      $('[data-k="bars"]', root).innerHTML = h + '<div class="marker" data-k="mark" style="left:0"></div>';
      $('[data-k="incs"]', root).innerHTML = inc;
      var step = tot > 3600 ? 900 : tot > 1800 ? 600 : tot > 600 ? 300 : 60, tl = '';
      for (var t = 0; t < tot - step * 0.45; t += step) tl += '<span style="position:absolute;left:' + (t / tot * 100).toFixed(2) + '%;' + (t ? 'transform:translateX(-50%)' : '') + '">' + TX.time(t) + '</span>';
      tl += '<span style="position:absolute;right:0">' + TX.time(tot) + '</span>';
      $('[data-k="tl"]', root).innerHTML = tl;
      cb.setQ(TX.pick3(sg.map(function (s) { return s.i; }), [0, 2, 4]), TX.pick3(sg.map(function (s) { return s.s; }), [8, 10, 12]));
      markKey = '';
    }
    var lastHv = '';
    var view = {
      el: root, needHist: true,
      update: function (st) {
        if (!st) return;
        var s = st.st, pr = st.prog;
        if (pr && (pr.type === 'zones' || pr.type === 'route')) { if (TX.busy(st)) { TX.go(TX.trainHash(st), true); return; } pr = null; }
        // Plan beim Betreten laden (Sollwerte vorladen), nur in BEREIT und nie starten
        if (s === 'BEREIT' && planSegs && (!pr || pr.name !== plan.name) && !loadTried && !TX.api.offline) {
          loadTried = true;
          var prog = TX.toProgram(plan);
          TX.cmd('program', { p: prog }).then(function (r) { if (r.ok) TX.setActive(plan, prog); else if (TX.transportErr(r)) setTimeout(function () { loadTried = false; }, 3000); });   // Verbindung: nochmals versuchen
        }
        // Abschnittsliste: geladenes Programm, sonst Vorschau der Vorlage
        var sg = pr ? (pr.segs && pr.segs.length ? pr.segs : (planSegs && pr.name === plan.name ? planSegs : null)) : planSegs;
        var name = pr ? pr.name : plan ? plan.name : 'Kein Plan geladen';
        var k = name + '|' + (sg ? sg.map(function (x) { return x.d + ':' + x.s + ':' + x.i + ':' + x.k; }).join(',') : '');
        if (k !== segKey) {
          segKey = k; segs = sg; setT(root, 'title', TX.nm(name));
          if (segs) buildBars(segs);
          else { $('[data-k="bars"]', root).innerHTML = '<div class="empty">' + (plan ? 'Plan wird geladen' : 'Kein Plan geladen. Unter Pläne eine Vorlage starten.') + '</div>'; $('[data-k="incs"]', root).innerHTML = ''; $('[data-k="tl"]', root).innerHTML = ''; starts = []; tot = 0; }
        }
        // Etiketten brauchen die Breite: vor dem Einhaengen gebaut, dann einmal neu
        if (segs && !barsW && $('[data-k="bars"]', root).clientWidth) buildBars(segs);
        var n = segs ? segs.length : 0;
        // in BEREIT steht ein geladenes Programm immer am Anfang (Altwerte des Dienstes nicht zeigen)
        var live = pr && s !== 'BEREIT';
        var i0 = live ? TX.clamp((pr.idx || 1) - 1, 0, Math.max(0, n - 1)) : 0, cur = segs ? segs[i0] : null;
        var total = pr && pr.total ? pr.total : tot, left = live ? pr.left : total;
        var t = live ? TX.clamp(pr.t != null ? pr.t : total - left, 0, total) : 0;
        var segDur = live ? pr.segDur : cur ? cur.d : 0, segLeft = live ? pr.segLeft : segDur, kind = live ? pr.kind : cur ? cur.k : 'w';
        // Abzeichen und Kopf
        var t2 = isTest(pr);
        if (t2 !== test) { test = t2; $('[data-k="hfx"]', root).hidden = !test; root.classList.toggle('is-test', test); markKey = ''; }
        var ph = $('[data-k="ph"]', root), pht = segs ? badgeOf(segs, i0, kind, test) : 'BEREIT';
        if (ph.textContent !== pht) { ph.textContent = pht; ph.className = 'phase k-' + kind; }
        setT(root, 'sub', n && !test ? 'Abschnitt ' + (i0 + 1) + ' von ' + n : test ? 'bis zur Erschöpfung, dann BEENDEN' : '');   // im Stufentest zaehlt nur das Abzeichen (Stufe 13/17)
        TX.progHead(root, st, segs ? { total: total, left: left } : null);
        var canCool = test && (s === 'LAEUFT' || s === 'PAUSE') && segs && i0 < segs.length - 1;
        TX.headAct(root, s === 'BEREIT' && pr ? { k: 'discard', html: discardBtn } : canCool ? { k: 'cool', html: coolBtn } : null);
        // Countdown
        setT(root, 'cd', TX.time(segLeft));
        setT(root, 'cdl', s === 'BEREIT' ? 'Dauer des ersten Abschnitts' : 'verbleibend in diesem Abschnitt');
        var ring = $('[data-k="ring"]', root); ring.style.width = (segDur ? (segDur - segLeft) / segDur * 100 : 0).toFixed(1) + '%';
        ring.style.background = kind === 'h' ? 'var(--warn)' : kind === 'r' ? 'var(--spd)' : 'var(--z1)';
        // Sollwerte: dieselben Zahlen wie in der Steuerleiste
        cb.update(st);
        var cv = cb.vals(); setT(root, 'ts', TX.f1(cv.s)); setT(root, 'ti', TX.f1(cv.i));
        // Einlaufen: Band-Soll 1.0, das Programm-Soll steht als «geplant» darunter
        setT(root, 'tsp', st.hold > 0 && st.holdTo > 0 ? 'geplant ' + TX.f1(st.holdTo) + ' km/h' : '');
        // Als Naechstes
        var nx = live ? pr.next : (segs && segs[1]) || null;
        if (nx) {
          var nn = segs && segs[i0 + 1] ? segNm(i0 + 1) : TX.KIND[nx.k];
          setT(root, 'nl', 'Als Nächstes in ' + TX.time(segLeft));
          var ntx = nn + ' ' + TX.time(nx.d) + ' · ' + TX.f1(nx.s) + ' km/h', nte = $('[data-k="nt"]', root);
          if (nte.textContent !== ntx) { nte.textContent = ntx; fit(nte, 22, 15); }
          $('[data-k="ndot"]', root).style.background = TX.KC[nx.k];
        } else {
          setT(root, 'nl', pr ? 'Ziel in ' + TX.time(segLeft) : 'Als Nächstes');
          var nte2 = setT(root, 'nt', pr ? 'Plan endet, Band hält sanft an' : TX.NA); fit(nte2, 22, 15);
          $('[data-k="ndot"]', root).style.background = 'var(--go)';
        }
        TX.updMrow(root, st, TX.time(left));
        // Umrandung: Abschnitt, in dem die Abspielmarke (prog.t) liegt
        if (segs && tot) {
          var j = 0; while (j < n - 1 && t >= starts[j] + segs[j].d) j++;
          var dn = 0; if (pr && s !== 'BEREIT') while (dn < n && starts[dn] + segs[dn].d <= t) dn++;
          var mk2 = j + '|' + dn;
          if (mk2 !== markKey) {
            markKey = mk2;
            TX.$$('[data-k="bars"] .b', root).forEach(function (b, k2) { b.classList.toggle('cur', k2 === j); b.classList.toggle('done', k2 < dn); });
            TX.$$('[data-k="incs"] i', root).forEach(function (b, k2) { b.classList.toggle('cur', k2 === j); b.classList.toggle('done', k2 < dn); });
            // Abspielmarke nur so hoch wie der aktuelle Balken, damit sie kein Etikett kreuzt
            var mk0 = $('[data-k="mark"]', root); if (mk0) mk0.style.top = 'calc(' + (100 - (hts[j] || 0)).toFixed(1) + '% - 4px)';
          }
          var mk = $('[data-k="mark"]', root);
          if (mk) mk.style.left = (t / tot * 100).toFixed(2) + '%';
        }
        // Banner 10 s vor dem Wechsel
        var ban = $('[data-k="ban"]', root), showB = s === 'LAEUFT' && pr && pr.next && pr.segLeft <= 10;
        ban.classList.toggle('on', !!showB);
        if (showB) {
          // gemeinsamer Wechseltext (TX.changeText): erste Zeile Abschnitt, zweite Zeile Tempo und Steigung
          var n2 = pr.next, cur2 = { s: st.tSpeed, i: st.tIncl };
          var nx2 = { s: n2.s, i: n2.i, k: n2.k, name: segs && segs[i0 + 1] ? segNm(i0 + 1) : null };
          var parts = TX.changeText(cur2, nx2).split(' · '), bh = TX.banHtml(pr.segLeft, parts[0], parts.slice(1).join(' · '));
          if (ban.getAttribute('data-h') !== bh) { ban.setAttribute('data-h', bh); ban.innerHTML = bh; }
          ban.className = 'banner xban on d-' + TX.changeDir(cur2, nx2);
        }
        // Test: hoechster Puls seit Laufbeginn (Verlauf plus Live-Wert), in BEREIT leer
        if (test) {
          var hn0 = st.hr > 0 && st.hrOk !== false ? st.hr : 0;
          if (!TX.busy(st)) hfMax = 0;
          else {
            var hk2 = TX.api.histVer + '|' + TX.api.liveVer;
            if (hk2 !== hfKey) { hfKey = hk2; TX.api.series().forEach(function (p) { if (p[3] > hfMax) hfMax = p[3]; }); }
            if (hn0 > hfMax) hfMax = hn0;
          }
          setT(root, 'hfm', hfMax ? String(Math.round(hfMax)) : TX.NA);
          setT(root, 'hfn', hn0 ? String(hn0) : TX.NA);
          setT(root, 'hfq', 'im Profil ' + TX.profile().hf);
          setT(root, 'hfp', !hn0 && !hfMax ? 'Kein Pulssignal: ohne Pulsmesser nicht auswertbar' : '');
        }
        // Puls im Abschnitt (mit Live-Punkten ab der ersten Sekunde)
        var hk = TX.api.histVer + '|' + TX.api.liveVer + '|' + s + '|' + i0;
        if (hk !== lastHv) {
          lastHv = hk;
          var hc = $('[data-k="hrc"]', root), t0 = st.elapsed - (segDur - segLeft);
          var pts = TX.busy(st) ? TX.api.series().filter(function (p) { return p[0] >= t0 - 2 && p[3] > 0; }).map(function (p) { return [p[0], p[3]]; }) : [];
          var hv = st.hr > 0 && st.hrOk !== false ? st.hr : 0;
          if (TX.busy(st) && pts.length >= 2) {
            TX.chart(hc, [{ pts: pts, min: 90, max: 190, c: '#ff4d5e', wd: 2.4, lab: hv ? String(hv) : TX.NA, unit: 'bpm', end: true }],
              { pad: 6, gutter: 92, xMin: Math.max(0, t0), xMax: Math.max(st.elapsed, t0 + 5) });
          } else {
            // ohne Kurve einzeilig: Wert und Zustand
            hc._tx = null;
            hc.innerHTML = '<div class="hrline"><b>' + (hv ? hv : TX.NA) + '</b> bpm · ' + (!hv ? 'kein Signal' : TX.busy(st) ? 'Kurve startet' : 'Kurve beginnt mit START') + '</div>';
          }
        }
      },
      destroy: function () { cb.destroy(); }
    };
    return view;
  };

  /* ================= Zonen ================= */
  var ZN = TX.ZN;
  TX.views.zones = function () {
    var root = document.createElement('div'); root.className = 'screen v-zones'; root.setAttribute('role', 'main');
    var pf = TX.prefs(), zs0 = pf.zone || {}, z = TX.clamp(+zs0.z || 2, 1, 5), d0 = TX.ZDEF[z];
    // Dauer und Tempogrenzen; Starttempo und Steigung kommen aus der Steuerleiste (state.tSpeed/tIncl)
    var cfg = { z: z, dur: TX.clamp(+zs0.dur || 2700, 300, 14400), sMin: +zs0.sMin || d0.sMin, sMax: Math.min(16, +zs0.sMax || d0.sMax), i: zs0.i != null ? +zs0.i : 1.0 };
    var setup = false, mode = '', lastHv = '', reloadT = 0, chosen = false, touched = false, lastS0 = null;
    var hrOk = function (st) { return !!(st && st.hrOk && st.hr > 0); };
    var isZ = function (st) { return !!(st && st.prog && st.prog.type === 'zones'); };
    // Schnellwahl Tempo nur zwischen min und max: min, Mitte (auf 0.5), max
    function spdQ(lo, hi) {
      var q = [TX.r1(lo), Math.round(lo + hi) / 2, TX.r1(hi)], u = [];
      q.forEach(function (v) { if (v >= lo - 1e-9 && v <= hi + 1e-9 && u.indexOf(v) < 0) u.push(v); });
      return u;
    }
    var cb = TX.ctlBar({ incQ: [0, 1, 2], spdQ: spdQ(cfg.sMin, cfg.sMax), block: function (st) { return isZ(st) ? '' : 'Erst Zone wählen'; },
      // vor der Zonenwahl: Tempoblock gesperrt, zeigt das Starttempo (= Tempo min) mit Unterzeile «Start»
      spdOff: function (st) { return st.st === 'BEREIT' && !isZ(st) ? { v: cfg.sMin, t: 'Start' } : null; },
      // Zone geladen: Tempo in der Leiste ist das Starttempo; ohne Puls laeuft das Band ohne Automatik
      spdNote: function (st) { return st.st === 'BEREIT' && st.prog && st.prog.type === 'zones' ? 'Start' : ''; },
      startNote: function (st) { return st.prog && st.prog.type === 'zones' && !hrOk(st) ? 'startet ohne Automatik' : ''; } });
    root.innerHTML = TX.theadHtml({ title: 'Zonentraining', prog: true }) + TX.mrowHtml({ l: 'Im Ziel', u: '%' }) + '<div class="main" data-k="main"></div>';
    root.appendChild(cb.el);
    var main = $('[data-k="main"]', root);
    function zoneOfProg(pr) { var zs = TX.zones(), b = 2, bd = 1e9; zs.forEach(function (x) { var dd = Math.abs(x.lo - pr.lo) + Math.abs(x.hi - pr.hi); if (dd < bd) { bd = dd; b = x.z; } }); return b; }
    function syncFromProg(pr) {
      cfg.z = zoneOfProg(pr); if (pr.total) cfg.dur = pr.total;
      if (pr.sMin) cfg.sMin = pr.sMin; if (pr.sMax) cfg.sMax = pr.sMax;
      chosen = true;
    }
    function stepper(k, lab, val, unit) {
      return '<div class="stp big"><button data-st="' + k + '" data-d="-1" aria-label="' + lab + ' verringern">' + I('minus') + '</button><div class="val"><div class="lab">' + lab + '</div><b><span data-k="v-' + k + '">' + val + '</span><small>' + unit + '</small></b></div>' +
        '<button data-st="' + k + '" data-d="1" aria-label="' + lab + ' erhöhen">' + I('plus') + '</button></div>';
    }
    function fmtCfg(k) { return k === 'dur' ? String(Math.round(cfg.dur / 60)) : TX.f1(cfg[k]); }
    function renderSetup() {
      var zs = TX.zones();
      main.innerHTML = '<section class="card zsetup" aria-label="Zielzone"><h2 class="lab" style="color:var(--hr);font-size:13px">' + I('heart', 1) + ' Zielzone wählen</h2>' +
        '<div class="zsel" style="flex-direction:column;flex:1">' + zs.map(function (x) {
          return '<button data-z="' + x.z + '" style="flex-direction:row;justify-content:flex-start;padding:0 18px;gap:16px;height:auto;flex:1" aria-pressed="false"><b style="color:' + TX.ZT[x.z] + ';width:44px">Z' + x.z + '</b>' +
            '<span style="font-size:17px;color:var(--text);font-weight:700;width:120px">' + ZN[x.z] + '</span><span style="font-size:15px">' + x.txt + ' bpm</span></button>';
        }).join('') + '</div></section>' +
        '<section class="card zsetup" aria-label="Einstellungen"><h2 class="lab">Einstellungen</h2>' +
        '<div class="srow">' + stepper('dur', 'Dauer', fmtCfg('dur'), 'min') + stepper('sMin', 'Tempo min', fmtCfg('sMin'), 'km/h') + stepper('sMax', 'Tempo max', fmtCfg('sMax'), 'km/h') + '</div>' +
        '<div class="znote">' + I('bolt') + '<span>Die Zone startet mit Tempo min. Starttempo und Steigung kannst du unten in der Steuerleiste anpassen, die Automatik regelt danach zwischen min und max.</span></div>' +
        '<div class="psrc" data-k="psrc"><span class="pic">' + I('heart', 1) + '</span><div class="ptx"><div class="lab">Pulsquelle</div><b>Brustgurt oder Handsensoren</b>' +
        '<div class="mut" data-k="pnote"></div></div><span class="bars4 big" data-k="pbars"></span><div class="pval"><div class="num"><span data-k="pv">' + TX.NA + '</span><small>bpm</small></div><div class="pst" data-k="pst"></div></div></div>' +
        '<div class="limits" style="margin-top:auto"><span class="chip">Automatik: langsamer sofort, schneller nur bei stabilem Signal</span><span class="chip">Erste 5 min: nicht schneller</span>' +
        '<span class="chip" style="color:#ff9a52">' + I('shield') + ' Ohne Pulssignal: Tempo halten, nach 20 s schrittweise aufs Mindesttempo</span></div>' +
        '<div class="mut" style="font-size:15px;margin-top:12px" data-k="lst">Zone antippen lädt das Programm. Das Band startet erst mit START.</div></section>';
      TX.$$('[data-st]', main).forEach(function (b) {
        TX.holdRepeat(b, function (n) {
          var k = b.getAttribute('data-st'), d = +b.getAttribute('data-d');
          if (k === 'dur') cfg.dur = TX.clamp(cfg.dur + d * (n > 8 ? 300 : 60), 300, 14400);
          else cfg[k] = TX.clamp(TX.r1(cfg[k] + d * 0.5), 0.8, 16);
          if (cfg.sMax < cfg.sMin + 0.5) { if (k === 'sMin') cfg.sMax = Math.min(16, cfg.sMin + 0.5); else cfg.sMin = Math.max(0.8, cfg.sMax - 0.5); }
          if (cfg.sMax < cfg.sMin + 0.5) cfg.sMax = cfg.sMin + 0.5;   // untere Grenze 0.8 km/h, Abstand mindestens 0.5
          ['dur', 'sMin', 'sMax'].forEach(function (kk) { setT(main, 'v-' + kk, fmtCfg(kk)); });
          if (k !== 'dur') { touched = true; if (TX.api.state) view.update(TX.api.state); }
          // geladene Zone mit neuen Grenzen nachladen
          clearTimeout(reloadT);
          var st = TX.api.state;
          if (chosen && st && st.st === 'BEREIT' && st.prog && st.prog.type === 'zones') reloadT = setTimeout(function () { loadZone(true); }, 700);
        });
      });
      markZ();
    }
    // Pulsquellen-Karte in der Einstellung: Signalbalken und Zustand aus state.hr/hrOk
    function psrc(st) {
      var box = $('[data-k="psrc"]', main); if (!box) return;
      var ok = hrOk(st), weak = !ok && st.hr > 0, k = ok ? 'ok' : weak ? 'weak' : 'none';
      if (box.getAttribute('data-s') !== k) {
        box.setAttribute('data-s', k); box.className = 'psrc s-' + k;
        $('[data-k="pbars"]', box).innerHTML = [8, 13, 18, 23].map(function (h, i) { return '<i style="height:' + h + 'px"' + ((ok || (weak && i < 2)) ? '' : ' class="x"') + '></i>'; }).join('');
        setT(box, 'pst', ok ? 'plausibel' : weak ? 'Signal unsicher' : 'kein Signal');
        setT(box, 'pnote', ok ? 'Die Automatik regelt nach diesem Puls.' : 'Ohne Signal startet das Band ohne Automatik.');
      }
      setT(box, 'pv', st.hr > 0 ? String(st.hr) : TX.NA);
    }
    function markZ() { TX.$$('[data-z]', main).forEach(function (b) { var on = chosen && +b.getAttribute('data-z') === cfg.z; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    // Programm laden: Sollwerte des Dienstes behalten, wenn schon eine Zone geladen ist
    function loadZone(keep) {
      var st = TX.api.state;
      if (!st || st.st !== 'BEREIT') { TX.toast('Zone nur im Zustand BEREIT wählbar'); return; }
      var had = st.prog && st.prog.type === 'zones';
      // Starttempo = Tempo min; beim Nachladen bleibt ein von Hand gesetztes Starttempo (innerhalb der Grenzen)
      var own = keep && had && lastS0 != null && Math.abs(st.tSpeed - lastS0) > 0.05;
      var s0 = own ? TX.clamp(st.tSpeed, cfg.sMin, cfg.sMax) : cfg.sMin, inc = had ? st.tIncl : cfg.i;
      var zone = { z: cfg.z, dur: cfg.dur, s0: s0, sMin: cfg.sMin, sMax: cfg.sMax, i: inc };
      TX.setPref('zone', zone);
      var plan = { id: null, name: TX.zoneName(cfg.z), type: 'zones', zone: zone }, prog = TX.toProgram(plan);
      TX.cmd('program', { p: prog }).then(function (r) {
        if (!r.ok) return null;
        TX.setActive(null, prog); if (!keep) { setup = false; mode = ''; }
        // Starttempo ausdruecklich vorladen (in BEREIT nur vorladen, startet nicht)
        lastS0 = s0;
        return TX.cmd('speed', { v: s0 });
      }).then(function () { TX.api.poke(); });
    }
    function renderRun() {
      main.innerHTML = '<section class="card gauge" aria-label="Puls"><h2 class="lab" style="color:var(--hr);font-size:13px">' + I('heart', 1) + ' Puls · <span data-k="zz">Zielzone</span></h2>' +
        '<div class="gw"><svg data-k="g" width="340" height="180" aria-hidden="true"></svg><div class="c"><div class="num" data-k="ghr">--</div><div class="st2" data-k="gst"></div></div></div>' +
        '<div class="zl" data-k="zl"></div><div class="sig" data-k="sig"></div>' +
        '<div class="autob"><span style="font-size:22px;display:flex" data-k="aic"></span><div><div style="font-weight:800;font-size:15px" data-k="at"></div><div class="mut" style="font-size:13px" data-k="as"></div></div>' +
        '<button class="btn ghost" data-v="auto"></button></div></section>' +
        '<section class="card zright" aria-label="Puls im Zielband"><div style="display:flex;align-items:center;gap:18px"><h2 class="lab">Puls im Zielband</h2>' +
        '<div class="legend"><span><i style="background:var(--hr)"></i>Puls</span><span><i style="background:var(--spd)"></i>Tempo (Automatik)</span><span><i style="background:rgba(61,139,255,.35)"></i>Zielband</span></div></div>' +
        '<div class="chart" data-k="zc" style="flex:1;min-height:0;margin-top:8px"></div><div class="xaxis" data-k="zxa" style="padding-right:' + GUT + 'px"></div>' +
        '<div class="lab" style="margin-top:10px">Zeit in Zonen</div><div class="dist" data-k="dist"></div><div class="limits" data-k="lim"></div></section>';
    }
    function gauge(st, pr, tz) {
      var g = $('[data-k="g"]', root), zs = TX.zones(), lo = Math.min(100, zs[0].lo), hi = Math.max(190, zs[4].hi + 6);
      var cx = 170, cy = 168, r = 145, a = function (v) { return Math.PI * (1 - (TX.clamp(v, lo, hi) - lo) / (hi - lo)); };
      var pt = function (v, rr) { return [(cx + rr * Math.cos(a(v))).toFixed(1), (cy - rr * Math.sin(a(v))).toFixed(1)]; }, s = '';
      zs.forEach(function (x) {
        var z0 = x.z === 1 ? lo : x.lo, z1 = x.z === 5 ? hi : x.hi + 1, p1 = pt(z0 + 0.6, r), p2 = pt(z1 - 0.6, r), on = x.z === tz;
        s += '<path d="M' + p1 + ' A' + r + ' ' + r + ' 0 0 1 ' + p2 + '" stroke="' + TX.ZHEX[x.z] + '" stroke-width="' + (on ? 26 : 16) + '" fill="none" opacity="' + (on ? 1 : 0.6) + '" stroke-linecap="round"/>';
      });
      if (st.hr > 0) { var n = pt(st.hr, r - 34), n2 = pt(st.hr, r + 16); s += '<line x1="' + n[0] + '" y1="' + n[1] + '" x2="' + n2[0] + '" y2="' + n2[1] + '" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'; }
      if (g._h !== s) { g._h = s; g.innerHTML = s; }   // nur bei Aenderung neu aufbauen (sonst alle 400 ms HTML-Parsing)
    }
    var view = {
      el: root, needHist: true,
      update: function (st) {
        if (!st) return;
        var s = st.st, pr = st.prog && st.prog.type === 'zones' ? st.prog : null;
        if (st.prog && (st.prog.type === 'interval' || st.prog.type === 'route') && TX.busy(st)) { TX.go(TX.trainHash(st), true); return; }
        if (!pr && chosen && !setup && mode === 'run') chosen = false;
        if (!pr) setup = false;
        var rdy = s === 'BEREIT' || s === 'OFF';
        var want = pr && !setup ? 'run' : (rdy ? 'setup' : (pr ? 'run' : 'none'));
        if (want !== mode) {
          mode = want; lastHv = '';
          if (want === 'setup') renderSetup(); else if (want === 'run') renderRun();
          else main.innerHTML = '<section class="card" style="grid-column:1 / span 2;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px">' +
            '<div class="mut" style="font-size:17px">Es läuft gerade kein Zonentraining.</div><a class="btn ghost" href="#/training">Zum laufenden Training</a></section>';
        }
        setT(root, 'title', pr ? TX.nm(pr.name) : 'Zonentraining');
        setT(root, 'sub', pr ? 'Ziel ' + pr.lo + ' bis ' + pr.hi + ' bpm' : 'Zielzone wählen, dann START');
        TX.progHead(root, st, pr ? { total: pr.total, left: pr.left } : null);
        // Programmaktion: «Zone ändern» (nur in BEREIT aktiv), in der Auswahl mit geladener Zone «Verwerfen»
        var act = null;
        if (pr && mode === 'run') act = { k: 'chg' + (s === 'BEREIT'), html: '<button class="btn ghost" data-v="change"' + (s === 'BEREIT' ? '' : ' disabled') + '>' + I('zones') + ' Zone ändern</button>' };
        else if (pr && mode === 'setup' && s === 'BEREIT') act = { k: 'discard', html: discardBtn };
        TX.headAct(root, act);
        // Schnellwahl aus den Grenzen des geladenen Programms, sonst aus der Einstellung
        cb.setQ([0, 1, 2], pr && pr.sMin && pr.sMax ? spdQ(pr.sMin, pr.sMax) : spdQ(cfg.sMin, cfg.sMax));
        var hist = TX.busy(st) ? TX.api.series() : [];
        var inT = 0, tot = 0;
        if (pr) hist.forEach(function (p, i) { if (!i) return; var dt = Math.min(30, p[0] - hist[i - 1][0]); tot += dt; if (p[3] >= pr.lo && p[3] <= pr.hi) inT += dt; });
        TX.updMrow(root, st, tot ? String(Math.round(inT / tot * 100)) : '--');
        if (mode === 'setup') psrc(st);
        if (mode === 'run' && pr) {
          var tz = zoneOfProg(pr), zs = TX.zones();
          setT(root, 'zz', 'Zielzone ' + tz);
          gauge(st, pr, tz);
          setT(root, 'ghr', st.hr > 0 ? String(st.hr) : '--');
          var gst = $('[data-k="gst"]', root), inz = st.hr >= pr.lo && st.hr <= pr.hi;
          gst.textContent = !(st.hr > 0) ? 'kein Signal' : inz ? 'bpm · im Ziel' : st.hr > pr.hi ? 'bpm · über dem Ziel' : 'bpm · unter dem Ziel';
          gst.style.color = !(st.hr > 0) ? 'var(--mut)' : inz ? '#5c9dff' : st.hr > pr.hi ? 'var(--hr)' : 'var(--mut)';
          var zl = $('[data-k="zl"]', root);
          // Grenzen zweizeilig («143» ueber «bis 156»), damit in den schmalen Spalten nichts zusammenlaeuft
          if (!zl.innerHTML) zl.innerHTML = zs.map(function (x) { var t2 = TX.zoneTxt2(x); return '<div><b style="color:' + TX.ZT[x.z] + '">Z' + x.z + '</b><span>' + t2[0] + '</span><span>' + t2[1] + '</span></div>'; }).join('');
          var ok = st.hrOk && st.hr > 0, sig = ok ? 'Brustgurt oder Handsensoren · plausibel' : st.hr > 0 ? 'Signal unsicher' : (s === 'BEREIT' ? 'Kein Pulssignal · START läuft ohne Automatik' : 'Kein Pulssignal');
          var sh = '<span class="bars4">' + [6, 10, 14, 16].map(function (h, i) { return '<i style="height:' + h + 'px"' + (ok || (st.hr > 0 && i < 2) ? '' : ' class="x"') + '></i>'; }).join('') + '</span> ' + sig;
          var sg = $('[data-k="sig"]', root); if (sg.innerHTML !== sh) sg.innerHTML = sh;
          // autoOn = Einstellung, auto = regelt gerade (nach Handeingabe 2 min Pause)
          var au = pr.autoOn != null ? !!pr.autoOn : pr.auto !== false, act2 = au && pr.auto !== false;
          var aic = $('[data-k="aic"]', root), ak = au + '|' + act2;
          if (aic.getAttribute('data-a') !== ak) {
            aic.setAttribute('data-a', ak);
            aic.innerHTML = act2 ? '<span style="color:var(--go);display:flex">' + I('check') + '</span>' : '<span style="color:var(--inc);display:flex">' + I('warn') + '</span>';
          }
          setT(root, 'at', !au ? 'Automatik aus' : act2 ? 'Automatik aktiv' : 'Automatik wartet');
          setT(root, 'as', !au ? 'Tempo nur von Hand, Pulsband nur Anzeige' : act2 ? 'langsamer sofort, schneller nur bei stabilem Signal' : 'nach Handeingabe 2 min Pause, dann regelt sie wieder');
          var ab = $('[data-v="auto"]', root), abt = au ? 'Automatik aus' : 'Automatik an'; if (ab.textContent !== abt) ab.textContent = abt;
          ab.disabled = TX.api.offline;
          var lk = TX.api.histVer + '|' + TX.api.liveVer + '|' + s + '|' + pr.sMin + '|' + pr.sMax + '|' + st.tIncl + (TX.busy(st) ? (s === 'LAEUFT' ? '|' + st.speed + '|' + st.hr : '') : '|' + st.tSpeed + '|' + (hrOk(st) ? st.hr : 0));
          if (lk !== lastHv) {
            lastHv = lk;
            var sMin = pr.sMin || 5, sMax = pr.sMax || 11;
            var lim = $('[data-k="lim"]', root), lh = '<span class="chip">Tempo ' + TX.f1(sMin) + ' bis ' + TX.f1(sMax) + ' km/h</span><span class="chip">Steigung ' + TX.f1(st.tIncl) + ' %</span>' +
              '<span class="chip">Erste 5 min: nicht schneller</span><span class="chip" style="color:#ff9a52">' + I('shield') + ' Ohne Pulssignal: Tempo halten, nach 20 s schrittweise aufs Mindesttempo</span>';
            if (lim.innerHTML !== lh) lim.innerHTML = lh;
            var zc = $('[data-k="zc"]', root), hmn = Math.min(95, pr.lo - 30), hmx = Math.max(165, pr.hi + 25);
            if (TX.busy(st) && hist.length >= 2) {
              var hv = hist.filter(function (p) { return p[0] >= 0; }), hp = hv.filter(function (p) { return p[3] > 0; }).map(function (p) { return [p[0], p[3]]; }), sp = hv.map(function (p) { return [p[0], p[1]]; });
              var lastH = st.hr > 0 && st.hrOk !== false ? st.hr : 0, zxMax = Math.max(st.elapsed, hv[hv.length - 1][0], 5);
              axisLabels($('[data-k="zxa"]', root), { xMin: 0, xMax: zxMax }, st, 0, false);
              TX.chart(zc, [
                { pts: thinPts(hp, 600), min: hmn, max: hmx, c: '#ff4d5e', fill: 0, wd: 3, band: [0, 0.70], lab: hp.length ? (lastH ? String(lastH) : TX.NA) : null, unit: 'bpm', none: NOHR, end: true },
                { pts: thinPts(sp, 600), min: Math.max(0, sMin - 1), max: sMax + 1, c: '#3d8bff', fill: 0.25, wd: 2.4, band: [0.78, 1], lab: TX.f1(st.st === 'LAEUFT' ? st.speed : sp[sp.length - 1][1]), pre: 'Ist', unit: 'km/h', end: true }],
                { xMin: 0, xMax: zxMax, seps: [0.74], gutter: GUT, padB: 3, zones: [{ lo: pr.lo, hi: pr.hi, min: hmn, max: hmx, band: [0, 0.70] }] });
            } else {
              // vor dem Lauf: Zielband und Bahnen schon zeigen, rechts Puls und Starttempo
              var hv0 = hrOk(st) ? st.hr : 0;
              axisLabels($('[data-k="zxa"]', root), { xMin: 0, xMax: 1 }, st, 0, true);
              TX.chart(zc, [
                { pts: [], c: '#ff4d5e', band: [0, 0.70], lab: hv0 ? String(hv0) : null, unit: 'bpm', none: hv0 ? '' : NOHR, noneDy: 46, end: true },
                { pts: [], c: '#3d8bff', band: [0.78, 1], lab: TX.f1(st.tSpeed), pre: 'Soll', unit: 'km/h', none: s === 'BEREIT' ? 'Der Verlauf beginnt mit START' : 'Verlauf startet', end: true }],
                { xMin: 0, xMax: 1, seps: [0.74], gutter: GUT, padB: 3, zones: [{ lo: pr.lo, hi: pr.hi, min: hmn, max: hmx, band: [0, 0.70] }] });
            }
            var zt = TX.zoneTimes(hist, TX.profile().hf), zsum = zt.reduce(function (x, y2) { return x + y2; }, 0);
            var dEl = $('[data-k="dist"]', root), dH = zsum ? zt.map(function (t, i) { return i && t ? '<i style="flex:' + t + ';background:' + TX.ZC[i] + '" title="Z' + i + '"></i>' : ''; }).join('') : '';
            if (dEl._h !== dH) { dEl._h = dH; dEl.innerHTML = dH; }
          }
        }
        cb.update(st);
      },
      destroy: function () { cb.destroy(); clearTimeout(reloadT); }
    };
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v],[data-z]'); if (!b || b.disabled) return;
      if (b.hasAttribute('data-z')) {
        cfg.z = +b.getAttribute('data-z'); var d = TX.ZDEF[cfg.z]; if (!touched) { cfg.sMin = d.sMin; cfg.sMax = d.sMax; } chosen = true;
        ['sMin', 'sMax'].forEach(function (kk) { setT(main, 'v-' + kk, fmtCfg(kk)); });
        clearTimeout(reloadT); markZ(); loadZone(false); return;
      }
      var v = b.getAttribute('data-v'), st = TX.api.state, pr = st && st.prog;
      if (v === 'auto' && pr) { var au = pr.autoOn != null ? !!pr.autoOn : pr.auto !== false; TX.cmd('auto', { on: !au }); }
      if (v === 'change' && pr && st.st === 'BEREIT') { syncFromProg(pr); setup = true; mode = ''; view.update(st); }
      if (v === 'discard') discard().then(function (r) { if (r.ok) { setup = false; chosen = false; mode = ''; TX.api.poke(); } });
    });
    return view;
  };
})();
