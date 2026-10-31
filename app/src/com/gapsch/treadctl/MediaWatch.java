// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import java.io.ByteArrayOutputStream;
import java.util.List;
import org.json.JSONObject;

/** Mini-Player: liest die laufende Wiedergabe der Medien-Apps (YouTube Music, Audiobookshelf, YouTube, Jellyfin)
 *  ueber die Android-Mediensitzungen und steuert sie (Wiedergabe/Pause, vor, zurueck).
 *  Braucht MEDIA_CONTENT_CONTROL (System-App mit Plattformsignatur). */
public class MediaWatch {
    static final String[] PREF = { "app.revanced.android.apps.youtube.music", "com.google.android.apps.youtube.music",
        "com.audiobookshelf.app", "app.revanced.android.youtube", "org.jellyfin.mobile" };
    final Context ctx;
    AudioOut out;   // Abspielgeraet
    String artKey = ""; byte[] art; int artVer;
    volatile String prefer = "";   // zuletzt gewaehlte Quelle: bleibt angezeigt, auch wenn pausiert
    static final String[][] SRC = { { "app.revanced.android.apps.youtube.music", "YouTube Music" }, { "com.audiobookshelf.app", "Hörbücher" } };

    MediaWatch(Context c) { ctx = c; }

    // Play pruefen: Manche Apps (YouTube Music kurz nach dem Einschalten) nehmen das erste play() an, ohne zu spielen.
    // Nach 2 s nachsehen; spielt die Sitzung dann nicht und kam kein neuer Befehl, einmal nachfassen. Alles ins Log (TreadMedia).
    final android.os.Handler later = new android.os.Handler(android.os.Looper.getMainLooper());
    volatile int cmdSeq = 0;
    static String stName(MediaController c) { PlaybackState ps = c == null ? null : c.getPlaybackState(); return ps == null ? "null" : String.valueOf(ps.getState()); }
    void playChecked(final MediaController c, final String why) {
        final int seq = ++cmdSeq; final String pkg = c.getPackageName();
        android.util.Log.i("TreadMedia", why + " play " + pkg + " Zustand vorher " + stName(c));
        c.getTransportControls().play();
        check(seq, pkg, why, 2000, true);
    }
    /** Nach ms nachsehen: spielt die Sitzung, fertig; puffert/verbindet sie noch, spaeter nochmals; sonst einmal nachfassen. */
    void check(final int seq, final String pkg, final String why, final long ms, final boolean again) {
        later.postDelayed(new Runnable() { public void run() {
            if (seq != cmdSeq) return;
            MediaController n = session(pkg); PlaybackState ps = n == null ? null : n.getPlaybackState();
            int st = ps == null ? -1 : ps.getState();
            android.util.Log.i("TreadMedia", why + " nach " + ms + " ms " + pkg + " Zustand " + st);
            if (n == null || st == PlaybackState.STATE_PLAYING) return;
            if (st == PlaybackState.STATE_BUFFERING || st == PlaybackState.STATE_CONNECTING) { if (again) check(seq, pkg, why, 3000, false); return; }
            android.util.Log.i("TreadMedia", why + " spielt nicht, zweites play");
            n.getTransportControls().play();
        } }, ms);
    }

    List<MediaController> sessions() {
        MediaSessionManager m = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
        return m.getActiveSessions(null);
    }
    MediaController session(String pkg) { try { return session(sessions(), pkg); } catch (Throwable e) { return null; } }
    static MediaController session(List<MediaController> l, String pkg) { if (l != null) for (MediaController c : l) if (pkg.equals(c.getPackageName())) return c; return null; }
    static boolean playing(MediaController c) { PlaybackState ps = c.getPlaybackState(); return ps != null && (ps.getState() == PlaybackState.STATE_PLAYING || ps.getState() == PlaybackState.STATE_BUFFERING); }

    /** Die passendste Sitzung: zuerst eine, die gerade spielt, dann die zuletzt gewaehlte Quelle, sonst die bevorzugte bekannte App. */
    MediaController pick() { try { return pick(sessions()); } catch (Throwable e) { return null; } }
    MediaController pick(List<MediaController> l) {
        try {
            MediaController best = null; int bestScore = -1;
            for (MediaController c : l) {
                int score = 0;
                for (int i = 0; i < PREF.length; i++) if (PREF[i].equals(c.getPackageName())) score = 10 - i;
                if (score == 0) continue;   // nur bekannte Medien-Apps
                PlaybackState ps = c.getPlaybackState();
                if (ps != null && ps.getState() == PlaybackState.STATE_PLAYING) score += 100;
                if (c.getPackageName().equals(prefer)) score += 50;
                if (score > bestScore) { bestScore = score; best = c; }
            }
            return best;
        } catch (Throwable e) { return null; }
    }

