// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

/** Plant eine Strecke fuer das Band: Profil glaetten, Abschnitte mit Bandsteigung bilden,
 *  Tempo so verteilen, dass die Summe der Abschnittszeiten der Zielzeit entspricht.
 *  Reines Java ohne Android, damit es auf der VM geprueft werden kann (RouteSim). */
public class RoutePlan {
    public static final float S_MIN = 0.8f, S_MAX = 20f, I_MAX = 15f;
    public static final double MOTOR = 0.6;          // Steigungsmotor in %/s (Annahme, am Band nachmessen)

    public double D;                                  // Laenge in m
    // Abschnitt: Anfang, Ende (m), Streckensteigung %, Tempo km/h, Bandsteigung %, Planzeit am Anfang (s),
    // sa: Beginn des Tempos (bei Anstieg um den Steigungsvorlauf vorgezogen)
    public double[] a, b, g, sp, in, tA, sa;
    public int n;
    public double total, up, down;                    // Planzeit, Hoehenmeter auf/ab (geglaettet)
    public double[] pd, pe;                           // geglaettetes Profil alle 10 m
    public int capped;                                // Abschnitte, in denen das Band die Steigung begrenzt (ueber 15 % oder Gefaelle)

    /** prof: Paare (Distanz m, Hoehe m), aufsteigend. target: Zielzeit in s. terrain: gleiche Anstrengung statt gleichmaessig.
     *  scale: Faktor fuer die Bandsteigung (1.0 oder 0.5). trail: kuerzere Glaettung. */
    public static RoutePlan build(double[] pdIn, double[] peIn, double target, boolean terrain, double scale, boolean trail) {
        return build(pdIn, peIn, target, terrain, scale, trail, false);
    }

