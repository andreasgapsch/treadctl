/* Rahmen: Router, globale Dialoge (Pause, Fehler, Verbindung), Laufende, Toene, Bildschirmschoner, Einbrennschutz. */
(function () {
  'use strict';
  var TX = window.TX, I = TX.I, esc = TX.esc, $ = TX.$, api = TX.api;
  var app = document.getElementById('app'), alerts = document.getElementById('alerts');
  var cur = null, curName = '';
  var TRAIN = { run: 1, interval: 1, zones: 1, strecke: 1 };

  /* ---------- Router ---------- */
  function parse() {
    var h = location.hash.replace(/^#\/?/, ''), qi = h.indexOf('?'), path = qi >= 0 ? h.slice(0, qi) : h, qs = qi >= 0 ? h.slice(qi + 1) : '', q = {};
    qs.split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); try { q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); } catch (e) { /* ungueltig */ } });
    return { parts: path.split('/').filter(Boolean).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } }), q: q };
  }
  function route() {
    var r = parse(), p = r.parts, name = p[0] || 'home', prm = p.slice(1);
    if (name === 'training') { TX.go(TX.trainHash(api.state), true); return; }
    if (name === 'plans' && p[1] === 'edit') { name = 'edit'; prm = p.slice(2); }
    if (!TX.views[name]) name = 'home';
    if (cur && cur.destroy) cur.destroy();
    cur = null; curName = name; app.innerHTML = '';
    var v = TX.views[name](prm, r.q);
    cur = v; v.born = Date.now(); TX.pageAt = v.born;
    app.appendChild(v.el); TX.fixGap(v.el);
    if (TX.media) TX.media.render();
    if (v.mounted) v.mounted();
    api.needHist = !!v.needHist;
    if (v.needHist) api.poke(true);
    v.update(api.state || TX.OFF);
    window.scrollTo(0, 0);
    TX.sbarUpd();
  }
  TX.go = function (h, replace) {
    if (replace) { history.replaceState(null, '', h); route(); }
    else if (location.hash === h) route();
    else location.hash = h;
  };
  TX.route = route;
  window.addEventListener('hashchange', route);

  /* ---------- globale Knoepfe (data-g) ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-g]'); if (!b || b.disabled) return;
    var g = b.getAttribute('data-g');
    if (g === 'home') TX.go('#/');
    else if (g === 'totrain') TX.go(TX.trainHash(api.state));
    else if (g === 'apprelease') TX.cmd('appRelease').then(function (r) { if (r && r.ok) TX.toast('Steuerung zurück an der Konsole'); });
    else if (g === 'stop') TX.cmd('stop');
    else if (g === 'launch') TX.launch(b.getAttribute('data-pkg'));
    else if (g === 'profile') profileDlg();
    else if (g === 'hrmenu') TX.hrMenu(b);
    else if (g === 'back') TX.back();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Tab') document.documentElement.classList.add('kbd'); });
  /* Geisterklick-Schutz: Ein Klick zaehlt nur, wenn der Finger nach dem Aufbau der Seite aufgesetzt hat. Sonst stammt er
     vom Tipp auf der vorigen Seite (z. B. «Starten»), und das Element darunter (Schnellwahl 13.0) wuerde ungewollt ausgeloest.
     Tastatur und Programm (detail 0) bleiben erlaubt. */
  var downAt = 0;
  document.addEventListener('pointerdown', function () { downAt = Date.now(); }, true);
  document.addEventListener('touchstart', function () { downAt = Date.now(); }, true);
  document.addEventListener('click', function (e) {
    if (e.detail > 0 && TX.pageAt && downAt < TX.pageAt) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('pointerdown', function () { document.documentElement.classList.remove('kbd'); TX.audioUnlock(); }, true);

  /* ---------- Pause-Dialog ----------
     Oben die Kennzahlen («PAUSE · GESAMT» mit Gesamtzeit wie in der Pille), unten dieselbe Pausenreihe
     wie in der Steuerleiste und an derselben Stelle: Mitte «BAND STEHT» (kein Knopf) genau dort, wo STOP sass. */
  var pdl = null, prevPz = null, pzT = 0;
  function pauseDlg(st) {
    var show = st && st.st === 'PAUSE' && !api.offline;
    if (!show) { if (pdl) { pdl.parentNode.removeChild(pdl); pdl = null; } return; }
    if (!pdl) {
      pdl = document.createElement('div'); pdl.className = 'modal blur pmodal'; pdl.setAttribute('role', 'dialog'); pdl.setAttribute('aria-modal', 'true'); pdl.setAttribute('aria-labelledby', 'pdlh');
      pdl.innerHTML = '<div class="dlg pdl"><div class="ico">' + I('stop', 1) + '</div><div class="lab pdone" data-k="pl"></div>' +
        '<h2 id="pdlh"><span class="plab">PAUSE · GESAMT</span><span class="ptm num" data-k="ptm"></span></h2>' +
        '<div class="mut pinfo" data-k="pi"></div><div class="pwalk" data-k="pw" hidden><b data-k="pwt"></b><span data-k="pwn"></span></div><div class="note" data-k="pn"></div></div>' + TX.pauseRowHtml('x');
      pdl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-x]'); if (!b || b.disabled) return;
        TX.pauseAction(b.getAttribute('data-x'));
      });
      document.body.appendChild(pdl);
      TX.fixGap(pdl);
    }
    var done = st.prog && (st.prog.done || st.prog.left <= 0), fin = done && st.prog.type === 'route' && st.prog.finish;
    var set = function (k, v) { var e = pdl.querySelector('[data-k="' + k + '"]'); if (e.textContent !== v) e.textContent = v; };
    set('pl', fin ? 'Ziel erreicht · ' + TX.time(st.prog.t) + ' (Vorgabe ' + TX.time(st.prog.target) + ')' : done ? 'Programm beendet' : '');
    pdl.querySelector('[data-k="pl"]').classList.toggle('fin', !!fin); pdl.querySelector('[data-k="pl"]').hidden = !done;
    set('ptm', TX.time(st.elapsed));
    set('pi', TX.f2(st.dist) + ' km · ' + Math.round(st.elev || 0) + ' Hm · ' + Math.round(st.kcal || 0) + ' kcal');
    // nach Fehler oder gezogenem Schluessel: Weiter faehrt nur auf Gehtempo (state.tSpeed, vom Dienst gesetzt)
    var ab = TX.afterBreak(st); pdl.querySelector('[data-k="pw"]').hidden = !ab;
    if (ab) { set('pwt', TX.walkText(st)); set('pwn', st.note); }
    // Stufentest HFmax: Hinweis auf die Auswertung statt nur auf Weiter
    var ta = st.prog && st.prog.type === 'interval' ? TX.active(st.prog.name) : null, tst = !!(ta && ta.planId && TX.isTest(TX.plan(ta.planId)));
    var mxh = 0; if (tst) { TX.api.series().forEach(function (p) { if (p[3] > mxh) mxh = p[3]; }); if (st.hrOk !== false && st.hr > mxh) mxh = st.hr; }
    set('pn', tst ? (mxh ? 'Stufentest: höchster Puls ' + Math.round(mxh) + ' bpm. ' : 'Stufentest: kein Pulssignal, ohne Pulsmesser nicht auswertbar. ') + '«Auslaufen» oben rechts springt ins Auslaufen, BEENDEN zeigt die Auswertung mit Übernahme als HFmax. Weiter fährt mit ' + TX.f1(st.tSpeed) + ' km/h in derselben Stufe fort.'
      : 'Weiter zählt 3 · 2 · 1 und fährt dann sanft auf ' + TX.f1(st.tSpeed) + ' km/h. Nach 5 min ohne Eingabe wird der Lauf gespeichert.');
    TX.pauseRowUpd(pdl.querySelector('.pzrow'), st, false);
  }
  // Wechsel in PAUSE: alle Pausenknoepfe 1 s sperren (Finger liegt evtl. noch auf STOP)
  function trackPause(st) {
    var s = st && !api.offline ? st.st : null;
    TX.pz.dlg = s === 'PAUSE';
    if (s === 'PAUSE' && prevPz && prevPz !== 'PAUSE') {
      TX.pz.lockUntil = Date.now() + 1000;
      clearTimeout(pzT); pzT = setTimeout(refreshPause, 1020);
    }
    if (s !== 'PAUSE') TX.pz.lockUntil = 0;
    if (s) prevPz = s;
  }
  function refreshPause() { var st = api.state; if (!st) return; if (cur) cur.update(st); pauseDlg(st); }
  TX.pauseAction = function (x) {
    var st = api.state;
    if (TX.pzLocked() || !st || st.st !== 'PAUSE' || api.offline) return;
    if (x === 'end') endRun();
    else if (x === 'resume') TX.resumeCountdown();
    else if (x === 'inclZero' && st.tIncl > 0) {
      // kurz zeigen, was passiert: «4.0 → 0.0»
      var from = st.tIncl;
      TX.cmd('inclZero').then(function (r) { if (!r.ok) return; TX.pz.iz = { from: from, until: Date.now() + 2500 }; refreshPause(); setTimeout(refreshPause, 2600); });
    }
  };

  /* ---------- START und WEITER nur mit Countdown 3 · 2 · 1 ----------
     Vollflaechig, je 1 s mit kurzem Ton. Zu Beginn geht arm an den Dienst, nach Ablauf start bzw. resume
     (der Dienst nimmt beides nur 2.5 bis 15 s nach arm an). Abbrechen an der STOP-Stelle, Zuruecktaste,
     ein anderer Zustand als BEREIT bzw. PAUSE oder ein abgewiesenes arm brechen ab; das Band bleibt stehen. */
  var cdl = null, cdT = 0, cdWhat = '', cdArm = 0, cdSeq = 0;
  var CD_NEED = { start: 'BEREIT', resume: 'PAUSE' };
  // START nur, solange das Band startbereit ist (Schluessel steckt, sicher)
  function cdOk(st) {
    if (cdWhat === 'hw') return !!(st && !api.offline && st.cd > 0);
    if (!st || api.offline || st.st !== CD_NEED[cdWhat]) return false;
    return cdWhat !== 'start' || (st.pulled === 0 && st.safe === 1);
  }
  function cdStop() {
    clearTimeout(cdT); cdT = 0; cdSeq++; cdArm = 0;
    if (cdl) { cdl.parentNode.removeChild(cdl); cdl = null; }
  }
  // Abbruch durch die Person: wie in der Pille ein stop hinterher, das loescht arm im Dienst (Band steht ohnehin).
  // Nicht bei einem Zustandswechsel von aussen: dort koennte stop ein gerade gestartetes Band anhalten.
  function cdCancel() { if (!cdl) return; cdStop(); TX.cmd('stop', null, true); }
  /* Geraetetaste START: Der Dienst zaehlt selbst (state.cd) und startet danach. Die Oberflaeche zeigt denselben
     Vollbild-Countdown, sendet aber weder arm noch start; ABBRECHEN sendet stop. */
  function hwCountdown(st) {
    var on = !!(st && !api.offline && st.cd > 0);
    if (!on) { if (cdl && cdWhat === 'hw') cdStop(); return; }
    if (cdl && cdWhat !== 'hw') return;
    if (!cdl) {
      cdWhat = 'hw'; cdSeq++;
      var res = st.st === 'PAUSE';
      cdl = document.createElement('div'); cdl.className = 'cdown cd-hw'; cdl.setAttribute('role', 'alertdialog'); cdl.setAttribute('aria-modal', 'true'); cdl.setAttribute('aria-labelledby', 'cdh');
      cdl.innerHTML = '<div class="lab" id="cdh">Band fährt an in</div><div class="cn num" data-k="cn" aria-live="assertive"></div>' +
        '<div class="seq num" data-k="seq" aria-hidden="true"><span>3</span> · <span>2</span> · <span>1</span></div>' +
        '<div class="cdt"><div class="lab">Gestartet mit der Taste am Gerät</div><div class="num">' + TX.f1(st.tSpeed) + '<small> km/h</small> · ' + TX.f1(st.tIncl) + '<small> %</small></div>' +
        '<div class="cdh">' + esc(TX.holdText(res ? 'resume' : 'start', st)) + '</div></div>' +
        '<button class="btn red cdx" data-c="cancel">' + I('stop', 1) + '<span class="bl"><span class="r1">ABBRECHEN</span><small>Band bleibt stehen</small></span></button>';
      cdl.addEventListener('click', function (e) { if (e.target.closest('[data-c]')) cdCancel(); });
      document.body.appendChild(cdl); TX.fixGap(cdl);
    }
    var n = Math.max(1, Math.min(3, st.cd)), e = cdl.querySelector('[data-k="cn"]');
    if (e.textContent !== String(n)) {
      e.textContent = String(n); TX.beep(n === 1 ? 1320 : 880);
      TX.$$('[data-k="seq"] span', cdl).forEach(function (sp, i) { sp.className = 3 - i > n ? 'cd-past' : 3 - i === n ? 'cd-now' : ''; });
    }
  }
  // Ende des Countdowns: fruehestens 3 s nach Beginn und 2.6 s nach der Bestaetigung von arm
  function cdFire(seq) {
    if (!cdl || seq !== cdSeq) return;
    if (!cdOk(api.state)) { cdStop(); return; }
    if (!cdArm) { cdT = setTimeout(function () { cdFire(seq); }, 100); return; }
    var wait = cdArm + 2600 - Date.now();
    if (wait > 0) { cdT = setTimeout(function () { cdFire(seq); }, wait); return; }
    var what = cdWhat; cdStop(); TX.cmd(what);
  }
  function cdStep(n, seq) {
    if (!cdl || seq !== cdSeq) return;
    if (!cdOk(api.state)) { cdStop(); return; }
    if (n === 0) { cdFire(seq); return; }
    var e = cdl.querySelector('[data-k="cn"]'); e.textContent = String(n);
    TX.$$('[data-k="seq"] span', cdl).forEach(function (sp, i) { sp.className = 3 - i > n ? 'cd-past' : 3 - i === n ? 'cd-now' : ''; });
    TX.beep(n === 1 ? 1320 : 880);
    cdT = setTimeout(function () { cdStep(n - 1, seq); }, 1000);
  }
  function countdown(what, note) {
    var st = api.state;
    if (cdl) return;
    cdWhat = what;
    if (!cdOk(st)) return;
    TX.audioUnlock();
    var seq = ++cdSeq, tl = what === 'start' ? 'Ziel · Start-Tempo und Steigung' : TX.afterBreak(st) ? 'Ziel · Gehtempo nach Unterbrechung' : 'Ziel';
    cdl = document.createElement('div'); cdl.className = 'cdown cd-' + what; cdl.setAttribute('role', 'alertdialog'); cdl.setAttribute('aria-modal', 'true'); cdl.setAttribute('aria-labelledby', 'cdh');
    cdl.innerHTML = '<div class="lab" id="cdh">Band fährt an in</div><div class="cn num" data-k="cn" aria-live="assertive">3</div>' +
      '<div class="seq num" data-k="seq" aria-hidden="true"><span>3</span> · <span>2</span> · <span>1</span></div>' +
      '<div class="cdt"><div class="lab">' + tl + '</div><div class="num">' + TX.f1(st.tSpeed) + '<small> km/h</small> · ' + TX.f1(st.tIncl) + '<small> %</small></div>' +
      '<div class="cdh">' + esc(TX.holdText(what, st)) + '</div>' +
      (note ? '<div class="cdn">' + esc(note) + '</div>' : '') + '</div>' +
      // ein einziger Knopf an der Stelle von STOP (Mitte der Steuerleiste): Abbrechen laesst das Band stehen
      '<button class="btn red cdx" data-c="cancel">' + I('stop', 1) + '<span class="bl"><span class="r1">ABBRECHEN</span><small>Band bleibt stehen</small></span></button>';
    cdl.addEventListener('click', function (e) { if (e.target.closest('[data-c]')) cdCancel(); });
    document.body.appendChild(cdl); TX.fixGap(cdl);
    // arm zu Beginn; ohne Bestaetigung kein start bzw. resume
    TX.cmd('arm').then(function (r) {
      if (seq !== cdSeq || !cdl) return;
      if (r && r.ok) cdArm = Date.now(); else cdStop();
    });
    cdStep(3, seq);
  }
  // Einlaufen: jeder Anlauf 15 s mit 1.0 km/h, dann Stufen zum Soll
  TX.HOLD = { v: 1.0, sec: 15 };
  TX.holdText = function (what, st) {
    var x = st.tSpeed, w = what === 'resume' ? 'Weiter' : 'Start';
    return x > TX.HOLD.v + 0.05 ? w + ' mit ' + TX.f1(TX.HOLD.v) + ' km/h, nach ' + TX.HOLD.sec + ' s ' + TX.f1(x) + ' km/h' : w + ' mit ' + TX.f1(Math.max(0.8, x)) + ' km/h';
  };
  TX.startCountdown = function (note) { countdown('start', note); };
  TX.resumeCountdown = function () { countdown('resume'); };
  TX.cdStop = cdStop;
  document.addEventListener('keydown', function (e) { if (cdl && (e.key === 'Escape' || e.key === 'MediaStop')) cdCancel(); });

  /* ---------- Laufende ---------- */
  var prevSt = null, lastBusy = null, lastBusyHist = [];
  // Kurzer Lauf: unter 2 min oder unter 0.2 km wird nachgefragt, Vorgabe Verwerfen
  TX.SHORT = { sec: 120, km: 0.2 };
  TX.isShort = function (rec) { return rec.elapsed < TX.SHORT.sec || rec.dist < TX.SHORT.km; };
  function finishRun(rec, nav) {
    // diese Zusammenfassung ist erledigt (gespeichert oder bewusst verworfen): beim naechsten Start nicht nachtragen
    if (/^s\d+$/.test(rec.id)) try { localStorage.setItem('tx.sumSeen', String(rec.ts)); } catch (e) {}
    if (rec.elapsed < 10 && rec.dist < 0.01) { TX.toast('Lauf kürzer als 10 s, nicht gespeichert'); if (nav) TX.go('#/'); return; }
    if (TX.run(rec.id)) { if (nav) TX.go('#/summary/' + encodeURIComponent(rec.id)); return; }
    var keep = function () { TX.saveRun(rec); if (nav) TX.go('#/summary/' + encodeURIComponent(rec.id)); else TX.toast('Lauf gespeichert'); };
    if (!TX.isShort(rec)) { keep(); return; }
    shortDlg(rec, function (k) { if (k) keep(); else { TX.toast('Kurzer Lauf verworfen'); if (nav) TX.go('#/'); } });
  }
  TX.finishRun = finishRun;
  var sdl = null, sdlId = '', sdlCb = null, sdlT = 0;
  function shortDone(k) {
    if (!sdl) return;
    var cb = sdlCb; clearTimeout(sdlT);
    sdl.parentNode.removeChild(sdl); sdl = null; sdlId = ''; sdlCb = null;
    if (cb) cb(k);
  }
  function shortDlg(rec, cb) {
    if (sdl && sdlId === rec.id) return;
    shortDone(false);
    sdl = document.createElement('div'); sdl.className = 'modal blur'; sdl.setAttribute('role', 'alertdialog'); sdl.setAttribute('aria-modal', 'true');
    sdl.setAttribute('aria-labelledby', 'sdh'); sdl.setAttribute('aria-describedby', 'sdd'); sdlId = rec.id; sdlCb = cb;
    sdl.innerHTML = '<div class="dlg sdlg"><div class="ico" style="color:var(--inc)">' + I('warn') + '</div><h2 id="sdh">Kurzer Lauf</h2>' +
      '<div class="mut" id="sdd" style="margin-top:6px">' + TX.time(rec.elapsed) + ' · ' + TX.f2(rec.dist) + ' km. Läufe unter 2 min oder unter 0.2 km werden nur auf Wunsch gespeichert.</div>' +
      '<div class="acts"><button class="btn lite" data-s="drop">' + I('x') + ' Verwerfen</button><button class="btn ghost" data-s="keep">' + I('check') + ' Trotzdem speichern</button></div>' +
      '<div class="note">Ohne Auswahl wird der Lauf nach 60 s verworfen.</div></div>';
    sdl.addEventListener('click', function (e) { var b = e.target.closest('[data-s]'); if (b) shortDone(b.getAttribute('data-s') === 'keep'); });
    document.body.appendChild(sdl); TX.fixGap(sdl);
    try { sdl.querySelector('[data-s="drop"]').focus(); } catch (x) { /* egal */ }
    sdlT = setTimeout(function () { shortDone(false); }, 60000);
  }
  function endRun() {
    if (TX.pz.ending) return;
    TX.pz.ending = true; refreshPause();
    var before = api.state;
    var hist0 = [];
    api.freshHist().then(function (h) { hist0 = h || []; return TX.cmd('end'); }).then(function (r) {
      if (!r.ok) { TX.pz.ending = false; refreshPause(); return; }
      // Zusammenfassung aus der Antwort, sonst GET /api/summary
      return (r.summary ? Promise.resolve(r.summary) : TX.fetchSummary()).then(function (sum) {
        var rec = TX.makeRun(before, hist0, sum);
        lastBusy = null; finishRun(rec, true);
        setTimeout(function () { TX.pz.ending = false; }, 1500);
      });
    });
  }
  TX.endRun = endRun;
  /** Letzte Zusammenfassung des Dienstes (z. B. nach BEENDEN in der Pille). */
  TX.fetchSummary = function () {
    return api.summary().then(function (s) { return s && s.ts && Date.now() - s.ts < 6 * 3600e3 ? s : null; }, function () { return null; });
  };
  function watchEnd(st) {
    if (!st) return;
    var s = st.st, busy = s === 'LAEUFT' || s === 'PAUSE' || s === 'FEHLER';
    if (busy && st.elapsed > 0) { lastBusy = st; lastBusyHist = api.hist; }
    if (prevSt && prevSt !== 'BEREIT' && s === 'BEREIT' && lastBusy && !TX.pz.ending) {
      // anderswo beendet (Pille, Zeitablauf, Quittung): Zusammenfassung vom Dienst holen
      var lb = lastBusy, lh = lastBusyHist, nav = TRAIN[curName] && prevSt !== 'FEHLER';
      lastBusy = null;
      TX.fetchSummary().then(function (sum) { finishRun(TX.makeRun(lb, lh, sum), nav); });
    }
    if (s === 'BEREIT' && !TX.pz.ending) lastBusy = null;
    prevSt = s;
  }

  /* ---------- Einlaufen: Hinweis in Lauf- und Programmansichten ----------
     «Einlaufen · 1.0 km/h · noch N s, dann X km/h», in den letzten 10 s orange wie ein Wechselbanner «Tempo steigt in N s auf X km/h». */
  var hb = document.createElement('div'); hb.id = 'holdbar'; hb.setAttribute('role', 'status'); hb.hidden = true; document.body.appendChild(hb);
  function holdBar(st) {
    var on = !!(st && !api.offline && st.st === 'LAEUFT' && st.hold > 0 && st.holdTo > TX.HOLD.v + 0.05 && TRAIN[curName]);
    hb.hidden = !on; if (!on) return;
    var soon = st.hold <= 10, h = soon ? TX.banHtml(st.hold, 'Tempo steigt auf ' + TX.f1(st.holdTo) + ' km/h', 'Einlaufen mit ' + TX.f1(st.tSpeed) + ' km/h endet') :
      TX.banHtml(null, 'Einlaufen · ' + TX.f1(st.tSpeed) + ' km/h · noch ' + st.hold + ' s, dann ' + TX.f1(st.holdTo) + ' km/h');
    if (hb.getAttribute('data-h') !== h) { hb.setAttribute('data-h', h); hb.innerHTML = h; hb.className = 'xban on ' + (soon ? 'd-up' : 'd-hold'); }
  }

  /* ---------- Banner: Fehler und Verbindung ---------- */
  var errKey = '';
  function banners(st) {
    var k = api.offline ? 'off' : st && st.st === 'FEHLER' ? 'err|' + st.err : '';
    if (k === errKey) return;
    errKey = k;
    if (k === 'off') alerts.innerHTML = '<div class="alert off" role="alert"><span class="ico">' + I('warn') + '</span><div class="tx">Keine Verbindung zum Laufband-Dienst<small>Steuerung gesperrt. Neuer Versuch läuft automatisch.</small></div></div>';
    else if (k) alerts.innerHTML = '<div class="alert err" role="alert"><span class="ico">' + I('warn') + '</span><div class="tx">Störung: ' + esc(st.err || 'unbekannt') +
      '<small>' + TX.errHint(st) + '</small></div><button class="btn lite" data-x="ack">' + I('check') + ' Quittieren</button></div>';
    else alerts.innerHTML = '';
    TX.fixGap(alerts);
  }
  alerts.addEventListener('click', function (e) { if (e.target.closest('[data-x="ack"]')) TX.cmd('ack'); });

  /* ---------- Toene 3, 2, 1 vor dem Abschnittswechsel ---------- */
  var beepKey = '';
  function beeps(st) {
    var p = st && st.prog;
    // Einlaufen: Toene 3, 2, 1 vor dem Tempoanstieg (auch ohne Programm)
    if (st && st.st === 'LAEUFT' && st.hold > 0 && st.holdTo > TX.HOLD.v + 0.05) {
      if (st.hold <= 3) { var hk = 'h:' + st.hold; if (hk !== beepKey) { beepKey = hk; TX.beep(st.hold === 1 ? 1320 : 880); } }
      return;
    }
    // Strecke: wie die Pille Toene bei 3, 2, 1 s vor einem Wechsel ab 1 % Steigung oder 1 km/h Tempo
    if (p && p.type === 'route') {
      var ch = st.st === 'LAEUFT' && !p.finish && TX.rte ? TX.rte.change(p, st) : null, sc = ch ? Math.ceil(ch.sec) : 0;
      if (!ch || !ch.big || sc > 3 || sc < 1) return;
      var rk = 'r' + p.idx + ':' + sc;
      if (rk !== beepKey) { beepKey = rk; TX.beep(sc === 1 ? 1320 : 880); }
      return;
    }
    if (!p || st.st !== 'LAEUFT' || !p.next || typeof p.segLeft !== 'number' || p.segLeft > 3 || p.segLeft < 1) return;
    var k = p.idx + ':' + p.segLeft;
    if (k !== beepKey) { beepKey = k; TX.beep(p.segLeft === 1 ? 1320 : 880); }
  }

  /* ---------- Bildschirmschoner (BEREIT, einstellbar, Werk 5 min ohne Beruehrung) ---------- */
  var saver = document.getElementById('saver'), blk = saver.querySelector('.blk'), saverOn = false, lastTouch = Date.now(), swallow = 0, moveT = 0, clockT = 0;
  // Minuten aus dem Profil-Dialog (0 = aus); Demo-Pruefung mit ?saver=1 nach 2 s
  function saverMs() { if (/[?&]saver=1/.test(location.search) && api.demo) return 2000; var m = +TX.prefs().saverMin; return m > 0 ? m * 60000 : Infinity; }
  function clock() {
    var d = new Date();
    blk.querySelector('.tm').textContent = TX.pad(d.getHours()) + ':' + TX.pad(d.getMinutes());
    blk.querySelector('.dt').textContent = TX.WD[d.getDay()] + ', ' + d.getDate() + '. ' + TX.MON[d.getMonth()];
  }
  function move() {
    var w = blk.offsetWidth || 360, h = blk.offsetHeight || 160, W = window.innerWidth, H = window.innerHeight;
    var x = 30 + Math.random() * Math.max(0, W - w - 60), y = 70 + Math.random() * Math.max(0, H - h - 100);
    blk.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }
  function saverStart() {
    if (saverOn) return;
    saverOn = true; clock(); saver.classList.add('on');
    blk.style.transition = 'none'; move(); void blk.offsetWidth; blk.style.transition = '';
    moveT = setInterval(move, 20000); clockT = setInterval(clock, 5000);
  }
  function saverStop() { if (!saverOn) return; saverOn = false; saver.classList.remove('on'); clearInterval(moveT); clearInterval(clockT); lastTouch = Date.now(); }
  TX.saverStart = saverStart; TX.saverStop = saverStop;
  saver.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); lastTouch = Date.now(); swallow = Date.now() + 1500; });
  saver.addEventListener('pointerup', function (e) { e.preventDefault(); e.stopPropagation(); swallow = Date.now() + 700; setTimeout(saverStop, 350); });
  saver.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('click', function (e) { if (saverOn || Date.now() < swallow) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('pointerdown', function () { if (!saverOn) lastTouch = Date.now(); }, true);
  document.addEventListener('keydown', function () { lastTouch = Date.now(); if (saverOn) saverStop(); }, true);
  setInterval(function () {
    var st = api.state, ok = st && st.st === 'BEREIT' && !api.offline;
    if (!saverOn && ok && Date.now() - lastTouch >= saverMs()) saverStart();
    if (saverOn && !ok) saverStop();
  }, 1000);

  /* ---------- Eigene Statuszeile (oben 40 px) ----------
     Nur wenn der Dienst die Herstellerleiste ausblendet (hideBar an); sonst liegt dort die Herstellerleiste und die Zeile bleibt leer.
     Rechts «Di 27.10.», «10:05», WLAN (navigator.onLine und Erfolg der Abfragen), Zahnrad (Herstellereinstellungen).
     Links klein die Marke, wenn die Seite keinen Kopf mit Marke hat (Trainingsseiten, Abschluss). */
  var sbar = document.getElementById('topfree'), sbK = function (k) { return sbar.querySelector('[data-k="' + k + '"]'); };
  var sbDt = sbK('sbdt'), sbTm = sbK('sbtm'), sbW = sbK('sbw'), sbG = sbK('sbg'), sbB = sbK('sbb'), sbT = 0, sbNetK = '';
  sbG.innerHTML = I('gear');
  function sbClock() {
    var d = new Date(), dt = TX.WD2[d.getDay()] + ' ' + TX.dshort(d.getTime()), tm = TX.hm(d.getTime());
    if (sbDt.textContent !== dt) sbDt.textContent = dt;
    if (sbTm.textContent !== tm) sbTm.textContent = tm;
    clearTimeout(sbT); sbT = setTimeout(sbClock, 60000 - Date.now() % 60000 + 50);
  }
  function sbNet() {
    var on = navigator.onLine !== false && !api.offline, k = on ? 'on' : 'off';
    if (k === sbNetK) return;
    sbNetK = k; sbW.innerHTML = I(on ? 'wifi' : 'wifiOff'); sbW.className = 'sbw' + (on ? '' : ' off');
    sbW.setAttribute('aria-label', on ? 'WLAN verbunden' : 'Keine Verbindung');
  }
  TX.sbarUpd = function () {
    var own = !!TX.prefs().hideBar;
    sbar.classList.toggle('own', own);
    sbB.hidden = !!app.querySelector('.head');
    sbG.hidden = !TX.native.hasSettings();
  };
  sbG.addEventListener('click', function () {
    if (TX.busy(api.state)) { TX.toast('Einstellungen erst nach dem Lauf'); return; }
    var r = TX.native.openSettings();
    if (r === 'demo') TX.toast('Demo: würde die Einstellungen der Konsole öffnen');
    else if (!r) TX.toast('Einstellungen konnten nicht geöffnet werden');
  });
  window.addEventListener('online', sbNet); window.addEventListener('offline', sbNet);
  api.on(sbNet);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sbClock(); });
  sbClock(); sbNet();

  /* ---------- Einbrennschutz: alle 3 min 0 bis 3 px verschieben ---------- */
  setInterval(function () {
    var x = Math.floor(Math.random() * 4), y = Math.floor(Math.random() * 4);
    app.style.transform = x || y ? 'translate(' + x + 'px,' + y + 'px)' : '';
    // Statuszeile: Inhalt nur waagrecht verschieben, die Zeile bleibt genau 40 px
    sbar.querySelector('.sbr').style.transform = x ? 'translateX(' + -x + 'px)' : '';
  }, 3 * 60 * 1000);

  /* ---------- Profil (Name, HFmax, Gewicht) und Bildschirm (Bildschirmschoner, Standby der Konsole) ---------- */
  var SAVER_OPT = [1, 2, 3, 5, 10, 15, 20, 30, 0];   // Minuten, 0 = aus
  // Standby der Herstellersoftware: nur diese Stufen; Index wie dort (0 = 30 min, 1 = 15 min, 2 = 10 min, 3 = aus)
  var ERP_OPT = [[2, '10 min'], [1, '15 min'], [0, '30 min'], [3, 'Aus']];
  function saverTxt(m) { return m > 0 ? m + ' min' : 'Aus'; }
  function profileDlg() {
    var pr = TX.profile(), hf = pr.hf, kg = pr.kg, st0 = api.state;
    var sv = +TX.prefs().saverMin, svI = Math.max(0, SAVER_OPT.indexOf(sv)), erp0 = st0 && st0.erp >= 0 ? st0.erp : -1, erp = erp0, home0 = !st0 || st0.home !== false, home = home0;
    var m = document.createElement('div'); m.className = 'modal blur'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'prh');
    // zwei Spalten: links Profil (Name, HFmax, Gewicht, Zonen), rechts Bildschirm (Bildschirmschoner, Standby der Konsole)
    m.innerHTML = '<div class="dlg pdlg wide"><h2 id="prh">Profil und Bildschirm</h2><div class="pcols"><div class="pcol">' +
      '<div class="mut" style="margin-top:4px">Die Pulszonen werden aus der maximalen Herzfrequenz berechnet.</div>' +
      '<div class="frow"><label for="pname">Name</label><input id="pname" maxlength="30" value="' + esc(pr.name) + '" autocomplete="off"></div>' +
      '<div class="frow"><span class="lab" style="width:120px">HFmax</span><div class="stp big"><button data-h="-1" aria-label="HFmax verringern">' + I('minus') + '</button><div class="val"><div class="lab">bpm</div><b data-k="hf">' + hf + '</b></div>' +
      '<button data-h="1" aria-label="HFmax erhöhen">' + I('plus') + '</button></div></div>' +
      '<div class="frow"><span class="lab" style="width:120px">Gewicht</span><div class="stp big"><button data-w="-1" aria-label="Gewicht verringern">' + I('minus') + '</button><div class="val"><div class="lab">kg</div><b data-k="kg">' + kg + '</b></div>' +
      '<button data-w="1" aria-label="Gewicht erhöhen">' + I('plus') + '</button></div><div class="mut pkg">für die Kalorienberechnung' + (st0 && st0.weight ? '<br>im Dienst ' + Math.round(st0.weight) + ' kg' : '') + '</div></div>' +
      '<div class="zpre" data-k="zp"></div></div><div class="pcol pscr">' +
      '<div class="frow"><span class="lab">Bildschirmschoner</span><div class="stp big"><button data-sv="-1" aria-label="Bildschirmschoner früher">' + I('minus') + '</button><div class="val"><div class="lab">nach</div><b data-k="sv"></b></div>' +
      '<button data-sv="1" aria-label="Bildschirmschoner später">' + I('plus') + '</button></div><div class="mut pkg">Uhr auf Schwarz, nur im Stand und ohne Wiedergabe.</div></div>' +
      '<div class="frow"><span class="lab">Standby der Konsole</span><div class="seg" role="radiogroup" aria-label="Standby der Konsole">' +
      ERP_OPT.map(function (o) { return '<button role="radio" data-erp="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' +
      '<div class="mut pkg">' + (erp0 < 0 ? 'Stand der Konsole unbekannt. ' : '') + 'Die Konsole schläft nach so langer Ruhe ohne Berührung, Band und Wiedergabe; Aufwecken mit Berührung oder Taste.</div></div>' +
      '<div class="frow"><span class="lab">Beim Einschalten</span><div class="seg" role="radiogroup" aria-label="Beim Einschalten">' +
      '<button role="radio" data-home="1">Tread Control</button><button role="radio" data-home="0">Hersteller</button></div>' +
      '<div class="mut pkg">Auch die Home-Taste führt dorthin. <button class="lnk" data-x="vendor">Herstelleroberfläche öffnen</button></div></div>' +
      '</div></div>' +
      '<div class="acts"><a class="btn ghost" href="#/geraete" data-x="dev">' + I('heart') + ' Geräte koppeln</a><span style="flex:1"></span><button class="btn ghost" data-x="no">Abbrechen</button><button class="btn go" data-x="ok">' + I('check') + ' Speichern</button></div></div>';
    function zp() { m.querySelector('[data-k="zp"]').innerHTML = TX.zones(hf).map(function (z) { return '<div><b style="color:' + TX.ZT[z.z] + '">Z' + z.z + '</b>' + z.txt + '</div>'; }).join(''); m.querySelector('[data-k="hf"]').textContent = hf; m.querySelector('[data-k="kg"]').textContent = kg; }
    TX.$$('[data-h]', m).forEach(function (b) { TX.holdRepeat(b, function () { hf = TX.clamp(hf + +b.getAttribute('data-h'), 120, 230); zp(); }); });
    TX.$$('[data-w]', m).forEach(function (b) { TX.holdRepeat(b, function (n) { kg = TX.clamp(kg + +b.getAttribute('data-w') * (n > 8 ? 5 : 1), 35, 200); zp(); }); });
    function scr() {
      m.querySelector('[data-k="sv"]').textContent = saverTxt(SAVER_OPT[svI]);
      TX.$$('[data-erp]', m).forEach(function (b) { var on = +b.getAttribute('data-erp') === erp; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      TX.$$('[data-home]', m).forEach(function (b) { var on = (b.getAttribute('data-home') === '1') === home; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    }
    TX.$$('[data-sv]', m).forEach(function (b) { b.addEventListener('click', function () { svI = TX.clamp(svI + +b.getAttribute('data-sv'), 0, SAVER_OPT.length - 1); scr(); }); });
    TX.$$('[data-erp]', m).forEach(function (b) { b.addEventListener('click', function () { erp = +b.getAttribute('data-erp'); scr(); }); });
    TX.$$('[data-home]', m).forEach(function (b) { b.addEventListener('click', function () { home = b.getAttribute('data-home') === '1'; scr(); }); });
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-x]'); if (!b) return;
      if (b.getAttribute('data-x') === 'vendor') { if (!TX.native.vendorUi()) TX.toast('Herstelleroberfläche nicht gefunden'); return; }
      if (b.getAttribute('data-x') === 'ok') {
        TX.saveProfile({ name: (m.querySelector('#pname').value || '').trim() || pr.name, hf: hf, kg: kg });
        var svm = SAVER_OPT[svI]; TX.setPref('saverMin', svm); TX.native.setPref('saverMin', String(svm)); TX.native.setPref('saver', String(svm > 0));
        if (home !== home0) TX.api.cmd('home', { on: home }).then(function (r) { if (!r || !r.ok) TX.toast('Startbildschirm nicht gesetzt: ' + (r && r.error || 'Dienst nicht erreicht')); });
        if (erp >= 0 && erp !== erp0) TX.api.cmd('standby', { i: erp }).then(function (r) { if (!r || !r.ok) TX.toast('Standby nicht gesetzt: ' + (r && r.error || 'Dienst nicht erreicht')); });
        TX.sendProfile().then(function (r) { TX.toast(r && r.ok ? 'Profil gespeichert' : 'Profil gespeichert, Dienst nicht erreicht'); });
        route();
      }
      m.parentNode.removeChild(m);
    });
    document.body.appendChild(m); zp(); scr(); TX.fixGap(m);
  }

  /* ---------- Pulsmenue: Ausklappmenue unter dem Pulschip im Kopf ----------
     Status (Quelle, Geraet, Live-Puls), «Pulsmesser suchen» mit Liste und «Verbinden», «Trennen», Hinweis Forerunner, Link «Alle Geraete».
     Schliesst bei Tipp ausserhalb, nach dem Verbinden und nach 20 s ohne Eingabe. Reicht nie bis zur Steuerleiste. */
  var hm = null, hmT = 0, hmPoll = 0, hmIdle = 0, hmWas = '';
  function hmClose() { if (!hm) return; clearTimeout(hmPoll); clearTimeout(hmIdle); hm.parentNode.removeChild(hm); hm = null; }
  function hmIdleReset() { clearTimeout(hmIdle); hmIdle = setTimeout(hmClose, 20000); }
  function hmRender(h) {
    if (!hm) return;
    var st = api.state || {}, con = h && h.state === 'verbunden', src = st.hrSrc === 'bluetooth' ? 'Bluetooth' : st.hr > 0 ? 'Brustgurt über die Konsole' : 'kein Signal';
    var top = '<div class="hmst"><div><div class="lab">Puls · ' + esc(src) + '</div><b>' + esc(h && h.name ? h.name + (con ? '' : ' · ' + (h.state || '')) : 'Kein Pulsmesser verbunden') + '</b></div>' +
      '<div class="hmv"><span class="num">' + (st.hr > 0 ? st.hr : TX.NA) + '</span><small>bpm</small></div></div>';
    var found = (h && h.found || []).filter(function (x) { return !con || x.address !== h.address; });
    var list = h && h.scanning && !found.length ? '<div class="mut hmse">Suche läuft, bis 15 s</div>' : found.map(function (x) {
      return '<div class="hmrow"><span><b>' + esc(x.name || 'Unbekannt') + '</b><small>' + (x.rssi ? 'Signal ' + x.rssi + ' dBm' : esc(x.address)) + '</small></span><button class="btn go" data-hm="con" data-a="' + esc(x.address) + '" data-n="' + esc(x.name || '') + '">Verbinden</button></div>';
    }).join('');
    var html = top + '<div class="hmact"><button class="btn ghost" data-hm="scan"' + (h && h.scanning ? ' disabled' : '') + '>' + I('repeat') + (h && h.scanning ? ' Suche läuft' : ' Pulsmesser suchen') + '</button>' +
      (h && h.name ? '<button class="btn ghost" data-hm="forget" style="color:#ff7884">' + I('x') + ' Trennen</button>' : '') + '</div>' +
      '<div class="hmlist">' + list + '</div><div class="hmhint">' + I('info') + '<span>Forerunner: Auf der Uhr «Herzfrequenz übertragen» einschalten.</span></div>' +
      '<a class="hmall" href="#/geraete">Alle Geräte ' + I('back') + '</a>';
    if (hm.getAttribute('data-h') !== html) { hm.setAttribute('data-h', html); hm.innerHTML = html; TX.fixGap(hm); }
    // nach erfolgreichem Verbinden schliessen
    var now = h ? h.state : '';
    if (hmWas === 'verbinde' && now === 'verbunden') { hmClose(); TX.toast('Pulsmesser verbunden: ' + (h.name || '')); return; }
    hmWas = now;
  }
  function hmPollFn() { api.hr.status().then(function (h) { if (!hm) return; hmRender(h && !h.error ? h : null); hmPoll = setTimeout(hmPollFn, 1000); }); }
  TX.hrMenu = function (anchor) {
    if (hm) { hmClose(); return; }
    hm = document.createElement('div'); hm.className = 'hrmenu'; hm.setAttribute('role', 'dialog'); hm.setAttribute('aria-label', 'Pulsmesser');
    var r = anchor.getBoundingClientRect(), top = Math.round(r.bottom + 8);
    hm.style.top = top + 'px'; hm.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    hm.style.maxHeight = Math.max(240, window.innerHeight - top - 116) + 'px';   // Steuerleiste (unten 112 px) bleibt frei
    hm.addEventListener('click', function (e) {
      var b = e.target.closest('[data-hm]'); hmIdleReset();
      if (!b || b.disabled) { if (e.target.closest('.hmall')) hmClose(); return; }
      var k = b.getAttribute('data-hm');
      if (k === 'scan') api.hr.scan().then(function (x) { if (x && x.ok === false) TX.toast('Suche nicht möglich: ' + (x.error || '')); });
      else if (k === 'con') { hmWas = 'verbinde'; api.hr.connect(b.getAttribute('data-a'), b.getAttribute('data-n')).then(function (x) { if (x && x.ok === false) TX.toast('Nicht verbunden: ' + (x.error || '')); }); }
      else if (k === 'forget') api.hr.forget().then(function () { TX.toast('Pulsmesser getrennt'); });
    });
    hm.addEventListener('pointerdown', hmIdleReset);
    document.body.appendChild(hm); hmWas = ''; hmRender(null); hmPollFn(); hmIdleReset();
  };
  // Tipp ausserhalb schliesst (der Tipp selbst wirkt nicht weiter)
  document.addEventListener('pointerdown', function (e) {
    if (hm && !e.target.closest('.hrmenu') && !e.target.closest('[data-g="hrmenu"]')) { hmClose(); hmT = Date.now(); }
  }, true);
  document.addEventListener('click', function (e) { if (Date.now() - hmT < 400 && !e.target.closest('[data-g="hrmenu"]') && !e.target.closest(TX.STOPSEL)) { hmT = 0; e.preventDefault(); e.stopPropagation(); } }, true);
  window.addEventListener('hashchange', hmClose);

  /* ---------- Zustand verteilen ---------- */
  var OFF = { ok: false, st: 'OFF', err: '', speed: 0, incline: 0, tSpeed: 0, tIncl: 0, hr: 0, hrOk: false, pulled: -1, safe: 0, elapsed: 0, dist: 0, kcal: 0, elev: 0, src: '', prog: null };
  TX.OFF = OFF;
  api.on(function (st) {
    trackPause(st);
    if (cur) cur.update(st || OFF);
    if (cdl && cdWhat !== 'hw' && !cdOk(st)) cdStop();
    hwCountdown(st);
    banners(st); pauseDlg(st); watchEnd(st); beeps(st); holdBar(st);
  });

  // Zuruecktaste der Konsole (UiActivity ruft onNativeBack): Dialog schliessen, sonst eine Ebene hoch
  // Zurueck-Pfeil: eine Ebene im eigenen Verlauf zurueck, auf der Startseite die Oberflaeche verlassen
  var depth = 0;
  window.addEventListener('hashchange', function () { depth++; });
  /* Zurueck fuehrt hoechstens zur eigenen Startseite, nie aus der Oberflaeche hinaus (kein history.back, kein leave):
     logisch eine Ebene hoeher, sonst #/. Auf der Startseite tut Zurueck nichts. */
  TX.parentOf = function (h) {
    h = (h || '').split('?')[0];
    if (/^#\/plans\/edit\//.test(h)) return '#/plans';
    if (/^#\/strecke\//.test(h)) return TX.busy(api.state) ? '#/' : '#/strecken';
    if (/^#\/summary\//.test(h)) return '#/history';
    if (/^#\/geraete/.test(h)) return '#/apps';
    return '#/';
  };
  TX.back = function () {
    var h = location.hash;
    if (h === '#/' || h === '' || h === '#') return;
    TX.go(TX.parentOf(h));
  };
  window.onNativeBack = function () {
    if (saverOn) { saverStop(); return; }
    if (cdl) { cdCancel(); return; }
    // Kurzer Lauf: Zuruecktaste waehlt die Vorgabe Verwerfen
    if (sdl) { shortDone(false); return; }
    var prof = Array.prototype.filter.call(document.querySelectorAll('body > .modal'), function (m) { return m !== pdl && m !== sdl; })[0];
    if (hm) { hmClose(); return; }
    if (TX.media && TX.media.closeMenu()) return;
    if (prof) { prof.parentNode.removeChild(prof); return; }
    if (pdl) return;
    // wie der Pfeil: eine Ebene hoeher, auf der Startseite nichts (nie TreadNative.leave)
    TX.back();
  };

  // Schalter «Herstellerleiste über Apps ausblenden»: einmalig aus dem alten Schluessel uebernehmen und weitergeben
  (function () {
    var raw = TX.load(TX.KEYS.prefs, {}) || {};
    if ('hideBar' in raw) return;
    var v = TX.prefs().hideBar; TX.setPref('hideBar', v); TX.native.setPref('hideBar', v);
  })();
  TX.sbarUpd();

  if (!location.hash) history.replaceState(null, '', '#/');
  route();
  api.start();
  // Herzschlag an die App: haengt die Seite, zeigt die App die Steuerpille und laedt neu
  setInterval(function () { try { if (window.TreadNative && window.TreadNative.beat) window.TreadNative.beat(); } catch (e) {} }, 2000);
  // Lauf, den der Dienst ohne Oberflaeche beendet hat (Pausenzeit, Pille ueber anderer App, Neustart): beim Start nachtragen
  if (!api.demo) setTimeout(function () {
    api.summary().then(function (sum) {
      if (!sum || !sum.ts || !(sum.elapsed >= 60) || Date.now() - sum.ts > 7 * 864e5) return;   // bis 7 Tage alt (z. B. ueber Nacht beendet)
      var seen = 0; try { seen = +localStorage.getItem('tx.sumSeen') || 0; } catch (e) {}
      if (sum.ts <= seen) return;
      try { localStorage.setItem('tx.sumSeen', String(sum.ts)); } catch (e) {}
      var rec = TX.makeRun(null, null, sum);
      if (!TX.run(rec.id)) { TX.saveRun(rec); TX.toast('Letzter Lauf nachgetragen: ' + rec.name); }
    });
  }, 2500);
  // Gewicht und HFmax einmal beim Laden an den Dienst
  (function sendProf(n) { setTimeout(function () { if (api.state && !api.offline) TX.sendProfile(); else if (n < 20) sendProf(n + 1); }, 800); })(0);
})();
