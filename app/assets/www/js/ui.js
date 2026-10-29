/* Gemeinsame Bausteine der Ansichten: Kopf mit Reitern, Trainingskopf, Metrikreihe, Steuerleiste. */
(function () {
  'use strict';
  var TX = window.TX, I = TX.I, esc = TX.esc;
  TX.views = {};

  // Befehl senden, Fehler als Kurzmeldung
  TX.cmd = function (c, extra, quiet) {
    return TX.api.cmd(c, extra).then(function (r) {
      if (!r.ok && !quiet) TX.toast(r.error ? 'Nicht ausgeführt: ' + r.error : 'Nicht ausgeführt');
      return r;
    });
  };
  // Hinweis im Fehler: ein Text je Zustand, gleich wie in der Pille (OverlayService, Modus err)
  TX.errHint = function (st) {
    if (st.speed > 0.3) return 'STOP gesendet, Band läuft aus.';
    if (st.pulled === 1) return 'Zuerst Schlüssel einstecken.';
    if (st.pulled === -1) return 'Verbindung zum Band unsicher. Bei Bedarf STOP.';
    return 'Band steht. Nach Prüfung quittieren.';
  };
  // Zustandswoerter: ueberall gleich (Kopf, Chip, Pausen-Dialog)
  TX.stName = { BEREIT: 'BEREIT', LAEUFT: 'LÄUFT', PAUSE: 'PAUSE · Band steht', FEHLER: 'FEHLER', OFF: 'GETRENNT' };
  TX.stOf = function (st) { return TX.api.offline || !st ? 'OFF' : (TX.stName[st.st] ? st.st : 'OFF'); };
  TX.busy = function (st) { return st && (st.st === 'LAEUFT' || st.st === 'PAUSE'); };

  // Zielseite fuer das aktuelle Training
  TX.trainHash = function (st) {
    if (st && st.prog) {
      if (st.prog.type === 'zones') return '#/zones';
      if (st.prog.type === 'route') return '#/strecke/' + encodeURIComponent(st.prog.id || '');
      var a = TX.active(st.prog.name);
      return '#/interval/' + (a && a.planId ? a.planId : 'aktiv');
    }
    return '#/run';
  };

  // Vorlage laden (nur in BEREIT) und zur Ausfuehrungsseite wechseln. Startet nie das Band.
  TX.loadPlan = function (plan) {
    var st = TX.api.state;
    if (!plan) return;
    if (st && st.st !== 'BEREIT') { TX.toast(TX.busy(st) ? 'Erst den laufenden Lauf beenden' : 'Band ist nicht bereit'); return; }
    var prog = TX.toProgram(plan);
    TX.cmd('program', { p: prog }).then(function (r) {
      if (!r.ok) return;
      TX.setActive(plan, prog);
      TX.go(prog.type === 'zones' ? '#/zones' : '#/interval/' + (plan.id || 'aktiv'));
    });
  };

  /* ---------- Kopf mit Reitern ---------- */
  var TABS = [['home', '#/', 'Start'], ['bolt', '#/training', 'Training'], ['plans', '#/plans', 'Pläne'], ['apps', '#/apps', 'Apps'], ['hist', '#/history', 'Verlauf']];
  TX.headHtml = function (on) {
    var pr = TX.profile();
    // auf der Startseite kein Zurueck (Platz bleibt, damit die Marke nicht springt)
    return '<header class="head"><button class="hback' + (on === 'Start' ? ' off' : '') + '" data-g="back" aria-label="Zurück"' + (on === 'Start' ? ' disabled aria-hidden="true" tabindex="-1"' : '') + '>' + I('back') + '</button><div class="brand"><span class="bw">TREAD<b>CONTROL</b></span><span class="demo-tag">DEMO</span></div>' +
      '<nav class="tabs" aria-label="Hauptmenü">' + TABS.map(function (t) {
        return '<a class="tab' + (t[2] === on ? ' on' : '') + '" href="' + t[1] + '"' + (t[2] === on ? ' aria-current="page"' : '') + '>' + I(t[0]) + ' ' + t[2] + '</a>';
      }).join('') + '</nav><div class="rt"><div data-k="hstat"></div><div class="mpw" data-k="mpl"></div>' +
      '<button class="avatar" data-g="profile" aria-label="' + esc(TX.initials(pr.name)) + ' Profil und Pulszonen">' + esc(TX.initials(pr.name)) + '</button></div></header>';
  };
  TX.updHead = function (root, st) {
    var box = root.querySelector('[data-k="hstat"]'); if (!box) return;
    var mode = TX.busy(st) ? st.st : (st && st.hrOk && st.hr > 0 ? 'hr' : 'nohr');
    if (box.getAttribute('data-m') !== mode) {
      box.setAttribute('data-m', mode);
      // mit Laufchip (Tempo und STOP) wird der Mini-Player kompakt, damit der Kopf nicht ueberlaeuft
      var mpw = root.querySelector('.head [data-k="mpl"]');
      if (mpw) { mpw.classList.toggle('compact', mode === 'LAEUFT' || mode === 'PAUSE'); if (TX.media) TX.media.render(); }
      if (mode === 'LAEUFT' || mode === 'PAUSE') {
        box.innerHTML = '<div class="chip runchip' + (mode === 'PAUSE' ? ' pause' : '') + '"><button class="go2" data-g="totrain">' +
          '<span class="sr">Zum laufenden Training: </span><span aria-hidden="true">●</span> <span data-k="hs"></span></button>' + (mode === 'LAEUFT' ? '<button class="stopb" data-g="stop">STOP</button>' : '') + '</div>';
      } else if (mode === 'hr') {
        box.innerHTML = '<button class="chip hrchip" data-g="hrmenu" aria-haspopup="true">' + I('heart') + '<span class="hrc2"><small data-k="hsrc">' + (st && st.hrSrc === 'bluetooth' ? 'Bluetooth' : 'Brustgurt') + '</small> <span><span data-k="hs"></span> bpm</span></span></button>';
      } else box.innerHTML = '<button class="chip hrchip off" data-g="hrmenu" aria-haspopup="true">' + I('heart') + ' Kein Pulssignal</button>';
    }
    var hs = box.querySelector('[data-k="hs"]'), hsrc = box.querySelector('[data-k="hsrc"]');
    if (hsrc) { var sl = st.hrSrc === 'bluetooth' ? 'Bluetooth' : 'Brustgurt'; if (hsrc.textContent !== sl) hsrc.textContent = sl; }
    // Pause wie in Pille, Dialog und Steuerleiste: «PAUSE · GESAMT 24:15»
    if (hs) hs.textContent = mode === 'LAEUFT' ? TX.f1(st.speed) + ' km/h' : mode === 'PAUSE' ? 'PAUSE · GESAMT ' + TX.time(st.elapsed) : String(st.hr);
  };

  /* ---------- Trainingskopf (Schnellstart, Intervall, Plan, Zonen, Strecke) ----------
     links Titel und Unterzeile, Mitte Zustands-Chip und darunter Fortschritt «x von y»,
     rechts [Programmaktion] [Mini-Player kompakt] [Apps] */
  TX.theadHtml = function (o) {
    return '<div class="thead"><button class="hbtn" data-g="home" aria-label="Zurück zum Start">' + I('back') + '</button>' +
      '<div class="tt"><h1 class="t"><span class="tn" data-k="title">' + esc(o.title) + '</span><span class="demo-tag">DEMO</span></h1><div class="s" data-k="sub"></div></div>' +
      '<div class="ctr"><span class="chip stchip" data-k="stc"></span>' +
      '<div class="pw" data-k="pw"' + (o.prog ? '' : ' hidden') + '><div class="prog"><i data-k="pbar"></i></div><span class="pt" data-k="pt"></span></div></div>' +
      '<div class="rt"><span class="act" data-k="act"></span><div class="mpw compact" data-k="mpl"></div><a class="btn ghost appb" href="#/apps" aria-label="Apps">' + I('apps') + '<span class="apl"> Apps</span></a></div></div>';
  };
  TX.stChip = function (el, st) {
    if (!el) return;
    var s = TX.stOf(st), t = '● ' + TX.stName[s];
    if (el.textContent !== t) { el.textContent = t; el.className = 'chip stchip st-' + s; }
    // Eine App (FTMS) steuert Tempo und Steigung: Hinweis mit Rueckgabe an die Konsole fuer den Rest des Laufs
    var ab = el.nextElementSibling && el.nextElementSibling.classList.contains('appchip') ? el.nextElementSibling : null, app = st && st.app;
    if (app) {
      if (!ab) { ab = document.createElement('button'); ab.className = 'chip appchip'; ab.setAttribute('data-g', 'apprelease'); el.parentNode.insertBefore(ab, el.nextSibling); el.parentNode.classList.add('withapp'); }
      if (ab.getAttribute('data-app') !== app) { ab.setAttribute('data-app', app); ab.setAttribute('aria-label', 'Steuerung durch ' + app + ' beenden'); ab.innerHTML = esc(app) + ' steuert ' + I('x'); }
    } else if (ab) { ab.parentNode.classList.remove('withapp'); ab.parentNode.removeChild(ab); }
  };
  // prog: {total, left} oder null (freier Lauf: kein Balken)
  TX.progHead = function (root, st, prog) {
    TX.stChip(root.querySelector('[data-k="stc"]'), st);
    var pw = root.querySelector('[data-k="pw"]'); if (!pw) return;
    pw.hidden = !prog; if (!prog) return;
    var done = TX.clamp(prog.total - prog.left, 0, prog.total || 0);
    root.querySelector('[data-k="pbar"]').style.width = (prog.total ? done / prog.total * 100 : 0).toFixed(2) + '%';
    var pt = root.querySelector('[data-k="pt"]'), txt = TX.time(done) + ' von ' + TX.time(prog.total);
    if (pt.textContent !== txt) pt.textContent = txt;
  };
  // Programmaktion rechts im Kopf: a = {k, html} oder null
  TX.headAct = function (root, a) {
    var el = root.querySelector('[data-k="act"]'), k = a ? a.k : '';
    if (!el || el.getAttribute('data-m') === k) return;
    el.setAttribute('data-m', k); el.innerHTML = a ? a.html : '';
    // mit Programmaktion zeigt der Mini-Player nur Cover und Knoepfe (Laufwerte und Fortschritt haben Vorrang)
    if (el.parentNode) el.parentNode.classList.toggle('withact', !!a);
    if (TX.media) TX.media.render();
  };

  /* ---------- Metrikreihe ---------- */
  TX.mrowHtml = function (x) {
    var it = [['Zeit', 't', ''], ['Distanz', 'd', 'km'], ['Kalorien', 'k', 'kcal'], ['Pace', 'p', '/km'], [x.l, 'x', x.u || ''], ['Puls', 'h', 'bpm']];
    return '<div class="mrow">' + it.map(function (m) {
      return '<div class="m' + (m[1] === 'h' ? ' hr' : '') + '"><div class="lab">' + esc(m[0]) + '</div><div class="v num"><span data-k="m' + m[1] + '">0</span><small>' + m[2] + '</small></div></div>';
    }).join('') + '</div>';
  };
  // In BEREIT gibt es noch keinen Lauf: Zeit, Distanz und Kalorien stehen auf null,
  // auch wenn der Dienst noch Werte des letzten Laufs meldet
  TX.updMrow = function (root, st, x) {
    var set = function (k, v) { var e = root.querySelector('[data-k="m' + k + '"]'); if (e && e.textContent !== v) e.textContent = v; };
    if (!st) return;
    var z = st.st === 'BEREIT';
    set('t', TX.time(z ? 0 : st.elapsed)); set('d', TX.f2(z ? 0 : st.dist)); set('k', String(z ? 0 : Math.round(st.kcal || 0)));
    set('p', st.st === 'LAEUFT' ? TX.pace(st.speed) : '--:--'); set('x', x);
    set('h', st.hr > 0 ? String(st.hr) : '--');
    // gegen sich selbst laufen: die Kalorienkachel zeigt den Abstand zum Gegner (gleiche Strecke oder Vorlage)
    var g = TX.ghost.gap(st), ke = root.querySelector('[data-k="mk"]'), tile = ke && ke.closest('.m');
    if (tile) {
      var lab = tile.querySelector('.lab'), unit = tile.querySelector('small'), want = g ? (g.label === 'Bestzeit' ? 'Bestzeit' : 'Gegner') : 'Kalorien';
      if (lab.textContent !== want) lab.textContent = want;
      if (g) { set('k', TX.time(Math.abs(g.s))); var u = Math.abs(g.s) < 2 ? 'gleich' : g.s < 0 ? 'vor' : 'hinter'; if (unit.textContent !== u) unit.textContent = u; tile.classList.toggle('ahead', g.s < -1); tile.classList.toggle('behind', g.s > 1); }
      else { if (unit.textContent !== 'kcal') unit.textContent = 'kcal'; tile.classList.remove('ahead', 'behind'); }
    }
  };

  /* ---------- Pausenreihe (Steuerleiste und Pausen-Dialog gleich aufgebaut) ----------
     Mitte genau an der STOP-Stelle: kein Knopf, nur das flache Statusfeld «BAND STEHT» (wie in der Pille:
     ohne Fuellung, graues Stopp-Quadrat, 56 hoch, reagiert auf nichts). Links WEITER,
     rechts STEIGUNG AUF 0 und BEENDEN. Nach dem Wechsel in PAUSE 1 s gesperrt (lockUntil).
     dlg: Pausen-Dialog offen, die Leiste liegt dann abgeblendet dahinter und nimmt nichts an. */
  TX.pz = { lockUntil: 0, dlg: false, ending: false, iz: null };
  TX.pzLocked = function () { return Date.now() < TX.pz.lockUntil; };
  // Pause nach Fehler oder gezogenem Schluessel waehrend eines Laufs: Dienst setzt Gehtempo (3.0) als Ziel
  TX.afterBreak = function (st) { return !!(st && st.st === 'PAUSE' && typeof st.note === 'string' && st.note.indexOf('Nach Unterbrechung') === 0); };
  TX.walkText = function (st) { return 'Weiter mit ' + TX.f1(st.tSpeed) + ' km/h (Gehtempo)'; };
  TX.izText = function (st) {
    var z = TX.pz.iz, fx = !!(z && Date.now() < z.until);
    return { fx: fx, t: fx ? TX.f1(z.from) + ' → 0.0' : st.tIncl > 0 ? 'Steigung bleibt ' + TX.f1(st.tIncl) + ' %' : 'Steigung ist 0.0 %' };
  };
  // a: Name des data-Attributs der Knoepfe (x im Dialog, pz in der Leiste)
  TX.pauseRowHtml = function (a) {
    return '<div class="pzrow"><div class="pz-l"><button class="pzb go" data-' + a + '="resume"><span class="bl"><span class="r1">' + I('play', 1) + ' WEITER</span><small data-k="rsc"></small></span></button></div>' +
      '<div class="pz-m" role="status"><b>' + I('stop', 1) + '<span>BAND STEHT</span></b><small data-k="pzt"></small></div>' +
      '<div class="pz-r"><button class="pzb ghost iz" data-' + a + '="inclZero"><span class="bl"><span class="r1">' + I('arrowDown') + ' STEIGUNG AUF 0</span><small data-k="izc"></small></span></button>' +
      '<button class="pzb ghost" data-' + a + '="end">' + I('check') + ' BEENDEN</button></div></div>';
  };
  TX.pauseRowUpd = function (row, st, behind) {
    if (!row || !st) return;
    var lk = TX.pzLocked(), iz = TX.izText(st), bs = row.querySelectorAll('button');
    var set = function (k, v) { var e = row.querySelector('[data-k="' + k + '"]'); if (e && e.textContent !== v) e.textContent = v; return e; };
    row.classList.toggle('lock', lk);
    set('pzt', 'PAUSE · GESAMT ' + TX.time(st.elapsed));
    // nach STOP aus hohem Tempo laeuft das Band noch aus: ehrlich anzeigen, WEITER erst im Stand (der Dienst prueft das auch)
    var coast = st.speed > 0.3, ms = row.querySelector('.pz-m span'); if (ms && ms.textContent !== (coast ? 'BAND LÄUFT AUS' : 'BAND STEHT')) ms.textContent = coast ? 'BAND LÄUFT AUS' : 'BAND STEHT';
    set('izc', iz.t).className = iz.fx ? 'fx' : '';
    set('rsc', TX.afterBreak(st) ? 'mit ' + TX.f1(st.tSpeed) + ' km/h · Gehtempo' : '');
    bs[0].disabled = lk || !!behind || TX.pz.ending || coast;
    bs[1].disabled = lk || !!behind || !(st.tIncl > 0);
    bs[2].disabled = lk || !!behind || TX.pz.ending;
  };

  /* ---------- Steuerleiste ---------- */
  var qv = TX.f1;
  /* opt: incQ, spdQ (Schnellwahl), block(st) -> Grund, warum START gesperrt ist,
     startNote(st) -> Zusatzzeile unter START, spdNote(st) -> Unterzeile beim Tempo ausserhalb des Laufs,
     spdOff(st) -> {v, t}, solange der Tempoblock gesperrt ist: angezeigter Wert und Unterzeile (z. B. 6.0 «Start» vor der Zonenwahl),
     incRel: {plan(), isPlan(st)} Steigungs-Schnellwahl relativ «−1», «Plan», «+1» statt fester Werte (Streckenmodus),
     confirmStart(st) -> Text: vor dem Countdown Bestaetigung mit diesem Klartext (leer = ohne Nachfrage) */
  TX.ctlBar = function (opt) {
    opt = opt || {};
    var incQ = opt.incQ || [0, 3, 6], spdQ = opt.spdQ || [8, 10, 12];
    var el = document.createElement('div');
    el.className = 'ctl'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Steuerung Steigung, Start und Stopp, Tempo');
    var relQ = function () { return [['-1', '\u22121', '\u22121 Prozent Steigung gegenüber Plan'], ['0', 'Plan', 'Plan: Steigung wie geplant'], ['1', '+1', '+1 Prozent Steigung gegenüber Plan']]
      .map(function (x) { return '<button data-ri="' + x[0] + '" aria-label="' + x[2] + '">' + x[1] + '</button>'; }).join(''); };
    var qb = function (a, w) { return a.map(function (v) { return '<button data-q="' + w + '" data-v="' + v + '" aria-label="' + (w === 'i' ? 'Steigung ' + qv(v) + ' Prozent' : 'Tempo ' + qv(v) + ' km/h') + '">' + qv(v) + '</button>'; }).join(''); };
    el.innerHTML = '<div class="side l"><div class="adj inc"><button class="b" data-s="incline" data-d="-0.5" aria-label="Steigung minus 0.5">' + I('minus') + '</button>' +
      '<div class="c"><div class="lab">Steigung</div><div class="num"><span data-k="iv">0.0</span><small>%</small></div><div class="ist off" data-k="ii">&nbsp;</div></div>' +
      '<button class="b" data-s="incline" data-d="0.5" aria-label="Steigung plus 0.5">' + I('plus') + '</button></div><div class="qs' + (opt.incRel ? ' rel' : '') + '">' + (opt.incRel ? relQ() : qb(incQ, 'i')) + '</div></div>' +
      '<div class="mid"><button class="bigbtn" data-k="mid"></button></div>' +
      '<div class="side r"><div class="qs">' + qb(spdQ, 's') + '</div><div class="adj spd"><button class="b" data-s="speed" data-d="-0.5" aria-label="Tempo minus 0.5">' + I('minus') + '</button>' +
      '<div class="c"><div class="lab">Tempo</div><div class="num"><span data-k="sv">0.0</span><small>km/h</small></div><div class="ist off" data-k="si">&nbsp;</div></div>' +
      '<button class="b" data-s="speed" data-d="0.5" aria-label="Tempo plus 0.5">' + I('plus') + '</button></div></div>' + TX.pauseRowHtml('pz');
    var L = TX.LIM, pend = { speed: null, incline: null }, last = null, born = Date.now(), downOk = false, mode = '', modeAt = 0, stopAt = 0;
    var mid = el.querySelector('[data-k="mid"]'), pzRow = el.querySelector('.pzrow');
    // Ist erst zeigen, wenn die Abweichung 2 s anhaelt
    var devAt = { speed: 0, incline: 0 };
    function devHold(w, on) { if (!on) { devAt[w] = 0; return false; } if (!devAt[w]) devAt[w] = Date.now(); return Date.now() - devAt[w] >= 2000; }
    function shown(w) {
      var p = pend[w], cur = last ? (w === 'speed' ? last.tSpeed : last.tIncl) : 0;
      if (p && Date.now() < p.until) return p.v;
      pend[w] = null; return cur;
    }
    function lim(w, v) { return w === 'speed' ? TX.clamp(TX.r1(v), L.sMin, L.sMax) : TX.clamp(TX.r1(v), L.iMin, L.iMax); }
    function setPend(w, v) { pend[w] = { v: v, until: Date.now() + 2500 }; draw(); }
    var stops = [];
    // Geisterklick-Schutz wie bei START: Plus/Minus erst 600 ms nach Seitenaufbau bzw. Moduswechsel
    TX.$$('[data-s]', el).forEach(function (b) {
      stops.push(TX.holdRepeat(b, function () {
        if (!qFresh()) return;
        var w = b.getAttribute('data-s'), d = +b.getAttribute('data-d');
        var base = shown(w), nv = lim(w, base + d), dd = TX.r1(nv - base);
        if (!dd) return;
        setPend(w, nv);
        TX.api.cmd('step', { what: w, d: dd }).then(function (r) { if (!r.ok) { pend[w] = null; draw(); TX.toast('Nicht ausgeführt: ' + (r.error || '')); } });
      }));
    });
    // Schnellwahl und relative Steigung: Klick nur, wenn der Finger auf genau diesem Knopf aufgesetzt hat (nach dem Seitenaufbau)
    var qDown = null;
    el.addEventListener('pointerdown', function (e) { qDown = e.target.closest('[data-q],[data-ri]'); qDown = qDown && qFresh() ? qDown : null; }, true);
    el.addEventListener('click', function (e) {
      var qr = e.target.closest('[data-q],[data-ri]');
      if (qr && e.detail !== 0 && qr !== qDown) { qDown = null; return; }
      qDown = null;
      var pz = e.target.closest('[data-pz]');
      if (pz) { if (!pz.disabled && !TX.pz.dlg && TX.pauseAction) TX.pauseAction(pz.getAttribute('data-pz')); return; }
      var ri = e.target.closest('[data-ri]');
      if (ri && !ri.disabled && opt.incRel) {
        var dv = +ri.getAttribute('data-ri');
        if (!dv) { opt.incRel.plan(); return; }
        var nv = lim('incline', shown('incline') + dv); setPend('incline', nv);
        TX.api.cmd('incline', { v: nv }).then(function (r) { if (!r.ok) { pend.incline = null; draw(); TX.toast('Nicht ausgeführt: ' + (r.error || '')); } });
        return;
      }
      var q = e.target.closest('[data-q]');
      if (q && !q.disabled) {
        var w = q.getAttribute('data-q') === 's' ? 'speed' : 'incline', v = lim(w, +q.getAttribute('data-v'));
        setPend(w, v);
        TX.api.cmd(w, { v: v }).then(function (r) { if (!r.ok) { pend[w] = null; draw(); TX.toast('Nicht ausgeführt: ' + (r.error || '')); } });
      }
    });
    // START nur ueber echten Druck auf diesen Knopf, nie ueber Navigation oder Geisterklick
    var kbd = false;
    // nach Seitenaufbau 600 ms, nach Wechsel STOP zu START 800 ms sperren (Finger liegt evtl. noch drauf)
    function fresh() { var t = Date.now(); return t - born > 600 && t - modeAt > 800; }
    // Schnellwahl, Plus/Minus: 600 ms nach Seitenaufbau und nach einem Wechsel zwischen START, STOP und Pause gesperrt
    var chAt = 0;
    function qFresh() { var t = Date.now(); return t - born > 600 && t - chAt > 600; }
    function doStop() {
      // Doppeltipp: der zweite Druck sendet kein zweites stop; die Sperre gilt nur, wenn STOP angekommen ist
      if (Date.now() - stopAt < 1500) return;
      stopAt = Date.now(); TX.cmd('stop').then(function (r) { if (!r || !r.ok) stopAt = 0; });
    }
    // STOP schon beim Druecken (wie die Pille): rutscht der Finger ab, gibt es sonst kein click
    mid.addEventListener('pointerdown', function () { kbd = false; downOk = mode === 'start' && fresh(); if (mode === 'stop' && !mid.disabled) doStop(); });
    mid.addEventListener('keydown', function (e) { kbd = (e.key === 'Enter' || e.key === ' ') && fresh(); });
    mid.addEventListener('click', function (e) {
      if (mid.disabled) return;
      if (mode === 'start') {
        if (!(downOk || (e.detail === 0 && kbd))) return;
        downOk = false; kbd = false; TX.audioUnlock();
        // nie direkt start: Countdown mit arm, start erst nach 3 s; bei riskantem Plan vorher Klartext und Bestaetigung
        var note = opt.startNote && last ? opt.startNote(last) : '', why = opt.confirmStart && last ? opt.confirmStart(last) : '';
        if (why) TX.confirmStart(why, function () { TX.startCountdown(note); });
        else TX.startCountdown(note);
      } else if (mode === 'stop') doStop();
    });
    function draw() {
      var st = last; if (!st) return;
      var off = TX.api.offline, s = st.st;
      var sv = shown('speed'), iv = shown('incline'), sOff = !off && opt.spdOff ? opt.spdOff(st) : null;
      el.querySelector('[data-k="sv"]').textContent = sOff ? TX.f1(sOff.v) : TX.f1(sv);
      el.querySelector('[data-k="iv"]').textContent = TX.f1(iv);
      el.querySelector('.adj.spd').classList.toggle('off', !!sOff);
      var moving = s === 'LAEUFT';
      var si = el.querySelector('[data-k="si"]'), ii = el.querySelector('[data-k="ii"]');
      // Ist unter dem Sollwert, sobald es um mehr als 0.2 abweicht und das 2 s anhaelt (Werte auf eine Stelle gerundet)
      var dev = function (a, b) { return Math.abs(TX.r1(a) - TX.r1(b)) > 0.2 + 1e-9; };
      var showS = devHold('speed', !sOff && moving && dev(st.speed, sv)), showI = devHold('incline', moving && dev(st.incline, iv));
      // ausserhalb des Laufs eigene Unterzeile (z. B. «Start» fuer das vorgeladene Starttempo)
      var sNote = sOff ? sOff.t : (!moving && opt.spdNote ? opt.spdNote(st) : '');
      var line = function (e, on, t) { e.classList.toggle('off', !on); var v = on ? t : '\u00a0'; if (e.textContent !== v) e.textContent = v; };
      line(si, showS || !!sNote, showS ? 'Ist ' + TX.f1(st.speed) : sNote);
      line(ii, showI, 'Ist ' + TX.f1(st.incline));
      TX.$$('[data-q]', el).forEach(function (b) {
        var w = b.getAttribute('data-q'), v = +b.getAttribute('data-v');
        b.classList.toggle('on', !(sOff && w === 's') && Math.abs((w === 's' ? sv : iv) - v) < 0.001);
      });
      var lock = off || s === 'FEHLER' || s === 'OFF';
      TX.$$('[data-q],[data-s],[data-ri]', el).forEach(function (b) {
        var spd = b.getAttribute('data-q') === 's' || b.getAttribute('data-s') === 'speed';
        b.disabled = lock || (!!sOff && spd);
      });
      if (opt.incRel) { var pb = el.querySelector('[data-ri="0"]'), onP = !!opt.incRel.isPlan(st); pb.classList.toggle('on', onP); pb.setAttribute('aria-pressed', onP ? 'true' : 'false'); }
      var nm, html, dis = false, cls;
      var mv = st.st === 'LAEUFT' || st.speed > 0.3 || (st.st === 'FEHLER' && st.pulled === -1);
      if (off && mv) { nm = 'stop'; html = I('stop', 1) + ' STOP'; cls = 'stop'; }   // Dienst weg, Band lief zuletzt: STOP direkt auf den Bus
      else if (off) { nm = 'off'; html = 'Keine Verbindung'; dis = true; cls = 'start'; }
      else if (s === 'OFF') { nm = 'wait'; html = 'Verbinde'; dis = true; cls = 'start'; }
      else if (s === 'BEREIT') {
        var why = st.pulled === 1 ? 'Schlüssel einstecken' : st.pulled !== 0 ? 'Schlüssel prüfen' : st.safe !== 1 ? 'Band nicht sicher' : (opt.block ? opt.block(st) : '');
        var note = why || !opt.startNote ? '' : opt.startNote(st);
        nm = why ? 'blocked' : 'start'; dis = !!why; cls = 'start';
        html = why ? esc(why) : note ? '<span class="bl"><span class="r1">' + I('play', 1) + ' START</span><small>' + esc(note) + '</small></span>' : '<span style="display:flex">' + I('play', 1) + '</span> START';
      } else if (s === 'LAEUFT') { nm = 'stop'; html = I('stop', 1) + ' STOP'; cls = 'stop'; }
      // PAUSE: an der STOP-Stelle liegt kein Knopf, sondern das Statusfeld der Pausenreihe
      else if (s === 'PAUSE') { nm = 'paused'; html = ''; dis = true; cls = 'start'; }
      else if (mv) { nm = 'stop'; html = I('stop', 1) + ' STOP'; cls = 'stop'; }   // FEHLER, Band laeuft noch oder Zustand unbekannt
      else { nm = 'locked'; html = 'Gesperrt'; dis = true; cls = 'stop'; }
      if (nm + html !== mode + mid.getAttribute('data-h')) {
        if (nm !== mode) { downOk = false; if (mode) modeAt = Date.now(); if (/^(start|stop|paused)$/.test(mode) && /^(start|stop|paused)$/.test(nm)) chAt = Date.now(); }
        mode = nm; mid.innerHTML = html; mid.setAttribute('data-h', html); mid.className = 'bigbtn ' + cls; mid.disabled = dis;
      }
      var paused = nm === 'paused';
      el.classList.toggle('paused', paused);
      if (paused) TX.pauseRowUpd(pzRow, st, TX.pz.dlg);
    }
    return {
      el: el,
      update: function (st) {
        last = st;
        ['speed', 'incline'].forEach(function (w) { var p = pend[w]; if (p && Math.abs((w === 'speed' ? st.tSpeed : st.tIncl) - p.v) < 0.05) pend[w] = null; });
        draw();
      },
      // angezeigte Sollwerte (dieselben Zahlen wie in der Leiste)
      vals: function () { return { s: shown('speed'), i: shown('incline') }; },
      // Schnellwahl neu belegen (z. B. aus den Abschnitten des geladenen Programms)
      setQ: function (incQ, spdQ) {
        var k = incQ.join() + '|' + spdQ.join();
        if (k === el.getAttribute('data-qk')) return;
        el.setAttribute('data-qk', k);
        if (!opt.incRel) el.querySelector('.side.l .qs').innerHTML = qb(incQ, 'i');
        el.querySelector('.side.r .qs').innerHTML = qb(spdQ, 's');
        draw();
      },
      destroy: function () { stops.forEach(function (f) { f(); }); }
    };
  };
  /* Bestaetigung vor dem Start (z. B. Zielzeit auf dem Band nicht erreichbar): Klartext, «Abbrechen» als Vorgabe */
  TX.confirmStart = function (why, go) {
    var m = document.createElement('div'); m.className = 'modal blur'; m.setAttribute('role', 'alertdialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'csh'); m.setAttribute('aria-describedby', 'csd');
    m.innerHTML = '<div class="dlg csdlg"><div class="ico" style="color:var(--inc)">' + I('warn') + '</div><h2 id="csh">Plan prüfen</h2><div class="cst" id="csd">' + esc(why) + '</div>' +
      '<div class="acts"><button class="btn ghost" data-c="no">' + I('x') + ' Abbrechen</button><button class="btn go" data-c="ok">' + I('play', 1) + ' Trotzdem starten</button></div></div>';
    m.addEventListener('click', function (e) { var b = e.target.closest('[data-c]'); if (!b) return; m.parentNode.removeChild(m); if (b.getAttribute('data-c') === 'ok') go(); });
    document.body.appendChild(m); TX.fixGap(m);
    try { m.querySelector('[data-c="no"]').focus(); } catch (x) { /* egal */ }
  };
  // Drei Schnellwahlwerte aus einer Wertemenge
  TX.pick3 = function (vals, def) {
    var u = []; vals.forEach(function (v) { v = TX.r1(v); if (u.indexOf(v) < 0) u.push(v); });
    u.sort(function (a, b) { return a - b; });
    if (u.length > 3) u = [u[0], u[Math.floor(u.length / 2)], u[u.length - 1]];
    for (var i = 0; u.length < 3 && i < def.length; i++) if (u.indexOf(def[i]) < 0) u.push(def[i]);
    return u.sort(function (a, b) { return a - b; });
  };
})();
