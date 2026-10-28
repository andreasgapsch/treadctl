/* Mini-Player im Kopf: zeigt und steuert die Wiedergabe von YouTube Music oder Hoerbuechern im Hintergrund.
   Dienst: GET /api/media, GET /api/media/art?v=, POST /api/media/cmd {a}. Abfrage alle 2 s bei sichtbarer Seite. */
(function () {
  'use strict';
  var TX = window.TX, I = TX.I, esc = TX.esc, api = TX.api;
  var YTM = 'app.revanced.android.apps.youtube.music', ABS = 'com.audiobookshelf.app';
  var M = TX.media = { st: null, at: 0 };

  /* ---------- Demo: YouTube Music spielt, ?musik=aus ohne Wiedergabe, ?musik=hoerbuch Hoerbuch ---------- */
  var DEMO_LIST = [
    { title: 'Morgenlicht über dem See', artist: 'Nordwind', album: 'Weite', dur: 214 },
    { title: 'Lauf durch die Nacht', artist: 'Kilometerzähler', album: 'Tempo', dur: 187 },
    { title: 'Bergauf', artist: 'Die Höhenmeter', album: 'Steigung', dur: 241 }
  ];
  var dmOut = [{ address: '', name: 'Konsole', connected: true, active: false }, { address: '74:CA:60:50:00:62', name: 'Wohnzimmer (SONOS 0062)', connected: true, active: true }, { address: '00:11:22:33:44:55', name: 'JBL Flip 5', connected: false, active: false }];
  var dm = { active: true, pkg: YTM, app: 'YouTube Music', playing: true, i: 0, pos: 63, t0: Date.now(), art: 1, canNext: true, canPrev: true, vol: 7, abs: true };
  var mq = /[?&]musik=([a-z]+)/.exec(location.search);
  if (mq && mq[1] === 'aus') dm.active = false;
  if (mq && mq[1] === 'hoerbuch') { dm.pkg = ABS; dm.app = 'Hörbücher'; }
  function demoState() {
    var now = Date.now(), cur = dm.app === 'Hörbücher' ? { title: 'Kapitel 7: Der lange Anstieg', artist: 'Die Läuferin', album: 'Die Läuferin', dur: 2710 } : DEMO_LIST[dm.i % DEMO_LIST.length];
    if (dm.playing) { dm.pos += (now - dm.t0) / 1000; } dm.t0 = now;
    if (dm.pos >= cur.dur) dm.pos = 0;
    var hb = dm.app === 'Hörbücher';
    var src = [{ pkg: YTM, app: 'YouTube Music', installed: true, session: dm.active, playing: dm.active && !hb && dm.playing, title: !hb ? cur.title : DEMO_LIST[0].title },
      { pkg: ABS, app: 'Hörbücher', installed: true, session: dm.abs, playing: dm.active && hb && dm.playing, title: 'Kapitel 7: Der lange Anstieg' }];
    var act = dmOut.filter(function (o) { return o.active; })[0];
    var base = { ok: true, vol: dm.vol, volMax: 15, out: act && act.address ? 'bluetooth' : 'geraet', outs: JSON.parse(JSON.stringify(dmOut)), sources: src };
    var o = dm.active ? { active: true, pkg: dm.pkg, app: dm.app, playing: dm.playing, title: cur.title, artist: cur.artist, album: cur.album, dur: cur.dur, pos: Math.floor(dm.pos), art: dm.art + dm.i, canNext: true, canPrev: true }
      : { active: false, pkg: '', app: '', playing: false, title: '', artist: '', album: '', dur: 0, pos: 0, art: 0, canNext: false, canPrev: false };
    for (var k in o) base[k] = o[k];
    return base;
  }
  function demoCmd(a, x) {
    if (a === 'volUp') { dm.vol = Math.min(15, dm.vol + 1); return { ok: true }; }
    if (a === 'volDown') { dm.vol = Math.max(0, dm.vol - 1); return { ok: true }; }
    if (a === 'vol') { dm.vol = Math.max(0, Math.min(15, x.v)); return { ok: true }; }
    if (a === 'out') { dmOut.forEach(function (o) { o.active = o.address === x.address; if (o.active) o.connected = true; }); return { ok: true }; }
    if (a === 'source') { dm.active = true; dm.pkg = x.pkg; dm.app = x.pkg === ABS ? 'Hörbücher' : 'YouTube Music'; dm.pos = x.pkg === ABS ? 1284 : 63; dm.playing = true; dm.t0 = Date.now(); return { ok: true }; }
    if (!dm.active) return { ok: false, error: 'keine Wiedergabe' };
    demoState();
    if (a === 'toggle') dm.playing = !dm.playing; else if (a === 'play') dm.playing = true; else if (a === 'pause') dm.playing = false;
    else if (a === 'next') { dm.i++; dm.pos = 0; } else if (a === 'prev') { if (dm.pos > 3) dm.pos = 0; else dm.i = Math.max(0, dm.i - 1); }
    else if (a === 'back30') dm.pos = Math.max(0, dm.pos - 30); else if (a === 'fwd30') dm.pos += 30;
    return { ok: true };
  }

  /* ---------- Abfrage und Befehle ---------- */
  var pollT = 0, busy = false;
  M.poll = function () {
    clearTimeout(pollT);
    if (busy) return;
    busy = true;
    // hoechstens 6 s warten: eine haengende Anfrage darf die Abfrage nicht dauerhaft sperren
    var p = api.demo ? Promise.resolve(demoState()) : Promise.race([fetch('/api/media', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      new Promise(function (_, no) { setTimeout(function () { no(new Error('Zeitüberschreitung')); }, 6000); })]);
    p.then(function (s) { M.st = s && s.ok !== false ? s : null; M.at = Date.now(); }, function () { M.st = null; }).then(function () {
      // Takt: 3 s bei Wiedergabe (Fortschritt rechnet lokal weiter), sonst 5 s; nach jedem Befehl sofort (M.cmd)
      busy = false; M.render(); pollT = setTimeout(M.poll, document.hidden ? 10000 : M.st && M.st.playing ? 3000 : 5000);
    });
  };
  M.cmd = function (a, x) {
    var body = { a: a }; if (x) for (var k in x) body[k] = x[k];
    var p = api.demo ? Promise.resolve(demoCmd(a, body)) : api.req('POST', '/api/media/cmd', body);
    return p.then(function (r) {
      M.poll();
      if (r && r.ok === false && r.error !== 'start') TX.toast('Wiedergabe: ' + (r.error || 'nicht ausgeführt'));
      return r;
    });
  };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) M.poll(); });

  /* ---------- Darstellung ---------- */
  var P = {
    pause: '<rect x="6" y="5" width="4.2" height="14" rx="1"/><rect x="13.8" y="5" width="4.2" height="14" rx="1"/>',
    next: '<path d="M5 5.5l9 6.5-9 6.5z"/><rect x="16" y="5.5" width="2.6" height="13" rx="1"/>',
    prev: '<path d="M19 5.5l-9 6.5 9 6.5z"/><rect x="5.4" y="5.5" width="2.6" height="13" rx="1"/>',
    voldown: '<path d="M3 9.2h3.4L11 5v14l-4.6-4.2H3z"/><rect x="14" y="10.9" width="7" height="2.2" rx="1.1"/>',
    volup: '<path d="M3 9.2h3.4L11 5v14l-4.6-4.2H3z"/><rect x="14" y="10.9" width="7" height="2.2" rx="1.1"/><rect x="16.4" y="8.5" width="2.2" height="7" rx="1.1"/>'
  };
  function ic(n) { return '<svg class="i f" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + P[n] + '</svg>'; }
  function ic30(back) {
    return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + (back ? 'M5 12a7 7 0 1 0 2.1-5' : 'M19 12a7 7 0 1 1-2.1-5') + '"/><path d="' + (back ? 'M6.5 3.5v3.8h3.8' : 'M17.5 3.5v3.8h-3.8') + '"/>' +
      '<text x="12" y="15.6" text-anchor="middle" font-size="7.6" font-weight="800" fill="currentColor" stroke="none" font-family="Roboto,sans-serif">30</text></svg>';
  }
  function artUrl(s) { return !s.art ? '' : api.demo ? 'img/apps/ytmusic.jpg' : '/api/media/art?v=' + s.art; }
  function srcCol(app) { return app === 'Hörbücher' ? 'var(--go)' : app === 'YouTube Music' || app === 'YouTube' ? '#ff3b4a' : 'var(--spd)'; }
  // Alle Knoepfe gleich gross; Wiedergabe/Pause nur durch die helle Flaeche hervorgehoben
  function ctl(s, big) {
    var hb = s.app === 'Hörbücher', c = big ? ' big' : '';
    return '<button class="mpb' + c + '" data-mp="' + (hb ? 'back30' : 'prev') + '" aria-label="' + (hb ? '30 Sekunden zurück' : 'Vorheriger Titel') + '"' + (!hb && !s.canPrev ? ' disabled' : '') + '>' + (hb ? ic30(true) : ic('prev')) + '</button>' +
      '<button class="mpb pp' + c + '" data-mp="toggle" aria-label="' + (s.playing ? 'Pause' : 'Wiedergabe') + '">' + (s.playing ? ic('pause') : I('play', 1)) + '</button>' +
      '<button class="mpb' + c + '" data-mp="' + (hb ? 'fwd30' : 'next') + '" aria-label="' + (hb ? '30 Sekunden vor' : 'Nächster Titel') + '"' + (!hb && !s.canNext ? ' disabled' : '') + '>' + (hb ? ic30(false) : ic('next')) + '</button>';
  }
  function vol(big) {
    var c = big ? ' big' : '';
    return '<button class="mpb' + c + '" data-mp="volDown" aria-label="Leiser">' + ic('voldown') + '</button><button class="mpb' + c + '" data-mp="volUp" aria-label="Lauter">' + ic('volup') + '</button>';
  }
  function html(compact) {
    var s = M.st;
    if (!s || !s.active || !s.title) return '<button class="mpe" data-mp="panel" aria-haspopup="true">' + I('music') + '<span>Musik</span></button>';
    var hb = s.app === 'Hörbücher', au = artUrl(s);
    // Kopf: nur Wiedergabe/Pause und Lautstaerke; vor, zurueck und Quelle im Player-Fenster
    var t = '<button class="mpb pp" data-mp="toggle" aria-label="' + (s.playing ? 'Pause' : 'Wiedergabe') + '">' + (s.playing ? ic('pause') : I('play', 1)) + '</button>';
    return '<div class="mp' + (compact ? ' compact' : '') + '" role="group" aria-label="Wiedergabe ' + esc(s.app) + '">' +
      '<button class="mpo" data-mp="panel" aria-haspopup="true" aria-label="Player öffnen">' + (au ? '<img src="' + esc(au) + '" alt="">' : '<span class="mpn">' + I('music') + '</span>') + '<i class="mpsrc" style="background:' + srcCol(s.app) + '"></i></button>' +
      (compact ? '' : '<button class="mpt" data-mp="panel" tabindex="-1" aria-hidden="true"><b data-k="mpti">' + esc(s.title) + '</b><small>' + esc(s.artist || s.album || s.app) + '</small></button>') +
      t + '<i class="mpdiv" aria-hidden="true"></i>' + vol(false) +
      '<i class="mpbar" data-k="mpbar" style="background:' + srcCol(s.app) + '"></i></div>';
  }
  // Fortschritt zwischen den Abfragen fortschreiben
  function frac() {
    var s = M.st; if (!s || !s.dur) return 0;
    var pos = s.pos + (s.playing ? (Date.now() - M.at) / 1000 : 0);
    return Math.max(0, Math.min(1, pos / s.dur));
  }
  M.render = function () {
    TX.$$('[data-k="mpl"]').forEach(function (el) {
      var h = html(el.classList.contains('compact'));
      if (el.getAttribute('data-h') !== h) { el.setAttribute('data-h', h); el.innerHTML = h; }
      var bar = el.querySelector('[data-k="mpbar"]'); if (bar) bar.style.width = (frac() * 100).toFixed(1) + '%';
    });
    if (mm) panelFill();
  };
  function mmss(t) { t = Math.max(0, Math.floor(t || 0)); var h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = t % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  setInterval(function () {
    TX.$$('[data-k="mpbar"]').forEach(function (b) { b.style.width = (frac() * 100).toFixed(1) + '%'; });
    var s = M.st, pt = document.querySelector('[data-k="mppos"]');
    if (pt && s) pt.textContent = mmss(s.pos + (s.playing ? (Date.now() - M.at) / 1000 : 0));
  }, 1000);

  /* ---------- Player-Fenster: Quelle, Jetzt, Steuerung, Lautstaerke ---------- */
  var mm = null, mmT = 0, mmIdle = 0;
  var SRC0 = [{ pkg: YTM, app: 'YouTube Music' }, { pkg: ABS, app: 'Hörbücher' }];
  function mmClose() { clearTimeout(mmIdle); if (mm) { mm.parentNode.removeChild(mm); mm = null; } }
  function idle() { clearTimeout(mmIdle); mmIdle = setTimeout(mmClose, 20000); }
  function srcState(x) {
    if (x.installed === false) return 'nicht installiert';
    if (x.playing) return 'spielt';
    if (x.session) return 'pausiert' + (x.title ? ' · ' + x.title : '');
    return 'nicht gestartet';
  }
  function volHtml(s, big) {
    var n = s.volMax || 15, v = s.vol || 0, seg = '';
    for (var i = 1; i <= n; i++) seg += '<i class="' + (i <= v ? 'on' : '') + '"></i>';
    return '<div class="mpvolrow">' + '<button class="mpb big" data-mp="volDown" aria-label="Leiser">' + ic('voldown') + '</button>' +
      '<div class="mpsteps" data-mpp="vol" role="slider" aria-label="Lautstärke" aria-valuemin="0" aria-valuemax="' + n + '" aria-valuenow="' + v + '">' + seg + '</div>' +
      '<button class="mpb big" data-mp="volUp" aria-label="Lauter">' + ic('volup') + '</button></div>';
  }
  // gleiches Symbol wie auf den App-Kacheln (echtes Symbol der Konsole, sonst Platzhalter der App)
  function srcIcon(x) {
    var ap = (TX.APPS || []).filter(function (y) { return y.pkg === x.pkg; })[0];
    return ap && TX.appIcon ? TX.appIcon(ap, 'mmi', 'span') : '<span class="mmi" style="background:' + srcCol(x.app) + '">' + I('music') + '</span>';
  }
  function panelHtml() {
    var s = M.st || {}, srcs = s.sources || SRC0, cur = s.active ? s.pkg : '';
    var h = '<div class="mph"><div class="lab">Musik und Hörbücher</div><button class="mpx" data-mpp="close" aria-label="Schliessen">' + I('x') + '</button></div><div class="mpsrcs">';
    srcs.forEach(function (x) {
      var on = x.pkg === cur, na = x.installed === false;
      h += '<button class="mps' + (on ? ' on' : '') + (na ? ' na' : '') + '" data-mpp="src" data-pkg="' + esc(x.pkg) + '"' + (na ? ' aria-disabled="true"' : '') + ' aria-pressed="' + on + '">' +
        srcIcon(x) + '<span class="mmt"><b>' + esc(x.app) + '</b><small>' + esc(srcState(x)) + '</small></span></button>';
    });
    h += '</div>';
    if (s.active && s.title) {
      var au = artUrl(s);
      h += '<div class="mpnow"><button class="mpcov" data-mpp="open" aria-label="' + esc(s.app) + ' öffnen">' + (au ? '<img src="' + esc(au) + '" alt="">' : I('music')) + '</button><div class="mpnt"><b>' + esc(s.title) + '</b><small>' + esc(s.artist || s.album || s.app) + '</small>' +
        '<div class="mpprog"><i data-k="mpbar" style="background:' + srcCol(s.app) + '"></i></div><div class="mptimes"><span data-k="mppos">' + mmss(s.pos) + '</span><span>' + (s.dur ? mmss(s.dur) : '') + '</span></div></div></div>' +
        '<div class="mpctl">' + ctl(s, true) + '</div>';
    } else h += '<div class="mpempty">Nichts läuft. Quelle oben wählen.</div>';
    h += '<div class="lab mpvl">Lautstärke <span>' + (s.vol || 0) + '/' + (s.volMax || 15) + '</span></div>' + volHtml(s);
    if (s.outs && s.outs.length) {
      h += '<div class="lab">Abspielgerät</div><div class="mpouts">';
      s.outs.forEach(function (o) {
        var m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(o.name || ''), nm = o.address ? (m ? m[1] : o.name) : 'Konsole';
        var typ = o.address ? (m ? m[2].replace(/\s*\w*\d+\w*$/, '').replace(/^SONOS$/i, 'Sonos') : 'Bluetooth') : 'eingebaut';
        var sub = o.busy ? 'verbindet …' : o.active ? 'spielt hier' : o.address && !o.connected ? 'nicht verbunden' : typ;
        h += '<button class="mpout' + (o.active ? ' on' : '') + '" data-mpp="out" data-addr="' + esc(o.address) + '" aria-pressed="' + !!o.active + '">' + I(o.address ? 'sound' : 'tv') +
          '<span class="mmt"><b>' + esc(nm) + '</b><small>' + esc(sub) + '</small></span></button>';
      });
      h += '</div>';
    }
    if (s.active && s.pkg) h += '<button class="btn ghost mpapp" data-mpp="open">In App öffnen</button>';
    return h;
  }
  function panelFill() {
    if (!mm) return; var h = panelHtml();
    if (mm.getAttribute('data-h') !== h) { mm.setAttribute('data-h', h); mm.innerHTML = h; }
    var bar = mm.querySelector('[data-k="mpbar"]'); if (bar) bar.style.width = (frac() * 100).toFixed(1) + '%';
  }
  function panel(anchor) {
    if (mm) { mmClose(); return; }
    var cap = anchor.closest('.mp') || anchor, r = cap.getBoundingClientRect();
    mm = document.createElement('div'); mm.className = 'mpmenu mppanel'; mm.setAttribute('role', 'dialog'); mm.setAttribute('aria-label', 'Player');
    mm.style.top = Math.round(r.bottom + 8) + 'px'; mm.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    mm.style.maxHeight = Math.max(240, Math.round(window.innerHeight - r.bottom - 8 - 116)) + 'px';   // Steuerleiste (unten 112 px) bleibt frei
    document.body.appendChild(mm); panelFill(); idle(); M.poll();
    mm.addEventListener('pointerdown', idle);
    mm.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mpp]'); if (!b) return;
      var a = b.getAttribute('data-mpp');
      if (a === 'close') mmClose();
      else if (a === 'open') { var p = M.st && M.st.pkg; mmClose(); if (p) TX.launch(p); }
      else if (a === 'vol') {
        var rr = b.getBoundingClientRect(), n = (M.st && M.st.volMax) || 15, v = Math.round((e.clientX - rr.left) / rr.width * n);
        if (M.st) M.st.vol = v; panelFill(); M.cmd('vol', { v: Math.max(0, Math.min(n, v)) });
      } else if (a === 'out') {
        var ad = b.getAttribute('data-addr');
        if (b.classList.contains('on')) return;
        if (M.st && M.st.outs) M.st.outs.forEach(function (o) { if (o.address === ad && !o.connected) o.busy = true; });
        panelFill(); M.cmd('out', { address: ad }); setTimeout(M.poll, 1500); setTimeout(M.poll, 4000);
      } else if (a === 'src') {
        if (b.classList.contains('na')) return;
        var pkg = b.getAttribute('data-pkg'), s = M.st;
        if (s && s.active && s.pkg === pkg && s.playing) return;
        M.cmd('source', { pkg: pkg }).then(function (r) { if (r && r.ok === false && r.error === 'start') { mmClose(); TX.launch(pkg); } });
      }
    });
  }
  // Lautstaerke-Anzeige unter der Kapsel (1.5 s)
  var vb = null, vbT = 0;
  function volBubble(anchor) {
    var s = M.st; if (!s || mm) return;
    var cap = anchor.closest('.mp'); if (!cap) return;
    var r = cap.getBoundingClientRect();
    if (!vb) { vb = document.createElement('div'); vb.className = 'mpvb'; vb.setAttribute('role', 'status'); document.body.appendChild(vb); }
    var n = s.volMax || 15, v = s.vol || 0;
    vb.innerHTML = '<span>Lautstärke ' + v + '/' + n + '</span><i><b style="width:' + Math.round(v / n * 100) + '%"></b></i>';
    vb.style.top = Math.round(r.bottom + 8) + 'px'; vb.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px'; vb.style.display = 'flex';
    clearTimeout(vbT); vbT = setTimeout(function () { vb.style.display = 'none'; }, 1500);
  }
  document.addEventListener('pointerdown', function (e) { if (mm && !e.target.closest('.mpmenu') && !e.target.closest('[data-mp="panel"]')) { mmClose(); mmT = Date.now(); } }, true);
  // STOP und Abbrechen wirken immer, auch wenn derselbe Tipp das Fenster schliesst
  document.addEventListener('click', function (e) { if (Date.now() - mmT < 400 && !e.target.closest('[data-mp]') && !e.target.closest(TX.STOPSEL)) { mmT = 0; e.preventDefault(); e.stopPropagation(); } }, true);
  window.addEventListener('hashchange', mmClose);
  M.closeMenu = function () { var o = !!mm; mmClose(); return o; };

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mp]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-mp');
    if (a === 'panel') panel(b);
    else if (a === 'volUp' || a === 'volDown') {
      var s = M.st; if (s) s.vol = Math.max(0, Math.min(s.volMax || 15, (s.vol || 0) + (a === 'volUp' ? 1 : -1)));
      volBubble(b); if (mm) panelFill(); M.cmd(a);
    }
    else M.cmd(a);
  });
  M.poll();
})();
