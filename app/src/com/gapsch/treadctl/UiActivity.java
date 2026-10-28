// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;

/** Eigene Oberflaeche (WebView auf 127.0.0.1:8765) im Prozess :ui. Laedt nur
 *  die eigene Seite; fremde Adressen werden blockiert. */
public class UiActivity extends Activity {
    WebView wv;
    // Gesundheit der Oberflaeche: Herzschlag aus der Seite, begrenzte Neuaufbauten nach Absturz oder Haenger
    volatile long beatAt = Core.clock(), loadAt = Core.clock();
    boolean resumed, needRebuild, uiShown = false;
    final java.util.ArrayList<Long> rebuilds = new java.util.ArrayList<Long>();
    final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
    boolean mayRebuild() {   // hoechstens 3 Neuaufbauten je Minute, sonst bleibt die Pille die Bedienung
        long now = Core.clock(); while (!rebuilds.isEmpty() && now - rebuilds.get(0) > 60000) rebuilds.remove(0);
        if (rebuilds.size() >= 3) return false; rebuilds.add(now); return true;
    }
    final Runnable health = new Runnable() { public void run() {
        long now = Core.clock();
        // Seite haengt oder ist leer: kein Herzschlag seit 6 s (nach dem Laden 10 s Schonfrist). Nur die Seite selbst setzt
        // den Herzschlag zurueck; die Pille bleibt sichtbar, bis wieder einer kommt (kein Hin und Her waehrend des Neuladens).
        boolean stale = resumed && now - beatAt > 6000 && (uiShown || now - loadAt > 10000);
        if (stale && !uiShown) { uiShown = true; overlay("show"); }               // STOP der Pille sichtbar machen
        if (uiShown && resumed && now - beatAt < 3000) { uiShown = false; overlay("hide"); }
        if (stale && wv != null && now - loadAt > 15000 && mayRebuild()) { loadAt = now; wv.reload(); }
        h.postDelayed(this, 2000);
    } };
    static final String[] APPS = { "org.smarttube.stable", "app.revanced.android.youtube", "app.revanced.android.apps.youtube.music", "com.google.android.apps.youtube.music", "com.google.android.youtube",
        "org.jellyfin.mobile", "org.jellyfin.androidtv", "com.kinomap.training", "com.zwift.zwiftgame", "com.audiobookshelf.app", "ch.teleboy", "com.aurora.store" };

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setBackgroundColor(0xFF000000);
        // Als Startbildschirm kommt die Oberflaeche vor BOOT_COMPLETED: Dienst und Pille gleich mitstarten (laufen sie schon, ohne Wirkung)
        try { startForegroundService(new Intent(this, TreadDaemon.class)); } catch (Throwable e) {}
        overlay(null);
        build();
    }

    void build() {
        // nur fuer Messungen: Fernzugriff der Chrome-Werkzeuge, solange files/webdebug existiert (anlegen kann nur root)
        WebView.setWebContentsDebuggingEnabled(new java.io.File(getFilesDir(), "webdebug").exists());
        wv = new WebView(this);
        wv.setBackgroundColor(0xFF000000);
        WebSettings ws = wv.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setTextZoom(100);
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        wv.addJavascriptInterface(new Native(), "TreadNative");
        wv.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !r.getUrl().toString().startsWith("http://127.0.0.1:8765/");
            }
            // Dienst noch nicht bereit (Start als Startbildschirm vor dem Steuerdienst): nach 1 s neu laden statt Fehlerseite
            @Override public void onReceivedError(WebView v, android.webkit.WebResourceRequest r, android.webkit.WebResourceError e) {
                if (r != null && r.isForMainFrame() && loadRetries++ < 30) h.postDelayed(new Runnable() { public void run() { if (wv != null) wv.reload(); } }, 1000);
            }
            @Override public void onPageFinished(WebView v, String url) { if (url != null && url.startsWith("http://127.0.0.1:8765/")) loadRetries = 0; }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                // Renderer abgestuerzt: neu aufbauen statt die App zu beenden, aber begrenzt (keine Endlosschleife) und
                // nur im Vordergrund (im Hintergrund wuerde die neue Seite neben YouTube weiter abfragen)
                try { ((android.view.ViewGroup) v.getParent()).removeView(v); v.destroy(); } catch (Throwable e) {}
                wv = null; overlay("show"); uiShown = true;
                if (!resumed) { needRebuild = true; return true; }
                if (mayRebuild()) build(); else showDown();
                return true;
            }
        });
        wv.loadUrl("http://127.0.0.1:8765/" + demo(getIntent()) + route(getIntent()));
        loadAt = Core.clock(); beatAt = loadAt;
        setContentView(wv);
    }

    /** Start ueber den exportierten Startbildschirm-Alias: keine Zusaetze (Route, Demo) von aussen. */
    static boolean external(Intent i) { return i != null && i.getComponent() != null && "com.gapsch.treadctl.Home".equals(i.getComponent().getClassName()); }
    static String route(Intent i) {
        if (external(i)) return "";
        String r = i == null ? null : i.getStringExtra("route");
        return r != null && r.matches("/[a-z/0-9-]{0,60}") ? "#" + r : "";
    }

    /** Nur fuer Abnahmefotos (Activity ist nicht exportiert, Start nur per Root-adb): Demo-Szenario statt echter Werte. */
    static String demo(Intent i) {
        if (external(i)) return "";
        String q = i == null ? null : i.getStringExtra("demo");
        return q != null && q.matches("[a-z0-9=&-]{0,80}") ? "?demo=1" + (q.length() > 0 ? "&" + q : "") : "";
    }

    int loadRetries = 0;
    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i); setIntent(i);   // ein Neuaufbau nach Absturz nimmt dann die letzte Route
        if (i != null && !external(i) && i.hasExtra("demo") || wv != null && wv.getUrl() != null && wv.getUrl().contains("demo=1")) {
            if (wv != null) wv.loadUrl("http://127.0.0.1:8765/" + demo(i) + route(i)); return;
        }
        String r = route(i);
        if (wv != null && r.length() > 0) wv.evaluateJavascript("location.hash=" + org.json.JSONObject.quote(r.substring(1)), null);
    }

    /** Nach wiederholtem Absturz: ruhige Meldung statt Endlosschleife; die Pille bleibt sichtbar. Antippen versucht es erneut. */
    void showDown() {
        android.widget.TextView t = new android.widget.TextView(this);
        t.setText("Oberfläche vorübergehend nicht verfügbar.\nSteuerung über die Pille unten. Antippen lädt neu.");
        t.setTextColor(0xFFF4F5F9); t.setTextSize(22); t.setGravity(android.view.Gravity.CENTER); t.setBackgroundColor(0xFF000000);
        t.setOnClickListener(new View.OnClickListener() { public void onClick(View x) { rebuilds.clear(); build(); } });
        setContentView(t);
    }

    void overlay(String action) {
        try { startService(new Intent(this, OverlayService.class).setAction(action)); } catch (Throwable e) {}
    }

    @Override protected void onResume() {
        super.onResume(); resumed = true;
        if (needRebuild && wv == null) { needRebuild = false; if (mayRebuild()) build(); else showDown(); }
        if (wv != null) { overlay("hide"); uiShown = false; wv.onResume(); beatAt = Core.clock(); }
        h.removeCallbacks(health); h.postDelayed(health, 2000);
    }
    @Override protected void onPause() { super.onPause(); resumed = false; h.removeCallbacks(health); overlay("show"); if (wv != null) wv.onPause(); }
    // Ganz verdeckt (andere App vorne): JavaScript-Zeitgeber anhalten, die Seite fragt dann nicht weiter alle 2 s ab;
    // Lease und STOP-Wache uebernimmt die Pille. Zurueck: weiter, onResume setzt den Herzschlag zurueck.
    @Override protected void onStop() { super.onStop(); if (wv != null) wv.pauseTimers(); }
    @Override protected void onStart() { super.onStart(); if (wv != null) wv.resumeTimers(); }
    @Override protected void onDestroy() { h.removeCallbacks(health); if (wv != null) wv.destroy(); super.onDestroy(); }
    @Override public void onBackPressed() { if (wv != null) wv.evaluateJavascript("window.onNativeBack&&window.onNativeBack()", null); }

    /** Bruecke fuer die Oberflaeche: Token, Notfall-STOP, Herzschlag, App-Start und Symbole, GPX-Dateien, Einstellungen. */
    class Native {
        @JavascriptInterface public String token() { return Token.read(UiActivity.this); }
        /** Herzschlag der Seite (alle 2 s aus app.js): bleibt er aus, zeigt die App die Pille und laedt neu. */
        @JavascriptInterface public void beat() { beatAt = Core.clock(); }
        /** Notfall-STOP ohne Dienst: direkt auf den Herstellerbus (gleiche uid). Nur STOP, nichts anderes. */
        @JavascriptInterface public boolean stopDirect() {
            // eigener Thread: ein haengender Herstellerdienst darf die Oberflaeche nicht einfrieren
            new Thread(new Runnable() { public void run() {
                try { DataBus b = new DataBus(); if (b.connect(UiActivity.this)) b.sendEvent(Core.A_STOP); } catch (Throwable e) {}
            } }, "stop-direkt").start();
            return true;
        }
        @JavascriptInterface public boolean launch(String pkg) {
            boolean known = false; for (String a : APPS) if (a.equals(pkg)) known = true;
            if (!known) return false;
            try {
                Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                if (i == null) return false;
                new Thread(new Runnable() { public void run() { AppHygiene.trim(UiActivity.this); } }).start();   // Speicher fuer die gestartete App
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); return true;
            } catch (Throwable e) { return false; }
        }
        @JavascriptInterface public String installed() {
            JSONArray a = new JSONArray(); PackageManager pm = getPackageManager();
            for (String p : APPS) { try { pm.getPackageInfo(p, 0); a.put(p); } catch (Throwable e) {} }
            return a.toString();
        }
        @JavascriptInterface public void setPref(String k, String v) {
            if (k == null || !k.matches("[a-zA-Z]{1,24}")) return;
            SharedPreferences.Editor e = getSharedPreferences("prefs", MODE_PRIVATE).edit(); e.putString(k, v); e.apply();
            try { startService(new Intent(UiActivity.this, OverlayService.class).setAction("pref").putExtra("k", k).putExtra("v", v)); } catch (Throwable t) {}
        }
        /** Oberflaeche verlassen: zurueck zur vorherigen App bzw. zum Horizon-Menue. */
        /** Bluetooth-Einstellungen von Android (Lautsprecher, Kopfhoerer koppeln). */
        @JavascriptInterface public void openBluetooth() {
            try { Intent i = new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); } catch (Throwable e) {}
        }
        /** Herstellereinstellungen (Zahnrad der eigenen Statuszeile). */
        /** Herstelleroberflaeche oeffnen (Einstellungen, Kalibrierung des Herstellers); Home-Taste fuehrt zurueck. */
        @JavascriptInterface public boolean vendorUi() {
            try { Intent i = new Intent(Intent.ACTION_MAIN).setComponent(HomeScreen.VENDOR).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); return true; }
            catch (Throwable e) { return false; }
        }
        @JavascriptInterface public void openSettings() {
            try { Intent i = new Intent(android.provider.Settings.ACTION_SETTINGS); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); } catch (Throwable e) {}
        }
        /** Echtes App-Symbol als data:-URL (PNG, 144 px), leer wenn nicht installiert. */
        @JavascriptInterface public String icon(String pkg) {
            boolean known = false; for (String x : APPS) if (x.equals(pkg)) known = true;
            if (!known) return "";
            try {
                android.graphics.drawable.Drawable d = getPackageManager().getApplicationIcon(pkg);
                android.graphics.Bitmap bm = android.graphics.Bitmap.createBitmap(144, 144, android.graphics.Bitmap.Config.ARGB_8888);
                android.graphics.Canvas cv = new android.graphics.Canvas(bm); d.setBounds(0, 0, 144, 144); d.draw(cv);
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream(); bm.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bo);
                return "data:image/png;base64," + android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP);
            } catch (Throwable e) { return ""; }
        }
        /** GPX/TCX-Dateien auf USB-Stick und im internen Speicher (Download, Wurzel), hoechstens 2 Ebenen tief. */
        @JavascriptInterface public String listGpx() {
            JSONArray out = new JSONArray();
            java.util.ArrayList<java.io.File> roots = new java.util.ArrayList<java.io.File>();
            roots.add(new java.io.File("/sdcard/Download")); roots.add(new java.io.File("/sdcard"));
            java.io.File[] st = new java.io.File("/storage").listFiles();
            if (st != null) for (java.io.File f : st) if (f.getName().matches("[0-9A-F]{4}-[0-9A-F]{4}")) roots.add(f);
            java.io.File[] mr = new java.io.File("/mnt/media_rw").listFiles();
            if (mr != null) for (java.io.File f : mr) roots.add(f);
            java.util.HashSet<String> seen = new java.util.HashSet<String>();
            for (java.io.File r : roots) scan(r, 0, out, seen);
            return out.toString();
        }
        void scan(java.io.File d, int depth, JSONArray out, java.util.HashSet<String> seen) {
            java.io.File[] fs = d.listFiles(); if (fs == null) return;
            for (java.io.File f : fs) {
                if (out.length() >= 200) return;
                String n = f.getName().toLowerCase();
                if (f.isDirectory() && depth < 2 && !n.startsWith(".") && !n.equals("android")) scan(f, depth + 1, out, seen);
                else if ((n.endsWith(".gpx") || n.endsWith(".tcx")) && f.length() < 10000000 && seen.add(f.getName() + f.length())) {
                    try { org.json.JSONObject o = new org.json.JSONObject(); o.put("path", f.getPath()); o.put("name", f.getName()); o.put("size", f.length());
                        o.put("usb", !f.getPath().startsWith("/sdcard")); o.put("mtime", f.lastModified()); out.put(o); } catch (Throwable e) {}
                }
            }
        }
        /** Liest eine GPX/TCX-Datei als Text, nur Endungen .gpx/.tcx unter /sdcard, /storage, /mnt/media_rw. */
        @JavascriptInterface public String readGpx(String path) {
            try {
                java.io.File f = new java.io.File(path).getCanonicalFile(); String p = f.getPath(), n = p.toLowerCase();
                if (!(n.endsWith(".gpx") || n.endsWith(".tcx")) || f.length() > 10000000) return "";
                if (!(p.startsWith("/sdcard/") || p.startsWith("/storage/") || p.startsWith("/mnt/media_rw/") || p.startsWith("/data/media/"))) return "";
                return new String(Conn.readFile(f), "UTF-8");
            } catch (Throwable e) { return ""; }
        }
    }
}
