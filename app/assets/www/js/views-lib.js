/* Seiten ohne Steuerleiste: Start, Pläne, Editor, Apps, Abschluss, Verlauf. */
(function () {
  'use strict';
  var TX = window.TX, I = TX.I, esc = TX.esc, $ = TX.$, $$ = TX.$$;

  /* ---------- Apps ---------- */
  function mono(ch) { return '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="18" text-anchor="middle" font-size="18" font-weight="900" fill="#fff" font-family="Roboto,sans-serif">' + ch + '</text></svg>'; }
  // Untertitel: was hinter der App steckt; Punkte: nur was sie kann (keine Einschraenkungen). Bilder: img/apps (16:9, ohne Text)
  TX.APPS = [
    { pkg: 'app.revanced.android.youtube', alt: 'org.smarttube.stable', name: 'YouTube', sub: 'Videos mit deinem Google-Konto', bg: 'linear-gradient(135deg,#ff5f6d,#b0186e)', ic: function () { return I('play', 1); },
      prev: 'img/apps/youtube.jpg', pos: 'center',
      pts: ['Echte YouTube-App mit Touch', 'Vollbild ohne Herstellerleiste', 'Pille über den Reitern der App'] },
    { pkg: 'app.revanced.android.apps.youtube.music', name: 'YouTube Music', sub: 'Musik und Playlists mit deinem Google-Konto', bg: 'linear-gradient(135deg,#ff5f6d,#b0186e)', ic: function () { return I('music'); },
      prev: 'img/apps/ytmusic.jpg', pos: 'center',
      pts: ['Musik, Playlists und Mixe', 'läuft im Hintergrund weiter', 'Mini-Player im Kopf'] },
    { pkg: 'org.jellyfin.mobile', name: 'Jellyfin', sub: 'Filme, Serien und Live-TV vom Heimserver', bg: 'linear-gradient(135deg,#aa5cc3,#00a4dc)', ic: function () { return I('tv'); },
      prev: 'img/apps/jellyfin.jpg', pos: 'center',
      pts: ['Filme und Serien vom eigenen Server', 'Live-TV mit Programmführer', 'Pille und Live-Verlauf darüber'] },
    { pkg: 'com.kinomap.training', name: 'Kinomap', sub: 'Videostrecken aus aller Welt', bg: '#ff6a00', ic: function () { return mono('K'); }, prev: 'img/apps/kinomap.jpg', pos: 'center',
      pts: ['Videostrecken weltweit', 'Laufband per Bluetooth verbunden', 'Menü und Musik von unten'] },
    { pkg: 'com.zwift.zwiftgame', name: 'Zwift', sub: 'Laufen in virtuellen Welten', bg: '#fc6719', ic: function () { return mono('Z'); }, prev: 'img/apps/zwift.jpg', pos: 'center',
      pts: ['Virtuelle Laufwelten', 'Laufband per Bluetooth verbunden', 'Menü und Musik von unten'] },
    { pkg: 'com.audiobookshelf.app', name: 'Hörbücher', sub: 'Audiobookshelf vom Heimserver', bg: '#1f6b5a', ic: function () { return I('music'); }, prev: 'img/apps/hoerbuecher.jpg', pos: 'center',
      pts: ['Bibliothek vom eigenen Server', 'läuft im Hintergrund weiter', 'Steuerung bleibt im Vollbild'] }
  ];
  TX.appList = function () {
    var inst = TX.native.installed();
    return TX.APPS.map(function (a) {
      var ok = inst ? inst.indexOf(a.pkg) >= 0 : true;
      if (!ok && a.alt && inst && inst.indexOf(a.alt) >= 0) { var c = {}; for (var k in a) c[k] = a[k]; c.pkg = a.alt; return { a: c, ok: true }; }
      return { a: a, ok: ok };
    }).filter(function (x) { return !x.a.optional || (x.ok && TX.native.installed()); });
  };
  /* App-Symbol: echtes Symbol der Konsole (TreadNative.icon), sonst Platzhalter (Buchstabe oder Strichsymbol auf App-Farbe).
     cls: lg (Startseite, App-Hub) oder phlg (grosses Symbol in der Platzhalter-Vorschau); gerundet ueber die Klasse. */
  TX.appIcon = function (a, cls, tag) {
    var u = TX.native.icon(a.pkg), t = tag || 'div';
    return u ? '<' + t + ' class="' + cls + ' real"><img src="' + u + '" alt=""></' + t + '>' :
      '<' + t + ' class="' + cls + '" style="background:' + a.bg + '">' + a.ic() + '</' + t + '>';
  };
  TX.launch = function (pkg) {
    var a = TX.APPS.filter(function (x) { return x.pkg === pkg; })[0], nm = a ? a.name : pkg;
    var inst = TX.native.installed();
    if (inst && inst.indexOf(pkg) < 0) { TX.toast(nm + ' ist nicht installiert'); return; }
    var r = TX.native.launch(pkg);
    if (r === 'demo') TX.toast('Demo: würde ' + nm + ' öffnen');
    else if (!r) TX.toast(nm + ' konnte nicht geöffnet werden');
  };

  function stepPts(segs, key) {
    var t = 0, pts = [];
    segs.forEach(function (s) { pts.push([t, s[key]]); t += s.d; });
    return { pts: pts, end: t };
  }
  function planChart(el, p, opt) {
    opt = opt || {};
    // Belastung/Intervall orange, Zonen blau, Huegel gelb (Steigung), Ziel gruen
    var col = { interval: '#ff7a1a', zones: '#3d8bff', huegel: '#ffd43b', ziel: '#2fd27a' }[p.type] || '#3d8bff';
    if (p.type === 'zones') {
      var z = p.zone, pts = [], n = 24;
      for (var i = 0; i <= n; i++) pts.push([i, z.s0 + (i < 3 ? (i - 3) * 0.4 : 0.25 * Math.sin(i / 2))]);
      TX.chart(el, [{ pts: pts, min: 0, max: 14, c: col, dot: false, wd: 2.2, fill: opt.fill }], { pad: 4 });
      return;
    }
    var segs = TX.expand(p), sp = stepPts(segs, p.type === 'huegel' ? 'i' : 's');
    TX.chart(el, [{ pts: sp.pts, min: 0, max: p.type === 'huegel' ? 12 : 14, c: col, step: true, stepEnd: sp.end, dot: false, wd: opt.wd || 2.2, fill: opt.fill }], { pad: 4, xMin: 0, xMax: sp.end });
  }
  TX.planChart = planChart;

  /* ================= Start ================= */
  TX.views.home = function () {
    var root = document.createElement('div'); root.className = 'screen v-home';
    var pr = TX.profile(), hr = new Date().getHours(), greet = hr < 5 ? 'Gute Nacht' : hr < 11 ? 'Guten Morgen' : hr < 17 ? 'Guten Tag' : 'Guten Abend';
    var np = TX.nextPlan(), today = np && np.days.indexOf(new Date().getDay()) >= 0, ps = np ? TX.planStats(np) : null;
    var runs = TX.runs(), last = runs[0], wk = TX.weekStats(Date.now()), apps = TX.appList().filter(function (x) { return !x.a.optional && x.ok; });
    root.innerHTML = TX.headHtml('Start') + '<main class="body">' +
      '<section class="card hero"><div class="ph"></div><div class="shade"></div>' +
      '<div class="lab" style="color:var(--inc)">' + greet + ', ' + esc(pr.name.split(' ')[0]) + '</div><h1 data-k="h1">Bereit für deinen Lauf?</h1>' +
      '<p data-k="sub">' + (np ? (today ? 'Heute im Plan: ' : 'Vorschlag: ') + '<b style="color:#fff">' + esc(TX.nm(np.name)) + '</b> · ' + Math.round(ps.dur / 60) + ' min · ca. ' + TX.km(ps.dist) + ' km' : 'Noch keine Vorlage angelegt') + '</p>' +
      '<div class="row" data-k="acts"></div>' +
      '<div class="last">' + (last ? '<div><div class="lab">Letzter Lauf</div><div class="num">' + TX.km(last.dist) + ' <small>km</small></div></div>' +
        '<div><div class="lab">Dauer</div><div class="num">' + TX.time(last.elapsed) + '</div></div>' +
        '<div><div class="lab">Ø Puls</div><div class="num" style="color:var(--hr)">' + (last.avgHr || TX.NA) + '</div></div>' : '<div><div class="lab">Letzter Lauf</div><div class="num">' + TX.NA + '</div></div>') +
      '<div><div class="lab">' + wk.label + '</div><div class="num">' + TX.km(wk.km) + ' <small>km</small></div></div></div></section>' +
      '<div class="right">' +
      '<a class="card mode" href="#/run"><div class="ic" style="background:rgba(61,139,255,.15);color:var(--spd)">' + I('bolt') + '</div><div class="vis" data-k="v1"></div><h2>Schnellstart</h2><p>Sofort loslaufen, Tempo frei wählen</p></a>' +
      '<a class="card mode" href="#/plans?f=interval"><div class="ic" style="background:rgba(255,122,26,.15);color:var(--warn)">' + I('intervals') + '</div><div class="vis" data-k="v2"></div><h2>Intervalle</h2><p>Belastung und Erholung im Wechsel</p></a>' +
      '<a class="card mode" href="#/zones"><div class="ic" style="background:rgba(255,77,94,.15);color:var(--hr)">' + I('zones') + '</div><div class="vis zvis" aria-hidden="true">' +
      '<i style="height:16px;background:var(--z1)"></i><i style="height:24px;background:var(--z2)"></i><i style="height:32px;background:var(--z3)"></i><i style="height:40px;background:var(--z4)"></i><i style="height:46px;background:var(--z5);opacity:.5"></i></div><h2>Zonentraining</h2><p>Tempo folgt deinem Puls</p></a>' +
      '<a class="card mode rmode" href="#/strecken"><div class="ic" style="background:rgba(34,197,201,.15);color:var(--route)">' + I('route') + '</div><div class="vis" data-k="v3" aria-hidden="true"></div><h2>Strecken</h2><p>GPX-Strecken 1:1 nachlaufen, mit Karte und Höhenprofil</p></a>' +
      '<a class="card mode" href="#/plans"><div class="ic" style="background:rgba(47,210,122,.15);color:var(--go)">' + I('plans') + '</div><span class="chip chipv">' + TX.plans().length + ' Vorlagen</span><h2>Trainingspläne</h2><p>Vorlagen anlegen, verwalten, starten</p></a>' +
      '</div><div class="apps" role="group" aria-label="Apps">' + apps.map(function (x) {
        var a = x.a;
        return '<button class="app" data-g="launch" data-pkg="' + a.pkg + '">' + TX.appIcon(a, 'lg') + '<div><b>' + esc(a.name) + '</b><span class="sub">' + esc(a.sub) + '</span></div></button>';
      }).join('') + (apps.length ? '' : '<a class="app" href="#/apps"><div class="lg" style="background:var(--s3)">' + I('apps') + '</div><div><b>Apps einrichten</b><span class="sub">noch keine App installiert</span></div></a>') + '</div></main>';
    var mode = '';
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      var v = b.getAttribute('data-v');
      if (v === 'plan') TX.loadPlan(TX.nextPlan());
      if (v === 'repeat') {
        var r = TX.runs()[0]; if (!r) return;
        var p = TX.runToPlan(r); p.id = 'wiederholung'; p.name = 'Wiederholung: ' + r.name;
        var st = TX.api.state;
        if (st && st.st !== 'BEREIT') { TX.toast('Erst den laufenden Lauf beenden'); return; }
        var prog = TX.toProgram(p);
        TX.cmd('program', { p: prog }).then(function (res) { if (res.ok) { TX.setActive(p, prog); TX.go('#/interval/wiederholung'); } });
      }
    });
    return {
      el: root,
      mounted: function () {
        var V = [], i;
        for (i = 0; i < 60; i++) V.push([i, i < 8 ? 4 + i * 0.8 : 10.5 + 1.6 * Math.sin(i / 9) + 0.25 * Math.sin(i * 1.7)]);
        TX.chart($('[data-k="v1"]', root), [{ pts: V, min: 0, max: 14, c: '#3d8bff', dot: false, wd: 2 }], { pad: 4 });
        var S = []; for (i = 0; i < 40; i++) S.push([i, (Math.floor(i / 5) % 2) ? 3 : 9]);
        TX.chart($('[data-k="v2"]', root), [{ pts: S, min: 0, max: 10, c: '#ff7a1a', step: true, dot: false, wd: 2 }], { pad: 4 });
        // Strecken: Hoehenprofil als Linie mit Verlaufsflaeche in der Streckenfarbe (wie die Schnellstart-Grafik)
        var E = [20, 22, 21, 26, 34, 40, 37, 31, 28, 30, 38, 49, 56, 52, 44, 36, 33, 35, 31, 26, 24, 22, 21, 20].map(function (v, k) { return [k, v]; });
        TX.chart($('[data-k="v3"]', root), [{ pts: E, min: 10, max: 60, c: TX.ROUTE_C, dot: false, wd: 2 }], { pad: 4 });
      },
      update: function (st) {
        TX.updHead(root, st);
        var m = TX.busy(st) ? 'busy' : 'ready';
        var h = $('[data-k="h1"]', root), sb = $('[data-k="sub"]', root);
        if (!h.hasAttribute('data-r')) { h.setAttribute('data-r', h.innerHTML); sb.setAttribute('data-r', sb.innerHTML); }   // Text fuer «bereit»
        if (m === 'busy' && st) {
          var t1 = st.st === 'PAUSE' ? 'Lauf pausiert' : st.st === 'FEHLER' ? 'Lauf unterbrochen' : 'Lauf läuft',
            t2 = TX.time(st.elapsed || 0) + ' · ' + TX.km(st.dist || 0) + ' km' + (st.prog && st.prog.name ? ' · ' + esc(TX.nm(st.prog.name)) : '');
          if (h.textContent !== t1) h.textContent = t1;
          if (sb.innerHTML !== t2) sb.innerHTML = t2;
        }
        if (m !== mode) {
          mode = m;
          // im Lauf nicht «Bereit für deinen Lauf?»: Titel und Zeile zeigen den laufenden Lauf
          var h1 = $('[data-k="h1"]', root), sub = $('[data-k="sub"]', root);
          if (m !== 'busy') { h1.innerHTML = h1.getAttribute('data-r'); sub.innerHTML = sub.getAttribute('data-r'); }
          $('[data-k="acts"]', root).innerHTML = m === 'busy' ? '<a class="btn go" href="#/training">' + I('run') + ' Zum laufenden Training</a>' :
            '<button class="btn go" data-v="plan"' + (np ? '' : ' disabled') + '>' + I('play', 1) + ' Plan starten</button>' +
            // ohne Verlauf gibt es nichts zu wiederholen: dann Schnellstart statt eines toten Knopfs
            (runs.length ? '<button class="btn ghost" data-v="repeat">' + I('hist') + ' Letzten Lauf wiederholen</button>' : '<a class="btn ghost" data-v="quick" href="#/run">' + I('bolt') + ' Schnellstart</a>');
        }
      }
    };
  };

  /* ================= Pläne ================= */
  var FIL = [['alle', 'Alle'], ['interval', 'Intervall'], ['zones', 'Zonen'], ['huegel', 'Hügel'], ['ziel', 'Ziel'], ['test', 'Test'], ['fav', 'Favoriten']];
  TX.views.plans = function (prm, q) {
    var root = document.createElement('div'); root.className = 'screen v-plans';
    var f = q.f && FIL.some(function (x) { return x[0] === q.f; }) ? q.f : 'alle', sel = q.sel || null;
    root.innerHTML = TX.headHtml('Pläne') + '<main class="body"><h1 class="sr">Trainingspläne</h1><div class="lib"><div class="filters" role="group" aria-label="Filter" data-k="fil"></div><div class="grid" data-k="grid"></div></div>' +
      '<section class="card det" data-k="det" aria-label="Gewählte Vorlage"></section></main>';
    function list() {
      return TX.plans().filter(function (p) { return f === 'alle' || (f === 'fav' ? p.fav : p.type === f); });
    }
    // «Zuletzt» aus dem Verlauf: juengster Lauf mit gleicher planId bzw. gleichem Namen, sonst «--»
    function lastTxt(p, runs) { var r = TX.lastRunOf(p, runs); return r ? TX.dshort(r.ts) : TX.NA; }
    function renderGrid() {
      var all = TX.plans(), l = list(), runs = TX.runs();
      $('[data-k="fil"]', root).innerHTML = FIL.map(function (x) {
        return '<a href="#/plans?f=' + x[0] + '" class="' + (x[0] === f ? 'on' : '') + '"' + (x[0] === f ? ' aria-current="true"' : '') + '>' + (x[0] === 'fav' ? I('star') + ' ' : '') + x[1] + (x[0] === 'alle' ? ' ' + all.length : '') + '</a>';
      }).join('');
      if (!sel || !l.some(function (p) { return p.id === sel; })) sel = l.length ? l[0].id : null;
      $('[data-k="grid"]', root).innerHTML = l.map(function (p) {
        var s = TX.planStats(p);
        return '<button class="card tpl' + (p.id === sel ? ' sel' : '') + '" data-id="' + esc(p.id) + '" aria-pressed="' + (p.id === sel) + '"><span class="tp t-' + p.type + '">' + TX.TYPES[p.type].toUpperCase() + '</span>' +
          (p.fav ? '<span class="fav">' + I('star', 1) + '<span class="sr">Favorit</span></span>' : '') +
          '<div class="mini" data-m="' + esc(p.id) + '"></div><h2>' + esc(TX.nm(p.name)) + '</h2><div class="meta"><span>' + Math.round(s.dur / 60) + ' min</span><span>' + TX.km(s.dist) + ' km</span>' +
          '<span class="ls" data-k="last">zuletzt ' + lastTxt(p, runs) + '</span></div></button>';
      }).join('') + '<div class="card tpl new"><a class="nv" href="#/plans/edit/neu"><span style="font-size:30px;display:flex">' + I('plus') + '</span><b>Neue Vorlage</b></a>' +
        (TX.runs().length ? '<a class="fl" href="#/plans/edit/lauf">oder aus letztem Lauf übernehmen</a>' : '<span style="font-size:13px">oder später aus einem Lauf</span>') + '</div>';
      requestAnimationFrame(function () { l.forEach(function (p) { var m = root.querySelector('[data-m="' + p.id + '"]'); if (m) planChart(m, p); }); });
      renderDet();
    }
    function renderDet() {
      var p = sel ? TX.plan(sel) : null, det = $('[data-k="det"]', root);
      if (!p) { det.innerHTML = '<div class="empty">Keine Vorlage in diesem Filter</div>'; return; }
      var s = TX.planStats(p), days = p.days.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); }).map(function (d) { return TX.WD2[d]; });
      var tc = { interval: 'color:#ff9a52;background:rgba(255,122,26,.12)', zones: 'color:#6ea8ff;background:rgba(61,139,255,.12)', huegel: 'color:var(--inc);background:rgba(255,212,59,.1)', ziel: 'color:var(--go);background:rgba(47,210,122,.1)', test: 'color:#ff6b7a;background:rgba(255,77,94,.12)' }[p.type];
      var rows = '', mix = '';
      if (p.type === 'zones') {
        var zs = TX.zones()[p.zone.z - 1];
        rows = '<div class="sg"><span class="c" style="background:' + TX.ZC[p.zone.z] + '"></span><b>' + TX.zoneName(p.zone.z) + '</b><div class="v"><span><b>' + zs.txt + '</b> bpm</span><span><b>' + TX.time(p.zone.dur) + '</b></span></div></div>' +
          '<div class="sg"><span class="c" style="background:var(--spd)"></span><b>Tempo</b><div class="v"><span><b>' + TX.f1(p.zone.sMin) + '</b> bis <b>' + TX.f1(p.zone.sMax) + '</b> km/h</span><span>Start <b>' + TX.f1(p.zone.s0) + '</b></span></div></div>' +
          '<div class="sg"><span class="c" style="background:var(--inc)"></span><b>Steigung</b><div class="v"><span><b>' + TX.f1(p.zone.i) + '</b> %</span></div></div>';
      } else {
        var sH = false, stN = 0;
        var seg = function (x, all, idx, inb) {
          // Test: Belastungen heissen «Stufe N»
          var lb = x.k === 'w' ? (sH ? 'Auslaufen' : 'Einlaufen') : TX.isTest(p) && x.k === 'h' ? 'Stufe ' + (++stN) : TX.KIND[x.k]; if (x.k === 'h') sH = true;
          return '<div class="sg' + (inb ? ' in' : '') + '"><span class="c" style="background:' + TX.KC[x.k] + '"></span><b>' + lb + '</b>' +
            '<div class="v"><span><b>' + TX.time(x.d) + '</b></span><span><b>' + TX.f1(x.s) + '</b> km/h</span><span><b>' + TX.f1(x.i) + '</b> %</span></div></div>';
        };
        // Zeitanteile je Art; Balken und Legende in derselben Reihenfolge (Ein-/Auslaufen, Belastung, Erholung)
        var kt = { w: 0, h: 0, r: 0 }, KO = ['w', 'h', 'r'];
        s.segs.forEach(function (x) { kt[x.k] += x.d; });
        mix = '<div class="mix"><div class="lab">Zeitanteile</div><div class="mbar">' + KO.map(function (k) { return kt[k] ? '<i style="flex:' + kt[k] + ';background:' + TX.KC[k] + '"></i>' : ''; }).join('') + '</div>' +
          '<div class="mleg">' + KO.map(function (k) { return kt[k] ? '<span><i style="background:' + TX.KC[k] + '"></i>' + TX.KIND[k] + ' <b>' + TX.time(kt[k]) + '</b> · ' + Math.round(kt[k] / s.dur * 100) + ' %</span>' : ''; }).join('') + '</div></div>';
        p.items.forEach(function (it, k) {
          if (it.rep) { rows += '<div class="sg rep"><span style="font-weight:800;color:var(--inc)">' + it.rep + ' ×</span><span class="mut">Block wiederholen</span></div>'; it.items.forEach(function (x) { rows += seg(x, p.items, 1, true); }); }
          else rows += seg(it, p.items, k, false);
        });
      }
      det.innerHTML = '<div style="display:flex;gap:8px;align-items:center"><span class="chip" style="' + tc + '">' + TX.TYPES[p.type].toUpperCase() + '</span>' +
        (days.length ? '<span class="chip">Im Wochenplan: ' + days.join(', ') + '</span>' : '') +
        '<button class="favb' + (p.fav ? ' on' : '') + '" data-v="fav" aria-pressed="' + p.fav + '" aria-label="Favorit">' + I('star', p.fav) + '</button></div>' +
        '<h2>' + esc(TX.nm(p.name)) + '</h2><div class="mut" style="font-size:14px">' + esc(p.desc || '') + '</div>' +
        '<div class="kp"><div><div class="lab">Dauer</div><div class="num">' + TX.time(s.dur) + '</div></div><div><div class="lab">Distanz ca.</div><div class="num">' + TX.km(s.dist) + ' <small>km</small></div></div>' +
        '<div><div class="lab">Max Tempo</div><div class="num">' + TX.f1(s.maxS) + ' <small>km/h</small></div></div><div><div class="lab">Zuletzt</div><div class="num" data-k="dlast">' + lastTxt(p) + '</div></div></div>' +
        '<div class="chart dprof" data-k="prof"></div><div class="segwrap" data-k="sw"><div class="seglist" tabindex="0" aria-label="Abschnitte">' + rows + '</div></div>' + mix +
        '<div class="acts"><button class="btn go" data-v="start">' + I('play', 1) + ' Starten</button><a class="btn ghost" href="#/plans/edit/' + esc(p.id) + '">' + I('edit') + ' Bearbeiten</a>' +
        '<button class="btn ghost" data-v="dup">' + I('copy') + ' Duplizieren</button></div>';
      requestAnimationFrame(function () { var el = $('[data-k="prof"]', root); if (el) planChart(el, p, { fill: 0.35, wd: 2.4 }); fade(); });
      setTimeout(fade, 150);
      $('.seglist', det).addEventListener('scroll', fade);
    }
    // Ausblendverlauf als Scrollhinweis: unten, solange noch Abschnitte folgen; oben, sobald gescrollt
    function fade() {
      var w = $('[data-k="sw"]', root); if (!w) return;
      var l = w.firstChild;
      w.classList.toggle('more', l.scrollTop + l.clientHeight < l.scrollHeight - 2);
      w.classList.toggle('less', l.scrollTop > 2);
    }
    root.addEventListener('click', function (e) {
      var c = e.target.closest('[data-id]');
      if (c) { sel = c.getAttribute('data-id'); $$('.tpl[data-id]', root).forEach(function (x) { var on = x.getAttribute('data-id') === sel; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on); }); renderDet(); return; }
      var b = e.target.closest('[data-v]'); if (!b) return;
      var v = b.getAttribute('data-v'), p = TX.plan(sel); if (!p) return;
      if (v === 'start') TX.loadPlan(p);
      if (v === 'fav') { p.fav = !p.fav; TX.putPlan(p); renderGrid(); }
      if (v === 'dup') { var cp = JSON.parse(JSON.stringify(p)); cp.id = TX.uid('p'); cp.name = (p.name + ' Kopie').slice(0, 60); TX.putPlan(cp); sel = cp.id; renderGrid(); TX.toast('Kopie angelegt'); }
    });
    renderGrid();
    return { el: root, update: function (st) { TX.updHead(root, st); } };
  };

  /* ================= Editor ================= */
  TX.views.edit = function (prm) {
    var id = prm[0] || 'neu', isNew = false, w;
    if (id === 'neu') { isNew = true; w = { id: TX.uid('p'), name: 'Neue Vorlage', type: 'interval', desc: '', fav: false, days: [], items: [{ d: 300, s: 8, i: 1, k: 'w' }, { d: 240, s: 12, i: 1, k: 'h' }, { d: 300, s: 7, i: 0, k: 'w' }] }; }
    else if (id === 'lauf') { var r0 = TX.runs()[0]; isNew = true; w = r0 ? TX.runToPlan(r0) : null; }
    else w = TX.plan(id);
    var root = document.createElement('div'); root.className = 'screen v-edit';
    if (!w) {
      root.innerHTML = TX.headHtml('Pläne') + '<main class="body"><div class="hempty">Vorlage nicht gefunden<a class="btn ghost" href="#/plans">Zu den Plänen</a></div></main>';
      return { el: root, update: function (st) { TX.updHead(root, st); } };
    }
    w = JSON.parse(JSON.stringify(w));
    if (!w.items) w.items = [{ d: 600, s: 8, i: 1, k: 'w' }];
    if (!w.zone) w.zone = { z: 2, dur: 2700, s0: 8, sMin: 6, sMax: 10.5, i: 1 };
    var delArm = 0;
    root.innerHTML = TX.headHtml('Pläne') + '<main class="body"><h1 class="sr">Vorlage bearbeiten</h1>' +
      '<div class="erow"><label class="sr" for="ename">Name der Vorlage</label><input id="ename" class="name" maxlength="60" value="' + esc(TX.nm(w.name)) + '" autocomplete="off">' +
      '<div class="seg typ" role="group" aria-label="Typ">' + Object.keys(TX.TYPES).map(function (t) { return '<button data-t="' + t + '">' + TX.TYPES[t] + '</button>'; }).join('') + '</div></div>' +
      '<div class="erow"><span class="lab">Wochenplan</span><div class="days" role="group" aria-label="Wochenplan">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<button data-day="' + d + '" title="' + TX.WD[d] + '">' + TX.WD2[d] + '</button>'; }).join('') + '</div>' +
      '<button class="favb" data-e="fav" aria-label="Favorit" style="margin-left:6px"></button><div class="ekp" data-k="kp"></div></div>' +
      '<div class="epv chart" data-k="pv" aria-hidden="true"></div><div class="elist" data-k="list"></div>' +
      '<div class="eacts" data-k="acts"></div></main>';
    var list = $('[data-k="list"]', root);
    function ref(path) {
      var a = String(path).split('.').map(Number);
      if (a.length === 1) return { arr: w.items, i: a[0] };
      return { arr: w.items[a[0]].items, i: a[1] };
    }
    function stp(f, lab, val, unit, path) {
      return '<div class="stp"><button data-f="' + f + '" data-p="' + path + '" data-d="-1" aria-label="' + lab + ' verringern">' + I('minus') + '</button><div class="val"><div class="lab">' + lab + '</div><b><span data-v="' + f + path + '">' + val + '</span><small>' + unit + '</small></b></div>' +
        '<button data-f="' + f + '" data-p="' + path + '" data-d="1" aria-label="' + lab + ' erhöhen">' + I('plus') + '</button></div>';
    }
    function tools(path, n, i) {
      return '<div class="tools"><button class="ebtn" data-e="up" data-p="' + path + '" aria-label="Nach oben"' + (i === 0 ? ' disabled' : '') + '>' + I('up') + '</button>' +
        '<button class="ebtn" data-e="down" data-p="' + path + '" aria-label="Nach unten"' + (i === n - 1 ? ' disabled' : '') + '>' + I('down') + '</button>' +
        '<button class="ebtn del" data-e="del" data-p="' + path + '" aria-label="Löschen">' + I('trash') + '</button></div>';
    }
    var seenH = false;
    function segRow(x, path, n, i, inb) {
      var lab = x.k === 'w' ? (seenH ? 'Auslaufen' : 'Einlaufen') : TX.KIND[x.k];
      if (x.k === 'h') seenH = true;
      return '<div class="er' + (inb ? ' in' : '') + '"><button class="kind" data-e="kind" data-p="' + path + '" title="Art wechseln"><i style="background:' + TX.KC[x.k] + '"></i>' + lab + '</button>' +
        stp('d', 'Dauer', TX.time(x.d), '', path) + stp('s', 'Tempo', TX.f1(x.s), 'km/h', path) + stp('i', 'Steigung', TX.f1(x.i), '%', path) + tools(path, n, i) + '</div>';
    }
    function renderList() {
      $$('[data-t]', root).forEach(function (b) { var on = b.getAttribute('data-t') === w.type; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      $$('[data-day]', root).forEach(function (b) { var on = w.days.indexOf(+b.getAttribute('data-day')) >= 0; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      var fb = $('[data-e="fav"]', root); fb.className = 'favb' + (w.fav ? ' on' : ''); fb.innerHTML = I('star', w.fav); fb.setAttribute('aria-pressed', w.fav);
      var h = '';
      if (w.type === 'zones') {
        var z = w.zone, zs = TX.zones();
        h = '<div class="zedit"><div class="zsel" role="group" aria-label="Zielzone" style="margin-top:0">' + zs.map(function (x) {
          return '<button data-z="' + x.z + '" class="' + (x.z === z.z ? 'on' : '') + '" aria-pressed="' + (x.z === z.z) + '"><b style="color:' + TX.ZT[x.z] + '">Z' + x.z + '</b><span>' + x.txt + ' bpm</span></button>';
        }).join('') + '</div><div class="srow">' + stp('zdur', 'Dauer', Math.round(z.dur / 60), 'min', 'z') + stp('zs0', 'Starttempo', TX.f1(z.s0), 'km/h', 'z') + stp('zsMin', 'Tempo min', TX.f1(z.sMin), 'km/h', 'z') +
          stp('zsMax', 'Tempo max', TX.f1(z.sMax), 'km/h', 'z') + stp('zi', 'Steigung', TX.f1(z.i), '%', 'z') + '</div>' +
          '<div class="mut" style="font-size:14px">Die Automatik im Dienst hält den Puls im Zielband: langsamer sofort, schneller nur bei stabilem Signal, in den ersten 5 min nie schneller.</div></div>';
      } else {
        var n = w.items.length; seenH = false;
        w.items.forEach(function (it, i) {
          if (it.rep) {
            h += '<div class="er rep"><span class="rl">' + I('repeat') + ' Block</span>' + stp('rep', 'Anzahl', it.rep, '×', String(i)) +
              '<button class="btn ghost" data-e="addin" data-p="' + i + '">' + I('plus') + ' Abschnitt im Block</button>' + tools(String(i), n, i) + '</div>';
            it.items.forEach(function (x, j) { h += segRow(x, i + '.' + j, it.items.length, j, true); });
          } else h += segRow(it, String(i), n, i, false);
        });
      }
      list.innerHTML = h;
      $$('[data-f]', list).forEach(function (b) { TX.holdRepeat(b, function (cnt) { change(b, cnt); }); });
      $('[data-k="acts"]', root).innerHTML = (w.type === 'zones' ? '' : '<button class="btn ghost" data-e="add">' + I('plus') + ' Abschnitt</button><button class="btn ghost" data-e="addblock">' + I('repeat') + ' Wiederholblock</button>') +
        '<span class="grow"></span>' + (isNew ? '' : '<button class="btn ghost" data-e="delplan" style="color:#ff7884">' + I('trash') + ' Löschen</button>') +
        '<a class="btn ghost" href="#/plans?sel=' + esc(isNew ? '' : w.id) + '">Abbrechen</a><button class="btn go" data-e="save">' + I('check') + ' Speichern</button>';
      refresh();
    }
    function change(b, cnt) {
      var f = b.getAttribute('data-f'), d = +b.getAttribute('data-d'), path = b.getAttribute('data-p'), L = TX.LIM, txt;
      if (path === 'z') {
        var z = w.zone;
        if (f === 'zdur') { z.dur = TX.clamp(z.dur + d * (cnt > 8 ? 300 : 60), 300, 14400); txt = String(Math.round(z.dur / 60)); }
        else if (f === 'zi') { z.i = TX.clamp(TX.r1(z.i + d * 0.5), L.iMin, L.iMax); txt = TX.f1(z.i); }
        else { var k = f.slice(1); z[k] = TX.clamp(TX.r1(z[k] + d * 0.5), L.sMin, L.sMax); if (z.sMax < z.sMin) { if (k === 'sMin') z.sMax = z.sMin; else z.sMin = z.sMax; } z.s0 = TX.clamp(z.s0, z.sMin, z.sMax); }
        ['zs0', 'zsMin', 'zsMax'].forEach(function (kk) { var e = list.querySelector('[data-v="' + kk + 'z"]'); if (e) e.textContent = TX.f1(z[kk.slice(1)]); });
        if (txt != null) list.querySelector('[data-v="' + f + 'z"]').textContent = txt;
        refresh(); return;
      }
      var r = ref(path), x = r.arr[r.i];
      if (f === 'rep') { x.rep = TX.clamp(x.rep + d, 1, 30); txt = String(x.rep); }
      else if (f === 'd') { var stepD = cnt > 8 ? 60 : (x.d >= 600 ? 30 : 15); x.d = TX.clamp(Math.round((x.d + d * stepD) / 15) * 15, 15, L.dMax); txt = TX.time(x.d); }
      else if (f === 's') { x.s = TX.clamp(TX.r1(x.s + d * 0.5), L.sMin, L.sMax); txt = TX.f1(x.s); }
      else if (f === 'i') { x.i = TX.clamp(TX.r1(x.i + d * 0.5), L.iMin, L.iMax); txt = TX.f1(x.i); }
      var e = list.querySelector('[data-v="' + f + path + '"]'); if (e) e.textContent = txt;
      refresh();
    }
    function refresh() {
      var p = TX.cleanPlan(w), s = TX.planStats(p);
      $('[data-k="kp"]', root).innerHTML = '<div><span class="lab">Dauer </span><span class="num">' + TX.time(s.dur) + '</span></div><div><span class="lab">ca. </span><span class="num">' + TX.km(s.dist) + ' <small>km</small></span></div>' +
        '<div><span class="lab">max </span><span class="num">' + TX.f1(s.maxS) + ' <small>km/h</small></span></div>';
      var pv = $('[data-k="pv"]', root);
      if (p.type === 'zones') planChart(pv, p, { fill: 0.35 });
      else {
        var segs = s.segs, sp = stepPts(segs, 's'), ip = stepPts(segs, 'i');
        TX.chart(pv, [{ pts: ip.pts, min: 0, max: Math.max(10, s.maxI), c: '#ffd43b', step: true, stepEnd: ip.end, dot: false, wd: 2, fill: 0.3, band: [0.72, 1] },
          { pts: sp.pts, min: 0, max: Math.max(14, s.maxS), c: '#ff7a1a', step: true, stepEnd: sp.end, dot: false, wd: 2.4, fill: 0.3, band: [0, 0.68] }], { pad: 6, xMin: 0, xMax: sp.end });
      }
    }
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-t]'), dy = e.target.closest('[data-day]'), zb = e.target.closest('[data-z]'), b = e.target.closest('[data-e]');
      if (t) { w.type = t.getAttribute('data-t'); renderList(); return; }
      if (dy) { var d = +dy.getAttribute('data-day'), k = w.days.indexOf(d); if (k >= 0) w.days.splice(k, 1); else w.days.push(d); renderList(); return; }
      if (zb) { w.zone.z = +zb.getAttribute('data-z'); var zd = TX.ZDEF[w.zone.z]; w.zone.s0 = zd.s0; w.zone.sMin = zd.sMin; w.zone.sMax = zd.sMax; renderList(); return; }
      if (!b) return;
      var a = b.getAttribute('data-e'), path = b.getAttribute('data-p'), r = path != null ? ref(path) : null;
      if (a === 'fav') { w.fav = !w.fav; renderList(); }
      else if (a === 'kind') { var x = r.arr[r.i]; x.k = { w: 'h', h: 'r', r: 'w' }[x.k]; renderList(); }
      else if (a === 'up' || a === 'down') {
        var j = r.i + (a === 'up' ? -1 : 1); if (j < 0 || j >= r.arr.length) return;
        var tmp = r.arr[r.i]; r.arr[r.i] = r.arr[j]; r.arr[j] = tmp; renderList();
      } else if (a === 'del') {
        var segCount = TX.expand(w).length, isBlock = !!r.arr[r.i].rep;
        if (!isBlock && segCount <= 1) { TX.toast('Mindestens ein Abschnitt bleibt'); return; }
        r.arr.splice(r.i, 1);
        var top = String(path).split('.');
        if (top.length === 2 && !w.items[+top[0]].items.length) w.items.splice(+top[0], 1);
        if (!w.items.length) w.items.push({ d: 600, s: 8, i: 1, k: 'w' });
        renderList();
      } else if (a === 'addin') { var blk = w.items[+path], lst = blk.items[blk.items.length - 1]; blk.items.push(lst ? { d: lst.d, s: lst.s, i: lst.i, k: lst.k } : { d: 120, s: 8, i: 1, k: 'r' }); renderList(); }
      else if (a === 'add') {
        var last = null; for (var q = w.items.length - 1; q >= 0 && !last; q--) last = w.items[q].rep ? w.items[q].items[w.items[q].items.length - 1] : w.items[q];
        w.items.push(last ? { d: last.d, s: last.s, i: last.i, k: last.k } : { d: 300, s: 8, i: 1, k: 'w' }); renderList();
        list.scrollTop = list.scrollHeight;
      } else if (a === 'addblock') { w.items.push({ rep: 3, items: [{ d: 180, s: 12, i: 1, k: 'h' }, { d: 120, s: 8, i: 1, k: 'r' }] }); renderList(); list.scrollTop = list.scrollHeight; }
      else if (a === 'save') {
        w.name = ($('#ename', root).value || '').trim() || 'Neue Vorlage';
        var p = TX.putPlan(w);
        if (!p) { TX.toast('Speichern fehlgeschlagen'); return; }
        TX.toast('Vorlage gespeichert'); TX.go('#/plans?sel=' + encodeURIComponent(p.id));
      } else if (a === 'delplan') {
        if (Date.now() - delArm > 3000) { delArm = Date.now(); b.innerHTML = I('trash') + ' Wirklich löschen?'; setTimeout(function () { if (b.isConnected) b.innerHTML = I('trash') + ' Löschen'; }, 3000); return; }
        TX.delPlan(w.id); TX.toast('Vorlage gelöscht'); TX.go('#/plans');
      }
    });
    root.querySelector('#ename').addEventListener('keydown', function (e) { if (e.key === 'Enter') e.target.blur(); });
    return { el: root, mounted: renderList, update: function (st) { TX.updHead(root, st); } };
  };

  /* ================= Apps ================= */
  var PREFS = [['pill', 'Steuer-Pille anzeigen', 'im Lauf unten, sonst von unten hochwischen'], ['pillGraph', 'Live-Verlauf einblenden', 'Tempo, Steigung, Puls über der Pille'],
    ['autoCollapse', 'Automatisch einklappen', 'nach 6 s ohne Berührung'], ['hideBar', 'Herstellerleiste ausblenden', 'eigene Statuszeile oben, Apps im Vollbild']];
  // Laufband als Bluetooth-Geraet (FTMS und Laufsensor): Einstellungen liegen im Dienst, nicht in den Oberflaechen-Einstellungen
  function ftmsRows(f) {
    var on = !!(f && f.on), ctl = on && !!f.ctl, n = f && f.clients ? f.clients.length : 0;
    var sub1 = !f ? 'Dienst nicht erreichbar' : !on ? 'FTMS und Laufsensor für Uhren und Apps auf anderen Geräten' :
      (n ? 'verbunden: ' + (n === 1 ? f.clients[0].name : n + ' Apps oder Uhren') : /^fehler/.test(f.state) ? 'Störung: ' + f.state.replace(/^fehler: /, '') : 'sichtbar als «' + f.name + '»') + (f.radio === 'esp32' && !n ? ' · Funkmodul ESP32' : '');
    var sub2 = 'bis ' + (f ? f.maxS : 14) + ' km/h und ' + (f ? f.maxI : 10) + ' %; Start in Kinomap und Zwift mit Countdown, STOP immer';
    return '<button class="trow" role="switch" data-f="on" aria-checked="' + on + '"' + (f ? '' : ' disabled') + '><div>Daten an Apps und Uhren<small data-k="fsub">' + esc(sub1) + '</small></div><span class="tg' + (on ? '' : ' off') + '"></span></button>' +
      (on ? '<button class="trow" role="switch" data-f="ctl" aria-checked="' + ctl + '"><div>Apps dürfen Tempo und Steigung steuern<small>' + esc(sub2) + '</small></div><span class="tg' + (ctl ? '' : ' off') + '"></span></button>' :
        '<button class="trow lk" role="switch" data-f="ctl" aria-checked="false" aria-disabled="true" disabled><div>Apps dürfen Tempo und Steigung steuern<small>zuerst «Daten an Apps und Uhren» einschalten</small></div><span class="tlk">' + I('lock') + '<span class="tg off"></span></span></button>') +
      (on ? '<button class="trow" role="switch" data-f="dircon" aria-checked="' + !!f.dircon + '"><div>Auch für Apps auf der Konsole<small>Zwift und Kinomap hier über WLAN (DIRCON)' + (f.dircon && f.dirconState && /^fehler/.test(f.dirconState) ? '; Störung' : '') + '</small></div><span class="tg' + (f.dircon ? '' : ' off') + '"></span></button>' : '');
  }
  TX.views.apps = function () {
    var root = document.createElement('div'); root.className = 'screen v-apps';
    var pf = TX.prefs();
    // gesperrte Schalter bleiben aus, auch wenn frueher einmal eingeschaltet
    var ptsOf = function (a, p) { return (typeof a.pts === 'function' ? a.pts(p) : a.pts).map(function (q) { return '<li><span style="color:var(--go);display:flex">' + I('check') + '</span><span>' + esc(q) + '</span></li>'; }).join(''); };
    root.innerHTML = TX.headHtml('Apps') + '<main class="body"><h1 class="sr">Apps</h1><div class="agrid">' + TX.appList().map(function (x) {
      var a = x.a;
      // ohne Abzeichen; nicht installiert nur dezent abgeblendet
      return '<button class="card ap' + (x.ok ? '' : ' na') + '" data-g="launch" data-pkg="' + a.pkg + '">' +
        '<div class="top">' + TX.appIcon(a, 'lg') + '<div><h2>' + esc(a.name) + '</h2><div class="pk">' + esc(a.sub) + '</div></div></div>' +
        '<div class="fit" aria-hidden="true"><div class="ar" style="background-image:url(' + a.prev + ');background-position:' + (a.pos || 'center') + '"></div></div>' +
        '<ul data-pts="' + a.pkg + '">' + ptsOf(a, pf) + '</ul></button>';
    }).join('') + '</div><section class="card set" aria-label="Steuerung in Apps"><a class="devlink" href="#/geraete"><span class="dli">' + I('heart') + '</span><span><b>Geräte koppeln</b><small>Pulsmesser, Lautsprecher, Kopfhörer</small></span><span class="dlg2">' + I('back') + '</span></a>' +
      '<h2 class="lab" style="margin:12px 0 4px">Steuerung in Apps</h2>' + PREFS.map(function (p) {
      // gesperrt: grau, Schloss, Grund in der Unterzeile, nimmt keine Eingabe an
      if (p[3]) return '<button class="trow lk" role="switch" data-p="' + p[0] + '" aria-checked="false" aria-disabled="true" disabled><div>' + p[1] + '<small>' + p[2] + '</small></div>' +
        '<span class="tlk">' + I('lock') + '<span class="tg off"></span></span></button>';
      return '<button class="trow" role="switch" data-p="' + p[0] + '" aria-checked="' + !!pf[p[0]] + '"><div>' + p[1] + '<small>' + p[2] + '</small></div><span class="tg' + (pf[p[0]] ? '' : ' off') + '"></span></button>';
    }).join('') + '<div data-k="ftms">' + ftmsRows(null) + '</div></section></main>';
    var ftmsBox = root.querySelector('[data-k="ftms"]'), ftmsNow = null;
    var ftmsShow = function (f) { ftmsNow = f; ftmsBox.innerHTML = ftmsRows(f); TX.fixGap(ftmsBox); };
    TX.api.ftms.status().then(function (f) { ftmsShow(f && f.ok ? f : null); });
    root.addEventListener('click', function (e) {
      var fb = e.target.closest('[data-f]');
      if (fb) {
        if (fb.hasAttribute('disabled') || !ftmsNow) return;
        var key = fb.getAttribute('data-f'), body = {}; body[key] = !ftmsNow[key];
        if (key === 'on' && !body.on) body.ctl = false;   // aus: Steuerung ebenfalls aus
        TX.api.ftms.set(body).then(function (f) { if (f && f.ok) ftmsShow(f); else TX.toast('Nicht gespeichert: ' + (f && f.error || 'Dienst nicht erreichbar')); });
        return;
      }
      var b = e.target.closest('[data-p]'); if (!b || b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true') return;
      var k = b.getAttribute('data-p'), v = !TX.prefs()[k];
      TX.setPref(k, v); TX.native.setPref(k, v);
      b.setAttribute('aria-checked', v); b.querySelector('.tg').className = 'tg' + (v ? '' : ' off');
      if (k === 'hideBar' && TX.sbarUpd) TX.sbarUpd();
    });
    return { el: root, update: function (st) { TX.updHead(root, st); } };
  };

  /* ================= Geraete: Pulsmesser (Bluetooth) und Lautsprecher ================= */
  var HRST = { aus: 'Nicht verbunden', verbinde: 'Verbinde', verbunden: 'Verbunden', getrennt: 'Getrennt, verbinde neu', suche: 'Suche' };
  TX.views.geraete = function () {
    var root = document.createElement('div'); root.className = 'screen v-dev';
    var hs = null, pollT = 0, busy = '', alive = true, fs = null, fanT = 0;
    root.innerHTML = TX.headHtml('Apps') + '<main class="body"><h1 class="sr">Geräte</h1>' +
      '<section class="card devc" aria-label="Pulsmesser"><div class="dh"><span class="dico" style="background:rgba(255,77,94,.15);color:var(--hr)">' + I('heart', 1) + '</span><div><h2>Pulsmesser</h2><div class="mut">Bluetooth, direkt mit der Konsole</div></div></div>' +
      '<div class="hrbox" data-k="hrbox"></div><div class="dact" data-k="dact"></div><div class="flist2" data-k="found"></div></section>' +
      // Ventilator CYCPLUS F1: Status, Suchen/Trennen, Stufenwahl AUTO | AUS | 25 | 50 | 75 | 100
      '<section class="card devc" aria-label="Ventilator"><div class="dh"><span class="dico" style="background:rgba(46,127,168,.2);color:#5bb4dc">' + I('fan') + '</span><div><h2>Ventilator</h2><div class="mut">CYCPLUS F1 über Bluetooth</div></div></div>' +
      '<div class="hrbox" data-k="fanbox"></div><div class="dact" data-k="fanact"></div><div data-k="fanlv"></div></section>' +
      '<section class="card devc" aria-label="Lautsprecher und Kopfhörer"><div class="dh"><span class="dico" style="background:rgba(61,139,255,.15);color:var(--spd)">' + I('sound') + '</span><div><h2>Lautsprecher und Kopfhörer</h2><div class="mut">Ton über Bluetooth</div></div></div>' +
      '<div class="audl" data-k="aud"></div><button class="btn go devbt" data-v="bt">' + I('sound') + ' Bluetooth-Lautsprecher koppeln</button></section></main>';
    function render() {
      var h = hs || { state: 'aus', found: [] }, con = h.state === 'verbunden', st = HRST[h.state] || h.state || '', box = $('[data-k="hrbox"]', root);
      var bh = h.bt === false ? '<div class="hrst off">Bluetooth ist aus oder nicht verfügbar</div>' :
        (h.name ? '<div class="hrdev"><div><div class="lab">' + esc(st) + '</div><b>' + esc(h.name) + '</b><small>' + esc(h.address || '') + '</small></div>' +
          '<div class="hrv"><span class="num">' + (con && h.hr > 0 ? h.hr : TX.NA) + '</span><small>bpm</small></div></div>' : '<div class="hrst">Kein Pulsmesser verbunden</div>');
      if (box.getAttribute('data-h') !== bh) { box.setAttribute('data-h', bh); box.innerHTML = bh; }
      var ah = '<button class="btn ghost" data-v="scan"' + (h.scanning || h.bt === false ? ' disabled' : '') + '>' + I('repeat') + (h.scanning ? ' Suche läuft' : ' Suchen') + '</button>' +
        (h.name ? '<button class="btn ghost" data-v="forget" style="color:#ff7884">' + I('trash') + ' Entfernen</button>' : '');
      setH('dact', ah);
      var f = (h.found || []).filter(function (x) { return x.address !== h.address || !con; });
      setH('found', h.scanning && !f.length ? '<div class="mut fsearch">Suche nach Pulsmessern, bis 15 s</div>' : f.map(function (x) {
        return '<div class="frow2"><span class="fic2">' + I('heart') + '</span><span class="fn2"><b>' + esc(x.name || 'Unbekannt') + '</b><small>' + esc(x.address) + (x.rssi ? ' · Signal ' + x.rssi + ' dBm' : '') + '</small></span>' +
          '<button class="btn go" data-con="' + esc(x.address) + '" data-nm="' + esc(x.name || '') + '">' + I('check') + ' Verbinden</button></div>';
      }).join(''));
      TX.fixGap(root);
    }
    var FANST = { bereit: 'verbunden', verbinde: 'verbinde', suche: 'Suche läuft', 'nicht gefunden': 'nicht gefunden', 'kein Ventilator': 'kein Ventilator gekoppelt', aus: 'aus' };
    function renderFan() {
      var f = fs || { state: '', name: '' }, con = !!f.connected, st = FANST[f.state] || f.state || 'Dienst nicht erreichbar';
      setH('fanbox', f.name ? '<div class="hrdev"><div><div class="lab">' + esc(st) + '</div><b>' + esc(f.name) + '</b><small>' + esc(f.address || '') + '</small></div>' +
          '<div class="hrv fanv"><span class="num">' + (con ? Math.round(f.level) : TX.NA) + '</span><small>%</small></div></div>' :
        '<div class="hrst">' + (f.state === 'suche' ? 'Suche nach dem Ventilator, bis 10 s' : f.state === 'nicht gefunden' ? 'Kein Ventilator gefunden' : f.state ? 'Kein Ventilator verbunden' : 'Dienst nicht erreichbar') + '</div>');
      setH('fanact', '<button class="btn ghost" data-f="scan"' + (f.state === 'suche' || !fs ? ' disabled' : '') + '>' + I('repeat') + (f.state === 'suche' ? ' Suche läuft' : ' Suchen') + '</button>' +
        (f.name ? '<button class="btn ghost" data-f="forget" style="color:#ff7884">' + I('x') + ' Trennen</button>' : ''));
      var on = !con ? '' : f.auto ? 'auto' : !(f.level > 0) ? 'off' : [25, 50, 75, 100].indexOf(Math.round(f.level)) >= 0 ? String(Math.round(f.level)) : '';
      setH('fanlv', !con ? '' : '<div class="seg fanseg" role="group" aria-label="Ventilatorstufe">' + [['auto', 'AUTO'], ['off', 'AUS'], ['25', '25'], ['50', '50'], ['75', '75'], ['100', '100']].map(function (x) {
        return '<button data-fl="' + x[0] + '" class="' + (x[0] === on ? 'on' : '') + (x[0] === 'auto' ? ' fa' : '') + '" aria-pressed="' + (x[0] === on) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<div class="fanlv"><b>' + Math.round(f.level || 0) + ' %</b><span>' + (f.auto ? 'Automatik' : f.level > 0 ? 'Handwahl' : 'aus') + '</span></div>' +
        '<div class="mut fannote">Automatik: aus in Bereit, im Lauf nach Tempo, Steigung und Puls; Handwahl gilt bis Laufende</div>');
    }
    function pollFan() {
      if (!alive) return;
      if (document.hidden) { fanT = setTimeout(pollFan, 2000); return; }
      TX.api.fan.status().then(function (r) { if (!alive) return; fs = r && r.ok !== false && r.state != null ? r : null; renderFan(); fanT = setTimeout(pollFan, 2000); });
    }
    function fanCmd(a, v) {
      TX.api.fan.cmd(a, v).then(function (r) {
        if (r && r.ok === false) TX.toast('Ventilator: ' + (r.error || 'nicht ausgeführt'));
        clearTimeout(fanT); TX.api.fan.status().then(function (x) { if (!alive) return; if (x && x.state != null) { fs = x; renderFan(); } fanT = setTimeout(pollFan, 2000); });
      });
    }
    function setH(k, h) { var e = $('[data-k="' + k + '"]', root); if (e.getAttribute('data-h') !== h) { e.setAttribute('data-h', h); e.innerHTML = h; } }
    function poll() {
      TX.api.hr.status().then(function (r) { if (!alive) return; if (r && !r.error) hs = r; else if (r && r.error) hs = { state: 'aus', bt: false, found: [] }; render(); pollT = setTimeout(poll, 1000); });
    }
    root.addEventListener('click', function (e) {
      var fb = e.target.closest('[data-f]'), fl = e.target.closest('[data-fl]');
      if (fb && !fb.disabled) { fanCmd(fb.getAttribute('data-f')); if (fb.getAttribute('data-f') === 'forget') TX.toast('Ventilator getrennt'); return; }
      if (fl) { var k = fl.getAttribute('data-fl'); if (k === 'auto' || k === 'off') fanCmd(k); else fanCmd('level', +k); return; }
      var c = e.target.closest('[data-con]'), b = e.target.closest('[data-v]');
      if (c && !c.disabled) { TX.api.hr.connect(c.getAttribute('data-con'), c.getAttribute('data-nm')).then(function (r) { if (r && r.ok === false) TX.toast('Nicht verbunden: ' + (r.error || '')); }); return; }
      if (!b || b.disabled) return;
      var v = b.getAttribute('data-v');
      if (v === 'scan') TX.api.hr.scan().then(function (r) { if (r && r.ok === false) TX.toast('Suche nicht möglich: ' + (r.error || '')); });
      if (v === 'forget') TX.api.hr.forget().then(function () { TX.toast('Pulsmesser entfernt'); });
      if (v === 'bt') { var o = TX.native.openBluetooth(); if (o === 'demo') TX.toast('Demo: würde die Bluetooth-Einstellungen öffnen'); else if (!o) TX.toast('Bluetooth-Einstellungen konnten nicht geöffnet werden'); }
    });
    // gekoppelte Lautsprecher und Kopfhoerer mit Verbindungsstatus (GET /api/bt/audio)
    function audName(n) {
      var m = /^(.*?)\s*\((SONOS[^)]*)\)\s*$/i.exec(n || ''), base = m ? m[1] : (n || 'Unbekannt');
      // im Haushalt ist der einzige Sonos mit Bluetooth ein Roam
      return m ? [base, 'Sonos Roam'] : [base, 'Bluetooth-Audio'];
    }
    TX.api.btAudio().then(function (r) {
      if (!alive) return;
      var l = r && Array.isArray(r.audio) ? r.audio.slice().sort(function (a, b) { return b.connected - a.connected; }) : [];
      setH('aud', l.map(function (x) { var nm = audName(x.name);
        return '<div class="audr' + (x.connected ? ' on' : '') + '"><span class="aui">' + I('sound') + '</span><span class="aut"><b>' + esc(nm[0]) + '</b><small>' + esc(nm[1]) + ' · ' + (x.connected ? 'verbunden' : 'gekoppelt') + '</small></span>' +
          (x.connected ? '<span class="aus">' + I('check') + '</span>' : '') + '</div>'; }).join(''));
    });
    render(); poll(); renderFan(); pollFan();
    return { el: root, update: function (st) { TX.updHead(root, st); }, destroy: function () { alive = false; clearTimeout(pollT); clearTimeout(fanT); } };
  };

  /* ================= Abschluss ================= */
  TX.views.summary = function (prm) {
    var root = document.createElement('div'); root.className = 'screen v-sum';
    if (prm[0] === 'last') {
      root.innerHTML = TX.headHtml('Verlauf') + '<main class="body" style="display:flex"><div class="hempty">Lauf wird abgeschlossen</div></main>';
      // nach Beenden ueber die Pille: gleiche Regeln wie in der Oberflaeche (kurzer Lauf mit Nachfrage, Vorgabe Verwerfen)
      TX.fetchSummary().then(function (sum) {
        if (sum && (sum.elapsed >= 10 || sum.dist >= 0.01)) TX.finishRun(TX.makeRun(null, sum.hist, sum), true);
        else { if (sum) TX.toast('Lauf kürzer als 10 s, nicht gespeichert'); TX.go('#/'); }   // nie den vorigen Lauf als «gespeichert» zeigen
      });
      return { el: root, update: function (st) { TX.updHead(root, st); } };
    }
    var r = prm[0] ? TX.run(prm[0]) : TX.runs()[0];
    if (!r) {
      root.innerHTML = TX.headHtml('Verlauf') + '<main class="body" style="display:flex"><div class="hempty">Kein Lauf gefunden<a class="btn ghost" href="#/">Zum Start</a></div></main>';
      return { el: root, update: function (st) { TX.updHead(root, st); } };
    }
    var d = new Date(r.ts), hf = TX.profile().hf, wk = TX.weekStats(r.ts), pw = TX.weekStats(r.ts - 7 * 864e5), wd = (d.getDay() + 6) % 7;
    var mx = Math.max.apply(null, wk.days.concat([0.1]));
    var cmp = '';
    if (wk.pace && pw.pace) { var df = Math.round(pw.pace - wk.pace); cmp = df ? ' · Pace ' + TX.time(Math.abs(df)) + ' /km ' + (df > 0 ? 'schneller' : 'langsamer') + ' als letzte Woche' : ' · Pace wie letzte Woche'; }
    var zt = TX.zoneTimes(r.hist, hf), zmax = Math.max.apply(null, zt.concat([1])), sp = TX.splits(r.hist), spMax = 0;
    sp.forEach(function (x) { spMax = Math.max(spMax, 3600 / x.sec); });
    var head = r.elapsed < 600 ? 'Kurz und gut!' : r.dist >= 10 ? 'Starke Leistung!' : 'Stark gelaufen!';
    // Streckenlauf: kleine Karte, Profil, Zielzeit gegen gelaufene Zeit
    var rt = r.route && r.route.D ? r.route : null, rtCard = '';
    if (rt) {
      var tRun = rt.t != null ? rt.t : r.elapsed, dd = tRun - rt.target, frac = rt.D ? Math.min(1, rt.x / rt.D) : 0;
      if (rt.finish) head = 'Ziel erreicht!';
      rtCard = '<section class="card rsum" aria-label="Strecke"><div class="rsm" data-k="rsm"></div><div class="rsr"><div class="rst"><div><div class="lab" style="color:var(--inc)">' + I('route') + ' Strecke</div>' +
        '<h2>' + esc(rt.name || TX.nm(r.name)) + '</h2></div>' +
        '<div class="rsk"><div><div class="lab">Vorgabe</div><div class="num">' + TX.time(rt.target) + '</div></div><div><div class="lab">' + (rt.finish ? 'Zeit bis Ziel' : 'Bis <span class="u">km</span> ' + TX.f1(rt.x / 1000)) + '</div><div class="num">' + TX.time(tRun) + '</div>' +
        '<div class="rsx">inkl. Auslaufen ' + TX.time(r.elapsed) + '</div></div>' +
        (rt.finish ? '<div><div class="lab">Gegen Vorgabe</div><div class="num ' + (dd <= 0 ? 'g' : 'o') + '">' + (dd <= 0 ? '\u2212' : '+') + TX.time(Math.abs(dd)) + '</div></div>' :
          '<div><div class="lab">Strecke</div><div class="num">' + Math.round(frac * 100) + '<small>%</small></div></div>') + '</div></div>' +
        '<div class="rsp chart" data-k="rsp"></div></div></section>';
    }
    // Stufentest HFmax: hoechster Puls prominent, Uebernahme ins Profil, Auslaufen als eigenes kurzes Programm
    var tpl = r.planId ? TX.plan(r.planId) : null, isT = TX.isTest(tpl) || r.planId === TX.HFTEST || r.type === 'test';
    if (isT) {
      var mh = Math.round(+r.maxHr || 0), hf0 = TX.profile().hf, vmax = 0;
      (r.hist || []).forEach(function (p) { if (p[1] > vmax) vmax = p[1]; });
      head = 'Test abgeschlossen!';
      var why = !mh ? 'Kein Pulssignal im Lauf: ohne Pulsmesser nicht auswertbar.' : mh < 120 || mh > 230 ? 'Wert nicht plausibel, bitte Pulsmesser prüfen.' : '';
      rtCard = '<section class="card hfsum" aria-label="Stufentest HFmax"><div class="hfv"><div class="lab" style="color:var(--hr)">Höchster Puls</div><div class="num" data-k="hfmx">' + (mh || TX.NA) + '<small>bpm</small></div></div>' +
        '<div class="hft"><div class="lab">' + I('heart') + ' Stufentest HFmax</div><h2 data-k="hfprof">HFmax im Profil: ' + hf0 + ' bpm</h2>' +
        '<div class="mut" data-k="hfwhy">' + (why || ('höchste Stufe ' + TX.f1(Math.round(vmax * 2) / 2) + ' km/h · der Wert setzt die Pulszonen')) + '</div></div>' +
        '<div class="hfa">' + (why ? '' : mh === hf0 ? '<button class="btn ghost" data-v="hfset" disabled>' + I('check') + ' Bereits als HFmax gespeichert</button>' :
          '<button class="btn go" data-v="hfset">' + I('heart') + ' Als HFmax übernehmen (' + mh + ')</button>') +
        '<button class="btn ghost" data-v="cool">Auslaufen 5 min · 6.0 km/h</button></div></section>';
    }
    // neue Bestzeiten (1, 5, 10 km, Halbmarathon, Strecke) und steigungsbereinigte Pace
    var recs = TX.records(r), gp = TX.gapPace(r);
    if (recs.length && Date.now() - r.ts < 120000 && TX.runs()[0] && TX.runs()[0].id === r.id && !TX.recSaid[r.id]) { TX.recSaid[r.id] = 1; TX.api.cmd('announce', { say: ['bestzeit'] }); }
    root.innerHTML = '<main class="body"><section class="card sumh"><div class="ph"></div><div class="shade"></div>' +
      '<div class="lab" style="color:var(--go)">Gespeichert · ' + TX.WD[d.getDay()] + ' ' + TX.dshort(r.ts) + '<span class="demo-tag">DEMO</span></div><h1>' + head + '</h1>' +
      '<div class="mut">' + esc(TX.nm(r.name)) + ' · ' + TX.hm(r.ts) + ' Uhr</div>' +
      (recs.length ? '<div class="recs">' + recs.map(function (x) { return '<span class="chip rec">' + I('check') + ' Bestzeit ' + esc(x.label) + ' ' + TX.time(x.t) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="bigk"><div><div class="lab">Distanz</div><div class="num">' + TX.f2(r.dist) + '<small>km</small></div></div><div><div class="lab">Zeit</div><div class="num">' + TX.time(r.elapsed) + '</div></div>' +
      '<div><div class="lab">Ø Pace</div><div class="num">' + TX.avgPace(r.dist, r.elapsed) + '<small>/km</small></div>' + (gp ? '<div class="gapp" title="steigungsbereinigt nach Minetti">bereinigt ' + TX.time(gp) + ' /km</div>' : '') + '</div>' +
      (rt && rt.up ? '<div><div class="lab">Höhenmeter Band</div><div class="num">' + r.elev + '<small>von ' + Math.round(rt.up) + ' m</small></div></div>' : '<div><div class="lab">Höhenmeter</div><div class="num">' + r.elev + '<small>m</small></div></div>') +
      '<div><div class="lab">Ø Puls</div><div class="num" style="color:var(--hr)">' + (r.avgHr || '--') + '<small>bpm</small></div></div><div><div class="lab">Kalorien</div><div class="num">' + r.kcal + '<small>kcal</small></div></div></div>' +
      '<div class="week"><div class="lab">' + wk.label + '</div><div class="wbars" aria-hidden="true">' + wk.days.map(function (km, i) {
        return '<i class="' + (i === wd ? 'today' : '') + '" style="height:' + (km / mx * 100).toFixed(0) + '%"></i>';
      }).join('') + '</div><div class="wlab">' + ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
      '<div class="mut" style="font-size:13px;margin-top:6px">' + TX.weekText(wk) + cmp + '</div></div>' +
      '<div class="acts"><a class="btn go" href="#/">' + I('check') + ' Fertig</a><button class="btn ghost" data-v="tpl">' + I('plans') + ' Als Vorlage speichern</button></div></section>' +
      '<div class="sr2' + (rtCard ? ' wr' : '') + '">' + rtCard +
      '<section class="card gcard"><div style="display:flex;gap:18px;align-items:center"><h2 class="lab">Verlauf</h2><div class="legend"><span><i style="background:var(--spd)"></i>Tempo</span>' +
      '<span><i style="background:var(--inc)"></i>Steigung</span><span><i style="background:var(--hr)"></i>Puls</span></div></div><div class="chart" data-k="ch" style="flex:1;min-height:0;margin-top:8px"></div>' +
      '<div class="xaxis" data-k="xa" style="padding-right:92px"></div></section>' +
      '<div class="bot"><section class="card zb"><h2 class="lab">Zeit in Pulszonen</h2>' + [1, 2, 3, 4, 5].map(function (z) {
        return '<div class="zrow"><b style="color:' + TX.ZT[z] + '">Z' + z + '</b><div class="bar"><i style="width:' + (zt[z] / zmax * 100).toFixed(0) + '%;background:' + TX.ZC[z] + '"></i></div><span>' + TX.time(zt[z]) + '</span></div>';
      }).join('') + '</section><section class="card splits"><div class="sp h"><span>km</span><span></span><span>PACE</span><span>Ø PULS</span></div><div class="spwrap" data-k="spw"><div class="splist" tabindex="0" aria-label="Kilometer">' +
      (sp.length ? sp.map(function (x) { return '<div class="sp"><b>' + x.km + '</b><i style="width:' + (3600 / x.sec / spMax * 100).toFixed(0) + '%"></i><span>' + TX.time(x.sec) + '</span><span class="mut">' + (x.hr || '--') + '</span></div>'; }).join('')
        : '<div class="mut" style="font-size:14px;padding:10px 0">Noch kein ganzer Kilometer</div>') + '</div></div></section></div></div></main>';
    function hfSet(v) {
      var pr = TX.profile(); TX.saveProfile({ name: pr.name, hf: v, kg: pr.kg });
      TX.sendProfile().then(function (res) { TX.toast(res && res.ok ? 'HFmax ' + v + ' bpm übernommen' : 'HFmax gespeichert, Dienst nicht erreicht'); });
      var b = $('[data-v="hfset"]', root); if (b) { b.disabled = true; b.className = 'btn ghost'; b.innerHTML = I('check') + ' Als HFmax gespeichert'; }
      var h2 = $('[data-k="hfprof"]', root); if (h2) h2.textContent = 'HFmax im Profil: ' + v + ' bpm';
    }
    function hfAsk(v) {
      var m = document.createElement('div'); m.className = 'modal blur'; m.setAttribute('role', 'alertdialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'hfq');
      m.innerHTML = '<div class="dlg"><div class="ico">' + I('heart') + '</div><h2 id="hfq">' + v + ' bpm als HFmax?</h2><div class="mut" style="margin-top:8px;font-size:16px">Der Wert liegt ' + (v < 150 ? 'unter 150' : 'über 220') +
        ' bpm. Das spricht oft für einen Messfehler oder einen zu früh beendeten Test. Trotzdem übernehmen?</div>' +
        '<div class="acts"><button class="btn ghost" data-c="no">Abbrechen</button><button class="btn go" data-c="ok">' + I('check') + ' Übernehmen</button></div></div>';
      m.addEventListener('click', function (e) { var b = e.target.closest('[data-c]'); if (!b) return; m.parentNode.removeChild(m); if (b.getAttribute('data-c') === 'ok') hfSet(v); });
      document.body.appendChild(m); TX.fixGap(m);
      try { m.querySelector('[data-c="no"]').focus(); } catch (x) { /* egal */ }
    }
    root.addEventListener('click', function (e) {
      var hb = e.target.closest('[data-v="hfset"]');
      if (hb && !hb.disabled) { var v = Math.round(+r.maxHr || 0); if (v < 150 || v > 220) hfAsk(v); else hfSet(v); return; }
      if (e.target.closest('[data-v="cool"]')) { TX.loadPlan({ name: 'Auslaufen', type: 'interval', items: [{ d: 300, s: 6.0, i: 1.0, k: 'w' }] }); return; }
      if (!e.target.closest('[data-v="tpl"]')) return;
      var p = TX.putPlan(TX.runToPlan(r));
      if (p) { TX.toast('Als Vorlage gespeichert'); TX.go('#/plans/edit/' + encodeURIComponent(p.id)); }
    });
    // Ausblendverlauf als Scrollhinweis, solange nicht alle Kilometer sichtbar sind (wie im Plan-Detail)
    function spFade() {
      var w = $('[data-k="spw"]', root); if (!w) return;
      var l = w.firstChild;
      w.classList.toggle('more', l.scrollTop + l.clientHeight < l.scrollHeight - 2);
      w.classList.toggle('less', l.scrollTop > 2);
    }
    $('.splist', root).addEventListener('scroll', spFade);
    return {
      el: root,
      mounted: function () {
        spFade(); setTimeout(spFade, 150);
        if (rt) {
          var mEl = $('[data-k="rsm"]', root), pEl = $('[data-k="rsp"]', root);
          if (rt.line) mEl.innerHTML = TX.rte.lineSvg(rt.line, { w: mEl.clientWidth || 220, h: mEl.clientHeight || 150, pad: 12, wd: 3, frac: rt.D ? Math.min(1, rt.x / rt.D) : 1 });
          if (rt.prof && rt.prof.length > 1) TX.rte.profile(pEl, { prof: rt.prof, D: rt.D, x: rt.x, ax: true });
        }
        var el = $('[data-k="ch"]', root), h = r.hist || [];
        if (h.length < 2) { el.innerHTML = '<div class="empty">Kein Verlauf aufgezeichnet</div>'; return; }
        // Zeitachse 0:00 bis Gesamtzeit
        var tEnd = Math.max(r.elapsed || 0, h[h.length - 1][0], 1);
        $('[data-k="xa"]', root).innerHTML = [0, 1, 2, 3, 4].map(function (k) { return '<span>' + TX.time(tEnd * k / 4) + '</span>'; }).join('');
        // drei Bahnen wie im Live-Verlauf, rechts die Mittelwerte
        var mxS = 10, mxI = 4, hp = h.filter(function (p) { return p[3] > 0; }), hLo = 999, hHi = 0, sI = 0;
        h.forEach(function (p) { mxS = Math.max(mxS, p[1] * 1.1); mxI = Math.max(mxI, p[2] * 1.15); sI += p[2]; });
        hp.forEach(function (p) { hLo = Math.min(hLo, p[3]); hHi = Math.max(hHi, p[3]); });
        hLo = Math.max(40, Math.min(hLo, 100) - 8); hHi = Math.max(hHi + 8, hLo + 40);
        var avgS = r.elapsed > 0 ? r.dist / r.elapsed * 3600 : 0;
        TX.chart(el, [
          { pts: h.map(function (p) { return [p[0], p[1]]; }), min: 0, max: mxS, c: '#3d8bff', fill: 0.18, wd: 2.6, band: [0, 0.44], dot: false, lab: 'Ø ' + TX.f1(avgS), unit: 'km/h' },
          { pts: hp.map(function (p) { return [p[0], p[3]]; }), min: hLo, max: hHi, c: '#ff4d5e', fill: 0, wd: 2.4, band: [0.52, 0.76], dot: false, lab: hp.length ? (r.avgHr ? 'Ø ' + r.avgHr : TX.NA) : null, unit: 'bpm', none: TX.NA + ' bpm · kein Signal' },
          { pts: h.map(function (p) { return [p[0], p[2]]; }), min: 0, max: mxI, c: '#ffd43b', step: true, fill: 0.35, wd: 2, band: [0.84, 1], dot: false, lab: 'Ø ' + TX.f1(sI / h.length), unit: '%' }],
          { seps: [0.48, 0.80], gutter: 92, xMin: 0, xMax: tEnd, padB: 3 });
      },
      update: function () {}
    };
  };

  /* ================= Verlauf ================= */
  TX.views.history = function () {
    var root = document.createElement('div'); root.className = 'screen v-hist';
    var runs = TX.runs(), wk = TX.weekStats(Date.now()), now = new Date(), ms = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), mkm = 0, mn = 0;
    runs.forEach(function (r) { if (r.ts >= ms) { mkm += r.dist; mn++; } });
    // Uebersicht: km je Tag der letzten 4 Wochen (Montag vor drei Wochen bis Sonntag dieser Woche)
    var d0 = new Date(TX.weekStart(Date.now())); d0.setDate(d0.getDate() - 21);
    var days = [], today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 0; i < 28; i++) { var dd = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i); days.push({ t: dd.getTime(), km: 0, fut: dd.getTime() > today.getTime(), now: dd.getTime() === today.getTime() }); }
    var t4 = { n: 0, km: 0, sec: 0 }, wkm = [0, 0, 0, 0];
    runs.forEach(function (r) {
      var rd = new Date(r.ts); rd.setHours(0, 0, 0, 0);
      var k = Math.round((rd.getTime() - days[0].t) / 864e5);
      if (k < 0 || k > 27) return;
      days[k].km += r.dist; wkm[Math.floor(k / 7)] += r.dist; t4.n++; t4.km += r.dist; t4.sec += r.elapsed;
    });
    var dmax = Math.max.apply(null, days.map(function (x) { return x.km; }).concat([1]));
    var bars = days.map(function (x) {
      return '<div class="hd' + (x.fut ? ' fut' : '') + (x.now ? ' now' : '') + '"><span>' + (x.km > 0 ? TX.f1(x.km) : '') + '</span><i style="height:' + (x.km > 0 ? Math.max(4, x.km / dmax * 80) : 0).toFixed(0) + '%"></i></div>';
    }).join('');
    var wl = [0, 1, 2, 3].map(function (w) { return '<div><b>' + (w === 3 ? 'Diese Woche' : 'ab ' + TX.dshort(days[w * 7].t)) + '</b> · ' + TX.f1(wkm[w]) + ' km</div>'; }).join('');
    var kp = '<section class="card hkp" aria-label="Kennzahlen 4 Wochen"><div><div class="lab">Läufe</div><div class="num">' + t4.n + '</div></div>' +
      '<div><div class="lab">Kilometer</div><div class="num">' + TX.km(t4.km) + '<small>km</small></div></div>' +
      '<div><div class="lab">Zeit</div><div class="num">' + TX.time(t4.sec) + '</div></div>' +
      '<div><div class="lab">Ø Pace</div><div class="num">' + TX.avgPace(t4.km, t4.sec) + '<small>/km</small></div></div>' +
      '<div class="hkf mut">' + wk.label + ' ' + TX.weekText(wk) + ' · ' + TX.MON[now.getMonth()] + ' ' + TX.km(mkm) + ' km in ' + mn + (mn === 1 ? ' Lauf' : ' Läufen') + '</div></section>';
    /* Leerer Verlauf: statt leerer Balkenflaeche ein Wochenraster der letzten 4 Wochen (Mo bis So, heute markiert),
       rechts die Kennzahlen und ein dezenter Hinweis mit Schnellstart und Plaenen */
    function emptyCal() {
      var wd = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
      var g = '<div class="hcr hch"><span></span>' + wd.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>';
      for (var w = 0; w < 4; w++) {
        g += '<div class="hcr"><span class="hcw">' + (w === 3 ? 'Diese Woche' : 'ab ' + TX.dshort(days[w * 7].t)) + '</span>';
        for (var k = 0; k < 7; k++) { var x = days[w * 7 + k]; g += '<span class="hcd' + (x.fut ? ' fut' : '') + (x.now ? ' now' : '') + '"><b>' + new Date(x.t).getDate() + '</b>' + (x.now ? '<small>heute</small>' : '') + '</span>'; }
        g += '</div>';
      }
      return '<div class="hemp"><section class="card hcal" aria-label="Letzte 4 Wochen, noch keine Läufe"><div class="hct"><h2 class="lab">Letzte 4 Wochen</h2><span class="mut">Mo bis So</span></div>' +
        '<div class="hcg" aria-hidden="true">' + g + '</div></section><div class="hside">' + kp +
        '<section class="card hcm" aria-label="Erster Lauf"><span class="hci">' + I('run') + '</span><p>Noch keine Läufe. Starte mit Schnellstart oder einem Plan.</p>' +
        '<div class="hcb"><a class="btn go" href="#/run">' + I('bolt') + ' Schnellstart</a><a class="btn ghost" href="#/plans">' + I('plans') + ' Pläne</a></div></section></div></div>';
    }
    root.innerHTML = TX.headHtml('Verlauf') + '<main class="body"><h1 class="sr">Verlauf</h1>' + (runs.length ? '<div class="hsum">' +
      '<section class="card hchart" aria-label="Kilometer je Tag, letzte 4 Wochen"><div class="hct"><h2 class="lab">Letzte 4 Wochen</h2><span class="mut">km je Tag</span></div>' +
      '<div class="hbars" aria-hidden="true">' + bars + '</div><div class="hwl">' + wl + '</div></section>' + kp + '</div>' +
      '<div class="hlist">' + runs.map(function (r) {
        var d = new Date(r.ts);
        return '<a class="card hrun" href="#/summary/' + esc(r.id) + '"><div class="l"><div class="d">' + TX.WD[d.getDay()] + ' ' + TX.dshort(r.ts) + ' · ' + TX.hm(r.ts) + '</div><h2>' + esc(TX.nm(r.name)) + '</h2>' +
          '<div class="k"><div class="num">' + TX.f2(r.dist) + '<small>km</small></div><div class="num">' + TX.time(r.elapsed) + '</div><div class="num">' + TX.avgPace(r.dist, r.elapsed) + '<small>/km</small></div>' +
          '<div class="num" style="color:var(--hr)">' + (r.avgHr || '--') + '<small>bpm</small></div></div></div><div class="mini chart" data-r="' + esc(r.id) + '"></div></a>';
      }).join('') + '</div>' : emptyCal()) + '</main>';
    return {
      el: root,
      mounted: function () {
        runs.forEach(function (r) {
          var el = root.querySelector('[data-r="' + r.id + '"]'), h = r.hist || [];
          if (!el || h.length < 2) return;
          TX.chart(el, [{ pts: h.filter(function (p) { return p[3] > 0; }).map(function (p) { return [p[0], p[3]]; }), min: 60, max: 190, c: '#ff4d5e', fill: 0, wd: 1.6, dot: false, band: [0, 0.9] },
            { pts: h.map(function (p) { return [p[0], p[1]]; }), min: 0, max: 16, c: '#3d8bff', fill: 0.2, wd: 2, dot: false, band: [0, 0.9] }], { pad: 4 });
        });
      },
      update: function (st) { TX.updHead(root, st); }
    };
  };
})();
