// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

/** Kartenkacheln ueber den Dienst, im Betrieb ausschliesslich offline:
 *  1. files/tiles (beim Import einer eigenen Strecke einmalig vorgeladen),
 *  2. assets/tiles (Paket der Beispielstrecken im APK),
 *  3. sonst eine neutrale leere Kachel. Die Anzeige loest nie einen Internetzugriff aus;
 *  online geladen wird nur in prefetch() auf ausdruecklichen Wunsch beim Import. */
public class Tiles {
    static final long MAX = 500L * 1024 * 1024;   // Obergrenze fuer vorgeladene Kacheln
    static volatile boolean prefetching = false;
    static volatile int preDone, preTotal, preFail;

    static String url(String src, int z, int x, int y) {
        if ("luft".equals(src)) return "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/" + z + "/" + x + "/" + y + ".jpeg";
        return null;
    }

    static File file(Context c, String src, int z, int x, int y) {
        return new File(new File(c.getFilesDir(), "tiles/" + src + "/" + z + "/" + x), y + ".jpg");
    }

    static void serve(Conn cn, TreadDaemon d) throws Exception {
        String[] p = cn.path.split("/");             // "", "tiles", src, z, x, y
        if (p.length != 6 || !cn.method.equals("GET")) { cn.send(400, "text/plain", "bad".getBytes()); return; }
        String src = p[2];
        int z, x, y;
        try { z = Integer.parseInt(p[3]); x = Integer.parseInt(p[4]); y = Integer.parseInt(p[5].replaceAll("\\.(png|jpe?g)$", "")); }
        catch (Exception e) { cn.send(400, "text/plain", "bad".getBytes()); return; }
        if (url(src, 0, 0, 0) == null || z < 0 || z > 19 || x < 0 || y < 0 || x >= (1 << z) || y >= (1 << z)) { cn.send(404, "text/plain", "quelle".getBytes()); return; }
        byte[] b = local(d, src, z, x, y);
        cn.cache = "max-age=604800";
        if (b == null) { cn.cache = "no-store"; cn.send(200, "image/png", blank()); return; }
        cn.send(200, "image/jpeg", b);
    }

    /** Nur lokal: vorgeladene Kachel oder Kachel aus dem APK-Paket. */
    static byte[] local(Context c, String src, int z, int x, int y) {
        File f = file(c, src, z, x, y);
        if (f.exists() && f.length() > 0) return Conn.readFile(f);
        try { InputStream is = c.getAssets().open("tiles/" + src + "/" + z + "/" + x + "/" + y + ".jpg"); byte[] b = Conn.readAll(is); is.close(); return b; }
        catch (Exception e) { return null; }
    }