    /** gpxHeights: Hoehen stammen aus der GPX (GPS/Barometer, verrauscht) statt aus swisstopo: Glaettung ueber 110 m. */
    public static RoutePlan build(double[] pdIn, double[] peIn, double target, boolean terrain, double scale, boolean trail, boolean gpxHeights) {
        RoutePlan p = new RoutePlan();
        int m = pdIn.length;
        if (m < 2) throw new IllegalArgumentException("Profil zu kurz");
        p.D = pdIn[m - 1] - pdIn[0];
        if (p.D < 400 || p.D > 200000) throw new IllegalArgumentException("Streckenlänge ausserhalb 0.4 bis 200 km");
        if (target < 60 || target > 72 * 3600) throw new IllegalArgumentException("Zielzeit ungültig");
        // 1) alle 10 m abtasten
        int k = (int) Math.ceil(p.D / 10.0) + 1;
        double[] d = new double[k], e = new double[k];
        int j = 0;
        for (int i = 0; i < k; i++) {
            double x = Math.min(p.D, i * 10.0) + pdIn[0];
            while (j < m - 2 && pdIn[j + 1] < x) j++;
            double t = pdIn[j + 1] > pdIn[j] ? (x - pdIn[j]) / (pdIn[j + 1] - pdIn[j]) : 0;
            t = Math.max(0, Math.min(1, t));
            d[i] = x - pdIn[0]; e[i] = peIn[j] + t * (peIn[j + 1] - peIn[j]);
        }
        // 2) gleitendes Mittel
        int w = gpxHeights ? 5 : trail ? 1 : 2;        // Halbfenster in 10-m-Schritten (110, 30 bzw. 50 m)
        double[] es = new double[k];
        for (int i = 0; i < k; i++) {
            double s = 0; int c = 0;
            for (int q = Math.max(0, i - w); q <= Math.min(k - 1, i + w); q++) { s += e[q]; c++; }
            es[i] = s / c;
        }
        p.pd = d; p.pe = es;
        for (int i = 1; i < k; i++) { double de = es[i] - es[i - 1]; if (de > 0) p.up += de; else p.down -= de; }
        // 3) Rohabschnitte je 100 m
        int nr = (int) Math.ceil(p.D / 100.0);
        double[] ra = new double[nr], rb = new double[nr], rg = new double[nr], ri = new double[nr];
        for (int i = 0; i < nr; i++) {
            ra[i] = i * 100.0; rb[i] = Math.min(p.D, (i + 1) * 100.0);
            double ea = at(d, es, ra[i]), eb = at(d, es, rb[i]);
            rg[i] = rb[i] > ra[i] ? (eb - ea) / (rb[i] - ra[i]) * 100.0 : 0;
            ri[i] = Math.max(0, Math.min(I_MAX, Math.round(rg[i] * scale * 2) / 2.0));
        }
        // 4) zusammenlegen: gleiche Bandsteigung wird ein Abschnitt; danach kurze Abschnitte
        //    (unter 200 m Strasse, 150 m Trail) dem Nachbarn mit der aehnlicheren Steigung zuschlagen
        java.util.ArrayList<double[]> L = new java.util.ArrayList<double[]>();   // {a, b, g}
        for (int i = 0; i < nr; i++) L.add(new double[]{ra[i], rb[i], rg[i]});
        double minLen = trail ? 150 : 200;
        boolean changed = true;
        while (changed) {
            changed = false;
            for (int i = 0; i + 1 < L.size(); i++) {                 // gleiche Bandsteigung
                if (bandIncl(L.get(i)[2], scale) == bandIncl(L.get(i + 1)[2], scale)) { merge(L, i); changed = true; i--; }
            }
            int best = -1; double bl = 1e9;                           // kuerzester zu kurzer Abschnitt
            for (int i = 0; i < L.size(); i++) { double l = L.get(i)[1] - L.get(i)[0]; if (l < minLen && l < bl && L.size() > 1) { bl = l; best = i; } }
            if (best >= 0) {
                double ib = bandIncl(L.get(best)[2], scale);
                int nb;
                if (best == 0) nb = 0; else if (best == L.size() - 1) nb = best - 1;
                else nb = Math.abs(bandIncl(L.get(best - 1)[2], scale) - ib) <= Math.abs(bandIncl(L.get(best + 1)[2], scale) - ib) ? best - 1 : best;
                merge(L, nb); changed = true;
            }
        }
        int n = L.size();
        double[] A = new double[n], B = new double[n], G = new double[n], I = new double[n];
        for (int i = 0; i < n; i++) { A[i] = L.get(i)[0]; B[i] = L.get(i)[1]; G[i] = L.get(i)[2]; I[i] = bandIncl(G[i], scale); }
        p.n = n; p.a = new double[n]; p.b = new double[n]; p.g = new double[n]; p.in = new double[n]; p.sp = new double[n]; p.tA = new double[n];
        for (int i = 0; i < n; i++) {
            p.a[i] = A[i]; p.b[i] = B[i]; p.g[i] = G[i]; p.in[i] = I[i];
            if (G[i] * scale > I_MAX + 0.25 || G[i] < -0.75) p.capped++;
        }
        // 5) Tempo verteilen
        double[] f = new double[n];
        for (int i = 0; i < n; i++) f[i] = terrain ? 1 + 0.045 * p.in[i] : 1;   // ACSM: Sauerstoffbedarf Laufen 0.2·v + 0.9·v·g
        double kk = 0; for (int i = 0; i < n; i++) kk += (p.b[i] - p.a[i]) * f[i];
        kk = kk / target * 3.6;                        // km/h bei f = 1
        p.sa = new double[n];
        for (int it = 0; it < 40; it++) {
            for (int i = 0; i < n; i++) p.sp[i] = Math.max(S_MIN, Math.min(S_MAX, Math.round(kk / f[i] * 10) / 10.0));
            p.total = p.timeSum();
            if (Math.abs(p.total - target) <= 2) break;
            kk *= Math.pow(p.total / target, 0.9);     // gedaempft nachfuehren (Rundung auf 0.1 km/h)
        }
        // bei Rundung bleibt oft ein kleiner Rest: auf einzelnen Abschnitten um 0.1 nachjustieren
        for (int pass = 0; pass < 3 && Math.abs(p.total - target) > 2; pass++) {
            for (int i = 0; i < n && Math.abs(p.total - target) > 2; i++) {
                double dv = p.total > target ? 0.1 : -0.1;
                double old = p.sp[i], v = Math.round((old + dv) * 10) / 10.0; if (v < S_MIN || v > S_MAX) continue;
                p.sp[i] = v; double nt = p.timeSum();
                if (Math.abs(nt - target) < Math.abs(p.total - target)) p.total = nt; else p.sp[i] = old;
            }
        }
        p.total = p.timeSum();
        return p;
    }

