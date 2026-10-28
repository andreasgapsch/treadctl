/* Bausteine: Symbole, Formatierung, Diagramme, Halten-Wiederholen, Kurzmeldung, dazu der Rueckfall fuer die Werks-WebView
   (Chrome 74: Flex-gap-Ersatz, Knopf-Ersatz). Mit der aktuellen WebView (Chrome 156) greift dieser Rueckfall nicht. */
(function () {
  'use strict';
  var TX = window.TX = window.TX || {};

  var P = {
    run: '<circle cx="14" cy="4" r="2"/><path d="M7 21l3-6 3 2v5M10 15l2-6 4 3 3 1M8 9l4-1"/>',
    heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    fan: '<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2c-1.6-2.4-1.4-6.2 1.4-6.9 2.6-.6 3.6 2.6 1.6 4.6-.9.9-1.9 1.6-3 2.3zM13.6 13c2.9-.2 6.2 1.6 5.6 4.4-.6 2.6-3.9 2.1-4.6-.6-.3-1.2-.6-2.4-1-3.8zM10.4 13.2c-1.2 2.6-4.4 4.6-6.5 2.7-2-1.8.2-4.4 2.9-4 1.2.2 2.4.6 3.6 1.3z"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    intervals: '<path d="M3 18h3V9h4v9h3V5h4v13h4"/>',
    zones: '<path d="M4 18a8 8 0 0 1 16 0"/><path d="M12 18l4-6"/>',
    plans: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    apps: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    arrowDown: '<path d="M12 4v15M6 13l6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    // Streckenmodus: Route, USB, Download, Flagge, Berg, Ebenen, Mitfahren (Fadenkreuz), Ganze Strecke
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
    usb: '<path d="M12 3v14M12 3l-2.5 3h5zM12 13l-4-2.5V8M12 15l4-2.5V10"/><rect x="6.5" y="6.5" width="3" height="2" rx=".5"/><circle cx="16" cy="9" r="1.3"/><circle cx="12" cy="19" r="2"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    flag: '<path d="M5 21V4M5 4h13l-2.5 4L18 12H5"/>',
    mtn: '<path d="M2 20l7-12 4 6 3-4 6 10z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    // Statuszeile: WLAN (drei Boegen und Punkt), WLAN getrennt (mit Schraegstrich), Zahnrad
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 15.9a4.8 4.8 0 0 1 6.4 0M12 19.5v.01"/>',
    wifiOff: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 15.9a4.8 4.8 0 0 1 6.4 0M12 19.5v.01M3 3l18 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
  };
  /* Wechsel-, Einlauf- und Zielbanner (einheitlich, wie die Pille): erste Zeile Sekunden und Ueberschrift
     gleich gross und fett, zweite Zeile kleiner; kein Kasten um die Zahl, kein Lautsprecher (Toene bleiben). */
  TX.banHtml = function (sec, head, sub) {
    return '<div class="l1">' + (sec != null ? '<span class="bn num">' + TX.time(sec) + '</span>' : '') + '<span class="hd">' + TX.esc(head) + '</span></div>' + (sub ? '<div class="l2">' + TX.esc(sub) + '</div>' : '');
  };
  // Akzentfarbe des Streckenmodus (Tuerkis), wie Blau fuer Schnellstart und Orange fuer Intervalle
  TX.ROUTE_C = '#22c5c9';
  // Ziele, deren Tipp nie verschluckt werden darf (Menue schliessen per Tipp daneben): STOP und Abbrechen
  TX.STOPSEL = '.bigbtn.stop, [data-g="stop"], .cdx';
  TX.I = function (n, fill) {
    return '<svg class="i' + (fill ? ' f' : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (P[n] || '') + '</svg>';
  };
  TX.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  TX.$ = function (s, r) { return (r || document).querySelector(s); };
  TX.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  TX.clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  TX.r1 = function (v) { return Math.round(v * 10) / 10; };
  TX.f1 = function (v) { return (Math.round((+v || 0) * 10) / 10).toFixed(1); };
  TX.f2 = function (v) { return (Math.round((+v || 0) * 100) / 100).toFixed(2); };
  // Distanz: unter 1 km zwei Nachkommastellen, sonst eine
  TX.km = function (v) { v = +v || 0; return v < 1 ? TX.f2(v) : TX.f1(v); };
  // einheitlicher Platzhalter fuer fehlende Werte
  TX.NA = '--';
  TX.pad = function (n) { return (n < 10 ? '0' : '') + n; };
  // Zeit m:ss bzw. h:mm:ss
  TX.time = function (sec) {
    sec = Math.max(0, Math.round(+sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return h ? h + ':' + TX.pad(m) + ':' + TX.pad(s) : m + ':' + TX.pad(s);
  };
  TX.pace = function (kmh) { return kmh >= 1 ? TX.time(3600 / kmh) : '--:--'; };
  TX.WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  TX.WD2 = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  TX.MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  TX.dshort = function (ts) { var d = new Date(ts); return TX.pad(d.getDate()) + '.' + TX.pad(d.getMonth() + 1) + '.'; };
  TX.hm = function (ts) { var d = new Date(ts); return TX.pad(d.getHours()) + ':' + TX.pad(d.getMinutes()); };
  TX.uid = function (p) { return (p || 'x') + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); };

  /* ---------- Diagramm ----------
     sets: [{pts:[[x,y],...], min, max, c, step, fill, wd, band:[oben,unten], dot, tag, tagDy, lab, unit, pre, none, end}]
     opt: {xMin, xMax, split, seps:[...], gutter, pad, padB (unten, fuer Achsen darunter)} ; Breite/Hoehe aus dem Element
     gutter: Breite rechts fuer Werteetiketten je Bahn (lab gross, unit klein darunter);
     none: Hinweis mitten in der Bahn, wenn sie keine Punkte hat (noneDy verschiebt ihn senkrecht);
     end: Etikett einzeilig auf Hoehe des Kurvenendes statt mitten in der Bahn */
  var gid = 0, obs = [];
  // Groesse kann sich nach dem Zeichnen aendern (Layout, Flex-gap-Ersatz): dann neu zeichnen
  var ro = window.ResizeObserver ? new ResizeObserver(function (es) {
    es.forEach(function (e) {
      var el = e.target, a = el._tx;
      if (a && document.contains(el) && (el.clientWidth !== a.w || el.clientHeight !== a.h)) TX.chart(el, a.sets, a.opt);
    });
  }) : null;
  // Leistung: Live-Diagramme hoechstens einmal je Sekunde neu aufbauen (die letzte Anfrage folgt nach), ausser bei neuer Groesse
  // eine Nachkommastelle ohne toFixed (toFixed ist in Diagrammen mit Tausenden Punkten der groesste Posten)
  function r1(v) { return Math.round(v * 10) / 10; }
  TX.chart = function (el, sets, opt) {
    var now = Date.now(), prev = el._tx;
    if (prev && prev.at && prev.n >= 3 && now - prev.at < 900 && el.clientWidth === prev.w && el.clientHeight === prev.h) {
      prev.sets = sets; prev.opt = opt || {};
      if (!el._txT) el._txT = setTimeout(function () { el._txT = 0; if (el._tx) { el._tx.at = 0; TX.chart(el, el._tx.sets, el._tx.opt); } }, 900 - (now - prev.at));
      return;
    }
    if (el._txT) { clearTimeout(el._txT); el._txT = 0; }
    opt = opt || {};
    // Groesse aus dem Zwischenspeicher (der ResizeObserver zeichnet bei Aenderung neu): kein erzwungenes Layout mitten im Abruf
    var w = ro && prev && prev.w ? prev.w : el.clientWidth, h = ro && prev && prev.h ? prev.h : el.clientHeight;
    if (ro && !el._tx) {
      obs = obs.filter(function (o) { if (document.contains(o)) return true; ro.unobserve(o); o._tx = null; return false; });
      ro.observe(el); obs.push(el);
    }
    el._tx = { sets: sets, opt: opt, w: w, h: h, at: now, n: (prev && prev.w === w && prev.h === h ? prev.n || 0 : 0) + 1 };   // n: Zahl der Aufbauten (ab 3 gilt die Drossel)
    if (!w || !h) { el.innerHTML = ''; return; }
    var pad = opt.pad == null ? 6 : opt.pad, padB = opt.padB == null ? pad : opt.padB, ih = h - pad - padB, xMin = opt.xMin, xMax = opt.xMax;
    if (xMin == null || xMax == null) {
      xMin = Infinity; xMax = -Infinity;
      sets.forEach(function (st) { st.pts.forEach(function (p) { if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0]; }); });
    }
    if (!(xMax > xMin)) xMax = xMin + 1;
    var s = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><defs>';
    var ids = sets.map(function (st) {
      var id = 'g' + (++gid);
      s += '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + st.c + '" stop-opacity="' + (st.fill == null ? 0.28 : st.fill) +
        '"/><stop offset="1" stop-color="' + st.c + '" stop-opacity="0"/></linearGradient>';
      return id;
    });
    s += '</defs>';
    var zw = w - (opt.gutter || 0);
    (opt.zones || []).forEach(function (z) {
      var top = pad + ih * z.band[0], hh = ih * (z.band[1] - z.band[0]);
      var y1 = top + hh * (1 - (z.hi - z.min) / (z.max - z.min)), y0 = top + hh * (1 - (z.lo - z.min) / (z.max - z.min));
      s += '<rect x="0" y="' + r1(y1) + '" width="' + zw + '" height="' + r1(Math.max(2, y0 - y1)) + '" fill="rgba(61,139,255,.12)"/>' +
        '<line x1="0" x2="' + zw + '" y1="' + r1(y1) + '" y2="' + r1(y1) + '" stroke="rgba(61,139,255,.7)" stroke-dasharray="3 3"/>' +
        '<line x1="0" x2="' + zw + '" y1="' + r1(y0) + '" y2="' + r1(y0) + '" stroke="rgba(61,139,255,.7)" stroke-dasharray="3 3"/>';
    });
    var gut = opt.gutter || 0, pw = w - gut;
    (opt.split ? [opt.split] : []).concat(opt.seps || []).forEach(function (sp) {
      var ys = r1(pad + ih * sp);
      s += '<line x1="0" x2="' + w + '" y1="' + ys + '" y2="' + ys + '" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 5"/>';
    });
    var tagR = opt.tagRight == null ? 10 : opt.tagRight, FF = ' font-family="Roboto,sans-serif"';
    sets.forEach(function (st, k) {
      var pts = st.pts;
      var b0 = st.band ? st.band[0] : 0, b1 = st.band ? st.band[1] : 1;
      var top = pad + ih * b0, hh = ih * (b1 - b0), base = top + hh;
      var has = pts && pts.length;
      // Werteetikett rechts in der Bahn (zweizeilig: Wert, darunter Einheit)
      if (gut && st.lab != null && !st.end) {
        var cy = top + hh / 2, big = Math.min(24, Math.max(15, hh * 0.32));
        s += '<text x="' + (w - 4) + '" y="' + r1(cy + (st.unit ? 2 : big * 0.35)) + '" text-anchor="end" fill="' + st.c + '" font-size="' + big.toFixed(0) + '" font-weight="800"' + FF + '>' + TX.esc(st.lab) + '</text>';
        if (st.unit) s += '<text x="' + (w - 4) + '" y="' + r1(cy + 4 + big * 0.62) + '" text-anchor="end" fill="#a4a9bb" font-size="13" font-weight="700"' + FF + '>' + TX.esc(st.unit) + '</text>';
      }
      if (!has) {
        if (st.none) s += '<text x="' + r1(pw / 2) + '" y="' + r1(top + hh / 2 + 5 + (st.noneDy || 0)) + '" text-anchor="middle" fill="#a4a9bb" font-size="15" font-weight="700"' + FF + '>' + TX.esc(st.none) + '</text>';
        if (gut && st.lab != null && st.end) s += endLab(st, top + hh / 2, top, base);
        return;
      }
      var mn = st.min, mx = st.max; if (!(mx > mn)) mx = mn + 1;
      var xs = function (x) { return (x - xMin) / (xMax - xMin) * pw; };
      var yv = function (v) { return top + hh * (1 - (TX.clamp(v, mn, mx) - mn) / (mx - mn)); };
      // hoechstens etwa ein Punkt je Bildpunktspalte (lange Laeufe: Tausende Punkte), Anfang und Ende bleiben
      var P2 = [], lastCol = -1e9;
      for (var q = 0; q < pts.length; q++) { var px = xs(pts[q][0]); if (q === pts.length - 1 || px - lastCol >= 1 || st.step) { P2.push([px, yv(pts[q][1])]); lastCol = px; } }
      if (P2.length === 1) P2.push([P2[0][0] + 1, P2[0][1]]);
      var d = '';
      if (st.step) {
        P2.forEach(function (p, i) { d += i ? 'H' + r1(p[0]) + 'V' + r1(p[1]) : 'M' + r1(p[0]) + ' ' + r1(p[1]); });
        if (st.stepEnd != null) d += 'H' + r1(xs(st.stepEnd));
      } else {
        P2.forEach(function (p, i) { d += (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); });
      }
      var last = st.step && st.stepEnd != null ? [xs(st.stepEnd), P2[P2.length - 1][1]] : P2[P2.length - 1];
      var x0 = r1(P2[0][0]);
      if (st.fill !== 0) s += '<path d="' + d + 'L' + r1(last[0]) + ' ' + base + 'L' + x0 + ' ' + base + 'Z" fill="url(#' + ids[k] + ')"/>';
      s += '<path d="' + d + '" stroke="' + st.c + '" stroke-width="' + (st.wd || 2.6) + '" fill="none" stroke-linejoin="round"/>';
      if (st.dot !== false) s += '<circle cx="' + r1(last[0]) + '" cy="' + r1(last[1]) + '" r="5" fill="' + st.c + '" stroke="#000" stroke-width="2"/>';
      if (st.tag) s += '<text x="' + r1(last[0] - tagR) + '" y="' + r1(last[1] - 10 + (st.tagDy || 0)) + '" text-anchor="end" fill="' + st.c + '" font-size="13" font-weight="800" font-family="Roboto,sans-serif">' + TX.esc(st.tag) + '</text>';
      // Endwert-Etikett auf Hoehe des Kurvenendes, einzeilig «Wert Einheit»
      if (gut && st.lab != null && st.end) {
        if (last[0] < pw - 2) s += '<line x1="' + r1(last[0]) + '" x2="' + r1(pw) + '" y1="' + r1(last[1]) + '" y2="' + r1(last[1]) + '" stroke="' + st.c + '" stroke-opacity=".5" stroke-dasharray="2 3"/>';
        s += endLab(st, last[1], top, base);
      }
    });
    function endLab(st, y, top, base) {
      var big = 22, ly = TX.clamp(y + big * 0.36, top + big * 0.8, base);
      // pre: kleines Vorwort vor dem Wert («Ist» im Lauf, «Soll» vor dem Start)
      return '<text x="' + (w - 4) + '" y="' + r1(ly) + '" text-anchor="end" fill="' + st.c + '" font-size="' + big + '" font-weight="800"' + FF + '>' +
        (st.pre ? '<tspan fill="#d3d6e0" font-size="15" font-weight="700">' + TX.esc(st.pre) + '</tspan><tspan dx="4">' + TX.esc(st.lab) + '</tspan>' : TX.esc(st.lab)) +
        (st.unit ? '<tspan dx="4" fill="#a4a9bb" font-size="13" font-weight="700">' + TX.esc(st.unit) + '</tspan>' : '') + '</text>';
    }
    el.innerHTML = s + '</svg>';
  };

  /* ---------- Flex-gap-Ersatz fuer die Werks-WebView (Chrome < 84; aktuell ungenutzt, mit ?nogap=1 pruefbar) ----------
     Liest gap einmal aus, setzt Abstaende als Rand der Kinder und gap auf 0 (so auch mit ?nogap=1 pruefbar). */
  TX.flexGapOk = (function () {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    d.appendChild(document.createElement('div')); d.appendChild(document.createElement('div'));
    document.documentElement.appendChild(d);
    var ok = d.scrollHeight === 1; d.parentNode.removeChild(d);
    if (/[?&]nogap=1/.test(location.search)) ok = false;
    return ok;
  })();
  function fixGap(root) {
    if (TX.flexGapOk || !root || root.nodeType !== 1) return;
    var list = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    list.forEach(function (el) {
      if (el instanceof SVGElement) return;
      var cs = getComputedStyle(el);
      if (cs.display !== 'flex' && cs.display !== 'inline-flex') return;
      var cg = el.getAttribute('data-cg'), rg = el.getAttribute('data-rg');
      if (cg == null) {
        cg = parseFloat(cs.columnGap) || 0; rg = parseFloat(cs.rowGap) || 0;
        el.setAttribute('data-cg', cg); el.setAttribute('data-rg', rg);
        if (cg || rg) { el.style.columnGap = '0px'; el.style.rowGap = '0px'; }
      }
      cg = +cg; rg = +rg; if (!cg && !rg) return;
      // Textknoten koennen keinen Rand tragen: in span einpacken, wenn sie neben Elementen stehen
      if (el.childNodes.length > 1) Array.prototype.slice.call(el.childNodes).forEach(function (n) {
        if (n.nodeType === 3 && n.nodeValue.trim()) { var sp = document.createElement('span'); sp.setAttribute('data-gw', '1'); el.insertBefore(sp, n); sp.appendChild(n); }
      });
      var col = cs.flexDirection.indexOf('column') === 0, wrap = cs.flexWrap !== 'nowrap', first = true;
      if (wrap && rg && !el.getAttribute('data-gb') && cs.marginBottom === '0px') { el.style.marginBottom = -rg + 'px'; el.setAttribute('data-gb', '1'); }
      Array.prototype.forEach.call(el.children, function (c) {
        var ccs = getComputedStyle(c);
        if (ccs.display === 'none' || ccs.position === 'absolute' || ccs.position === 'fixed') return;
        if (wrap) { c.style.marginRight = cg + 'px'; c.style.marginBottom = rg + 'px'; return; }
        if (first) { first = false; return; }
        var prop = col ? 'marginTop' : 'marginLeft';
        if (c.getAttribute('data-gm') || ccs[prop] === '0px') { c.style[prop] = (col ? rg : cg) + 'px'; c.setAttribute('data-gm', '1'); }
      });
    });
  }
  TX.fixGap = fixGap;
  if (!TX.flexGapOk) {
    document.documentElement.classList.add('no-fgap');
    var pend = [], raf = 0;
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        for (var i = 0; i < m.addedNodes.length; i++) {
          var n = m.addedNodes[i];
          if (n.nodeType === 1 && !(n instanceof SVGElement)) pend.push(n.parentNode && n.parentNode.nodeType === 1 ? n.parentNode : n);
        }
      });
      if (pend.length && !raf) raf = requestAnimationFrame(function () {
        raf = 0; var p = pend; pend = [];
        p.forEach(function (n) { if (document.contains(n)) fixGap(n); });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ---------- Halten: sofort ausloesen, nach 500 ms alle 250 ms wiederholen ---------- */
  TX.holdRepeat = function (btn, fn) {
    var t1 = 0, t2 = 0, n = 0, pid = null;
    function stop() { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; pid = null; btn.classList.remove('held'); }
    btn.addEventListener('pointerdown', function (e) {
      if (btn.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault(); stop(); pid = e.pointerId; n = 0;
      try { btn.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
      btn.classList.add('held'); fn(0);
      t1 = setTimeout(function () { t2 = setInterval(function () { if (btn.disabled) { stop(); return; } fn(++n); }, 250); }, 500);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { btn.addEventListener(ev, function (e) { if (pid === null || e.pointerId === pid) stop(); }); });
    // Tastatur (Enter/Leertaste) erzeugt click mit detail 0
    btn.addEventListener('click', function (e) { if (e.detail === 0 && !btn.disabled) fn(0); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return stop;
  };

  /* ---------- Kurzmeldung ---------- */
  var tt = 0;
  TX.toast = function (msg, ms) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on'); clearTimeout(tt);
    tt = setTimeout(function () { t.classList.remove('on'); }, ms || 3200);
  };

  /* ---------- Ton (WebAudio, 80 ms) ---------- */
  var actx = null;
  TX.audioUnlock = function () {
    try {
      if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  };
  TX.beep = function (hz) {
    try {
      TX.audioUnlock(); if (!actx) return;
      var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'sine'; o.frequency.value = hz || 880;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      g.gain.setValueAtTime(0.5, t + 0.07); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.09);
    } catch (e) { /* ohne Ton weiter */ }
  };
})();

/* Chrome vor 83 (WebView der Konsole: 74) kann <button> nicht als Flex-Container darstellen.
   Karten-Knoepfe werden dort in <div role="button"> umgebaut; Ereignisse laufen ueber data-Attribute. */
(function () {
  var m = navigator.userAgent.match(/Chrome\/(\d+)/), v = m ? +m[1] : 999;
  if (v >= 83) return;
  var RX = /(^|\s)(card|app|trow|mode|hrun|ap|tpl|tab|chip)(\s|$)/;
  function fix(root) {
    var bs = (root.querySelectorAll ? root.querySelectorAll('button') : []);
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i]; if (!RX.test(b.className)) continue;
      var d = document.createElement('div');
      for (var k = 0; k < b.attributes.length; k++) d.setAttribute(b.attributes[k].name, b.attributes[k].value);
      d.setAttribute('role', b.getAttribute('role') || 'button'); d.setAttribute('tabindex', '0');
      while (b.firstChild) d.appendChild(b.firstChild);
      b.parentNode.replaceChild(d, b);
    }
  }
  new MutationObserver(function (ms) { ms.forEach(function (mu) { for (var i = 0; i < mu.addedNodes.length; i++) if (mu.addedNodes[i].nodeType === 1) fix(mu.addedNodes[i].parentNode || mu.addedNodes[i]); }); })
    .observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { fix(document); });
  var st = document.createElement('style'); st.textContent = 'div[role=button]{cursor:pointer;-webkit-user-select:none;user-select:none}'; document.head.appendChild(st);
})();