    static byte[] blankPng;
    static synchronized byte[] blank() {
        if (blankPng == null) {
            android.graphics.Bitmap bm = android.graphics.Bitmap.createBitmap(256, 256, android.graphics.Bitmap.Config.ARGB_8888);
            bm.eraseColor(0xFF1B1E25);
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream(); bm.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bo); blankPng = bo.toByteArray();
        }
        return blankPng;
    }

    /** Online laden, nur aus prefetch(). */
    static byte[] fetch(Context c, String src, int z, int x, int y) {
        File f = file(c, src, z, x, y);
        try {
            HttpURLConnection h = (HttpURLConnection) new URL(url(src, z, x, y)).openConnection();
            h.setConnectTimeout(5000); h.setReadTimeout(8000);
            h.setRequestProperty("User-Agent", "TreadCtl/4 (Laufband privat)");
            if (h.getResponseCode() != 200) return null;
            InputStream is = h.getInputStream(); byte[] b = Conn.readAll(is); is.close();
            if (b.length < 100 || b.length > 2000000) return null;
            f.getParentFile().mkdirs();
            File tmp = new File(f.getPath() + ".tmp");
            FileOutputStream o = new FileOutputStream(tmp); o.write(b); o.close(); tmp.renameTo(f);
            return b;
        } catch (Throwable e) { return null; }
    }

    /** Laedt die Kacheln entlang einer Strecke (Punkt plus Nachbarn) fuer zmin bis zmax im Hintergrund. */
    static String prefetch(final Context c, JSONObject j) throws Exception {
        final String src = j.optString("src", "luft");
        if (url(src, 0, 0, 0) == null) return Core.err("Quelle unbekannt");
        final int zmin = Math.max(8, j.optInt("zmin", 12));
        int zmax = Math.min(17, j.optInt("zmax", 16));
        JSONArray pts = j.getJSONArray("pts");
        java.util.LinkedHashSet<String> want = tileSet(pts, zmin, zmax);
        while (want.size() > 6000 && zmax > zmin) want = tileSet(pts, zmin, --zmax);   // lange Strecken: hoechste Zoomstufe weglassen
        if (want.size() > 6000) return Core.err("Strecke zu gross zum Vorladen");
        final long used0;
        synchronized (Tiles.class) {
            if (prefetching) return "{\"ok\":true,\"busy\":true}";
            used0 = usage(c);
            if (used0 > MAX) return Core.err("Kartenspeicher voll (500 MB)");
            prefetching = true; preDone = 0; preFail = 0; preTotal = want.size();
        }
        final java.util.LinkedHashSet<String> todo = want; final int zTop = zmax;
        new Thread(new Runnable() { public void run() {
            long used = used0;
            try {
                for (String k : todo) {
                    if (used > MAX) { preFail += todo.size() - preDone; Log.w("TREADCTL", "prefetch: 500 MB erreicht"); break; }   // Grenze auch waehrend des Ladens
                    String[] p = k.split("/"); int z = Integer.parseInt(p[0]), x = Integer.parseInt(p[1]), y = Integer.parseInt(p[2]);
                    if (local(c, src, z, x, y) == null) {
                        byte[] got = fetch(c, src, z, x, y);
                        if (got == null) preFail++; else used += got.length;
                        try { Thread.sleep(40); } catch (InterruptedException e) { break; }
                    }
                    preDone++;
                }
            } catch (Throwable e) { Log.w("TREADCTL", "prefetch: " + e); }
            prefetching = false;
        } }, "tiles").start();
        return "{\"ok\":true,\"total\":" + todo.size() + ",\"zmax\":" + zTop + "}";
    }

    static java.util.LinkedHashSet<String> tileSet(JSONArray pts, int zmin, int zmax) throws Exception {
        java.util.LinkedHashSet<String> want = new java.util.LinkedHashSet<String>();
        for (int z = zmin; z <= zmax; z++) {
            for (int i = 0; i < pts.length(); i++) {
                JSONArray q = pts.getJSONArray(i);
                int tx = lon2x(q.getDouble(1), z), ty = lat2y(q.getDouble(0), z);
                for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) want.add(z + "/" + (tx + dx) + "/" + (ty + dy));
            }
        }
        return want;
    }

    static int lon2x(double lon, int z) { return (int) Math.floor((lon + 180) / 360 * (1 << z)); }
    static int lat2y(double lat, int z) {
        double r = Math.toRadians(lat);
        return (int) Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z));
    }

    /** Belegter Platz der vorgeladenen Kacheln. Es wird nichts automatisch geloescht (Strecken muessen offline bleiben). */
    static long usage(Context c) {
        java.util.ArrayList<File> all = new java.util.ArrayList<File>();
        collect(new File(c.getFilesDir(), "tiles"), all);
        long sum = 0, now = System.currentTimeMillis();
        for (File f : all) {
            if (f.getName().endsWith(".tmp") && now - f.lastModified() > 60000) { f.delete(); continue; }   // Reste abgebrochener Ladevorgaenge
            sum += f.length();
        }
        return sum;
    }
    static void collect(File d, java.util.ArrayList<File> out) {
        File[] fs = d.listFiles(); if (fs == null) return;
        for (File f : fs) if (f.isDirectory()) collect(f, out); else out.add(f);
    }

    static String status() { return "{\"ok\":true,\"busy\":" + prefetching + ",\"done\":" + preDone + ",\"total\":" + preTotal + ",\"failed\":" + preFail + "}"; }

    /** Wie viele Kacheln einer Strecke offline vorhanden sind (fuer die Anzeige «Karte nachladen»). */
    static String coverage(Context c, JSONObject j) throws Exception {
        String src = j.optString("src", "luft"); JSONArray pts = j.getJSONArray("pts"); int have = 0, all = 0;
        if (pts.length() > 600) return Core.err("zu viele Punkte");
        for (int z = 12; z <= 16; z += 2) for (int i = 0; i < pts.length(); i++) {
            JSONArray q = pts.getJSONArray(i); all++;
            if (local(c, src, z, lon2x(q.getDouble(1), z), lat2y(q.getDouble(0), z)) != null) have++;
        }
        return "{\"ok\":true,\"have\":" + have + ",\"total\":" + all + "}";
    }
}
