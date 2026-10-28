// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.View;

/** Strichsymbole im Stil des Designsystems (24er-Raster, 2er-Strich). */
public class Icon extends View {
    String name; int color; boolean fill;
    final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    final Path path = new Path();

    public Icon(Context c, String name, int color) { super(c); this.name = name; this.color = color; }
    public void set(String n, int c) { name = n; color = c; invalidate(); }

    @Override protected void onDraw(Canvas cv) {
        float s = Math.min(getWidth(), getHeight()) / 24f;
        cv.save();
        cv.translate((getWidth() - 24 * s) / 2f, (getHeight() - 24 * s) / 2f);
        cv.scale(s, s);
        p.setColor(color); p.setStrokeWidth(2.2f); p.setStrokeCap(Paint.Cap.ROUND); p.setStrokeJoin(Paint.Join.ROUND);
        p.setStyle(Paint.Style.STROKE);
        path.reset();
        switch (name) {
            case "menu": line(cv, 4, 7, 20, 7); line(cv, 4, 12, 20, 12); line(cv, 4, 17, 20, 17); break;
            case "plus": line(cv, 12, 5, 12, 19); line(cv, 5, 12, 19, 12); break;
            case "minus": line(cv, 5, 12, 19, 12); break;
            case "down": path.moveTo(6, 9); path.lineTo(12, 15); path.lineTo(18, 9); line(cv, 12, 4, 12, 15); cv.drawPath(path, p); break;
            case "warn": path.moveTo(12, 3); path.lineTo(22, 21); path.lineTo(2, 21); path.close(); line(cv, 12, 10, 12, 15); line(cv, 12, 18, 12, 18.5f); cv.drawPath(path, p); break;
            case "up": path.moveTo(6, 15); path.lineTo(12, 9); path.lineTo(18, 15); cv.drawPath(path, p); break;
            case "back": path.moveTo(15, 5); path.lineTo(8, 12); path.lineTo(15, 19); cv.drawPath(path, p); break;
            case "music": cv.drawCircle(7, 18, 3, p); cv.drawCircle(18, 16, 3, p); path.moveTo(10, 18); path.lineTo(10, 5); path.lineTo(21, 3); path.lineTo(21, 16); cv.drawPath(path, p); break;
            case "stop": p.setStyle(Paint.Style.FILL); cv.drawRoundRect(new RectF(6, 6, 18, 18), 2, 2, p); break;
            case "play": p.setStyle(Paint.Style.FILL); path.moveTo(7, 4); path.lineTo(20, 12); path.lineTo(7, 20); path.close(); cv.drawPath(path, p); break;
            case "pause": p.setStyle(Paint.Style.FILL); cv.drawRoundRect(new RectF(6, 5, 10, 19), 1, 1, p); cv.drawRoundRect(new RectF(14, 5, 18, 19), 1, 1, p); break;
            case "next": p.setStyle(Paint.Style.FILL); path.moveTo(5, 5); path.lineTo(16, 12); path.lineTo(5, 19); path.close(); cv.drawPath(path, p); cv.drawRect(new RectF(17, 5, 20, 19), p); break;
            case "prev": p.setStyle(Paint.Style.FILL); path.moveTo(19, 5); path.lineTo(8, 12); path.lineTo(19, 19); path.close(); cv.drawPath(path, p); cv.drawRect(new RectF(4, 5, 7, 19), p); break;
            case "inc": path.moveTo(3, 20); path.lineTo(21, 20); path.lineTo(21, 7); path.close(); cv.drawPath(path, p); break;
            case "clock": cv.drawCircle(12, 12, 9, p); path.moveTo(12, 7); path.lineTo(12, 12); path.lineTo(15, 14); cv.drawPath(path, p); break;
            case "run": cv.drawCircle(14, 4, 2, p); path.moveTo(7, 21); path.lineTo(10, 15); path.lineTo(13, 17); path.lineTo(13, 22);
                path.moveTo(10, 15); path.lineTo(12, 9); path.lineTo(16, 12); path.lineTo(19, 13); path.moveTo(8, 9); path.lineTo(12, 8); cv.drawPath(path, p); break;
            case "heart": p.setStyle(Paint.Style.FILL); path.moveTo(12, 21);
                path.cubicTo(5, 15.5f, 2, 12, 2, 8.5f); path.cubicTo(2, 5.5f, 4.5f, 3.5f, 7, 3.5f); path.cubicTo(9, 3.5f, 11, 4.8f, 12, 6.5f);
                path.cubicTo(13, 4.8f, 15, 3.5f, 17, 3.5f); path.cubicTo(19.5f, 3.5f, 22, 5.5f, 22, 8.5f); path.cubicTo(22, 12, 19, 15.5f, 12, 21); path.close(); cv.drawPath(path, p); break;
            case "graph": p.setStrokeWidth(3.4f); line(cv, 5, 20, 5, 13); line(cv, 10, 20, 10, 8); line(cv, 15, 20, 15, 11); line(cv, 20, 20, 20, 5); break;   // Verlauf als Balken (Linie sah aus wie ein Berg)
            case "apps": cv.drawRoundRect(new RectF(4, 4, 11, 11), 2, 2, p); cv.drawRoundRect(new RectF(13, 4, 20, 11), 2, 2, p);
                cv.drawRoundRect(new RectF(4, 13, 11, 20), 2, 2, p); cv.drawRoundRect(new RectF(13, 13, 20, 20), 2, 2, p); break;
            case "key": cv.drawCircle(8, 15, 4, p); line(cv, 11, 12, 20, 3); line(cv, 17, 6, 20, 9); break;
            case "interval": path.moveTo(3, 18); path.lineTo(6, 18); path.lineTo(6, 9); path.lineTo(10, 9); path.lineTo(10, 18); path.lineTo(13, 18); path.lineTo(13, 5); path.lineTo(17, 5); path.lineTo(17, 18); path.lineTo(21, 18); cv.drawPath(path, p); break;
            case "dist": path.moveTo(4, 19); path.cubicTo(8, 19, 8, 13, 12, 13); path.cubicTo(16, 13, 16, 7, 20, 7); cv.drawPath(path, p); break;
            case "wifi": path.moveTo(2, 9); path.quadTo(12, 0, 22, 9); path.moveTo(5.5f, 12.5f); path.quadTo(12, 6.5f, 18.5f, 12.5f);
                path.moveTo(9, 16); path.quadTo(12, 13.5f, 15, 16); cv.drawPath(path, p); p.setStyle(Paint.Style.FILL); cv.drawCircle(12, 19.5f, 1.6f, p); break;
            case "gear": cv.drawCircle(12, 12, 3f, p);
                for (int k = 0; k < 48; k++) {   // Zahnrad: 8 Zaehne aus Polygon (aussen 9.5, innen 7.2)
                    double a = k * Math.PI * 2 / 48; int ph = (k % 6); double r = ph < 2 ? 9.5 : (ph == 3 || ph == 4) ? 7.2 : 8.4;
                    float x = (float) (12 + r * Math.cos(a)), y = (float) (12 + r * Math.sin(a));
                    if (k == 0) path.moveTo(x, y); else path.lineTo(x, y);
                }
                path.close(); p.setStrokeWidth(1.8f); cv.drawPath(path, p); break;
            case "fan": cv.drawCircle(12, 12, 1.8f, p);   // Ventilator: drei Fluegel
                for (int k = 0; k < 3; k++) { cv.save(); cv.rotate(k * 120, 12, 12); path.reset(); path.moveTo(12, 10); path.cubicTo(9, 6, 10, 2.5f, 13.5f, 3); path.cubicTo(16.5f, 3.5f, 16, 7.5f, 13.6f, 10.4f); cv.drawPath(path, p); cv.restore(); }
                break;
            case "check": path.moveTo(5, 12); path.lineTo(10, 17); path.lineTo(19, 7); cv.drawPath(path, p); break;
            default: break;
        }
        cv.restore();
    }

    void line(Canvas cv, float a, float b, float c, float d) { cv.drawLine(a, b, c, d, p); }
}