    static double bandIncl(double g, double scale) { return Math.max(0, Math.min(I_MAX, Math.round(g * scale * 2) / 2.0)); }

    /** Abschnitt i und i+1 zusammenlegen, Steigung laengengewichtet. */
    static void merge(java.util.ArrayList<double[]> L, int i) {
        double[] x = L.get(i), y = L.get(i + 1);
        double l0 = x[1] - x[0], l1 = y[1] - y[0];
        x[2] = (x[2] * l0 + y[2] * l1) / (l0 + l1); x[1] = y[1]; L.remove(i + 1);
    }

    static double at(double[] d, double[] e, double x) {
        int i = (int) Math.min(d.length - 2, Math.max(0, Math.floor(x / 10.0)));
        double t = d[i + 1] > d[i] ? (x - d[i]) / (d[i + 1] - d[i]) : 0;
        return e[i] + Math.max(0, Math.min(1, t)) * (e[i + 1] - e[i]);
    }

    public double eleAt(double x) { return at(pd, pe, Math.max(0, Math.min(D, x))); }

    public int idxAt(double x) {
        int lo = 0, hi = n - 1;
        while (lo < hi) { int mid = (lo + hi + 1) >>> 1; if (a[mid] <= x) lo = mid; else hi = mid - 1; }
        return lo;
    }

    /** Planzeit an Position x (s), linear im Abschnitt. */
    public double tPlanAt(double x) {
        if (x >= D) return total;
        int i = n - 1; while (i > 0 && sa[i] > x) i--;
        return tA[i] + (Math.max(0, x - sa[i])) / (sp[i] / 3.6);
    }

    /** Vorlauf der Steigung vor Abschnitt i (m), gerechnet mit dem Plantempo des Abschnitts davor. */
    public double lead(int i) {
        if (i <= 0 || i >= n) return 0;
        return Math.min(100, sp[i - 1] / 3.6 * Math.abs(in[i] - in[i - 1]) / MOTOR);
    }
    /** Anstieg mit langsamerem Tempo: Tempo wird mit der Steigung vorgezogen. */
    public boolean early(int i) { return i > 0 && i < n && in[i] > in[i - 1] && sp[i] < sp[i - 1]; }

    /** Planzeit mit den tatsaechlichen Tempogrenzen (sa) und Startzeiten tA. */
    double timeSum() {
        for (int i = 0; i < n; i++) sa[i] = i == 0 ? 0 : early(i) ? a[i] - lead(i) : a[i];
        double t = 0;
        for (int i = 0; i < n; i++) { tA[i] = t; double e = i + 1 < n ? sa[i + 1] : D; t += Math.max(0, e - sa[i]) / (sp[i] / 3.6); }
        return t;
    }

    /** Index des Abschnitts, dessen Steigung an Position x schon anliegen soll (Vorlauf fuer den Motor). */
    public int inclIdxAt(double x, double v, double offI) {
        int i = idxAt(x);
        if (i + 1 >= n) return i;
        double cur = Math.max(0, Math.min(I_MAX, in[i] + offI)), nx = Math.max(0, Math.min(I_MAX, in[i + 1] + offI));
        double lead = Math.min(100, v / 3.6 * Math.abs(nx - cur) / MOTOR);   // v = Soll-Tempo; ohne Versatz identisch mit lead(i+1)
        return x >= a[i + 1] - lead ? i + 1 : i;
    }
}
