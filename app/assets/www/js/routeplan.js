/* Streckenplanung: 1:1-Port von RoutePlan.java (Dienst). Nur fuer den Demo-Simulator und die Pruefung;
   im Betrieb plant der Dienst. Gleiche Schritte, gleiche Rundung (Math.round = Java Math.round fuer double). */
(function () {
  'use strict';
  var TX = window.TX;
  var S_MIN = 0.8, S_MAX = 20, I_MAX = 15, MOTOR = 0.6;

  function at(d, e, x) {
    var i = Math.min(d.length - 2, Math.max(0, Math.floor(x / 10.0)));
    var t = d[i + 1] > d[i] ? (x - d[i]) / (d[i + 1] - d[i]) : 0;
    return e[i] + Math.max(0, Math.min(1, t)) * (e[i + 1] - e[i]);
  }
  function bandIncl(g, scale) { return Math.max(0, Math.min(I_MAX, Math.round(g * scale * 2) / 2.0)); }
  function merge(L, i) {
    var x = L[i], y = L[i + 1], l0 = x[1] - x[0], l1 = y[1] - y[0];
    x[2] = (x[2] * l0 + y[2] * l1) / (l0 + l1); x[1] = y[1]; L.splice(i + 1, 1);
  }

  function Plan() { this.D = 0; this.n = 0; this.total = 0; this.up = 0; this.down = 0; this.capped = 0; }
  Plan.prototype.eleAt = function (x) { return at(this.pd, this.pe, Math.max(0, Math.min(this.D, x))); };
  Plan.prototype.idxAt = function (x) {
    var lo = 0, hi = this.n - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >>> 1; if (this.a[mid] <= x) lo = mid; else hi = mid - 1; }
    return lo;
  };
  // Planzeit an Position x: Abschnitt ueber den Tempobeginn sa (bei Anstieg vorgezogen)
  Plan.prototype.tPlanAt = function (x) {
    if (x >= this.D) return this.total;
    var i = this.n - 1; while (i > 0 && this.sa[i] > x) i--;
    return this.tA[i] + Math.max(0, x - this.sa[i]) / (this.sp[i] / 3.6);
  };
  // Vorlauf der Steigung vor Abschnitt i (m), mit dem Plantempo des Abschnitts davor
  Plan.prototype.lead = function (i) {
    if (i <= 0 || i >= this.n) return 0;
    return Math.min(100, this.sp[i - 1] / 3.6 * Math.abs(this.in[i] - this.in[i - 1]) / MOTOR);
  };
  // Anstieg mit langsamerem Tempo: Tempo wird mit der Steigung vorgezogen
  Plan.prototype.early = function (i) { return i > 0 && i < this.n && this.in[i] > this.in[i - 1] && this.sp[i] < this.sp[i - 1]; };
  // Planzeit mit den tatsaechlichen Tempogrenzen sa und Startzeiten tA
  Plan.prototype.timeSum = function () {
    var i, t = 0;
    for (i = 0; i < this.n; i++) this.sa[i] = i === 0 ? 0 : this.early(i) ? this.a[i] - this.lead(i) : this.a[i];
    for (i = 0; i < this.n; i++) { this.tA[i] = t; var e = i + 1 < this.n ? this.sa[i + 1] : this.D; t += Math.max(0, e - this.sa[i]) / (this.sp[i] / 3.6); }
    return t;
  };
  Plan.prototype.inclIdxAt = function (x, v, offI) {
    var i = this.idxAt(x);
    if (i + 1 >= this.n) return i;
    var cur = Math.max(0, Math.min(I_MAX, this.in[i] + offI)), nx = Math.max(0, Math.min(I_MAX, this.in[i + 1] + offI));
    var lead = Math.min(100, v / 3.6 * Math.abs(nx - cur) / MOTOR);
    return x >= this.a[i + 1] - lead ? i + 1 : i;
  };

  /* pdIn, peIn: Distanz (m) und Hoehe (m) aufsteigend; target s; terrain bool; scale 1.0|0.5; trail bool;
     gpxHeights: Hoehen aus der GPX statt swisstopo, dann Glaettung ueber 110 m */
  function build(pdIn, peIn, target, terrain, scale, trail, gpxHeights) {
    var p = new Plan(), m = pdIn.length, i, q;
    if (m < 2) throw new Error('Profil zu kurz');
    p.D = pdIn[m - 1] - pdIn[0];
    if (p.D < 400 || p.D > 200000) throw new Error('Streckenlänge ausserhalb 0.4 bis 200 km');
    if (target < 60 || target > 72 * 3600) throw new Error('Zielzeit ungültig');
    // 1) alle 10 m abtasten
    var k = Math.ceil(p.D / 10.0) + 1, d = new Array(k), e = new Array(k), j = 0;
    for (i = 0; i < k; i++) {
      var x = Math.min(p.D, i * 10.0) + pdIn[0];
      while (j < m - 2 && pdIn[j + 1] < x) j++;
      var t = pdIn[j + 1] > pdIn[j] ? (x - pdIn[j]) / (pdIn[j + 1] - pdIn[j]) : 0;
      t = Math.max(0, Math.min(1, t));
      d[i] = x - pdIn[0]; e[i] = peIn[j] + t * (peIn[j + 1] - peIn[j]);
    }
    // 2) gleitendes Mittel (Halbfenster in 10-m-Schritten: 110, 30 bzw. 50 m)
    var w = gpxHeights ? 5 : trail ? 1 : 2, es = new Array(k);
    for (i = 0; i < k; i++) {
      var s = 0, c = 0;
      for (q = Math.max(0, i - w); q <= Math.min(k - 1, i + w); q++) { s += e[q]; c++; }
      es[i] = s / c;
    }
    p.pd = d; p.pe = es;
    for (i = 1; i < k; i++) { var de = es[i] - es[i - 1]; if (de > 0) p.up += de; else p.down -= de; }
    // 3) Rohabschnitte je 100 m
    var nr = Math.ceil(p.D / 100.0), L = [];
    for (i = 0; i < nr; i++) {
      var ra = i * 100.0, rb = Math.min(p.D, (i + 1) * 100.0), ea = at(d, es, ra), eb = at(d, es, rb);
      L.push([ra, rb, rb > ra ? (eb - ea) / (rb - ra) * 100.0 : 0]);
    }
    // 4) zusammenlegen: gleiche Bandsteigung, dann kuerzesten zu kurzen Abschnitt dem aehnlicheren Nachbarn zuschlagen
    var minLen = trail ? 150 : 200, changed = true;
    while (changed) {
      changed = false;
      for (i = 0; i + 1 < L.length; i++) {
        if (bandIncl(L[i][2], scale) === bandIncl(L[i + 1][2], scale)) { merge(L, i); changed = true; i--; }
      }
      var best = -1, bl = 1e9;
      for (i = 0; i < L.length; i++) { var l = L[i][1] - L[i][0]; if (l < minLen && l < bl && L.length > 1) { bl = l; best = i; } }
      if (best >= 0) {
        var ib = bandIncl(L[best][2], scale), nb;
        if (best === 0) nb = 0; else if (best === L.length - 1) nb = best - 1;
        else nb = Math.abs(bandIncl(L[best - 1][2], scale) - ib) <= Math.abs(bandIncl(L[best + 1][2], scale) - ib) ? best - 1 : best;
        merge(L, nb); changed = true;
      }
    }
    var n = L.length;
    p.n = n; p.a = []; p.b = []; p.g = []; p.in = []; p.sp = []; p.tA = [];
    for (i = 0; i < n; i++) {
      p.a[i] = L[i][0]; p.b[i] = L[i][1]; p.g[i] = L[i][2]; p.in[i] = bandIncl(L[i][2], scale);
      if (p.g[i] * scale > I_MAX + 0.25 || p.g[i] < -0.75) p.capped++;
    }
    // 5) Tempo verteilen
    var f = [], kk = 0, it;
    for (i = 0; i < n; i++) f[i] = terrain ? 1 + 0.045 * p.in[i] : 1;   // ACSM: Sauerstoffbedarf Laufen 0.2·v + 0.9·v·g
    for (i = 0; i < n; i++) kk += (p.b[i] - p.a[i]) * f[i];
    kk = kk / target * 3.6;
    p.sa = new Array(n);
    for (it = 0; it < 40; it++) {
      for (i = 0; i < n; i++) p.sp[i] = Math.max(S_MIN, Math.min(S_MAX, Math.round(kk / f[i] * 10) / 10.0));
      p.total = p.timeSum();
      if (Math.abs(p.total - target) <= 2) break;
      kk *= Math.pow(p.total / target, 0.9);
    }
    // bei Rundung bleibt oft ein kleiner Rest: auf einzelnen Abschnitten um 0.1 nachjustieren
    for (var pass = 0; pass < 3 && Math.abs(p.total - target) > 2; pass++) {
      for (i = 0; i < n && Math.abs(p.total - target) > 2; i++) {
        var dv = p.total > target ? 0.1 : -0.1, old = p.sp[i], v2 = Math.round((old + dv) * 10) / 10.0;
        if (v2 < S_MIN || v2 > S_MAX) continue;
        p.sp[i] = v2; var nt = p.timeSum();
        if (Math.abs(nt - target) < Math.abs(p.total - target)) p.total = nt; else p.sp[i] = old;
      }
    }
    p.total = p.timeSum();
    return p;
  }

  TX.RoutePlan = { build: build, bandIncl: bandIncl, S_MIN: S_MIN, S_MAX: S_MAX, I_MAX: I_MAX, MOTOR: MOTOR };
})();
