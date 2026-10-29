/* Streckenmodus: Bibliothek (API oder Demo), GPX/TCX-Import mit swisstopo-Hoehen, Kartenvorschau, Hoehenprofil, Leaflet-Karte. */
(function () {
  'use strict';
  var TX = window.TX, api = TX.api;
  var R = TX.rte = { cache: {}, metaCache: null };

  /* ---------- Formate ---------- */
  // Pace m:ss aus Sekunden je km
  R.pace = function (spk) { return spk > 0 && isFinite(spk) ? TX.time(spk) : '--:--'; };
  R.km = function (m) { return TX.f1((+m || 0) / 1000); };
  // Vorzeichen als echtes Minus
  R.signTime = function (s) { s = Math.round(+s || 0); return (s < 0 ? '−' : '+') + TX.time(Math.abs(s)); };
  R.ART = { strasse: 'Strasse', trail: 'Trail' };

  /* ---------- Geo ---------- */
  function hav(a, b) {
    var Rr = 6371008.8, p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dp = p2 - p1, dl = (b[1] - a[1]) * Math.PI / 180;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * Rr * Math.asin(Math.sqrt(h));
  }
  R.hav = hav;
  // WGS84 -> LV95 (Naeherung swisstopo, wie strecke-bauen.py)
  R.lv95 = function (lat, lon) {
    var p = (lat * 3600 - 169028.66) / 10000, l = (lon * 3600 - 26782.5) / 10000;
    var e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l * l * l;
    var n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p * p * p;
    return [e, n];
  };
  R.inCh = function (lat, lon) { return lat >= 45.8 && lat <= 47.9 && lon >= 5.9 && lon <= 10.6; };
  R.routeInCh = function (r) {
    if (r.bbox && r.bbox.length === 4) return R.inCh(r.bbox[0], r.bbox[1]) && R.inCh(r.bbox[2], r.bbox[3]);
    var pts = r.pts || r.thumb || [];
    for (var i = 0; i < pts.length; i += 20) if (!R.inCh(pts[i][0], pts[i][1])) return false;
    return pts.length > 0;
  };
  // Richtung in Grad (0 = Nord, im Uhrzeigersinn)
  R.bearing = function (a, b) {
    var p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dl = (b[1] - a[1]) * Math.PI / 180;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  /* ---------- GPX und TCX lesen ---------- */
  function kids(el, name) { var o = []; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if ((c.localName || c.nodeName) === name) o.push(c); return o; }
  function first(el, name) { var a = el.getElementsByTagNameNS ? el.getElementsByTagNameNS('*', name) : el.getElementsByTagName(name); return a && a.length ? a[0] : null; }
  function all(el, name) { return Array.prototype.slice.call(el.getElementsByTagNameNS ? el.getElementsByTagNameNS('*', name) : el.getElementsByTagName(name)); }
  function num(s) { var v = parseFloat(s); return isFinite(v) ? v : null; }
  /** Text einer GPX- oder TCX-Datei -> {pts: [[lat, lon, ele|null]], name, kind}. Wirft Error mit verstaendlicher Meldung. */
  R.parse = function (text) {
    if (!text || typeof text !== 'string') throw new Error('Datei ist leer oder nicht lesbar');
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Datei ist kein gültiges GPX oder TCX');
    var root = doc.documentElement, rn = (root.localName || root.nodeName).toLowerCase(), out = [], name = '', kind;
    if (rn === 'gpx') {
      kind = 'gpx';
      var tp = all(root, 'trkpt'); if (!tp.length) tp = all(root, 'rtept');
      tp.forEach(function (e) {
        var la = num(e.getAttribute('lat')), lo = num(e.getAttribute('lon')), el = kids(e, 'ele')[0];
        if (la == null || lo == null) return;
        out.push([la, lo, el ? num(el.textContent) : null]);
      });
      var nm = first(root, 'trk') || first(root, 'rte') || first(root, 'metadata');
      var ne = nm ? kids(nm, 'name')[0] : null; name = ne ? ne.textContent.trim() : '';
    } else if (rn === 'trainingcenterdatabase') {
      kind = 'tcx';
      all(root, 'Trackpoint').forEach(function (e) {
        var pos = kids(e, 'Position')[0]; if (!pos) return;
        var la = kids(pos, 'LatitudeDegrees')[0], lo = kids(pos, 'LongitudeDegrees')[0], al = kids(e, 'AltitudeMeters')[0];
        if (!la || !lo) return;
        var a = num(la.textContent), b = num(lo.textContent); if (a == null || b == null) return;
        out.push([a, b, al ? num(al.textContent) : null]);
      });
      var c = first(root, 'Course'), cn = c ? kids(c, 'Name')[0] : null; name = cn ? cn.textContent.trim() : '';
    } else throw new Error('Unbekanntes Format: erwartet GPX oder TCX');
    out = out.filter(function (p) { return Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180; });
    if (out.length < 2) throw new Error('Keine Streckenpunkte in der Datei');
    return { pts: out, name: name.slice(0, 80), kind: kind };
  };

  /* GPS-Zittern glaetten: gleitendes Mittel ueber 3 Punkte, nur wo beide Nachbarn naeher als 15 m liegen (dichte Aufzeichnung)
     und nur bei Zickzack (Drehrichtung wechselt gegenueber einem Nachbarpunkt). Gleichmaessige Kurven bleiben, sonst wuerden
     Kurven geschnitten und die Strecke kuerzer (bei 10-m-Punkten bis 2 %). */
  R.dejitter = function (pts) {
    var o = pts.map(function (p) { return p.slice(); }), n = pts.length, turn = [0], i;
    for (i = 1; i < n - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1], k = Math.cos(b[0] * Math.PI / 180);
      var cr = ((b[1] - a[1]) * k) * (c[0] - b[0]) - (b[0] - a[0]) * ((c[1] - b[1]) * k);
      turn.push(cr > 0 ? 1 : cr < 0 ? -1 : 0);
    }
    turn.push(0);
    for (i = 1; i < n - 1; i++) {
      var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      var zig = turn[i] !== 0 && ((turn[i - 1] !== 0 && turn[i - 1] !== turn[i]) || (turn[i + 1] !== 0 && turn[i + 1] !== turn[i]));
      if (zig && hav(p0, p1) < 15 && hav(p1, p2) < 15) {
        o[i][0] = (p0[0] + p1[0] + p2[0]) / 3; o[i][1] = (p0[1] + p1[1] + p2[1]) / 3;
        if (p0[2] != null && p1[2] != null && p2[2] != null) o[i][2] = (p0[2] + p1[2] + p2[2]) / 3;
      }
    }
    return o;
  };
  R.lenOf = function (pts) { var d = 0; for (var i = 1; i < pts.length; i++) d += hav(pts[i - 1], pts[i]); return d; };

  /* Alle step m neu abtasten (wie strecke-bauen.py): [[lat, lon, ele|null, dist]], D */
  R.resample = function (pts, step) {
    step = step || 10;
    var cum = [0], i;
    for (i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    var D = cum[cum.length - 1], res = [], j = 0, x = 0;
    if (!(D > 0)) throw new Error('Strecke hat keine Länge');
    for (;;) {
      while (j < pts.length - 2 && cum[j + 1] < x) j++;
      var seg = cum[j + 1] - cum[j], t = seg > 0 ? (x - cum[j]) / seg : 0; t = Math.max(0, Math.min(1, t));
      var a = pts[j], b = pts[j + 1];
      var ele = a[2] == null || b[2] == null ? null : a[2] + t * (b[2] - a[2]);
      res.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), ele, x]);
      if (x >= D) break;
      x = Math.min(D, x + step);
    }
    return { res: res, D: D };
  };

  /* Nur beim Import und nur als Verbesserung: Hoehen von swisstopo (profile.json, LV95), je Anfrage hoechstens 3000 Punkte,
     Abbruch nach 8 s (dann bleiben die GPX-Hoehen). Zuordnung ueber das Feld dist
     (die Antwort kann einen Punkt mehr enthalten). onProg(done, total). */
  R.SWISSTOPO = 'https://api3.geo.admin.ch/rest/services/profile.json';
  R.swisstopo = function (res, onProg) {
    var out = [], chunks = [];
    for (var k = 0; k < res.length; k += 3000) chunks.push(res.slice(k, k + 3000));
    var i = 0;
    function next() {
      if (i >= chunks.length) return Promise.resolve(out);
      var chunk = chunks[i++], coords = chunk.map(function (p) { var c = R.lv95(p[0], p[1]); return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100]; });
      var body = 'geom=' + encodeURIComponent(JSON.stringify({ type: 'LineString', coordinates: coords })) + '&sr=2056&nb_points=' + coords.length + '&distinct_points=true';
      var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
      return fetch(R.SWISSTOPO, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error('swisstopo HTTP ' + r.status); return r.json(); })
        .then(function (r) {
          if (!Array.isArray(r) || r.length < 2) throw new Error('swisstopo: Antwort leer');
          var rd = r.map(function (x) { return +x.dist; }), ra = r.map(function (x) { var a = x.alts || {}; return a.COMB != null ? +a.COMB : +a.DTM2; });
          var cd = [0], q, jj = 0;
          for (q = 1; q < coords.length; q++) cd.push(cd[q - 1] + Math.sqrt(Math.pow(coords[q][0] - coords[q - 1][0], 2) + Math.pow(coords[q][1] - coords[q - 1][1], 2)));
          cd.forEach(function (x) {
            while (jj < rd.length - 2 && rd[jj + 1] < x) jj++;
            var t = rd[jj + 1] > rd[jj] ? (x - rd[jj]) / (rd[jj + 1] - rd[jj]) : 0; t = Math.max(0, Math.min(1, t));
            out.push(ra[jj] + t * (ra[jj + 1] - ra[jj]));
          });
          if (onProg) onProg(out.length, res.length);
          return next();
        }, function (e) { clearTimeout(tm); throw e; });
    }
    return next();
  };

  /* Hoehenmeter mit derselben Glaettung wie der Dienst (Mittel ueber 50 m Strasse, 30 m Trail) */
  R.upDown = function (eles, art) {
    var w = art === 'trail' ? 1 : 2, n = eles.length, es = [], up = 0, down = 0, i, q;
    for (i = 0; i < n; i++) { var s = 0, c = 0; for (q = Math.max(0, i - w); q <= Math.min(n - 1, i + w); q++) { s += eles[q]; c++; } es.push(s / c); }
    for (i = 1; i < n; i++) { var d = es[i] - es[i - 1]; if (d > 0) up += d; else down -= d; }
    return { up: up, down: down, es: es };
  };
  // Vorschlag Art: Trail ab 40 Hoehenmetern je km
  R.suggestArt = function (D, up) { return up / Math.max(0.1, D / 1000) > 40 ? 'trail' : 'strasse'; };

  R.slug = function (s) {
    var t = String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[éèê]/g, 'e').replace(/[àâ]/g, 'a')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return t || 'strecke';
  };
  // Duenne Linie fuer Vorschauen: n Punkte [lat, lon, Hoehe]
  R.thumb = function (pts, n) {
    n = n || 120; var o = [], f = Math.max(1, (pts.length - 1) / (n - 1));
    var q = function (p) { return [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5, Math.round(+p[2] || 0)]; };
    for (var i = 0; i < n - 1 && Math.round(i * f) < pts.length; i++) o.push(q(pts[Math.round(i * f)]));
    o.push(q(pts[pts.length - 1]));
    return o;
  };
  // Profil aus der duennen Linie (Distanz aus den Punkten) fuer kleine Vorschauen
  R.thumbProf = function (th, D) {
    var d = [0], i; for (i = 1; i < th.length; i++) d.push(d[i - 1] + hav(th[i - 1], th[i]));
    var f = D && d[d.length - 1] > 0 ? D / d[d.length - 1] : 1;
    return th.map(function (p, k) { return [d[k] * f, p[2] || 0]; });
  };

  /** Datei-Text -> fertige Streckendatei. o: {name, art|null, fileName}; onProg(text, frac). Ergebnis {route, warn}. */
  R.fromText = function (text, o, onProg) {
    o = o || {};
    var prog = onProg || function () {};
    return new Promise(function (res) { res(R.parse(text)); }).then(function (g) {
      prog('Punkte glätten und neu abtasten', 0.1);
      var rawD = R.lenOf(g.pts), rs = R.resample(R.dejitter(g.pts), 10), pts = rs.res, warn = '', src = 'gpx';
      var ch = true; for (var i = 0; i < pts.length; i += 20) if (!R.inCh(pts[i][0], pts[i][1])) { ch = false; break; }
      if (!R.inCh(pts[pts.length - 1][0], pts[pts.length - 1][1])) ch = false;
      var hasEle = pts.every(function (p) { return p[2] != null; });
      var heights = ch ? (prog('Höhen von swisstopo holen', 0.2), R.swisstopo(pts, function (d, n) { prog('Höhen von swisstopo holen', 0.2 + 0.7 * d / n); })
        .then(function (al) { src = 'swisstopo swissALTI3D'; return al; }, function () {
          if (!hasEle) throw new Error('Keine Verbindung zu swisstopo und die Datei enthält keine Höhen');
          warn = 'Ohne Internet: Höhen aus der GPX-Datei übernommen (ungenauer).';
          return null;
        })) : Promise.resolve(null);
      if (!ch && !hasEle) throw new Error('Höhen fehlen und die Strecke liegt nicht in der Schweiz');
      return heights.then(function (al) {
        if (al) pts.forEach(function (p, k) { p[2] = al[k]; });
        prog('Höhenmeter berechnen', 0.95);
        var eles = pts.map(function (p) { return p[2]; });
        var ud0 = R.upDown(eles, 'strasse'), art = o.art || R.suggestArt(rs.D, ud0.up), ud = R.upDown(eles, art);
        var lats = pts.map(function (p) { return p[0]; }), lons = pts.map(function (p) { return p[1]; });
        var d = new Date(), nm = (o.name || g.name || String(o.fileName || 'Strecke').replace(/\.(gpx|tcx)$/i, '').replace(/[_]+/g, ' ')).trim().slice(0, 80);
        var r = { id: R.slug(nm), name: nm, ort: '', art: art, quelle: o.fileName ? 'Import ' + o.fileName : 'Import', offiziell: false, hinweis: '', datum: '',
          importiert: TX.pad(d.getDate()) + '.' + TX.pad(d.getMonth() + 1) + '.' + d.getFullYear(), hoehe: src, d: Math.round(rs.D), up: Math.round(ud.up), down: Math.round(ud.down),
          bbox: [Math.round(Math.min.apply(null, lats) * 1e5) / 1e5, Math.round(Math.min.apply(null, lons) * 1e5) / 1e5, Math.round(Math.max.apply(null, lats) * 1e5) / 1e5, Math.round(Math.max.apply(null, lons) * 1e5) / 1e5],
          pts: pts.map(function (p) { return [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6, Math.round(p[2] * 10) / 10, Math.round(p[3] * 10) / 10]; }) };
        r.prof = r.pts.map(function (p) { return [p[3], p[2]]; });
        r.thumb = R.thumb(r.pts, 120);
        r.artVorschlag = R.suggestArt(rs.D, ud0.up);
        prog('Fertig', 1);
        return { route: r, warn: warn, kind: g.kind, rawD: rawD, n: g.pts.length };
      });
    });
  };
  // Hoehenmeter nach Wechsel der Art neu rechnen
  R.reArt = function (r, art) { var ud = R.upDown(r.pts.map(function (p) { return p[2]; }), art); r.art = art; r.up = Math.round(ud.up); r.down = Math.round(ud.down); return r; };

  /* ---------- Bibliothek: Dienst oder Demo ---------- */
  // Beispielstrecken: Veranstalterstrecken (nur privat) und eigene freie Strecken (OSM/swisstopo); doppelte Kennungen nur einmal
  var SAMPLES = ['homberg-runde', 'hallwilersee-runde', 'arosa-weisshorn', 'homberg-runde', 'hallwilersee-runde', 'arosa-weisshorn']
    .filter(function (id, i, a) { return a.indexOf(id) === i; }), DKEY = 'tx.demo.routes.v1';
  function meta(o, sample) {
    var m = {};
    ['id', 'name', 'ort', 'quelle', 'art', 'd', 'up', 'down', 'bbox', 'datum', 'hinweis', 'offiziell', 'thumb', 'importiert'].forEach(function (k) { if (k in o) m[k] = o[k]; });
    m.sample = !!sample; return m;
  }
  function demoOwn() { var o = TX.load(DKEY, {}); return o && typeof o === 'object' ? o : {}; }
  function getJson(u) {
    var ctl = window.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    return fetch(u, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(r.status === 404 ? 'Strecke nicht gefunden' : 'HTTP ' + r.status); return r.json(); },
      function (e) { clearTimeout(t); throw e; });
  }
  R.list = function () {
    if (api.demo) {
      var own = demoOwn(), out = Object.keys(own).map(function (k) { return meta(own[k], false); });
      return Promise.all(SAMPLES.map(function (id) { return R.get(id).then(function (o) { return meta(o, true); }, function () { return null; }); }))
        .then(function (l) { out = out.concat(l.filter(Boolean)); R.metaCache = out; return out; });
    }
    return getJson('/api/routes').then(function (l) { R.metaCache = Array.isArray(l) ? l : []; return R.metaCache; });
  };
  R.get = function (id) {
    if (R.cache[id]) return Promise.resolve(R.cache[id]);
    var p;
    if (api.demo) {
      var own = demoOwn();
      p = own[id] ? Promise.resolve(JSON.parse(JSON.stringify(own[id]))) : (SAMPLES.indexOf(id) >= 0 ? getJson('strecken/' + id + '.json') : Promise.reject(new Error('Strecke nicht gefunden')));
    } else p = getJson('/api/routes/' + encodeURIComponent(id));
    return p.then(function (o) { if (!o || !o.pts || !o.prof) throw new Error('Streckendatei unvollständig'); R.cache[id] = o; return o; });
  };
  R.save = function (r) {
    if (!/^[a-z0-9-]{1,48}$/.test(r.id)) return Promise.resolve({ ok: false, error: 'Kennung ungültig' });
    if (api.demo) {
      var own = demoOwn(); own[r.id] = r; if (!TX.save(DKEY, own)) return Promise.resolve({ ok: false, error: 'Speicher voll' });
      R.cache[r.id] = r; R.metaCache = null; return Promise.resolve({ ok: true });
    }
    return api.req('POST', '/api/routes', r).then(function (o) { if (o.ok) { R.cache[r.id] = r; R.metaCache = null; } return o; });
  };
  R.del = function (id) {
    delete R.cache[id]; R.metaCache = null;
    if (api.demo) { var own = demoOwn(); if (!own[id]) return Promise.resolve({ ok: false, error: 'nur eigene Strecken lassen sich löschen' }); delete own[id]; TX.save(DKEY, own); return Promise.resolve({ ok: true }); }
    return api.req('DELETE', '/api/routes/' + encodeURIComponent(id));
  };
  // eindeutige Kennung neben den vorhandenen
  R.uniqueId = function (base, list) {
    var ids = (list || []).map(function (m) { return m.id; }), id = base.slice(0, 44), n = 2;
    while (ids.indexOf(id) >= 0) id = base.slice(0, 44) + '-' + (n++);
    return id;
  };

  /* ---------- Kacheln ---------- */
  /* Im Betrieb haengt nichts vom Internet ab: Kacheln kommen nur vom Dienst (/tiles), der nur vorhandene liefert
     (Offline-Paket der Beispiele, beim Import vorgeladen). Nur Luftbild der Schweiz «luft» (swisstopo SWISSIMAGE); ausserhalb ohne Hintergrund. */
  R.tileSrc = function (r) { return R.routeInCh(r) ? 'luft' : null; };
  R.ZMIN = 12; R.ZMAX = 16;
  var demoPre = null;
  R.prefetch = function (src, pts) {
    var thin = [], last = -1e9;
    pts.forEach(function (p) { if (p[3] - last >= 100) { thin.push([p[0], p[1]]); last = p[3]; } });
    if (api.demo) { demoPre = { at: Date.now(), total: Math.min(1400, thin.length * 6) }; return Promise.resolve({ ok: true }); }
    return api.req('POST', '/api/tiles/prefetch', { src: src, pts: thin, zmin: R.ZMIN, zmax: R.ZMAX });
  };
  // Abdeckung: wie viele Kacheln entlang der Strecke hat der Dienst (POST /api/tiles/coverage, mit Token)
  R.coverage = function (src, pts, r) {
    var thin = [], last = -1e9;
    pts.forEach(function (p) { if (p[3] - last >= 250) { thin.push([p[0], p[1]]); last = p[3]; } });
    // Demo: eigene Strecke, die ohne Internet importiert wurde, hat keine Kacheln
    if (api.demo) return Promise.resolve({ ok: true, have: r && r.karte === false ? 0 : thin.length * 3, total: thin.length * 3 });
    return api.req('POST', '/api/tiles/coverage', { src: src, pts: thin });
  };
  R.tileStatus = function () {
    if (api.demo) {
      if (!demoPre) return Promise.resolve({ busy: false, done: 0, total: 0 });
      var dn = Math.min(demoPre.total, Math.round((Date.now() - demoPre.at) / 3000 * demoPre.total));
      return Promise.resolve({ busy: dn < demoPre.total, done: dn, total: demoPre.total });
    }
    return getJson('/api/tiles/status').catch(function () { return null; });
  };

  /* ---------- Vorlieben je Strecke (Zielzeit, Verteilung, Steigung, Karte) ---------- */
  var PK = 'tx.routeprefs.v1';
  R.prefs = function (id) { var a = TX.load(PK, {}) || {}; return a[id] || null; };
  R.setPrefs = function (id, o) { var a = TX.load(PK, {}) || {}; a[id] = o; TX.save(PK, a); };

  /* ---------- Planauswertung aus prog.secs [[a, b, s, i, g, tA]] ---------- */
  R.kmPaces = function (secs, D) {
    var out = [], n = Math.ceil(D / 1000 - 1e-9);
    for (var k = 0; k < n; k++) {
      var a = k * 1000, b = Math.min(D, a + 1000), t = 0;
      secs.forEach(function (s) { var l = Math.min(b, s[1]) - Math.max(a, s[0]); if (l > 0) t += l / (s[2] / 3.6); });
      out.push({ k: k + 1, a: a, b: b, t: t, pace: b > a ? t / ((b - a) / 1000) : 0 });
    }
    return out;
  };
  R.planInfo = function (secs) {
    var lo = 99, hi = 0, steep = null, flatDown = 0;
    secs.forEach(function (s) {
      lo = Math.min(lo, s[2]); hi = Math.max(hi, s[2]);
      if (!steep || s[4] > steep[4]) steep = s;
      if (s[4] < -0.75) flatDown += s[1] - s[0];
    });
    return { lo: lo, hi: hi, steep: steep, flatDown: flatDown };
  };

  /* Naechster Wechsel wie in der Pille: Steigung ab 1 % oder Tempo ab 1 km/h; sec = Sekunden bis zum Wechsel beim aktuellen Tempo */
  /* wie die Pille (OverlayService.changeCheck): Abstand bis zum Beginn des Wechsels inklusive Steigungsvorlauf (toChange),
     im letzten Abschnitt bis zum Ziel (toFinish); Richtung und Schwelle gegen das aktuelle Soll (tIncl, tSpeed) */
  R.change = function (pr, st) {
    if (!pr || !pr.sec || !st) return null;
    var nx = pr.next, fin = !nx, v = Math.max(1, st.speed || 0) / 3.6;
    var to = fin ? (pr.toFinish != null ? pr.toFinish : pr.D - pr.x) : (pr.toChange != null ? pr.toChange : pr.toNext);
    var dI = fin ? 0 : nx.i - (+st.tIncl || 0), dS = fin ? 3 - (+st.tSpeed || 0) : nx.s - (+st.tSpeed || 0);
    return { dI: dI, dS: dS, finish: fin, big: fin || Math.abs(dI) >= 1 - 1e-9 || Math.abs(dS) >= 1 - 1e-9, sec: Math.ceil(Math.max(0, to) / v), to: to };
  };

  /* ---------- Farben der Steigung ---------- */
  R.SLOPE = [[-99, '#4f86e0', 'Gefälle'], [-2, '#7a8599', 'flach'], [2, '#e8c22e', '2 bis 4 %'], [4, '#ff8a2a', '4 bis 7 %'], [7, '#ff4d5e', '7 bis 10 %'], [10, '#d23fae', 'über 10 %']];
  R.slopeCol = function (g) { var c = R.SLOPE[0][1]; for (var i = 0; i < R.SLOPE.length; i++) if (g >= R.SLOPE[i][0]) c = R.SLOPE[i][1]; return c; };

  /* ---------- Kleine Karte als SVG (Linie auf dunklem Grund, ohne Kacheln) ----------
     line: [[lat, lon], ...]; o: {w, h, pad, frac (0..1 gelaufen), cls} */
  R.lineSvg = function (line, o) {
    o = o || {};
    var w = o.w || 300, h = o.h || 160, pad = o.pad == null ? 12 : o.pad;
    if (!line || line.length < 2) return '<svg width="' + w + '" height="' + h + '" aria-hidden="true"></svg>';
    var la0 = 1e9, la1 = -1e9, lo0 = 1e9, lo1 = -1e9;
    line.forEach(function (p) { la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); lo0 = Math.min(lo0, p[1]); lo1 = Math.max(lo1, p[1]); });
    var cx = Math.cos((la0 + la1) / 2 * Math.PI / 180), sx = (lo1 - lo0) * cx || 1e-6, sy = (la1 - la0) || 1e-6;
    var sc = Math.min((w - 2 * pad) / sx, (h - 2 * pad) / sy), ox = (w - sx * sc) / 2, oy = (h - sy * sc) / 2;
    var P = line.map(function (p) { return [ox + (p[1] - lo0) * cx * sc, oy + (la1 - p[0]) * sc]; });
    var path = function (a) { return a.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(''); };
    var s = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">';
    s += '<path d="' + path(P) + '" stroke="rgba(0,0,0,.6)" stroke-width="' + ((o.wd || 3) + 3) + '" fill="none" stroke-linejoin="round" stroke-linecap="round"/>';
    if (o.frac != null) {
      var k = Math.max(1, Math.min(P.length - 1, Math.round(o.frac * (P.length - 1))));
      s += '<path d="' + path(P.slice(k - 1)) + '" stroke="#ff4d5e" stroke-width="' + (o.wd || 3) + '" fill="none" stroke-linejoin="round" stroke-linecap="round"/>';
      s += '<path d="' + path(P.slice(0, k + 1)) + '" stroke="#2fd27a" stroke-width="' + ((o.wd || 3) + 0.5) + '" fill="none" stroke-linejoin="round" stroke-linecap="round"/>';
    } else s += '<path d="' + path(P) + '" stroke="' + (o.c || '#ffd43b') + '" stroke-width="' + (o.wd || 3) + '" fill="none" stroke-linejoin="round" stroke-linecap="round"/>';
    var A = P[0], Z = P[P.length - 1];
    s += '<circle cx="' + Z[0].toFixed(1) + '" cy="' + Z[1].toFixed(1) + '" r="5.5" fill="#fff" stroke="#000" stroke-width="2.5"/>';
    s += '<circle cx="' + A[0].toFixed(1) + '" cy="' + A[1].toFixed(1) + '" r="5.5" fill="#2fd27a" stroke="#000" stroke-width="2"/>';
    return s + '</svg>';
  };

  /* ---------- Hoehenprofil (SVG) ----------
     o: {prof: [[d, e]], D, secs, x (m oder null), bars (Pace je km darunter), ax (Achsen), lineCol} */
  var pro = window.ResizeObserver ? new ResizeObserver(function (es) {
    es.forEach(function (e) { var el = e.target, a = el._rp; if (a && document.contains(el) && (el.clientWidth !== a.w || el.clientHeight !== a.h)) R.profile(el, a.o); });
  }) : null;
  R.profile = function (el, o) {
    var w = el.clientWidth, h = el.clientHeight;
    if (pro && !el._rp) pro.observe(el);
    el._rp = { o: o, w: w, h: h };
    if (!w || !h || !o.prof || o.prof.length < 2) { el.innerHTML = ''; return; }
    var FF = ' font-family="Roboto,sans-serif"', D = o.D || o.prof[o.prof.length - 1][0];
    var gl = o.ax === false ? 0 : 62, gr = o.ax === false ? 0 : 10, top = o.ax === false ? 3 : 10, barsH = o.bars ? 50 : 0, axB = o.ax === false ? 0 : 24, ph = h - top - axB - barsH - (o.bars ? 10 : 0);
    var pw = w - gl - gr, emin = 1e9, emax = -1e9;
    o.prof.forEach(function (p) { emin = Math.min(emin, p[1]); emax = Math.max(emax, p[1]); });
    // runde Achsenwerte, mindestens 60 m Spanne
    // Schrittweite so, dass die Hoehenmarken mindestens 30 px auseinander liegen
    var span = Math.max(60, emax - emin), stepE = 10, y0, y1, SE = [10, 20, 50, 100, 200, 500, 1000, 2000];
    for (var si = 0; si < SE.length; si++) {
      stepE = SE[si]; y0 = Math.floor((emin - span * 0.08) / stepE) * stepE; y1 = Math.ceil((emax + span * 0.06) / stepE) * stepE;
      if (ph / ((y1 - y0) / stepE) >= 30) break;
    }
    var X = function (d) { return gl + d / D * pw; }, Y = function (e) { return top + ph * (1 - (e - y0) / (y1 - y0)); }, base = top + ph;
    var s = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">';
    // Gitter und Hoehenachse
    if (o.ax !== false) for (var e = y0; e <= y1 + 1e-6; e += stepE) {
      var yy = Y(e).toFixed(1);
      s += '<line x1="' + gl + '" x2="' + (w - gr) + '" y1="' + yy + '" y2="' + yy + '" stroke="rgba(255,255,255,.08)"/>';
      s += '<text x="' + (gl - 8) + '" y="' + (+yy + 5) + '" text-anchor="end" fill="#a4a9bb" font-size="14" font-weight="700"' + FF + '>' + Math.round(e) + (e + stepE > y1 + 1e-6 ? ' m' : '') + '</text>';
    }
    // Flaechen je Abschnitt in Steigungsfarbe (aus secs, sonst je 100 m aus dem Profil)
    var cols = [];
    if (o.secs && o.secs.length) cols = o.secs.map(function (q) { return [q[0], q[1], q[4]]; });
    else for (var a = 0; a < D; a += 100) { var b = Math.min(D, a + 100); cols.push([a, b, (eAt(o.prof, b) - eAt(o.prof, a)) / Math.max(1, b - a) * 100]); }
    var px = o.x != null ? Math.max(0, Math.min(D, o.x)) : null;
    cols.forEach(function (c) {
      var pts = slice(o.prof, c[0], c[1]);
      if (pts.length < 2) return;
      var d = 'M' + X(c[0]).toFixed(1) + ' ' + base.toFixed(1) + pts.map(function (p) { return 'L' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join('') + 'L' + X(c[1]).toFixed(1) + ' ' + base.toFixed(1) + 'Z';
      s += '<path d="' + d + '" fill="' + R.slopeCol(c[2]) + '" fill-opacity="' + (o.x != null ? 0.42 : 0.7) + '"/>';
    });
    var lp = function (pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(''); };
    // steile Stellen (Strasse ueber 12 %): Warnmarke ueber der Kurve
    (o.steep || []).forEach(function (q) {
      var cx = X((q[0] + q[1]) / 2), cy = Math.max(top + 10, Y(Math.max(eAt(o.prof, q[0]), eAt(o.prof, q[1]))) - 16);
      s += '<path d="M' + cx.toFixed(1) + ' ' + (cy - 9).toFixed(1) + 'l9 15h-18z" fill="#ff9a52" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<path d="M' + cx.toFixed(1) + ' ' + (cy - 3).toFixed(1) + 'v5M' + cx.toFixed(1) + ' ' + (cy + 4).toFixed(1) + 'v.5" stroke="#1f0b00" stroke-width="2" stroke-linecap="round"/>';
    });
    if (px != null) {
      var dn = slice(o.prof, 0, px), rest = slice(o.prof, px, D);
      if (dn.length > 1) s += '<path d="' + lp(dn) + 'L' + X(px).toFixed(1) + ' ' + base + 'L' + X(0) + ' ' + base + 'Z" fill="#2fd27a" fill-opacity=".38"/>';
      if (rest.length > 1) s += '<path d="' + lp(rest) + '" stroke="#ff4d5e" stroke-width="3.5" fill="none" stroke-linejoin="round"/>';
      if (dn.length > 1) s += '<path d="' + lp(dn) + '" stroke="#2fd27a" stroke-width="4" fill="none" stroke-linejoin="round"/>';
      var ex = X(px), ey = Y(eAt(o.prof, px));
      s += '<line x1="' + ex.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y1="' + top + '" y2="' + base + '" stroke="#fff" stroke-width="2" stroke-dasharray="4 4" opacity=".7"/>';
      s += '<circle cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) + '" r="9" fill="#fff" stroke="#000" stroke-width="3"/><circle cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) + '" r="4" fill="#3d8bff"/>';
    } else s += '<path d="' + lp(o.prof) + '" stroke="' + (o.lineCol || '#f4f5f9') + '" stroke-width="2.5" fill="none" stroke-linejoin="round"/>';
    // km-Achse
    if (o.ax !== false) {
      var kmStep = D > 40000 ? 10 : D > 15000 ? 5 : D > 6000 ? 2 : 1;
      for (var km = 0; km * 1000 <= D + 1; km += kmStep) {
        var kx = X(km * 1000), last = (D - km * 1000) < kmStep * 1000 * 0.45 && km > 0;
        if (last) continue;
        s += '<line x1="' + kx.toFixed(1) + '" x2="' + kx.toFixed(1) + '" y1="' + base + '" y2="' + (base + 5) + '" stroke="rgba(255,255,255,.35)"/>';
        s += '<text x="' + kx.toFixed(1) + '" y="' + (base + 21) + '" text-anchor="' + (km ? 'middle' : 'start') + '" fill="#a4a9bb" font-size="14" font-weight="700"' + FF + '>' + km + '</text>';
      }
      s += '<text x="' + (w - gr) + '" y="' + (base + 21) + '" text-anchor="end" fill="#d3d6e0" font-size="14" font-weight="800"' + FF + '>' + TX.f1(D / 1000) + ' km</text>';
    }
    // Pace je km als Balken
    if (o.bars && o.secs && o.secs.length) {
      var kp = R.kmPaces(o.secs, D), pmin = 1e9, pmax = 0, by = h - barsH;
      kp.forEach(function (q) { pmin = Math.min(pmin, q.pace); pmax = Math.max(pmax, q.pace); });
      var rng = Math.max(20, pmax - pmin), cw = pw / (D / 1000), lab = cw >= 40;
      var lMin = false, lMax = false, lastLab = -1e9, curK = px != null ? Math.min(kp.length - 1, Math.floor(px / 1000)) : -1;
      s += '<text x="' + (gl - 8) + '" y="' + (by + 20) + '" text-anchor="end" fill="#5c9dff" font-size="12" font-weight="800"' + FF + '>PACE</text>';
      s += '<text x="' + (gl - 8) + '" y="' + (by + 36) + '" text-anchor="end" fill="#a4a9bb" font-size="12" font-weight="700"' + FF + '>/km</text>';
      var labs = '';
      kp.forEach(function (q, i) {
        var x0 = X(q.a) + 1.5, x1 = X(q.b) - 1.5, bh = 12 + (1 - (q.pace - pmin) / rng) * (barsH - 30);
        var done = px != null && q.b <= px, cur = i === curK;
        s += '<rect x="' + x0.toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="' + (cur ? '#fff' : done ? '#2c69cf' : '#3d8bff') + '" fill-opacity="' + (done ? 0.45 : 0.85) + '"/>';
        var showL = lab || (q.pace === pmin && !lMin) || (q.pace === pmax && !lMax), lx = (x0 + x1) / 2;
        // Etiketten duerfen sich nicht ueberlappen (rund 36 px breit); min/max gilt erst als gezeigt, wenn gezeichnet
        if (showL && lx - 18 < lastLab + 4) showL = false;
        if (showL) { lastLab = lx + 18; if (q.pace === pmin) lMin = true; if (q.pace === pmax) lMax = true; }
        // Beschriftung im zweiten Durchgang ueber allen Balken, mit dunklem Rand
        if (showL) labs += '<text x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' + (h - bh - 5).toFixed(1) + '" text-anchor="middle" fill="#f4f5f9" stroke="#0b0c10" stroke-width="3" paint-order="stroke" stroke-linejoin="round" font-size="13" font-weight="800"' + FF + '>' + TX.time(q.pace) + '</text>';
      });
      s += labs;
    }
    el.innerHTML = s + '</svg>';
  };
  function eAt(prof, x) {
    var lo = 0, hi = prof.length - 1;
    if (x <= prof[0][0]) return prof[0][1];
    if (x >= prof[hi][0]) return prof[hi][1];
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (prof[m][0] <= x) lo = m; else hi = m; }
    var a = prof[lo], b = prof[hi], t = b[0] > a[0] ? (x - a[0]) / (b[0] - a[0]) : 0;
    return a[1] + t * (b[1] - a[1]);
  }
  R.eAt = eAt;
  // Profilpunkte zwischen a und b (mit interpolierten Randpunkten)
  function slice(prof, a, b) {
    var o = [[a, eAt(prof, a)]];
    for (var i = 0; i < prof.length; i++) if (prof[i][0] > a && prof[i][0] < b) o.push(prof[i]);
    o.push([b, eAt(prof, b)]);
    return o;
  }
  // Profil fuer die Anzeige ausduennen (hoechstens n Punkte)
  R.thinProf = function (prof, n) {
    if (prof.length <= n) return prof;
    var f = (prof.length - 1) / (n - 1), o = [];
    for (var i = 0; i < n; i++) o.push(prof[Math.round(i * f)]);
    return o;
  };

  /* ---------- Position auf der Strecke ---------- */
  R.posAt = function (pts, x) {
    var lo = 0, hi = pts.length - 1;
    if (x <= pts[0][3]) return { ll: [pts[0][0], pts[0][1]], k: 0, brg: R.bearing(pts[0], pts[Math.min(3, hi)]) };
    if (x >= pts[hi][3]) return { ll: [pts[hi][0], pts[hi][1]], k: hi, brg: R.bearing(pts[Math.max(0, hi - 3)], pts[hi]) };
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (pts[m][3] <= x) lo = m; else hi = m; }
    var a = pts[lo], b = pts[hi], t = b[3] > a[3] ? (x - a[3]) / (b[3] - a[3]) : 0;
    var p0 = pts[Math.max(0, lo - 2)], p1 = pts[Math.min(pts.length - 1, hi + 2)];
    return { ll: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], k: lo, brg: R.bearing(p0, p1) };
  };

  /* ---------- Leaflet-Karte ----------
     el: Container; r: Streckendatei; o: {live (Punkt und Folgen), onFollow(bool)}. Zoom 12 bis 16 (11 mit verkleinerten 12er-Kacheln, damit lange Strecken ganz passen), Ausschnitt auf die Strecke begrenzt,
     damit nur Kacheln angefragt werden, die der Dienst haben kann. Rueckgabe: Steuerobjekt. */
  var FLAG = '<svg viewBox="0 0 28 34" width="28" height="34" aria-hidden="true"><path d="M4 2v31" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M5 3h20v14H5z" fill="#fff" stroke="#000" stroke-width="1.5"/><path d="M5 3h5v3.5H5zM15 3h5v3.5h-5zM10 6.5h5V10h-5zM20 6.5h5V10h-5zM5 10h5v3.5H5zM15 10h5v3.5h-5zM10 13.5h5V17h-5zM20 13.5h5V17h-5z" fill="#000"/></svg>';
  R.map = function (el, r, o) {
    o = o || {};
    if (!window.L) { el.innerHTML = '<div class="empty">Karte nicht verfügbar</div>'; return null; }
    var Lf = window.L, pts = r.pts, ll = pts.map(function (p) { return [p[0], p[1]]; });
    var bounds = Lf.latLngBounds(ll), pb = bounds.pad(0.25);
    var map = Lf.map(el, { zoomControl: false, attributionControl: true, keyboard: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: R.ZMIN - 1, maxZoom: R.ZMAX, tap: false,
      bounceAtZoomLimits: false, maxBounds: pb, maxBoundsViscosity: 1.0 });
    map.attributionControl.setPrefix(false);
    var src = R.tileSrc(r);
    if (src) Lf.tileLayer('/tiles/' + src + '/{z}/{x}/{y}', { minZoom: R.ZMIN - 1, minNativeZoom: R.ZMIN, maxZoom: R.ZMAX, bounds: pb, className: 'tl-' + src, keepBuffer: 2,
      attribution: '© swisstopo SWISSIMAGE' }).addTo(map);
    Lf.polyline(ll, { color: '#000', opacity: 0.55, weight: 11, lineJoin: 'round', interactive: false }).addTo(map);
    var rest = Lf.polyline(ll, { color: o.live ? '#ff4d5e' : '#ffd43b', weight: 6, lineJoin: 'round', interactive: false }).addTo(map);
    var done = Lf.polyline([], { color: '#2fd27a', weight: 7, lineJoin: 'round', interactive: false }).addTo(map);
    // km-Marken: bis 25 km jeder km, sonst alle 5 km; kleine Marken erst ab Zoom 14
    var kmStep = r.d > 25000 ? 5 : 1, kms = [];
    for (var k = kmStep; k * 1000 < (r.d || pts[pts.length - 1][3]) - 150; k += kmStep) {
      var pp = R.posAt(pts, k * 1000), big = k % 5 === 0;
      kms.push(Lf.marker(pp.ll, { km: k, interactive: false, keyboard: false, icon: Lf.divIcon({ className: 'kmk' + (big ? ' k5' : ''), html: '<span>' + k + '</span>', iconSize: big ? [30, 30] : [24, 24] }) }).addTo(map));
    }
    Lf.marker(ll[ll.length - 1], { interactive: false, keyboard: false, zIndexOffset: 500, icon: Lf.divIcon({ className: 'mk-ziel', html: FLAG, iconSize: [28, 34], iconAnchor: [4, 33] }) }).addTo(map);
    Lf.marker(ll[0], { interactive: false, keyboard: false, zIndexOffset: 600, icon: Lf.divIcon({ className: 'mk-start', html: '<span>START</span>', iconSize: [64, 26], iconAnchor: [32, 36] }) }).addTo(map);
    Lf.circleMarker(ll[0], { radius: 8, color: '#000', weight: 3, fillColor: '#2fd27a', fillOpacity: 1, interactive: false }).addTo(map);
    var me = null, follow = !!o.live, lastX = -1, lineX = -1e9;
    function zoomCls() { el.classList.toggle('z-lo', map.getZoom() < 13.5); }
    map.on('zoomend', zoomCls);
    map.on('dragstart', function () { if (follow) { follow = false; if (o.onFollow) o.onFollow(false); } });
    function fit(anim) { map.fitBounds(bounds, { padding: [28, 28], animate: !!anim }); }
    fit(false); zoomCls();
    var ctl = {
      map: map, lines: { done: done, rest: rest },
      fit: function () { follow = false; if (o.onFollow) o.onFollow(false); fit(true); },
      follow: function (on) { follow = on; if (o.onFollow) o.onFollow(on); if (on && me) map.setView(me.getLatLng(), Math.max(15, map.getZoom()), { animate: true }); },
      // Fortschritt x (m): gruen gelaufen, rot offen, Punkt mit Richtung
      // Leistung: der Punkt folgt jeder Abfrage (nur eine Verschiebung), die gruene Linie alle 10 m, die rote liegt
      // einmal ganz darunter; die Karte schwenkt nur, wenn der Punkt die Mitte verlaesst (sonst Dauer-Animation).
      progress: function (x) {
        if (x === lastX) return; var first = lastX < 0; lastX = x;
        var ps = R.posAt(pts, x), k = ps.k;
        if (Math.abs(x - lineX) >= 10 || first) {
          lineX = x;
          // km-Marke unter dem Punkt ausblenden
          kms.forEach(function (m) { var hide = Math.abs(m.options.km * 1000 - x) < 300; if (m._hid !== hide) { m._hid = hide; m.setOpacity(hide ? 0 : 1); } });
          done.setLatLngs(ll.slice(0, k + 1).concat([ps.ll]));
        }
        var ic = '<div class="me-r" style="transform:rotate(' + Math.round(ps.brg) + 'deg)"><svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="#fff" stroke="#000" stroke-width="3"/><path d="M20 8l8 17-8-4-8 4z" fill="#2c69cf"/></svg></div>';
        if (!me) me = Lf.marker(ps.ll, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: Lf.divIcon({ className: 'mk-me', html: ic, iconSize: [40, 40] }) }).addTo(map);
        else { me.setLatLng(ps.ll); var d = me.getElement && me.getElement(); if (d && d.firstChild) d.firstChild.style.transform = 'rotate(' + Math.round(ps.brg) + 'deg)'; }
        if (follow) {
          if (first) map.setView(ps.ll, 15, { animate: false });
          else {
            var sz = map.getSize(), pt = map.latLngToContainerPoint(ps.ll);
            if (Math.abs(pt.x - sz.x / 2) > sz.x * 0.18 || Math.abs(pt.y - sz.y / 2) > sz.y * 0.18) map.panTo(ps.ll, { animate: true, duration: 0.6 });
          }
        }
      },
      resize: function (refit) { map.invalidateSize(false); if (refit && !follow) fit(false); },   // nach dem Einhaengen: Groesse stimmt erst jetzt
      destroy: function () { try { map.remove(); } catch (e) { /* egal */ } }
    };
    R._lastMap = ctl;
    return ctl;
  };
})();
