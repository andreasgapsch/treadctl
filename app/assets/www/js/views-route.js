/* Streckenmodus: Bibliothek, Import (GPX/TCX), Streckenseite mit Planung und Laufansicht. */
(function () {
  'use strict';
  var TX = window.TX, I = TX.I, esc = TX.esc, $ = TX.$, $$ = TX.$$, R = TX.rte, api = TX.api;
  var N = window.TreadNative;

  function setT(root, k, v) { var e = root.querySelector('[data-k="' + k + '"]'); if (e && e.textContent !== v) e.textContent = v; return e; }
  function setH(root, k, v) { var e = root.querySelector('[data-k="' + k + '"]'); if (e && e.getAttribute('data-h') !== v) { e.setAttribute('data-h', v); e.innerHTML = v; } return e; }
  // Prozent mit echtem Minus
  function pc(v) { v = Math.round((+v || 0) * 10) / 10; return (v < 0 ? '\u2212' : '') + Math.abs(v).toFixed(1); }
  function kb(n) { return n >= 1048576 ? TX.f1(n / 1048576) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function dts(ms) { if (!ms) return ''; var d = new Date(ms); return TX.dshort(ms) + d.getFullYear() + ' ' + TX.hm(ms); }
  var ARTC = { strasse: 'a-str', trail: 'a-trl' };

  /* ---------- Zuletzt gelaufen (aus dem Verlauf) ---------- */
  function lastRun(id) {
    var best = null;
    TX.runs().forEach(function (r) { if (r.route && r.route.id === id && (!best || r.ts > best.ts)) best = r; });
    return best;
  }
  /* Zielzeit-Vorschlaege mit Ermuedung (Riegel): T2 = T1 · (D2 / D1)^1.06. Referenz: mittlere Distanz D1 der letzten Laeufe ab 3 km,
     T1 = deren Durchschnittspace · D1. D2 = flache Vergleichsdistanz (ACSM: 1 % Steigung kostet 4.5 %, also D + 4.5 · Hoehenmeter · Faktor).
     Ohne Laeufe: 5:30 /km auf D2. */
  function suggest(r, scale) {
    var l = TX.runs().filter(function (x) { return x.dist >= 3 && x.elapsed > 0 && x.elapsed / x.dist >= 180 && x.elapsed / x.dist <= 720; }).slice(0, 12);
    var deq = (r.d + 4.5 * (r.up || 0) * (scale || 1)) / 1000, base, km = 0, t = 0;
    l.forEach(function (x) { km += x.dist; t += x.elapsed; });
    if (l.length) { var D1 = km / l.length, T1 = t / km * D1; base = T1 * Math.pow(deq / D1, 1.06); } else base = deq * 330;
    var rnd = function (v) { var q = v >= 3600 ? 300 : 60; return Math.round(v / q) * q; };
    return { n: l.length, def: rnd(base), list: [0.94, 1, 1.06].map(function (f) { return rnd(base * f); }).filter(function (v, i, a) { return a.indexOf(v) === i; }) };
  }
  // schnellster bisheriger Lauf (Durchschnittstempo, ab 1 km)
  function fastest() { var v = 0; TX.runs().forEach(function (x) { if (x.dist >= 1 && x.elapsed > 0) v = Math.max(v, x.dist / x.elapsed * 3600); }); return v; }

  /* ================= Bibliothek ================= */
  var FIL = [['alle', 'Alle'], ['strasse', 'Strasse'], ['trail', 'Trail'], ['eigene', 'Eigene']];
  TX.views.strecken = function (prm, q) {
    var root = document.createElement('div'); root.className = 'screen v-routes';
    var f = q.f && FIL.some(function (x) { return x[0] === q.f; }) ? q.f : 'alle', list = null, err = '';
    root.innerHTML = TX.headHtml('Training') + '<main class="body"><div class="rtop"><h1 class="rtitle">' + I('route') + ' Strecken</h1>' +
      '<div class="filters" role="group" aria-label="Filter" data-k="fil"></div><button class="btn go" data-v="import">' + I('dl') + ' GPX importieren</button></div>' +
      '<div class="rgrid" data-k="grid"><div class="empty">Strecken werden geladen</div></div></main>';
    function render() {
      $('[data-k="fil"]', root).innerHTML = FIL.map(function (x) {
        var n = list ? list.filter(function (m) { return x[0] === 'alle' || (x[0] === 'eigene' ? !m.sample : m.art === x[0]); }).length : 0;
        return '<a href="#/strecken?f=' + x[0] + '" class="' + (x[0] === f ? 'on' : '') + '"' + (x[0] === f ? ' aria-current="true"' : '') + '>' + x[1] + ' ' + n + '</a>';
      }).join('');
      var g = $('[data-k="grid"]', root);
      if (!list) { g.innerHTML = '<div class="empty">' + (err ? esc(err) : 'Strecken werden geladen') + '</div>'; return; }
      var l = list.filter(function (m) { return f === 'alle' || (f === 'eigene' ? !m.sample : m.art === f); });
      l.sort(function (a, b) { return (a.sample === b.sample ? 0 : a.sample ? 1 : -1) || String(a.name).localeCompare(String(b.name)); });
      g.innerHTML = l.map(function (m) {
        var lr = lastRun(m.id), badge = m.sample ? (m.offiziell ? '<span class="rb off">' + I('check') + ' OFFIZIELL</span>' : '') + '<span class="rb smp">BEISPIEL</span>' : '<span class="rb own">EIGENE</span>';
        return '<div class="rwrap"><a class="card rcard" href="#/strecke/' + encodeURIComponent(m.id) + '"><div class="rmini" data-th="' + esc(m.id) + '"></div><div class="rmp" data-tp="' + esc(m.id) + '"></div>' +
          '<div class="rbadges">' + badge + '<span class="rb art ' + (ARTC[m.art] || '') + '">' + (m.art === 'trail' ? 'TRAIL' : 'STRASSE') + '</span></div>' +
          '<h2>' + esc(m.name) + '</h2><div class="rsub">' + esc([m.ort, m.datum ? 'Lauf ' + m.datum : m.importiert ? 'importiert ' + m.importiert : ''].filter(Boolean).join(' · ') || ' ') + '</div>' +
          '<div class="rkp"><span><b>' + R.km(m.d) + '</b> km</span><span class="up">' + I('up') + '<b>' + Math.round(m.up || 0) + '</b> m</span><span class="dn">' + I('down') + '<b>' + Math.round(m.down || 0) + '</b> m</span>' +
          '<span class="ls">' + (lr ? 'zuletzt ' + TX.dshort(lr.ts) + ' · ' + TX.time(lr.elapsed) : 'noch nicht gelaufen') + '</span></div></a>' +
          (m.sample ? '' : '<button class="rdel" data-del="' + esc(m.id) + '" aria-label="' + esc(m.name) + ' löschen">' + I('trash') + '</button>') + '</div>';
      }).join('') + '<button class="card rnew" data-v="import"><span class="ri">' + I('dl') + '</span><b>GPX importieren</b><span>vom USB-Stick oder aus Downloads</span></button>';
      l.forEach(function (m) {
        var el = root.querySelector('[data-th="' + m.id + '"]'), ep = root.querySelector('[data-tp="' + m.id + '"]'); if (!el) return;
        var draw = function (line) {
          if (!el.isConnected) return;
          el.innerHTML = R.lineSvg(line, { w: el.clientWidth || 360, h: el.clientHeight || 150, pad: 16, wd: 3.5, c: TX.ROUTE_C });
          // Profilstreifen einfarbig in der Streckenfarbe (Linie mit Verlaufsflaeche wie auf der Startseite)
          if (line[0] && line[0].length > 2) { var tp = R.thumbProf(line, m.d), lo = 1e9, hi = -1e9; tp.forEach(function (q) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); });
            TX.chart(ep, [{ pts: tp, min: lo - Math.max(20, (hi - lo) * 0.15), max: hi + 5, c: TX.ROUTE_C, dot: false, wd: 2, fill: 0.35 }], { pad: 2 }); }
        };
        if (m.thumb && m.thumb.length > 1) draw(m.thumb);
        else R.get(m.id).then(function (r) { draw(R.thumb(r.pts, 160)); }, function () {});
      });
    }
    function load() { R.list().then(function (l) { list = l; err = ''; render(); }, function (e) { err = 'Strecken nicht verfügbar: ' + (e && e.message || 'Fehler'); render(); }); }
    root.addEventListener('click', function (e) {
      var d = e.target.closest('[data-del]');
      if (d) {
        var id = d.getAttribute('data-del'), m = list && list.filter(function (x) { return x.id === id; })[0];
        if (m) confirmDlg('Strecke löschen?', '«' + m.name + '» wird aus der Bibliothek entfernt. Gelaufene Läufe bleiben im Verlauf.', 'Löschen', function () {
          R.del(id).then(function (r) { if (r && r.ok) { TX.toast('Strecke gelöscht'); load(); } else TX.toast('Nicht gelöscht: ' + (r && r.error || 'Fehler')); });
        });
        return;
      }
      if (e.target.closest('[data-v="import"]')) importDlg(function (id) { TX.go('#/strecke/' + encodeURIComponent(id)); });
    });
    render(); load();
    return { el: root, update: function (st) { TX.updHead(root, st); } };
  };

  /* ---------- Bestaetigung (Loeschen) ---------- */
  function confirmDlg(title, txt, okTxt, ok) {
    var m = document.createElement('div'); m.className = 'modal blur'; m.setAttribute('role', 'alertdialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'cfh');
    m.innerHTML = '<div class="dlg"><div class="ico">' + I('trash') + '</div><h2 id="cfh">' + esc(title) + '</h2><div class="mut" style="margin-top:8px;font-size:16px">' + esc(txt) + '</div>' +
      '<div class="acts"><button class="btn ghost" data-c="no">Abbrechen</button><button class="btn red" data-c="ok">' + I('trash') + ' ' + esc(okTxt) + '</button></div></div>';
    m.addEventListener('click', function (e) { var b = e.target.closest('[data-c]'); if (!b) return; m.parentNode.removeChild(m); if (b.getAttribute('data-c') === 'ok') ok(); });
    document.body.appendChild(m); TX.fixGap(m);
    try { m.querySelector('[data-c="no"]').focus(); } catch (x) { /* egal */ }
  }

  /* ---------- Dateien der Konsole (TreadNative.listGpx/readGpx), in der Demo nachgebildet ---------- */
  var demoFiles = null;
  function toGpx(r, name, every) {
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Garmin Connect" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>' + esc(name) + '</name><trkseg>';
    for (var i = 0; i < r.pts.length; i += every) { var p = r.pts[i]; s += '<trkpt lat="' + p[0] + '" lon="' + p[1] + '"><ele>' + (p[2] + 2.5 * Math.sin(i / 7)).toFixed(1) + '</ele></trkpt>'; }
    var L = r.pts[r.pts.length - 1]; return s + '<trkpt lat="' + L[0] + '" lon="' + L[1] + '"><ele>' + L[2] + '</ele></trkpt></trkseg></trk></gpx>';
  }
  function toTcx(r, name, every) {
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Courses><Course><Name>' + esc(name) + '</Name><Track>';
    for (var i = 0; i < r.pts.length; i += every) { var p = r.pts[i]; s += '<Trackpoint><Position><LatitudeDegrees>' + p[0] + '</LatitudeDegrees><LongitudeDegrees>' + p[1] + '</LongitudeDegrees></Position><AltitudeMeters>' + p[2] + '</AltitudeMeters></Trackpoint>'; }
    return s + '</Track></Course></Courses></TrainingCenterDatabase>';
  }
  function demoPrep() {
    if (demoFiles) return Promise.resolve(demoFiles);
    var now = Date.now();
    return Promise.all([R.get('hallwilersee-runde').catch(function () { return null; }), R.get('homberg-runde').catch(function () { return null; })]).then(function (a) {
      demoFiles = {};
      var add = function (path, usb, txt, ago) { demoFiles[path] = { path: path, name: path.split('/').pop(), size: txt.length, usb: usb, mtime: now - ago, txt: txt }; };
      if (a[0]) add('/storage/USB/Laeufe/Hallwilersee_Abendrunde.gpx', true, toGpx(a[0], 'Hallwilersee Abendrunde', 3), 2 * 864e5);
      if (a[1]) add('/sdcard/Download/Homberg-Lauf.tcx', false, toTcx(a[1], 'Homberg Lauf', 2), 5 * 864e5);
      add('/sdcard/Download/defekt.gpx', false, '<gpx><trk><name>leer</name></trk></gpx>', 9 * 864e5);
      return demoFiles;
    });
  }
  var files = {
    list: function () {
      if (N && typeof N.listGpx === 'function') {
        try { var a = JSON.parse(N.listGpx()); return Promise.resolve(Array.isArray(a) ? a : []); } catch (e) { return Promise.resolve([]); }
      }
      if (!api.demo) return Promise.resolve([]);
      return demoPrep().then(function (d) { return Object.keys(d).map(function (k) { var x = d[k]; return { path: x.path, name: x.name, size: x.size, usb: x.usb, mtime: x.mtime }; }); });
    },
    read: function (path) {
      if (N && typeof N.readGpx === 'function') { try { return String(N.readGpx(path) || ''); } catch (e) { return ''; } }
      return demoFiles && demoFiles[path] ? demoFiles[path].txt : '';
    }
  };

  /* ================= Import-Dialog =================
     Schritte: Datei waehlen, lesen (Fortschritt), pruefen (Name, Art, Kennzahlen), speichern. */
  function importDlg(done) {
    var m = document.createElement('div'); m.className = 'modal blur imodal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'imh');
    m.innerHTML = '<div class="dlg idlg"><div class="ihd"><span class="ii">' + I('dl') + '</span><div><h2 id="imh">GPX importieren</h2><div class="mut" data-k="isub">USB-Stick oder Downloads · GPX und TCX</div></div></div>' +
      '<div class="ibody" data-k="ib"><div class="empty">Dateien werden gesucht</div></div><div class="acts" data-k="ia"></div></div>';
    var cur = null, list = [], busy = false;
    function close() { if (m.parentNode) m.parentNode.removeChild(m); }
    function acts(h) { m.querySelector('[data-k="ia"]').innerHTML = h; TX.fixGap(m); }
    function pick() {
      cur = null; setT(m, 'isub', 'USB-Stick oder Downloads · GPX und TCX');
      files.list().then(function (l) {
        list = l.slice().sort(function (a, b) { return (b.usb - a.usb) || (b.mtime - a.mtime); });
        var b = m.querySelector('[data-k="ib"]');
        b.innerHTML = list.length ? '<div class="flist">' + list.map(function (x, i) {
          return '<button class="frow" data-f="' + i + '"><span class="fic' + (x.usb ? ' usb' : '') + '">' + I(x.usb ? 'usb' : 'dl') + '</span><span class="fn"><b>' + esc(x.name) + '</b><small>' + (x.usb ? 'USB-Stick' : 'Downloads') + ' · ' + esc(dts(x.mtime)) + '</small></span>' +
            '<span class="fs">' + kb(x.size) + '</span><span class="fgo">' + I('back') + '</span></button>';
        }).join('') + '</div>' : '<div class="fnone"><span class="ri">' + I('usb') + '</span><b>Keine GPX- oder TCX-Dateien gefunden</b><span>Datei auf einen USB-Stick kopieren und einstecken oder in «Downloads» ablegen.</span></div>';
        acts('<button class="btn ghost" data-a="close">Abbrechen</button><button class="btn ghost" data-a="rescan">' + I('repeat') + ' Neu suchen</button>');
      });
    }
    function prog(t, fr) {
      var b = m.querySelector('[data-k="ib"]');
      if (!b.querySelector('.iprog')) b.innerHTML = '<div class="iprog"><b data-k="pfn"></b><div class="ibar"><i data-k="pbar"></i></div><div class="ipt"><span data-k="ptx"></span><span data-k="ppc"></span></div></div>';
      setT(b, 'pfn', cur ? cur.f.name : ''); setT(b, 'ptx', t); setT(b, 'ppc', Math.round(fr * 100) + ' %');
      b.querySelector('[data-k="pbar"]').style.width = Math.round(fr * 100) + '%';
    }
    function read(i) {
      var f = list[i]; if (!f || busy) return;
      busy = true; cur = { f: f }; setT(m, 'isub', 'Datei lesen');
      acts('<button class="btn ghost" data-a="back" disabled>Zurück</button>');
      prog('Datei lesen', 0.02);
      var txt = files.read(f.path);
      setTimeout(function () {
        R.fromText(txt, { fileName: f.name }, prog).then(function (res) {
          busy = false; cur.res = res; cur.r = res.route; review();
        }, function (e) {
          busy = false;
          m.querySelector('[data-k="ib"]').innerHTML = '<div class="fnone ierr"><span class="ri">' + I('warn') + '</span><b>Import nicht möglich</b><span>' + esc(e && e.message || 'Unbekannter Fehler') + '</span></div>';
          acts('<button class="btn ghost" data-a="back">' + I('back') + ' Andere Datei</button>');
        });
      }, 30);
    }
    function review() {
      var r = cur.r, b = m.querySelector('[data-k="ib"]'), upkm = Math.round(r.up / Math.max(0.1, r.d / 1000));
      setT(m, 'isub', cur.f.name + ' · ' + (cur.res.kind === 'tcx' ? 'TCX' : 'GPX'));
      b.innerHTML = '<div class="irev"><div class="ivis"><div class="imap" data-k="imap"></div><div class="iprof" data-k="iprof"></div></div><div class="iform">' +
        '<label class="lab" for="iname">Name</label><input id="iname" maxlength="80" value="' + esc(r.name) + '" autocomplete="off">' +
        '<div class="lab" style="margin-top:14px">Art</div><div class="seg iart" role="group" aria-label="Art"><button data-art="strasse">Strasse</button><button data-art="trail">Trail</button></div>' +
        '<div class="ivor">Vorschlag: <b>' + (r.artVorschlag === 'trail' ? 'Trail' : 'Strasse') + '</b> (' + upkm + ' Höhenmeter je km' + (r.artVorschlag === 'trail' ? ', ab 40 Trail' : ', Trail ab 40') + ')</div>' +
        '<div class="ikp"><div><div class="lab">Distanz</div><div class="num">' + R.km(r.d) + '<small>km</small></div><div class="isub">Datei ' + R.km(cur.res.rawD) + ' km, ' + cur.res.n + ' Punkte</div></div><div><div class="lab">Aufstieg</div><div class="num" data-k="iup">' + r.up + '<small>m</small></div></div>' +
        '<div><div class="lab">Abstieg</div><div class="num" data-k="idn">' + r.down + '<small>m</small></div></div></div>' +
        '<div class="isrc ' + (cur.res.warn ? 'w' : 'ok') + '">' + I(cur.res.warn ? 'warn' : 'check') + '<span>' + esc(cur.res.warn ? cur.res.warn + ' Karte ohne Hintergrund, Linie und Profil funktionieren.' : (r.hoehe === 'gpx' ? 'Höhen aus der Datei' : 'Höhen von swisstopo (swissALTI3D)')) + '</span></div></div></div>';
      artOn();
      var im = $('[data-k="imap"]', b); im.innerHTML = R.lineSvg(r.thumb, { w: im.clientWidth || 380, h: im.clientHeight || 220, pad: 18, wd: 4 });
      R.profile($('[data-k="iprof"]', b), { prof: R.thinProf(r.prof, 400), D: r.d });
      acts('<button class="btn ghost" data-a="back">' + I('back') + ' Andere Datei</button><button class="btn go" data-a="save">' + I('check') + ' Speichern</button>');
      $('#iname', m).addEventListener('keydown', function (e) { if (e.key === 'Enter') e.target.blur(); });
    }
    function artOn() { $$('[data-art]', m).forEach(function (x) { var on = x.getAttribute('data-art') === cur.r.art; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    function save() {
      if (busy) return;
      var r = cur.r, nm = ($('#iname', m).value || '').trim().slice(0, 80) || r.name;
      r.name = nm; busy = true;
      var sv = m.querySelector('[data-a="save"]'); if (sv) sv.disabled = true;
      R.list().catch(function () { return []; }).then(function (l) {
        r.id = R.uniqueId(R.slug(nm), l);
        var tiles = !cur.res.warn && !!R.tileSrc(r);   // Luftbild nur in der Schweiz
        r.karte = tiles;
        return R.save(r).then(function (res) {
          busy = false;
          if (!res || !res.ok) { if (sv) sv.disabled = false; TX.toast('Nicht gespeichert: ' + (res && res.error || 'Fehler')); return; }
          // Kacheln einmalig beim Import vorladen (danach laeuft die Karte ohne Internet)
          if (tiles) R.prefetch(R.tileSrc(r), r.pts).then(function (p) { if (p && p.ok === false) TX.toast('Karte nicht vorgeladen: ' + (p.error || '')); else if (p && p.busy) TX.toast('Karte wird später geladen'); });
          TX.toast('Strecke gespeichert' + (tiles ? ', Karte wird für offline geladen' : ''));
          close(); if (done) done(r.id);
        });
      });
    }
    m.addEventListener('click', function (e) {
      var f = e.target.closest('[data-f]'); if (f) { read(+f.getAttribute('data-f')); return; }
      var ar = e.target.closest('[data-art]'); if (ar && cur && cur.r) { R.reArt(cur.r, ar.getAttribute('data-art')); artOn(); setH(m, 'iup', cur.r.up + '<small>m</small>'); setH(m, 'idn', cur.r.down + '<small>m</small>'); return; }
      var a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
      var v = a.getAttribute('data-a');
      if (v === 'close') close(); else if (v === 'rescan') pick(); else if (v === 'back') pick(); else if (v === 'save') save();
    });
    document.body.appendChild(m); TX.fixGap(m);
    pick();
    return m;
  }
  TX.importDlg = importDlg;

  // Gegen sich selbst laufen: Abstand zur Bestzeit (oder zum letzten Lauf) auf dieser Strecke
  function ghostSpan(st) {
    var g = TX.ghost.gap(st); if (!g) return '';
    var c = Math.abs(g.s) < 2 ? '' : g.s < 0 ? ' style="color:var(--go)"' : ' style="color:var(--warn)"';
    return '<span><span class="lab">' + (g.label === 'Bestzeit' ? 'Bestzeit' : 'Gegner') + '</span><b class="num"' + c + '>' + TX.time(Math.abs(g.s)) + '</b><small>' + (Math.abs(g.s) < 2 ? 'gleich' : g.s < 0 ? 'vor' : 'hinter') + '</small></span>';
  }
  /* ================= Streckenseite: Planung und Lauf ================= */
  TX.views.strecke = function (prm) {
    var id = prm[0] || '', root = document.createElement('div'); root.className = 'screen v-route'; root.setAttribute('role', 'main');
    var r = null, loadErr = '', mode = '', map = null, mapMode = '', follow = true;
    var pf = null, cfg = null, sentKey = '', reloadT = 0, lastProfK = '', lastBarK = '', lastSt = null;
    var cb = TX.ctlBar({ incQ: [0, 2, 4], spdQ: [10, 11, 12],
      block: function (st) { return !r ? 'Strecke wird geladen' : isMine(st) ? '' : 'Plan wird geladen'; },
      startNote: function (st) { return isMine(st) ? 'Ziel ' + TX.time(st.prog.target) : ''; },
      // Steigung relativ zum Plan: «−1», «Plan», «+1» (Handeingabe gilt bis zum naechsten Steigungswechsel)
      incRel: { plan: function () { var st = api.state; if (isMine(st)) TX.cmd('routeOffset', { s: st.prog.offS || 0, i: 0 }); },
        isPlan: function (st) { return isMine(st) && Math.abs(st.prog.offI || 0) < 0.05; } },
      confirmStart: function (st) { return startCheck(st); } });
    root.innerHTML = TX.theadHtml({ title: 'Strecke', prog: true }).replace('data-g="home" aria-label="Zurück zum Start"', 'data-v="back" aria-label="Zurück zu den Strecken"') +
      '<div class="main" data-k="main"><div class="empty">Strecke wird geladen</div></div>';
    root.appendChild(cb.el);
    var main = $('[data-k="main"]', root);
    // START-Schutz: Zielzeit nicht erreichbar (Tempo am Anschlag) oder schneller als je gelaufen
    function startCheck(st) {
      if (!isMine(st)) return '';
      var pr = st.prog, plan = api.routePlan(pr), out = [];
      if (pr.total - pr.target > 30) out.push('Die Zielzeit ' + TX.time(pr.target) + ' ist auf dem Band nicht erreichbar: Das Tempo steht am Anschlag (höchstens 20 km/h), der Plan braucht ' + TX.time(pr.total) + '.');
      if (plan) {
        var mx = 0, fs = fastest(); plan.secs.forEach(function (q) { mx = Math.max(mx, q[2]); });
        if (fs > 0 && mx > fs + 1) out.push('Der Plan verlangt bis ' + TX.f1(mx) + ' km/h. Dein schnellster Lauf hatte im Schnitt ' + TX.f1(fs) + ' km/h.');
      }
      return out.join(' ');
    }
    function isMine(st) { return !!(st && st.prog && st.prog.type === 'route' && st.prog.id === id); }
    function wantKey() { return [id, cfg.target, cfg.mode, cfg.scale].join('|'); }
    function progKey(p) { return [p.id, p.target, p.mode, p.scale].join('|'); }

    // Demo: erst wenn das Szenario aufgebaut ist (sonst laedt die Seite das Programm parallel)
    (TX.demoReady || Promise.resolve()).then(function () { return R.get(id); }).then(function (x) {
      r = x; pf = R.prefs(id);
      var sg = suggest(r, pf && pf.scale || 1);
      cfg = { target: pf && pf.target || sg.def, mode: pf && pf.mode || 'terrain', scale: pf && pf.scale || 1.0 };
      var st = api.state;
      // laeuft oder ist diese Strecke schon geladen: dessen Werte uebernehmen
      if (isMine(st)) { cfg.target = st.prog.target; cfg.mode = st.prog.mode; cfg.scale = st.prog.scale; sentKey = progKey(st.prog); }
      mode = ''; view.update(api.state || TX.OFF);
    }, function (e) { loadErr = e && e.message || 'Strecke nicht verfügbar'; mode = ''; view.update(api.state || TX.OFF); });

    function savePf() { R.setPrefs(id, { target: cfg.target, mode: cfg.mode, scale: cfg.scale }); }
    // Programm laden (nur BEREIT); Aenderungen entprellt
    function sendProgram() {
      var st = api.state; reloadT = 0;
      if (!r || !st || st.st !== 'BEREIT' || api.offline) return;
      var k = wantKey(); sentKey = k;
      // nur die Kennung: Profil, Art und Hoehenquelle liest der Dienst aus der Bibliothek (Befehl bleibt klein)
      TX.cmd('program', { p: { type: 'route', id: r.id, target: cfg.target, mode: cfg.mode, scale: cfg.scale } }, true).then(function (res) {
        // abgewiesen: dieselben Werte nicht erneut senden (erst nach einer Aenderung); Fehler nur anzeigen
        if (!res.ok) {
          if (api.state && api.state.st === 'BEREIT') setPlanErr(res.error || 'Fehler');
          // Verbindungsproblem (nicht abgewiesen): nach 3 s erneut senden; echte Ablehnungen erst nach einer Aenderung
          if (TX.transportErr(res)) setTimeout(function () { if (sentKey === k) sentKey = ''; }, 3000);
          return;
        }
        setPlanErr(''); api.poke(true);
      });
    }
    var planErr = '';
    function setPlanErr(e) { if (planErr === e) return; planErr = e; lastProfK = ''; if (lastSt && mode === 'plan') updPlan(lastSt); }
    function changed() { savePf(); clearTimeout(reloadT); reloadT = setTimeout(sendProgram, 600); drawInputs(); }

    /* ---------- Karte (gemeinsam fuer Planung und Lauf) ---------- */
    function ensureMap(live) {
      var el = $('[data-k="map"]', root); if (!el || !r) return;
      var mk = (live ? 'live' : 'plan') + '|' + (el._id || (el._id = Math.random()));
      if (map && mapMode === mk) return;
      if (map) map.destroy();
      mapMode = mk; follow = !!live;
      map = R.map(el, r, { live: live, onFollow: function (on) { follow = on; folBtns(); } });
      folBtns();
    }
    function folBtns() {
      var a = $('[data-v="fol"]', root), b = $('[data-v="fit"]', root);
      if (a) { a.classList.toggle('on', follow); a.setAttribute('aria-pressed', follow ? 'true' : 'false'); }
      if (b) b.classList.toggle('on', !follow);
    }

    /* ---------- Planung (BEREIT) ---------- */
    function renderPlan() {
      main.className = 'main rplanm';
      main.innerHTML = '<section class="card rleft" aria-label="Karte und Höhenprofil"><div class="rmap" data-k="map"></div>' +
        '<div class="mapnote" data-k="mnote" hidden>' + I('info') + '<span>Karte ohne Hintergrund, Linie und Profil funktionieren</span><button class="btn ghost" data-v="tiles">' + I('dl') + ' Karte nachladen</button></div>' +
        '<div class="rph"><h2 class="lab">Höhenprofil und Soll-Pace je <span class="u">km</span></h2><div class="slg">' + R.SLOPE.map(function (x) { return '<span><i style="background:' + x[1] + '"></i>' + x[2] + '</span>'; }).join('') + '</div></div>' +
        '<div class="rprof" data-k="prof"></div></section>' +
        '<section class="card rright" aria-label="Zielzeit und Plan">' +
        '<div class="tin"><div class="tl"><div class="lab">Zielzeit</div><small>h:mm:ss</small></div><button class="tb" data-st="t" data-d="-1" aria-label="Zielzeit verringern">' + I('minus') + '</button>' +
        '<b class="num" data-k="tv"></b><button class="tb" data-st="t" data-d="1" aria-label="Zielzeit erhöhen">' + I('plus') + '</button></div>' +
        '<div class="tin pin"><div class="tl"><div class="lab">Pace Ø</div><small>m:ss /km</small></div><button class="tb" data-st="p" data-d="-1" aria-label="Pace schneller">' + I('minus') + '</button>' +
        '<b class="num" data-k="pv"></b><button class="tb" data-st="p" data-d="1" aria-label="Pace langsamer">' + I('plus') + '</button></div>' +
        '<div class="opt"><span class="lab">Verteilung</span><div class="seg" role="group" aria-label="Verteilung"><button data-mode="terrain">Nach Gelände</button><button data-mode="even">Gleichmässig</button></div></div>' +
        '<div class="opt"><span class="lab">Steigung</span><div class="seg" role="group" aria-label="Steigung"><button data-sc="1">1:1</button><button data-sc="0.5">Abgeschwächt 50 %</button></div></div>' +
        '<div class="pbox" data-k="pbox"></div></section>';
      TX.fixGap(main);
      $$('[data-st]', main).forEach(function (b) {
        TX.holdRepeat(b, function (n) {
          var d = +b.getAttribute('data-d'), km = r.d / 1000;
          if (b.getAttribute('data-st') === 't') cfg.target = TX.clamp(cfg.target + d * (n > 8 ? 300 : 60), 600, 72 * 3600 - 60);
          else { var p = Math.round(cfg.target / km) + d * (n > 8 ? 15 : 5); p = TX.clamp(p, 180, 1800); cfg.target = Math.round(p * km); }
          cfg.target = Math.max(Math.ceil(r.d / 1000 * 180), cfg.target);
          changed();
        });
      });
      ensureMap(false); drawInputs();
      // «Karte nachladen» nur, wenn dem Dienst Kacheln entlang der Strecke fehlen
      if (R.tileSrc(r)) R.coverage(R.tileSrc(r), r.pts, r).then(function (c) { var n = $('[data-k="mnote"]', main); if (n && c && c.total > 0 && c.have < c.total) { n.hidden = false; TX.fixGap(n); } });
    }
    function drawInputs() {
      if (!cfg || mode !== 'plan') return;
      setT(main, 'tv', TX.time(cfg.target));
      setH(main, 'pv', TX.time(cfg.target / (r.d / 1000)) + '<small>/km</small>');
      $$('[data-mode]', main).forEach(function (b) { var on = b.getAttribute('data-mode') === cfg.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      $$('[data-sc]', main).forEach(function (b) { var on = +b.getAttribute('data-sc') === cfg.scale; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      $$('[data-sg]', main).forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-sg') === cfg.target); });
    }
    function updPlan(st) {
      var pr = isMine(st) ? st.prog : null, ok = pr && progKey(pr) === wantKey(), plan = ok ? api.routePlan(pr) : null;
      var pk = (plan ? api.rkey(pr) : 'none') + '|' + (r ? r.id : '');
      if (pk !== lastProfK) {
        lastProfK = pk;
        R.profile($('[data-k="prof"]', main), { prof: plan && plan.prof ? plan.prof : R.thinProf(r.prof, 400), D: r.d, secs: plan ? plan.secs : null, bars: true,
          steep: plan && r.art !== 'trail' && !r.steilGeprueft ? plan.secs.filter(function (q) { return q[4] > 12; }) : null });
      }
      var box = $('[data-k="pbox"]', main), h;
      if (planErr) h = '<div class="pwarn">' + I('warn') + '<span>Plan nicht möglich: ' + esc(planErr) + '</span></div>';
      else if (!plan) h = '<div class="pload">' + (st.st === 'BEREIT' ? 'Plan wird berechnet' : st.st === 'OFF' ? 'Keine Verbindung zum Dienst' : 'Planung nur im Zustand BEREIT') + '</div>';
      else {
        var inf = R.planInfo(plan.secs), miss = Math.abs(pr.total - pr.target) > 2, sk = inf.steep;
        // steile Strassenabschnitte nur markieren, wenn die Daten nicht als geprueft vermerkt sind (steilGeprueft)
        var steep = r.art !== 'trail' && !r.steilGeprueft ? plan.secs.filter(function (q) { return q[4] > 12; }) : [];
        h = '<div class="prow2"><div><div class="lab">Planzeit</div><div class="num' + (miss ? ' bad' : '') + '">' + TX.time(pr.total) + '</div></div>' +
          '<div><div class="lab">Tempo</div><div class="num">' + TX.f1(inf.lo) + '<small> bis </small>' + TX.f1(inf.hi) + '<small>km/h</small></div></div>' +
          '<div><div class="lab">Steilste Stelle</div><div class="num' + (steep.length ? ' bad' : '') + '">' + pc(sk[4]) + '<small>% bei km ' + TX.f1(sk[0] / 1000) + '</small></div></div></div>' +
          '';
      }
      if (box.getAttribute('data-h') !== h) { box.setAttribute('data-h', h); box.innerHTML = h; TX.fixGap(box); }
      if (plan) {
        var bk = api.rkey(pr);
        if (bk !== lastBarK) { lastBarK = bk; cb.setQ(TX.pick3(plan.secs.map(function (s) { return s[3]; }), [0, 2, 4]), TX.pick3(plan.secs.map(function (s) { return s[2]; }), [10, 11, 12])); }
      }
      // Programm laden, wenn noetig (auch nach Rueckkehr in BEREIT)
      if (st.st === 'BEREIT' && !api.offline && (!pr || progKey(pr) !== wantKey()) && sentKey !== wantKey() && !reloadT) sendProgram();
      if (st.st === 'BEREIT' && pr && progKey(pr) === wantKey() && !plan && !api.needHistAsk) { api.needHistAsk = true; api.poke(true); setTimeout(function () { api.needHistAsk = false; }, 1500); }
    }

    /* ---------- Lauf ---------- */
    function renderRun() {
      main.className = 'main rrunm';
      main.innerHTML = '<section class="card rleft" aria-label="Karte und Höhenprofil"><div class="rmap" data-k="map"></div>' +
        '<div class="mbtns"><button class="mbtn" data-v="fit">' + I('expand') + ' Ganze Strecke</button><button class="mbtn" data-v="fol">' + I('locate') + ' Mitfahren</button></div>' +
        '<div class="rban xban" data-k="ban" role="status"></div>' +
        '<div class="rprof live" data-k="prof"></div></section>' +
        '<section class="card rlive" aria-label="Soll-Pace und Plan" data-k="live"></section>';
      TX.fixGap(main);
      ensureMap(true);
    }
    function liveHtml() {
      return '<div class="sp"><div class="spl"><div class="lab">Soll-Pace</div><div class="spv num"><span data-k="sp">--:--</span><small>/km</small></div><div class="sps" data-k="sps"></div></div>' +
        '<div class="spr"><div class="ist"><div class="lab">Ist-Pace</div><div class="num" data-k="ip">--:--</div></div><div class="dl" data-k="dl"></div></div></div>' +
        '<div class="lk"><div class="c"><div class="lab">Prognose</div><div class="num" data-k="eta"></div><div class="sub" data-k="etas"></div></div>' +
        '<div class="c"><div class="lab">Gelaufen</div><div class="num"><span data-k="kd"></span><small>km</small></div><div class="sub" data-k="kl"></div></div>' +
        '<div class="c"><div class="lab">Steigung Band</div><div class="num"><span data-k="gs"></span><small>%</small></div><div class="sub" data-k="gb"></div></div>' +
        '<div class="c"><div class="lab" data-k="nl">Als Nächstes</div><div class="num nx" data-k="nv"></div><div class="sub" data-k="ns"></div></div></div>' +
        '<div class="lbot" data-k="lbot"></div>';
    }
    function finHtml(pr) {
      var dd = pr.t - pr.target, st = api.state || {};
      return '<div class="fin"><div class="ffl">' + I('flag') + '</div><div class="fl">ZIEL ERREICHT</div><div class="ft num">' + TX.time(pr.t) + '</div>' +
        '<div class="fz">Vorgabe ' + TX.time(pr.target) + ' · <b class="' + (dd <= 0 ? 'g' : 'o') + '">' + TX.time(Math.abs(dd)) + (dd <= 0 ? ' schneller' : ' langsamer') + '</b></div>' +
        '<div class="fk"><div><div class="lab">Ø Pace</div><div class="num">' + TX.time(pr.t / (pr.D / 1000)) + '<small>/km</small></div></div><div><div class="lab">Distanz</div><div class="num">' + R.km(pr.D) + '<small>km</small></div></div>' +
        '<div><div class="lab">Aufstieg</div><div class="num">' + Math.round(pr.up) + '<small>m</small></div></div><div><div class="lab" style="color:var(--hr)">Puls</div><div class="num" style="color:var(--hr)">' + (st.hr > 0 ? st.hr : TX.NA) + '<small>bpm</small></div></div></div>' +
        '<div class="fn">Band läuft auf 3 km/h aus und hält 10 s danach an. Schneller weiterlaufen geht frei, STOP beendet den Lauf.</div></div>';
    }
    function updRun(st) {
      var pr = st.prog, live = $('[data-k="live"]', main);
      if (!pr || pr.type !== 'route') return;
      var fin = !!pr.finish;
      if (live.getAttribute('data-m') !== String(fin)) { live.setAttribute('data-m', String(fin)); live.innerHTML = fin ? finHtml(pr) : liveHtml(); TX.fixGap(live); }
      if (map) map.progress(pr.x);
      var plan = api.routePlan(pr), pk = (plan ? 'p' : 'n') + '|' + Math.round(pr.x / 25);   // Profil alle 25 m neu (etwa 1 Bildpunkt), nicht bei jeder Abfrage
      if (pk !== lastProfK) { lastProfK = pk; R.profile($('[data-k="prof"]', main), { prof: plan && plan.prof ? plan.prof : R.thinProf(r.prof, 400), D: pr.D, secs: plan ? plan.secs : null, x: pr.x }); }
      if (plan) { var bk = api.rkey(pr); if (bk !== lastBarK) { lastBarK = bk; cb.setQ([0, 2, 4], TX.pick3(plan.secs.map(function (s) { return s[2]; }), [10, 11, 12])); } }
      // Wechselbanner wie in der Pille: Steigung ab 1 % oder Tempo ab 1 km/h, 10 s vorher (Ton bei 3, 2, 1 in app.js)
      var ban = $('[data-k="ban"]', main), ch = R.change(pr, st), nx = pr.next;
      var showB = !fin && st.st === 'LAEUFT' && ch && ch.big && ch.sec <= 10 && ch.sec > 0;
      ban.classList.toggle('on', !!showB);
      if (showB) {
        var head, sub;
        if (ch.finish) { head = 'Ziel'; sub = 'Band läuft auf 3 km/h aus und hält danach an'; }
        else {
          head = Math.abs(ch.dI) >= 1 ? 'Steigung ' + (ch.dI > 0 ? '↑ auf ' : '↓ auf ') + TX.f1(nx.i) + ' %' : 'Tempo ' + (ch.dS > 0 ? '↑ auf ' : '↓ auf ') + TX.f1(nx.s) + ' km/h';
          sub = 'Strecke ' + pc(nx.g) + ' % · Tempo ' + TX.f1(nx.s) + ' km/h · Soll ' + R.pace(3600 / Math.max(0.8, nx.s)) + ' /km';
        }
        var bh = TX.banHtml(ch.sec, head, sub);
        if (ban.getAttribute('data-h') !== bh) { ban.setAttribute('data-h', bh); ban.innerHTML = bh; }
        ban.className = 'rban xban on ' + (ch.finish ? 'd-fin' : ch.dI >= 1 || (Math.abs(ch.dI) < 1 && ch.dS > 0) ? 'd-up' : 'd-down');
      }
      if (fin) {
        if (live.getAttribute('data-ft') !== String(pr.t)) { live.setAttribute('data-ft', String(pr.t)); live.innerHTML = finHtml(pr); }
        return;
      }
      // Plan pausiert (nach Unterbrechung mit Gehtempo): gross die Plan-Pace, das Gehtempo nur als Hinweis
      var paused = pr.offS <= -3, planS0 = Math.max(0.8, Math.round((pr.sec.s - pr.offS) * 10) / 10);
      var spT = R.pace(paused ? 3600 / planS0 : pr.pace); setT(live, 'sp', spT); $('.spv', live).classList.toggle('sm', spT.length > 4);
      var spl = $('.spl .lab', live), splT = paused ? 'Plan-Pace' : 'Soll-Pace'; if (spl && spl.textContent !== splT) spl.textContent = splT;
      setT(live, 'sps', paused ? 'Plan pausiert · jetzt ' + TX.f1(st.tSpeed) + ' km/h Gehtempo' : st.hold > 0 && st.holdTo > 0 ? 'geplant ' + TX.f1(3600 / pr.pace) + ' km/h · Band ' + TX.f1(st.tSpeed) + ' km/h (Einlaufen)' : 'Soll ' + TX.f1(3600 / pr.pace) + ' km/h · Abschnitt ' + pr.idx + ' von ' + pr.n);
      setT(live, 'ip', st.st === 'LAEUFT' && st.speed >= 1 ? TX.pace(st.speed) : '--:--');
      var d = pr.delta, dl = $('[data-k="dl"]', live), dk = Math.abs(d) < 3 ? 'eq' : d > 0 ? 'bh' : 'ah';
      var dtx = dk === 'eq' ? '<b>im Plan</b><span>±0:00</span>' : '<b>' + R.signTime(d) + '</b><span>' + (d > 0 ? 'hinter Plan' : 'vor Plan') + '</span>';
      if (dl.getAttribute('data-h') !== dtx) { dl.setAttribute('data-h', dtx); dl.innerHTML = dtx; dl.className = 'dl ' + dk; }
      var ee = $('[data-k="etas"]', live), ed = pr.eta - pr.target;
      if (paused) { setT(live, 'eta', TX.NA); ee.textContent = 'Ziel ' + TX.time(pr.target) + ' · nach «Zurück zum Plan»'; ee.className = 'sub'; }   // Gehtempo-Rechnung waere irrefuehrend
      else { setT(live, 'eta', TX.time(pr.eta)); ee.textContent = 'Ziel ' + TX.time(pr.target) + (Math.abs(ed) >= 3 ? ' · ' + R.signTime(ed) : ''); ee.className = 'sub ' + (ed <= 2 ? 'g' : 'o'); }
      setT(live, 'kd', R.km(pr.x)); setT(live, 'kl', 'von ' + R.km(pr.D) + ' · noch ' + R.km(pr.D - pr.x) + ' km');
      setT(live, 'gs', TX.f1(st.tIncl)); setT(live, 'gb', 'Strecke ' + pc(pr.sec.g) + ' %' + (pr.sec.g < -0.75 ? ' · Gefälle flach' : pr.sec.g * (pr.scale || 1) > 15.25 ? ' · höchstens 15 %' : pr.scale === 0.5 ? ' · zur Hälfte' : ''));
      if (nx) {
        setT(live, 'nl', 'Nächster Wechsel');
        setT(live, 'nv', TX.f1(nx.i) + ' %');
        setT(live, 'ns', 'in ' + Math.max(0, Math.round(pr.toNext / 10) * 10) + ' m' + (pr.offS > -3 ? ' · Pace ' + R.pace(3600 / Math.max(0.8, nx.s)) : ''));
      } else { setT(live, 'nl', 'Ziel'); setT(live, 'nv', R.km(pr.D - pr.x) + ' km'); setT(live, 'ns', 'letzter Abschnitt, Ziel in Sicht'); }
      // Versatz zum Plan (Handeingabe) oder Zeit und Puls
      var off = Math.abs(pr.offS) >= 0.05 || Math.abs(pr.offI) >= 0.05, bot = $('[data-k="lbot"]', live), bh;
      if (off) {
        // grosser negativer Versatz (z. B. nach Unterbrechung mit 3 km/h): Plan steht still
        var planS = Math.round((pr.sec.s - pr.offS) * 10) / 10, line1, line2 = '';
        if (pr.offS <= -3) { line1 = 'Gehtempo nach Unterbrechung'; line2 = 'Mit «Zurück zum Plan» geht es mit ' + TX.f1(planS) + ' km/h weiter'; }
        else {
          var parts = [];
          if (Math.abs(pr.offS) >= 0.05) parts.push((pr.offS > 0 ? '+' : '\u2212') + TX.f1(Math.abs(pr.offS)) + ' km/h');
          if (Math.abs(pr.offI) >= 0.05) parts.push((pr.offI > 0 ? '+' : '\u2212') + TX.f1(Math.abs(pr.offI)) + ' % Steigung');
          line1 = 'Plan ' + parts.join(' · ');
          line2 = Math.abs(pr.offI) >= 0.05 ? 'Steigung von Hand bis zum nächsten Wechsel' : 'Tempo von Hand bis «Zurück zum Plan»';
        }
        bh = '<div class="offc' + (pr.offS <= -3 ? ' big' : '') + '"><span class="ot"><b>' + esc(line1) + '</b><small>' + esc(line2) + '</small></span><button class="btn lite" data-v="replan">' + I('repeat') + ' Zurück zum Plan</button></div>';
      } else bh = '<div class="tz"><span><span class="lab">Zeit</span><b class="num">' + TX.time(pr.t) + '</b></span><span><span class="lab" style="color:var(--hr)">Puls</span><b class="num" style="color:var(--hr)">' + (st.hr > 0 ? st.hr : TX.NA) + '</b><small>bpm</small></span>' +
        '<span><span class="lab">Höhe</span><b class="num">' + pr.ele + '</b><small>m</small></span>' + ghostSpan(st) + '</div>';
      if (bot.getAttribute('data-h') !== bh) { bot.setAttribute('data-h', bh); bot.innerHTML = bh; TX.fixGap(bot); }
    }

    function head(st) {
      var pr = isMine(st) ? st.prog : null;
      setT(root, 'title', r ? r.name : loadErr ? 'Strecke' : 'Strecke wird geladen');
      TX.stChip(root.querySelector('[data-k="stc"]'), st);
      var pw = $('[data-k="pw"]', root), live = pr && TX.busy(st);
      pw.hidden = !r;
      if (r) {
        var x = live ? pr.x : 0, D = pr ? pr.D : r.d;
        $('[data-k="pbar"]', root).style.width = (D ? x / D * 100 : 0).toFixed(2) + '%';
        setT(root, 'pt', 'km ' + R.km(x) + ' von ' + R.km(D));
        setT(root, 'sub', live ? (pr.finish ? 'Ziel erreicht' : 'Ziel ' + TX.time(pr.target) + ' · Zeit ' + TX.time(pr.t)) : [r.ort, R.km(r.d) + ' km', '+' + Math.round(r.up) + ' m', '\u2212' + Math.round(r.down) + ' m', R.ART[r.art]].filter(Boolean).join(' · '));
      } else setT(root, 'sub', loadErr ? '' : 'Strecke wird geladen');
      TX.headAct(root, st.st === 'BEREIT' && pr ? { k: 'discard', html: '<button class="btn ghost" data-v="discard">' + I('x') + ' Verwerfen</button>' } : null);
    }

    var view = {
      el: root, needHist: true,
      update: function (st) {
        if (!st) return; lastSt = st;
        // anderes Programm laeuft: dorthin
        if (TX.busy(st) && st.prog && !isMine(st)) { TX.go(TX.trainHash(st), true); return; }
        var want = loadErr ? 'err' : !r ? 'wait' : isMine(st) && (TX.busy(st) || st.st === 'FEHLER' && st.elapsed > 0) ? 'run' : 'plan';
        if (want !== mode) {
          mode = want; lastProfK = ''; lastBarK = '';
          if (map) { map.destroy(); map = null; mapMode = ''; }
          if (want === 'err') { main.className = 'main'; main.innerHTML = '<div class="hempty">' + esc(loadErr) + '<a class="btn ghost" href="#/strecken">Zu den Strecken</a></div>'; }
          else if (want === 'wait') { main.className = 'main'; main.innerHTML = '<div class="empty">Strecke wird geladen</div>'; }
          else if (want === 'plan') renderPlan(); else renderRun();
        }
        head(st);
        if (mode === 'plan') updPlan(st); else if (mode === 'run') updRun(st);
        cb.update(st);
      },
      mounted: function () { if (map) map.resize(); },
      destroy: function () { cb.destroy(); clearTimeout(reloadT); if (map) map.destroy(); map = null; }
    };
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v],[data-mode],[data-sc],[data-sg]'); if (!b || b.disabled) return;
      if (b.hasAttribute('data-mode')) { cfg.mode = b.getAttribute('data-mode'); changed(); return; }
      if (b.hasAttribute('data-sc')) { cfg.scale = +b.getAttribute('data-sc'); changed(); return; }
      if (b.hasAttribute('data-sg')) { cfg.target = +b.getAttribute('data-sg'); changed(); return; }
      var v = b.getAttribute('data-v');
      if (v === 'back') TX.go(TX.busy(api.state) ? '#/' : '#/strecken');
      else if (v === 'fit' && map) map.fit();
      else if (v === 'fol' && map) map.follow(true);
      else if (v === 'replan') TX.cmd('routeOffset', { s: 0, i: 0 });
      else if (v === 'discard') TX.cmd('clearProgram').then(function (res) { if (res.ok) { sentKey = wantKey(); TX.go('#/strecken'); } });
      else if (v === 'tiles' && r) R.prefetch(R.tileSrc(r), r.pts).then(function (res) { TX.toast(res && res.busy ? 'Karte wird später geladen' : res && res.ok !== false ? 'Karte wird geladen' : 'Karte nicht geladen: ' + (res && res.error || '')); });
    });
    return view;
  };
})();
