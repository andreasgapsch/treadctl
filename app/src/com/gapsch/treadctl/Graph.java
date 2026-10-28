// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;
import org.json.JSONArray;

/** Live-Verlauf fuer die Pille: Tempo und Puls oben (72 %), Steigung als
 *  Hoehenprofil unten. Daten: [[t, speed, incline, hr], ...] */
public class Graph extends View {
    JSONArray data = new JSONArray();
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    final Path path = new Path();
    static final int SPD = 0xFF3D8BFF, INC = 0xFFFFD43B, HR = 0xFFFF4D5E;

    public Graph(Context c) { super(c); }
    double nowS = -1, nowI, nowH;
    public void setNow(double s, double i, double h) { nowS = s; nowI = i; nowH = h; }
    public void set(JSONArray a) { if (a != null) data = a; invalidate(); }
    JSONArray prof; double rx, rD, rPace; int rDelta;
    public void setRoute(JSONArray p, double x, double D, double pace, int delta) { prof = p; rx = x; rD = D; rPace = pace; rDelta = delta; }
    static final int DONE = 0xFF2FD27A, TODO = 0xFFFF4D5E;

    /** Streckenmodus: Hoehenprofil, gelaufen gruen, offen rot, Punkt an der Position. */
    void drawRoute(Canvas cv) {
        int n = prof.length(); float w = getWidth(), H = getHeight(), h = H - dp(18), lw = w - dp(112), pad = 6;
        double mn = 1e9, mx = -1e9;
        for (int i = 0; i < n; i++) { double e = prof.optJSONArray(i).optDouble(1); mn = Math.min(mn, e); mx = Math.max(mx, e); }
        double span = Math.max(30, mx - mn); mn -= span * 0.08; mx = mn + span * 1.16;
        float px = (float) (Math.min(1, rx / Math.max(1, rD)) * lw);
        float py = interpY(prof, 0, rx, rD, lw, mn, mx, h, pad);
        float[] xs = new float[n], ys = new float[n];
        for (int i = 0; i < n; i++) { JSONArray q = prof.optJSONArray(i); xs[i] = (float) (q.optDouble(0) / rD * lw); ys[i] = (float) (pad + (h - 2 * pad) * (1 - (q.optDouble(1) - mn) / (mx - mn))); }
        for (int pass = 0; pass < 2; pass++) {          // 0 = gelaufen (bis px), 1 = offen (ab px)
            path.reset(); Path fillP = new Path();
            if (pass == 0) { path.moveTo(xs[0], ys[0]); for (int i = 1; i < n && xs[i] < px; i++) path.lineTo(xs[i], ys[i]); path.lineTo(px, py); }
            else { path.moveTo(px, py); for (int i = 0; i < n; i++) if (xs[i] > px) path.lineTo(xs[i], ys[i]); }
            float x0 = pass == 0 ? xs[0] : px, x1 = pass == 0 ? px : xs[n - 1];
            if (x1 - x0 < 1) continue;
            fillP.addPath(path); fillP.lineTo(x1, h); fillP.lineTo(x0, h); fillP.close();
            p.setStyle(Paint.Style.FILL); p.setColor((pass == 0 ? DONE : TODO) & 0x33FFFFFF); cv.drawPath(fillP, p);
            p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(3f); p.setColor(pass == 0 ? DONE : TODO); cv.drawPath(path, p);
        }
        p.setStyle(Paint.Style.FILL); p.setColor(0xFFFFFFFF); cv.drawCircle(px, py, dp(6), p);
        p.setColor(DONE); cv.drawCircle(px, py, dp(4), p);
        p.setTextAlign(Paint.Align.LEFT); p.setTextSize(dp(13)); p.setFakeBoldText(true);
        p.setColor(0xFFF4F5F9); cv.drawText(String.format(java.util.Locale.US, "km %.1f / %.1f", rx / 1000, rD / 1000), lw + dp(8), dp(14), p);
        p.setColor(0xFF3D8BFF); cv.drawText(rPace > 0 ? String.format(java.util.Locale.US, "Soll %d:%02d /km", (int) rPace / 60, (int) rPace % 60) : "", lw + dp(8), dp(32), p);
        p.setColor(rDelta >= 3 ? 0xFFFF7A1A : rDelta <= -3 ? DONE : 0xFFA4A9BB);
        cv.drawText(Math.abs(rDelta) < 3 ? "im Plan" : String.format(java.util.Locale.US, "%d:%02d %s", Math.abs(rDelta) / 60, Math.abs(rDelta) % 60, rDelta > 0 ? "hinter Plan" : "vor Plan"), lw + dp(8), dp(50), p);
        p.setColor(0xFFA4A9BB); p.setFakeBoldText(false); p.setTextSize(dp(11));
        cv.drawText(String.format(java.util.Locale.US, "%.0f m", mn + span * 0.08), lw + dp(8), h, p);
        cv.drawText("Start", 0, H - dp(2), p); p.setTextAlign(Paint.Align.RIGHT); cv.drawText("Ziel", lw, H - dp(2), p);
    }
    float interpY(JSONArray pr, int i, double x, double D, float lw, double mn, double mx, float h, float pad) {
        int n = pr.length(); int k = 1; while (k < n - 1 && pr.optJSONArray(k).optDouble(0) < x) k++;
        JSONArray a = pr.optJSONArray(k - 1), b = pr.optJSONArray(k);
        double t = b.optDouble(0) > a.optDouble(0) ? (x - a.optDouble(0)) / (b.optDouble(0) - a.optDouble(0)) : 0; t = Math.max(0, Math.min(1, t));
        double e = a.optDouble(1) + t * (b.optDouble(1) - a.optDouble(1));
        return (float) (pad + (h - 2 * pad) * (1 - (e - mn) / (mx - mn)));
    }