    static String appName(String pkg) {
        if (pkg.contains("youtube.music")) return "YouTube Music";
        if (pkg.contains("audiobookshelf")) return "Hörbücher";
        if (pkg.contains("youtube")) return "YouTube";
        if (pkg.contains("jellyfin")) return "Jellyfin";
        return pkg;
    }

    synchronized String status() {
        try {
            JSONObject o = new JSONObject(); o.put("ok", true);
            List<MediaController> all = sessions();   // einmal je Abfrage (frueher dreimal, samt Metadaten und Cover)
            android.media.AudioManager am = (android.media.AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            o.put("vol", am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)); o.put("volMax", am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC));
            o.put("out", am.isBluetoothA2dpOn() ? "bluetooth" : "geraet");
            if (out != null) try { o.put("outs", out.list()); } catch (Throwable e) {}
            org.json.JSONArray src = new org.json.JSONArray();
            for (String[] q : SRC) {
                JSONObject x = new JSONObject(); x.put("pkg", q[0]); x.put("app", q[1]);
                boolean inst; try { ctx.getPackageManager().getPackageInfo(q[0], 0); inst = true; } catch (Throwable e) { inst = false; }
                x.put("installed", inst);
                MediaController sc = inst ? session(all, q[0]) : null;
                x.put("session", sc != null); x.put("playing", sc != null && playing(sc));
                MediaMetadata sm = sc == null ? null : sc.getMetadata();
                x.put("title", sm == null ? "" : nz(sm.getString(MediaMetadata.METADATA_KEY_TITLE)));
                src.put(x);
            }
            o.put("sources", src);
            MediaController c = pick(all);
            if (c == null) { o.put("active", false); return o.toString(); }
            PlaybackState ps = c.getPlaybackState(); MediaMetadata md = c.getMetadata();
            int st = ps == null ? 0 : ps.getState();
            o.put("active", true); o.put("pkg", c.getPackageName()); o.put("app", appName(c.getPackageName()));
            o.put("playing", st == PlaybackState.STATE_PLAYING || st == PlaybackState.STATE_BUFFERING);
            if (md != null) {
                o.put("title", nz(md.getString(MediaMetadata.METADATA_KEY_TITLE)));
                String ar = md.getString(MediaMetadata.METADATA_KEY_ARTIST); if (ar == null) ar = md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
                if (ar == null) ar = md.getString(MediaMetadata.METADATA_KEY_AUTHOR);
                o.put("artist", nz(ar)); o.put("album", nz(md.getString(MediaMetadata.METADATA_KEY_ALBUM)));
                o.put("dur", md.getLong(MediaMetadata.METADATA_KEY_DURATION) / 1000);
                Bitmap b = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART); if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
                if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
                // Kennung aus Titel und Bildinhalt (16 Stichproben): die Generationsnummer ist bei jedem Abruf neu,
                // das haette bei jeder Abfrage ein neues JPEG und einen neuen Bildabruf in der Oberflaeche ausgeloest
                String key = c.getPackageName() + "|" + nz(md.getString(MediaMetadata.METADATA_KEY_TITLE)) + "|" + artSig(b);
                if (!key.equals(artKey)) { artKey = key; art = b == null ? null : jpeg(b); artVer++; }
                o.put("art", art != null ? artVer : 0);
            }
            if (ps != null) {
                o.put("pos", pos(ps) / 1000);
                long a = ps.getActions();
                o.put("canNext", (a & PlaybackState.ACTION_SKIP_TO_NEXT) != 0); o.put("canPrev", (a & PlaybackState.ACTION_SKIP_TO_PREVIOUS) != 0);
            }
            return o.toString();
        } catch (Throwable e) { return Core.err(String.valueOf(e)); }
    }

    /** Knapper Zustand fuer den Player der Pille: ohne Quellenliste, Ausgaenge und Cover (keine Bitmaps je Abfrage). */
    synchronized String statusLite() {
        try {
            JSONObject o = new JSONObject(); o.put("ok", true);
            MediaController c = pick(sessions());
            if (c == null) { o.put("active", false); return o.toString(); }
            PlaybackState ps = c.getPlaybackState(); MediaMetadata md = c.getMetadata(); int st = ps == null ? 0 : ps.getState();
            o.put("active", true); o.put("pkg", c.getPackageName()); o.put("app", appName(c.getPackageName()));
            o.put("playing", st == PlaybackState.STATE_PLAYING || st == PlaybackState.STATE_BUFFERING);
            if (md != null) {
                o.put("title", nz(md.getString(MediaMetadata.METADATA_KEY_TITLE)));
                String ar = md.getString(MediaMetadata.METADATA_KEY_ARTIST); if (ar == null) ar = md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
                if (ar == null) ar = md.getString(MediaMetadata.METADATA_KEY_AUTHOR);
                o.put("artist", nz(ar));
            }
            return o.toString();
        } catch (Throwable e) { return Core.err(String.valueOf(e)); }
    }

    synchronized byte[] artwork() { return art; }

    String cmd(JSONObject j) {
        String a = j.optString("a");
        android.media.AudioManager am = (android.media.AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        int MU = android.media.AudioManager.STREAM_MUSIC;
        if ("volUp".equals(a)) { am.adjustStreamVolume(MU, android.media.AudioManager.ADJUST_RAISE, 0); return Core.ok(); }
        if ("volDown".equals(a)) { am.adjustStreamVolume(MU, android.media.AudioManager.ADJUST_LOWER, 0); return Core.ok(); }
        if ("vol".equals(a) && !j.has("v")) return Core.err("Wert fehlt");
        if ("vol".equals(a)) { am.setStreamVolume(MU, Math.max(0, Math.min(am.getStreamMaxVolume(MU), j.optInt("v"))), 0); return Core.ok(); }
        if ("out".equals(a)) return out == null ? Core.err("kein Bluetooth") : out.select(j.optString("address"));
        if ("source".equals(a)) {   // Quelle wechseln: andere pausieren, gewuenschte fortsetzen
            String pkg = j.optString("pkg"); boolean known = false;
            for (String[] q : SRC) if (q[0].equals(pkg)) known = true;
            if (!known) return Core.err("unbekannte Quelle");
            prefer = pkg;
            try { for (MediaController o : sessions()) if (!pkg.equals(o.getPackageName()) && playing(o)) o.getTransportControls().pause(); } catch (Throwable e) {}
            MediaController t = session(pkg);
            if (t == null) return Core.err("start");
            playChecked(t, "source"); return Core.ok();
        }
        MediaController c = pick();
        if (c == null) return Core.err("keine Wiedergabe");
        MediaController.TransportControls t = c.getTransportControls();
        PlaybackState ps = c.getPlaybackState();
        boolean playing = playing(c);   // auch beim Puffern: Tipp heisst Pause
        cmdSeq++;   // jeder Befehl verwirft ein ausstehendes Nachfassen
        android.util.Log.i("TreadMedia", "cmd " + a + " " + c.getPackageName() + " Zustand " + stName(c));
        if ("toggle".equals(a)) { if (playing) t.pause(); else playChecked(c, "toggle"); }
        else if ("play".equals(a)) playChecked(c, "play");
        else if ("pause".equals(a)) t.pause();
        else if ("next".equals(a)) t.skipToNext();
        else if ("prev".equals(a)) t.skipToPrevious();
        else if ("back30".equals(a) && ps != null) t.seekTo(Math.max(0, pos(ps) - 30000));
        else if ("fwd30".equals(a) && ps != null) t.seekTo(pos(ps) + 30000);
        else return Core.err("unbekannt");
        return Core.ok();
    }

    /** Aktuelle Position: die App meldet sie nur ab und zu, dazwischen fortschreiben (wie in status). */
    static long pos(PlaybackState ps) {
        long p = ps.getPosition();
        if (ps.getState() == PlaybackState.STATE_PLAYING && ps.getLastPositionUpdateTime() > 0)
            p += (long) ((android.os.SystemClock.elapsedRealtime() - ps.getLastPositionUpdateTime()) * ps.getPlaybackSpeed());
        return Math.max(0, p);
    }
    static String artSig(Bitmap b) {
        if (b == null) return "0";
        try {
            int w = b.getWidth(), h = b.getHeight(); long x = w * 31L + h;
            for (int i = 1; i <= 4; i++) for (int j = 1; j <= 4; j++) x = x * 31 + b.getPixel(w * i / 5, h * j / 5);
            return w + "x" + h + ":" + Long.toHexString(x);
        } catch (Throwable e) { return "?"; }
    }
    static String nz(String s) { return s == null ? "" : s; }
    static byte[] jpeg(Bitmap b) {
        try {
            int w = b.getWidth(), h = b.getHeight(), m = 240; float f = Math.min(1f, m / (float) Math.max(w, h));
            Bitmap s = f < 1f ? Bitmap.createScaledBitmap(b, Math.max(1, (int) (w * f)), Math.max(1, (int) (h * f)), true) : b;
            ByteArrayOutputStream o = new ByteArrayOutputStream(); s.compress(Bitmap.CompressFormat.JPEG, 85, o); return o.toByteArray();
        } catch (Throwable e) { return null; }
    }
}