    @Override protected void onDraw(Canvas cv) {
        if (prof != null && prof.length() > 1 && rD > 0) { drawRoute(cv); return; }
        int n = data.length(); if (n < 2) { drawEmpty(cv); return; }
        int from = Math.max(0, n - 300);           // letzte 10 min (2 s Raster)
        float w = getWidth(), H = getHeight(), pad = 4, h = H - dp(18);   // unten Platz fuer die Zeitachse
        float top = pad, upH = (h - 2 * pad) * .70f, lowTop = pad + (h - 2 * pad) * .78f, lowH = (h - 2 * pad) * .22f;
        p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(1); p.setColor(0x22FFFFFF);
        p.setPathEffect(new DashPathEffect(new float[]{4, 6}, 0));
        cv.drawLine(0, pad + (h - 2 * pad) * .74f, w, pad + (h - 2 * pad) * .74f, p);
        p.setPathEffect(null);
        float lw = w - dp(112);                   // rechts Platz fuer Endwerte
        line(cv, from, n, 2, 0, 8, lowTop, lowH, lw, INC, 2.5f, true);
        line(cv, from, n, 3, 90, 190, top, upH, lw, HR, 2.5f, false);
        line(cv, from, n, 1, 0, 16, top, upH, lw, SPD, 3f, false);
        JSONArray last = data.optJSONArray(n - 1);
        p.setStyle(Paint.Style.FILL); p.setTextAlign(Paint.Align.LEFT); p.setTextSize(dp(13)); p.setFakeBoldText(true);
        if (last != null) {
            double vs = nowS >= 0 ? nowS : last.optDouble(1), vi = nowS >= 0 ? nowI : last.optDouble(2); int vh = nowS >= 0 ? (int) nowH : last.optInt(3);
            p.setColor(SPD); cv.drawText(String.format(java.util.Locale.US, "Ist %.1f km/h", vs), lw + dp(8), top + dp(14), p);
            p.setColor(HR); cv.drawText(vh > 0 ? vh + " bpm" : "kein Puls", lw + dp(8), top + dp(32), p);
            p.setColor(INC); cv.drawText(String.format(java.util.Locale.US, "%.1f %%", vi), lw + dp(8), lowTop + lowH, p);
        }
        p.setColor(0xFFA4A9BB); p.setFakeBoldText(false); p.setTextSize(dp(11));
        int mins = Math.max(1, Math.round((n - from) * 2 / 60f));
        cv.drawText("-" + mins + " min", 0, H - dp(2), p); p.setTextAlign(Paint.Align.RIGHT); cv.drawText("jetzt", lw, H - dp(2), p);
    }

    void drawEmpty(Canvas cv) {
        p.setStyle(Paint.Style.FILL); p.setColor(0xFFA4A9BB); p.setTextSize(28); p.setTextAlign(Paint.Align.CENTER);
        cv.drawText("Der Verlauf beginnt mit dem Lauf", getWidth() / 2f, getHeight() / 2f, p);
    }

    float dp(int v) { return v * getResources().getDisplayMetrics().density; }

    boolean line(Canvas cv, int from, int n, int idx, float mn, float mx, float top, float hh, float w, int col, float sw, boolean step) {
        path.reset(); boolean first = true, any = false; float lastY = 0;
        for (int i = from; i < n; i++) {
            JSONArray q = data.optJSONArray(i); if (q == null) continue;
            float v = (float) q.optDouble(idx, 0);
            if (idx == 3 && v <= 0) { first = true; continue; }
            float x = (i - from) * w / Math.max(1, (n - from - 1));
            float y = top + hh * (1 - Math.max(0, Math.min(1, (v - mn) / (mx - mn))));
            any = true;
            if (first) { path.moveTo(x, y); first = false; }
            else if (step) { path.lineTo(x, lastY); path.lineTo(x, y); }
            else path.lineTo(x, y);
            lastY = y;
        }
        p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(sw); p.setColor(col); p.setStrokeJoin(Paint.Join.ROUND);
        cv.drawPath(path, p);
        return any;
    }
}
