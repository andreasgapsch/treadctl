// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONObject;

/** Schwebende Steuer-Pille (Prozess :ovl) unten in allen Apps, dazu eigene Statuszeile, Bildschirmschoner und Einbrennschutz.
 *  Ausgeklappt: Menue | Zeit/Phase | Steigung - Wert + | STOP | Tempo - Wert + | Puls | Ventilator | Verlauf
 *  Eingeklappt:       Zeit | Steigung | Aufklappen | Tempo | Puls  (ohne STOP, Wunsch des Nutzers)
 *  Ohne Steuerdienst: zeigt sich immer, liest die STOP-Taste selbst, STOP direkt auf den Herstellerbus, startet den Dienst neu. */
public class OverlayService extends Service {
    static final int GLASS = 0xFF181A21, LINE = 0x1FFFFFFF, CHIP = 0x14FFFFFF, MUT = 0xFFA4A9BB;   // deckend: Herstellerbildschirm (z. B. dessen Wischgriff) darf nicht durchscheinen
    static final int SPD = 0xFF3D8BFF, INC = 0xFFFFD43B, HR = 0xFFFF4D5E, GO = 0xFF2FD27A, WARN = 0xFFFF7A1A, WHITE = 0xFFF4F5F9;

    WindowManager wm;
    WindowManager.LayoutParams lp;
    LinearLayout root, pill; FrameLayout above; TextView noteView;
    View watcher; FrameLayout saver; TextView saverClock, saverDate;
    final Handler ui = new Handler(Looper.getMainLooper());
    final Random rnd = new Random();
    volatile boolean run = true;
    SharedPreferences prefs;

    // Zustand
    // lastOk mit Schonfrist: beim Start der Pille nicht sofort «Dienst nicht erreichbar»
    JSONObject s; long lastOk = Core.clock() + 7000; String mode = ""; boolean expanded = true, hiddenByUi = false, graphOn = false;
    String pop = null; long lastTouch = System.currentTimeMillis(), lastInteract = System.currentTimeMillis();
    long modeAt = 0; TextView pauseInfo, weiterSub; View weiterBtn;
    String lastNote = ""; JSONArray hist; boolean readyOpen = false;
    // Anzeigen
    TextView[] cTime, cIncl, cSpd, cHr, cDist; Graph graph; TextView gPace, gDist, gZone, gKcal, firstLab;
    Icon firstIcon;
    DataBus fallbackBus;

    @Override public IBinder onBind(Intent i) { return null; }

    static boolean isRunning(Context c) {
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(ACTIVITY_SERVICE);
            for (ActivityManager.RunningServiceInfo i : am.getRunningServices(100))
                if (i.service.getClassName().equals(OverlayService.class.getName())) return true;
        } catch (Throwable e) {}
        return false;
    }

    @Override public void onCreate() {
        Api.ctx = getApplicationContext();
        startStopKeyWatch();
        super.onCreate();
        fg();
        prefs = getSharedPreferences("ovlprefs", MODE_PRIVATE);
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        buildRoot();
        buildWatcher();
        buildTopBar();
        poll();
        ui.postDelayed(shift, 120000);
        ui.postDelayed(saverCheck, 10000);
    }

    void fg() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel("ovl", "Pille", NotificationManager.IMPORTANCE_MIN));
            startForeground(2, new Notification.Builder(this, "ovl").setContentTitle("TreadCtl Pille").setSmallIcon(android.R.drawable.ic_media_play).build());
        } catch (Throwable e) {}
    }

    @Override public int onStartCommand(Intent i, int f, int id) {
        if (i != null && i.getAction() != null) {
            String a = i.getAction();
            if ("hide".equals(a)) { hiddenByUi = true; apply(); }
            else if ("show".equals(a)) { hiddenByUi = false; expanded = true; lastInteract = System.currentTimeMillis(); apply(); update(); }
            else if ("pref".equals(a)) { prefs.edit().putString(i.getStringExtra("k"), i.getStringExtra("v")).apply(); apply();
                if ("hideBar".equals(i.getStringExtra("k"))) { final boolean on = !"false".equals(i.getStringExtra("v"));
                    new Thread(new Runnable() { public void run() { try { Api.cmd(OverlayService.this, new JSONObject().put("c", "hideBar").put("on", on)); } catch (Throwable e) {} } }).start(); } }
        }
        return START_STICKY;
    }

    @Override public void onDestroy() {
        run = false;
        try { wm.removeView(root); } catch (Throwable e) {}
        try { wm.removeView(watcher); } catch (Throwable e) {}
        hideSaver();
        super.onDestroy();
    }

    boolean pref(String k, boolean def) { String v = prefs.getString(k, ""); return v.length() == 0 ? def : v.equals("1") || v.equals("true"); }

    // ---------------- Wischen: hochziehen zeigt, runterziehen versteckt ----------------
    /** Wurzel der Pille: erkennt senkrechtes Wischen, ohne Tipps auf Knoepfe zu stoeren. */
    class SwipeRoot extends LinearLayout {
        float y0, x0; boolean drag;
        SwipeRoot(Context c) { super(c); }
        @Override public boolean onInterceptTouchEvent(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: y0 = e.getRawY(); x0 = e.getRawX(); drag = false; break;
                case MotionEvent.ACTION_MOVE: { float dy = e.getRawY() - y0, dx = e.getRawX() - x0;
                    if (Math.abs(dy) > dp(24) && Math.abs(dy) > Math.abs(dx) * 1.5f) { drag = true; return true; } break; }
            }
            return false;
        }
        @Override public boolean onTouchEvent(MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) { y0 = e.getRawY(); x0 = e.getRawX(); return true; }
            if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                float dy = e.getRawY() - y0;
                if (Math.abs(dy) > dp(24)) swipe(dy < 0); else if ("mini".equals(mode)) swipe(true);
                drag = false; return true;
            }
            return true;
        }
    }
    boolean hiddenRun = false; TextView miniLabel;
    /** Hoch: Griff → Pille → ausgeklappt. Runter: ausgeklappt → Pille → Griff. Pause, Fehler und Schluessel bleiben sichtbar. */
    void swipe(boolean up) {
        touch();
        if (up) {
            if ("mini".equals(mode)) { if ("LAEUFT".equals(st())) hiddenRun = false; else readyOpen = true; }
            else if ("col".equals(mode)) expanded = true;
        } else {
            if ("exp".equals(mode)) expanded = false;
            else if ("col".equals(mode)) hiddenRun = true;
            else if ("ready".equals(mode)) readyOpen = false;
        }
        update();
    }

    // ---------------- Fenster ----------------
    void buildRoot() {
        root = new SwipeRoot(this); root.setOrientation(LinearLayout.VERTICAL); root.setGravity(Gravity.CENTER_HORIZONTAL);
        noteView = new TextView(this); noteView.setTextColor(WHITE); noteView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 15);
        noteView.setPadding(dp(16), dp(8), dp(16), dp(8)); noteView.setBackground(round(GLASS, dp(20), LINE)); noteView.setVisibility(View.GONE);
        root.addView(noteView, lpWrap(0, 0, 0, dp(10)));
        above = new FrameLayout(this); above.setVisibility(View.GONE);
        { LinearLayout.LayoutParams ap = lpWrap(0, 0, 0, dp(12)); ap.width = ViewGroup.LayoutParams.MATCH_PARENT; root.addView(above, ap); }
        pill = new LinearLayout(this); pill.setOrientation(LinearLayout.HORIZONTAL); pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setPadding(dp(8), dp(8), dp(8), dp(8));
        pill.setBackground(round(GLASS, dp(44), LINE));
        pill.setElevation(0);
        root.addView(pill, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL; lp.y = dp(14);
        try { wm.addView(root, lp); } catch (Throwable e) {}
    }

    /** 1x1-Fenster, das jede Beruehrung auf dem Bildschirm mitbekommt (fuer den Bildschirmschoner). */
    void buildWatcher() {
        watcher = new View(this);
        watcher.setOnTouchListener(new View.OnTouchListener() { public boolean onTouch(View v, MotionEvent e) { lastTouch = System.currentTimeMillis(); return false; } });
        WindowManager.LayoutParams w = new WindowManager.LayoutParams(1, 1, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT);
        w.gravity = Gravity.TOP | Gravity.LEFT;
        try { wm.addView(watcher, w); } catch (Throwable e) {}
    }

    // ---------------- Abfrage ----------------
    void poll() {
        new Thread(new Runnable() { public void run() {
            int k = 0;
            while (run) {
                JSONObject st0 = sim();
                final JSONObject st = st0 != null ? st0 : Api.state((graphOn && (k % 12 == 0)) || (k % 10 == 0 && needProf()));
                if (st != null) { lastOk = Core.clock(); if (st.has("hist")) hist = st.optJSONArray("hist"); keepProf(st); }
                else if (st0 == null) reviveCore();
                ui.post(new Runnable() { public void run() { Api.uiBeat = System.currentTimeMillis(); if (st != null) s = st; update(); } });
                k++;
                // Takt: 400 ms im Gebrauch (Lauf, Pause, Fehler, Countdown, Band bewegt sich); in BEREIT 1 s, versteckt hinter der eigenen Oberflaeche 2 s
                JSONObject cs = st != null ? st : s;
                boolean busy = cs == null || !"BEREIT".equals(cs.optString("st")) || cs.optInt("cd") > 0 || cs.optDouble("speed") > 0.3 || cdTask != null || st0 != null;
                try { Thread.sleep(busy ? 400 : hiddenByUi ? 2000 : 1000); } catch (InterruptedException e) { return; }
            }
        }}, "poll").start();
    }

    /** Nur fuer Abnahmefotos: files/pillsim.json (vom Entwickler per root gesetzt) ersetzt die Anzeige.
     *  Befehle gehen weiter an den echten Dienst; die Datei gilt hoechstens 10 min und wird dann geloescht. */
    JSONObject sim() {
        try {
            java.io.File f = new java.io.File(getFilesDir(), "pillsim.json");
            if (!f.exists()) { simActive = false; return null; }
            if (System.currentTimeMillis() - f.lastModified() > 600000) { f.delete(); return null; }
            java.io.FileInputStream in = new java.io.FileInputStream(f); byte[] b = new byte[(int) f.length()]; in.read(b); in.close();
            simActive = true;
            JSONObject o = new JSONObject(new String(b, "UTF-8")); hist = o.optJSONArray("hist"); keepProf(o);
            if (o.optString("top").isEmpty()) { JSONObject r = Api.state(false); if (r != null) o.put("top", r.optString("top")); }
            return o;
        } catch (Throwable e) { return null; }
    }

    JSONArray routeProf; String routeProfId = "";
    void keepProf(JSONObject st) {
        JSONObject p = st.optJSONObject("prog");
        if (p == null || !"route".equals(p.optString("type"))) return;
        JSONArray pf = p.optJSONArray("prof"); if (pf != null) { routeProf = pf; routeProfId = p.optString("id") + p.optLong("D"); }
    }
    boolean needProf() { JSONObject p = s == null ? null : s.optJSONObject("prog");
        return p != null && "route".equals(p.optString("type")) && !(p.optString("id") + p.optLong("D")).equals(routeProfId); }

    String st() { return s == null ? "" : s.optString("st"); }

    String errKey() { return s == null ? "" : (s.optDouble("speed") < 0.3) + "/" + s.optInt("pulled"); }
    String lastErrKey = "";
    String wantMode() {
        if (Core.clock() - lastOk > 3000) return "nodaemon";
        String st = st();
        if ("FEHLER".equals(st)) return "err";
        if ("PAUSE".equals(st)) return "pause";
        if (!"LAEUFT".equals(st)) hiddenRun = false;
        if ("LAEUFT".equals(st)) return hiddenRun ? "mini" : expanded ? "exp" : "col";
        if (s != null && s.optInt("pulled") == 1) return "key";
        if (readyOpen && System.currentTimeMillis() - lastInteract < 8000) return "ready";
        readyOpen = false;
        return "mini";
    }

    // ---------------- Eigene Statuszeile ueber Fremd-Apps ----------------
    /** Die Systemstatuszeile reserviert oben Platz (policy_control: nur eigene und Herstellerseiten im Vollbild).
     *  Darueber liegt diese Zeile im Stil der eigenen Oberflaeche: Logo (zur Oberflaeche), Datum, Uhrzeit, WLAN, Einstellungen.
     *  Die Symbole von Android werden ausgeblendet. In Vollbildvideos verschwindet sie mit der Systemzeile. */
    LinearLayout topBar; TextView topTime, topDate; boolean appFullscreen;
    void buildTopBar() {
        int h = 0; try { int id = getResources().getIdentifier("status_bar_height", "dimen", "android"); h = getResources().getDimensionPixelSize(id); } catch (Throwable e) {}
        if (h <= 0) h = dp(24);
        topBar = new LinearLayout(this); topBar.setOrientation(LinearLayout.HORIZONTAL); topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setBackgroundColor(0xFF000000); topBar.setPadding(dp(16), 0, dp(10), 0);
        TextView logo = new TextView(this); logo.setText("TREAD·CONTROL"); logo.setTextColor(0xFFF4F5F9); logo.setTypeface(Typeface.DEFAULT_BOLD);
        logo.setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.5f); logo.setLetterSpacing(0.25f); logo.setGravity(Gravity.CENTER_VERTICAL);
        logo.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { openUi("/"); } });
        topBar.addView(logo, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));
        View sp = new View(this); topBar.addView(sp, new LinearLayout.LayoutParams(0, 1, 1));
        topDate = new TextView(this); topDate.setTextColor(0xFFA4A9BB); topDate.setTypeface(Typeface.DEFAULT_BOLD); topDate.setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.5f);
        topTime = new TextView(this); topTime.setTextColor(0xFFF4F5F9); topTime.setTypeface(Typeface.DEFAULT_BOLD); topTime.setTextSize(TypedValue.COMPLEX_UNIT_PX, h * 0.5f);
        topTime.setFontFeatureSettings("tnum");
        topBar.addView(topDate); topBar.addView(topTime, lpWrap(dp(10), 0, dp(14), 0));
        Icon wifi = new Icon(this, "wifi", 0xFFCFD2DC); topBar.addView(wifi, new LinearLayout.LayoutParams(h * 2 / 3, h * 2 / 3));
        Icon gear = new Icon(this, "gear", 0xFFCFD2DC);
        LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(h * 2, h); gp.setMargins(dp(10), 0, 0, 0);
        gear.setPadding(h / 2, h / 6, h / 2, h / 6);
        gear.setOnClickListener(new View.OnClickListener() { public void onClick(View v) {
            try { Intent i = new Intent(android.provider.Settings.ACTION_SETTINGS); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); } catch (Throwable e) {} } });
        topBar.addView(gear, gp);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, h,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.OPAQUE);
        lp.gravity = Gravity.TOP | Gravity.LEFT; lp.x = 0; lp.y = 0;
        // Vollbildvideo: Systemzeile weg, eigene Zeile ebenfalls
        topBar.setOnSystemUiVisibilityChangeListener(new View.OnSystemUiVisibilityChangeListener() {
            public void onSystemUiVisibilityChange(int v) { appFullscreen = (v & View.SYSTEM_UI_FLAG_FULLSCREEN) != 0; topBarUpdate(); } });
        topBar.setVisibility(View.GONE);
        try { wm.addView(topBar, lp); } catch (Throwable e) {}
        systemIcons(false);
    }
    /** Symbole und Uhr der Android-Statuszeile ausblenden (eigene Zeile zeigt Uhr und WLAN). */
    void systemIcons(boolean show) {
        try {
            Object sb = getSystemService("statusbar");
            int f = show ? 0 : (0x00020000 | 0x00100000 | 0x00800000 | 0x00010000);   // NOTIFICATION_ICONS, SYSTEM_INFO, CLOCK, EXPAND
            sb.getClass().getMethod("disable", int.class).invoke(sb, f);
        } catch (Throwable e) { android.util.Log.w("TREADCTL", "statusbar disable: " + e); }
    }
    void topBarUpdate() {
        if (topBar == null) return;
        String top = s == null ? "" : s.optString("top");
        boolean own = top.length() == 0 || top.startsWith("com.gapsch") || top.startsWith("com.jht") || top.startsWith("com.cvte") || top.equals("com.android.launcher3");
        boolean show = !own && !appFullscreen;
        topBar.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) {
            java.util.Date d = new java.util.Date();
            topDate.setText(new SimpleDateFormat("EE", Locale.GERMAN).format(d).replace(".", "") + " " + new SimpleDateFormat("dd.MM.", Locale.GERMAN).format(d));
            topTime.setText(new SimpleDateFormat("HH:mm", Locale.GERMAN).format(d));
        }
    }

    long reviveAt = 0;
    /** Antwortet der Steuerdienst 5 s nicht, ihn selbst starten (hoechstens alle 10 s). Android verlaengert nach einer Absturzserie
     *  die Neustartpause oder gibt auf; ein ausdruecklicher Start hebt das auf. */
    void reviveCore() {
        long now = Core.clock();
        if (now - lastOk < 5000 || now - reviveAt < 10000) return;
        reviveAt = now;
        try { startForegroundService(new Intent(this, TreadDaemon.class)); android.util.Log.w("TREADCTL", "pille: steuerdienst neu gestartet"); } catch (Throwable e) {}
    }

    /** STOP-Taste der Konsole auch ohne Steuerdienst: eigener Leser in der Pille, wirkt nur, wenn der Dienst nicht antwortet
     *  (sonst behandelt ihn KeyReader im Dienst). Nur K_STOP, sonst nichts. */
    void startStopKeyWatch() {
        new Thread(new Runnable() { public void run() {
            java.util.HashSet<String> open = new java.util.HashSet<String>();
            while (true) {
                String[] l = new java.io.File("/dev/input").list();
                if (l != null) for (String n : l) if (n.startsWith("event") && open.add(n)) {
                    final String dev = "/dev/input/" + n;
                    Thread t = new Thread(new Runnable() { public void run() { stopKeyLoop(dev); } }, "stoptaste-" + n); t.setDaemon(true); t.start();
                }
                try { Thread.sleep(10000); } catch (InterruptedException e) { return; }
            }
        } }, "stoptaste").start();
    }
    void stopKeyLoop(String dev) {
        final int SZ = System.getProperty("os.arch", "").contains("64") ? 24 : 16, T = SZ - 8; byte[] b = new byte[SZ];
        try (java.io.FileInputStream in = new java.io.FileInputStream(dev)) {
            while (true) {
                int n = 0; while (n < SZ) { int r = in.read(b, n, SZ - n); if (r < 0) return; n += r; }
                int type = (b[T] & 0xff) | (b[T + 1] & 0xff) << 8, code = (b[T + 2] & 0xff) | (b[T + 3] & 0xff) << 8, value = b[T + 4];
                if (type == KeyReader.EV_KEY && value == 1 && code == KeyReader.K_STOP && Core.clock() - lastOk > 3500) {
                    new Thread(new Runnable() { public void run() { directStop(); } }).start();
                    android.util.Log.w("TREADCTL", "pille: STOP-Taste ohne Dienst, direkt auf den Bus");
                }
            }
        } catch (Throwable e) {}
    }

    void apply() {
        topBarUpdate();
        boolean running = "LAEUFT".equals(st()) || "PAUSE".equals(st());
        // im Lauf den Bildschirm wach halten (falls eine App oder Einstellung ihn sonst ausschalten wuerde)
        boolean keep = running || (s != null && s.optDouble("speed") > 0.3);
        if (lp != null && ((lp.flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0) != keep) {
            if (keep) lp.flags |= WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON; else lp.flags &= ~WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
            try { wm.updateViewLayout(root, lp); } catch (Throwable e) {}
        }
        // Dienst weg: Pille immer zeigen, auch ueber der eigenen Oberflaeche (ihr STOP geht direkt auf den Herstellerbus)
        boolean show = "nodaemon".equals(mode) || (!hiddenByUi && (running || pref("showPill", true) || "err".equals(mode)));
        root.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    void update() {
        String m = wantMode();
        // automatisches Einklappen nur waehrend des Laufs
        if ("exp".equals(m) && pref("autoCollapse", true) && pop == null && !graphOn && !bannerOn && System.currentTimeMillis() - lastInteract > 6000) { expanded = false; m = "col"; }
        if ("key".equals(mode) && "mini".equals(m)) { readyOpen = true; lastInteract = System.currentTimeMillis(); m = "ready"; }
        if ("err".equals(m) && "err".equals(mode) && !errKey().equals(lastErrKey)) mode = "";
        if ("err".equals(m)) lastErrKey = errKey();
        boolean fs = s != null && s.optJSONObject("fan") != null;
        if ("exp".equals(m) && "exp".equals(mode) && fs != fanShown && pop == null && !graphOn && !"LAEUFT".equals(st())) { build(); place(); }   // im Lauf nie umbauen: STOP bleibt am Platz
        if (!m.equals(mode)) { if (!bannerOn) noteView.setVisibility(View.GONE); if (cdTask != null) cancelCountdownSilent(); mode = m; pop = null; modeAt = System.currentTimeMillis(); build(); place(); }
        checkPkg();
        apply();
        fill();
        noteCheck();
        if (!"LAEUFT".equals(st()) && !"PAUSE".equals(st()) && graphOn) { graphOn = false; above.setVisibility(View.GONE); }
        if (saver != null && !"BEREIT".equals(st())) hideSaver();
    }

    // ---------------- Aufbau je Modus ----------------
    void build() {
        statusField = null; weiterBtn = null; pill.removeAllViews(); above.removeAllViews(); above.setVisibility(View.GONE); graphOn = false;
        cTime = cIncl = cSpd = cHr = cDist = null; firstLab = null; firstIcon = null;
        pill.setBackground(round(GLASS, dp(44), LINE));
        pill.setPadding(dp(8), dp(8), dp(8), dp(8)); pill.setElevation(0); pill.setOnClickListener(null); pill.setMinimumWidth(0);   // kein Schatten: kostet bei der grossen Glasflaeche jedes Bild
        pill.setOrientation(LinearLayout.HORIZONTAL); pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setOnLongClickListener(null);
        switch (mode) {
            case "exp": {
                // Steuerleiste: Menue | Phase/Zeit | Steigung | STOP | Tempo | Puls | Ventilator (falls gespeichert) | Verlauf
                add(pb("menu", WHITE, new Runnable() { public void run() { openUi("/"); } }), 0);
                cTime = cell("clock", 0xFFCFD2DC, "ZEIT", 0xFFA4A9BB); firstLab = cTime[3]; fixW(cTime, 164); add(cTime[0], 4);
                cIncl = adj("STEIGUNG", INC, "incline"); add(cIncl[0], 6);
                add(stopBtn(), 10);
                cSpd = adj("TEMPO", SPD, "speed"); add(cSpd[0], 10);
                cHr = cell("heart", HR, "PULS", HR); fixW(cHr, 164); add(cHr[0], 4);
                fanShown = s != null && s.optJSONObject("fan") != null; fanLab = null;
                if (fanShown) add(fanBtn(), 4);
                add(pb("graph", WHITE, new Runnable() { public void run() { toggleGraph(); } }), 4);
                break; }
            case "col": {
                LinearLayout.LayoutParams w = new LinearLayout.LayoutParams(dp(180), ViewGroup.LayoutParams.WRAP_CONTENT);
                cTime = cell("clock", 0xFFCFD2DC, "ZEIT", 0xFFA4A9BB); firstLab = cTime[3]; pill.addView(rv(cTime[0]), new LinearLayout.LayoutParams(w));
                cIncl = cell("none", INC, "STEIGUNG", INC); pill.addView(rv(cIncl[0]), new LinearLayout.LayoutParams(w));
                FrameLayout slot = new FrameLayout(this); slot.addView(expBtn(), new FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER));
                pill.addView(slot, new LinearLayout.LayoutParams(dp(120), dp(64)));
                cSpd = cell("none", SPD, "TEMPO", SPD); pill.addView(rv(cSpd[0]), new LinearLayout.LayoutParams(w));
                cHr = cell("heart", HR, "PULS", HR); pill.addView(rv(cHr[0]), new LinearLayout.LayoutParams(w));
                for (int i = 0; i < pill.getChildCount(); i++) { pill.getChildAt(i).setOnClickListener(new View.OnClickListener() { public void onClick(View v) { expand(); } }); }
                break; }
            case "mini": {
                // Griff unten in der Mitte (wie in allen Apps gleich): hochwischen oder antippen zeigt die Pille
                pill.setPadding(dp(22), dp(8), dp(22), dp(10)); pill.setElevation(0); pill.setOrientation(LinearLayout.VERTICAL);
                pill.setGravity(Gravity.CENTER_HORIZONTAL);
                View bar = new View(this); bar.setBackground(round(0xB3FFFFFF, dp(3), 0));
                pill.addView(bar, new LinearLayout.LayoutParams(dp(56), dp(5)));
                TextView t = new TextView(this); miniLabel = t; t.setTextColor(0xFFCFD2DC); t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 13); t.setTypeface(Typeface.DEFAULT_BOLD);
                t.setLetterSpacing(0.06f);
                t.setText("LAEUFT".equals(st()) && s != null ? f1(s.optDouble("tSpeed")) + " km/h  ·  " + f1(s.optDouble("tIncl")) + " %" : "STEUERUNG");
                pill.addView(t, lpWrap(0, dp(6), 0, 0));
                pill.setMinimumWidth(dp(220));
                break; }
            case "ready": {
                add(pb("menu", WHITE, new Runnable() { public void run() { openUi("/"); } }), 0);
                cIncl = tapCell("none", INC, "STEIGUNG", INC, "incline"); fixW(cIncl, 200); add(cIncl[0], 8);
                final View sb = bigBtn("START", "play", GO, 0xFF03210F, null); ((LinearLayout) sb).setMinimumWidth(dp(200));
                sb.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { if (System.currentTimeMillis() - modeAt < 1000) return; touch(); countdown((LinearLayout) sb, "start"); } });
                add(sb, 12);
                cSpd = tapCell("none", SPD, "START-TEMPO", SPD, "speed"); fixW(cSpd, 200); add(cSpd[0], 12);
                add(pb("apps", WHITE, new Runnable() { public void run() { openUi("/apps"); } }), 8);
                break; }
            case "pause": {
                // Mitte (STOP-Stelle) ist ein inaktives Statusfeld: ein Doppeltipp auf STOP loest nie einen Befehl aus.
                add(pb("menu", WHITE, new Runnable() { public void run() { openUi("/"); } }), 0);
                cTime = cell("clock", 0xFFCFD2DC, "PAUSE · GESAMT", HR); fixW(cTime, 164); add(cTime[0], 4);
                final View w = bigBtn("WEITER", "play", GO, 0xFF03210F, null);
                w.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { if (System.currentTimeMillis() - modeAt < 1000) return; touch(); countdown((LinearLayout) w, "resume"); } });
                ((LinearLayout) w).setMinimumWidth(dp(252));
                weiterBtn = w; weiterSub = new TextView(this); weiterSub.setTextColor(0xFF03210F); weiterSub.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12); weiterSub.setVisibility(View.GONE);
                { // Symbol und Text in einer Zeile, der Hinweis darunter
                    LinearLayout wl = (LinearLayout) w, top1 = new LinearLayout(this); top1.setGravity(Gravity.CENTER);
                    while (wl.getChildCount() > 0) { View c0 = wl.getChildAt(0); ViewGroup.LayoutParams l0 = c0.getLayoutParams(); wl.removeViewAt(0); top1.addView(c0, l0); }
                    wl.setOrientation(LinearLayout.VERTICAL); wl.addView(top1); weiterSub.setGravity(Gravity.CENTER); wl.addView(weiterSub);
                }
                add(w, 6);
                LinearLayout st = new LinearLayout(this); st.setGravity(Gravity.CENTER); st.setOrientation(LinearLayout.VERTICAL);
                st.setBackground(null); st.setClickable(false); st.setMinimumWidth(dp(200)); st.setMinimumHeight(dp(56));
                TextView st1 = new TextView(this); st1.setText("■  BAND STEHT"); st1.setTextColor(0xFFC9CCD8); st1.setTypeface(Typeface.DEFAULT_BOLD); st1.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 17); st1.setLetterSpacing(.08f);
                pauseInfo = new TextView(this); pauseInfo.setTextColor(0xFFE9C9CC); pauseInfo.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 13);
                st1.setGravity(Gravity.CENTER); pauseInfo.setGravity(Gravity.CENTER);
                statusField = st; st.addView(st1, new LinearLayout.LayoutParams(dp(200), ViewGroup.LayoutParams.WRAP_CONTENT)); st.addView(pauseInfo, new LinearLayout.LayoutParams(dp(200), ViewGroup.LayoutParams.WRAP_CONTENT)); add(st, 10);
                View z = bigBtn("STEIGUNG AUF 0", "down", 0xFF252937, INC, new Runnable() { public void run() { cmd("inclZero"); } });
                ((LinearLayout) z).setMinimumWidth(dp(252));
                if (s == null || s.optDouble("tIncl") <= 0.05) { z.setAlpha(0.4f); z.setEnabled(false); }
                add(z, 10);
                View e = bigBtn("BEENDEN", "check", 0xFF252937, WHITE, new Runnable() { public void run() { endRun(); } });
                ((LinearLayout) e).setMinimumWidth(dp(164)); add(e, 4);
                add(pb("apps", WHITE, new Runnable() { public void run() { openUi("/apps"); } }), 4);
                // 1 s sichtbar gesperrt nach dem Wechsel in PAUSE
                for (final View v : new View[]{ w, z, e }) { final float a0 = v.getAlpha(); v.setAlpha(Math.min(a0, 0.35f));
                    ui.postDelayed(new Runnable() { public void run() { v.setAlpha(a0); } }, 1000); }
                break; }
            case "key": {
                pill.setBackground(round(0xFF3C080E, dp(44), 0xFFFF4D5E)); pill.setPadding(dp(28), dp(16), dp(28), dp(16)); pill.setMinimumWidth(dp(900));
                Icon k = new Icon(this, "key", HR); pill.addView(k, sq(30, 0));
                pill.addView(textBlock("Sicherheitsschlüssel gezogen", "Band steht. Schlüssel einstecken, dann erscheint hier START.", 0xFFE9C9CC), lpWrap(dp(14), 0, 0, 0));
                break; }
            case "err": {
                pill.setBackground(round(0xFF3C080E, dp(44), 0xFFFF4D5E)); pill.setPadding(dp(22), dp(10), dp(10), dp(10)); pill.setMinimumWidth(dp(900));
                String e = s == null ? "Fehler" : s.optString("err", "Fehler");
                Icon k = new Icon(this, e.contains("Schlüssel") ? "key" : "warn", HR); pill.addView(k, sq(28, 0));
                e = "FEHLER · " + e;
                boolean canAck = s != null && s.optDouble("speed") < 0.3 && s.optInt("pulled") == 0;
                LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f); tl.setMargins(dp(14), 0, dp(14), 0);
                // gleiche Reihenfolge und Texte wie TX.errHint in der Weboberflaeche
                String hint = s == null ? "" : s.optDouble("speed") > 0.3 ? "STOP gesendet, Band läuft aus." : s.optInt("pulled") == 1 ? "Zuerst Schlüssel einstecken." : s.optInt("pulled") == -1 ? "Verbindung zum Band unsicher. Bei Bedarf STOP." : "Band steht. Nach Prüfung quittieren.";
                pill.addView(textBlock(e, hint, 0xFFE9C9CC), tl);
                // Band laeuft noch oder Zustand unbekannt: STOP bleibt bedienbar statt eines gesperrten Quittierens
                boolean moving = s != null && (s.optDouble("speed") > 0.3 || s.optInt("pulled") == -1);
                if (moving) { add(stopBtn(), 0); break; }
                View q = bigBtn("QUITTIEREN", "check", 0xFF252937, WHITE, new Runnable() { public void run() { cmd("ack"); } });
                q.setAlpha(0.35f); final boolean ok2 = canAck; final View qf = q;
                ui.postDelayed(new Runnable() { public void run() { if (ok2) qf.setAlpha(1f); } }, 1500);
                if (!canAck) q.setEnabled(false);
                add(q, 0);
                break; }
            default: { // Dienst nicht erreichbar: STOP geht direkt auf den Herstellerbus
                pill.setBackground(round(0xFF3C080E, dp(44), 0xCCFF4D5E)); pill.setPadding(dp(22), dp(10), dp(10), dp(10));
                pill.addView(textBlock("Steuerdienst nicht erreichbar", "Wird neu gestartet. STOP wirkt trotzdem.", 0xFFE9C9CC), lpWrap(0, 0, dp(14), 0));
                add(stopBtn(), 0);
            }
        }
    }

    static View rv(View v) { Object t = v.getTag(); return (v instanceof TextView && t instanceof View) ? (View) t : v; }
    void fixW(TextView[] t, int w) { View v = rv(t[0]); v.setMinimumWidth(dp(w)); ((LinearLayout) v).setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT); }
    void add(View v, int leftMargin) { v = rv(v); LinearLayout.LayoutParams p = lpWrap(dp(leftMargin), 0, 0, 0); p.gravity = Gravity.CENTER_VERTICAL; pill.addView(v, p); }

    String lastPkg = "";
    /** Pille immer unten, in allen Apps gleich; nur die Hoehe haengt von der App ab (baseY). */
    void checkPkg() {
        String pkg = s == null ? "" : s.optString("top", "");
        if (pkg.equals(lastPkg)) return; lastPkg = pkg;
        place();
    }
    /** Reihenfolge im Fenster von oben nach unten: Hinweis/Banner, Ausklappbereich (Schnellwahl, Verlauf), Pille. */
    void orderChildren() {
        if (root.getChildCount() == 3 && root.getChildAt(2) == pill) return;
        root.removeAllViews();
        root.addView(noteView, lpWrap(0, 0, 0, dp(10)));
        LinearLayout.LayoutParams ap = lpWrap(0, 0, 0, dp(12)); ap.width = ViewGroup.LayoutParams.MATCH_PARENT; root.addView(above, ap);
        root.addView(pill, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    /** Abstand zum unteren Rand: Griff knapp, Pille 14 dp; ueber der Hersteller-App 30 dp, damit deren Knopf «Verwalten» nicht ueber STOP hervorschaut. */
    int baseY() {
        if ("mini".equals(mode)) return dp(6);
        String tp = s == null ? "" : s.optString("top", "");
        return tp.startsWith("com.jht") ? dp(30) : dp(14);
    }
    /** Mini-Knopf am linken Rand, sonst mittig. */
    void place() {
        try {
            boolean mini = "mini".equals(mode);
            int g = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL, y = baseY();
            if (lp.gravity != g || lp.y != y) { lp.gravity = g; lp.x = 0; lp.y = y; wm.updateViewLayout(root, lp); }
            root.setAlpha(mini ? 0.92f : 1f);
            orderChildren();
            if (!mini) pill.setOnClickListener(null);
        } catch (Throwable e) {}
    }

    // ---------------- Werte eintragen ----------------
    void fill() {
        if (s == null) return;
        if ("mini".equals(mode) && miniLabel != null) setTxt(miniLabel, "LAEUFT".equals(st()) ? f1(s.optDouble("tSpeed")) + " km/h  ·  " + f1(s.optDouble("tIncl")) + " %" : "STEUERUNG");
        JSONObject prog = s.optJSONObject("prog");
        if (cTime != null) {
            if (prog != null && "interval".equals(prog.optString("type")) && !"pause".equals(mode)) {
                String k = prog.optString("kind");
                String name = "h".equals(k) ? "BELASTUNG" : "r".equals(k) ? "ERHOLUNG" : (prog.optInt("idx") <= 1 ? "EINLAUFEN" : "AUSLAUFEN");
                String cnt = "";
                JSONArray sg = prog.optJSONArray("segs");
                if ("h".equals(k) && sg != null) { int kk = 0, KK = 0, idx = prog.optInt("idx");
                    for (int i = 0; i < sg.length(); i++) if ("h".equals(sg.optJSONObject(i).optString("k"))) { KK++; if (i < idx) kk++; }
                    cnt = " " + kk + "/" + KK; }
                setTxt(cTime[3], name + cnt); fitLab(cTime[3]); setTxt(cTime[2], "noch");
                cTime[3].setTextColor("h".equals(k) ? WARN : "r".equals(k) ? SPD : MUT);
                setTxt(cTime[1], mmss(prog.optInt("segLeft")));
            } else if (prog != null && "route".equals(prog.optString("type")) && !"pause".equals(mode)) {
                int dl = prog.optInt("delta");
                double offS = prog.optDouble("offS", 0);
                JSONObject sec = prog.optJSONObject("sec");
                boolean paused = offS <= -3 && sec != null;   // Plan pausiert nach Unterbrechung: Plan-Pace statt Gehtempo-Rechnung (wie die Weboberflaeche)
                String lab = paused ? "PLAN · PAUSIERT" : "SOLL · " + (Math.abs(dl) < 3 ? "IM PLAN" : mmss(Math.abs(dl)) + (dl > 0 ? " HINTER" : " VOR"));
                setTxt(cTime[3], prog.optBoolean("done") ? "ZIEL ERREICHT" : lab); fitLab(cTime[3]);
                cTime[3].setTextColor(prog.optBoolean("done") ? GO : paused ? MUT : dl >= 3 ? WARN : dl <= -3 ? GO : MUT);
                int pace = paused ? (int) Math.round(3600 / Math.max(0.8, sec.optDouble("s") - offS)) : prog.optInt("pace");
                setTxt(cTime[1], mmss(pace)); setTxt(cTime[2], "/km");
            } else { setTxt(cTime[1], mmss(s.optInt("elapsed"))); setTxt(cTime[2], ""); setTxt(cTime[3], "ZEIT"); cTime[3].setTextColor(0xFFA4A9BB); }
            if ("pause".equals(mode)) { setTxt(cTime[3], "PAUSE · GESAMT"); setTxt(cTime[2], ""); double ti = s.optDouble("tIncl");
                boolean after = s.optString("note").startsWith("Nach Unterbrechung");
                if (pauseInfo != null) setTxt(pauseInfo, ti > 0.05 ? "Steigung bleibt " + f1(ti) + " %" : "Steigung 0.0 %");
                boolean coast = s.optDouble("speed") > 0.3;   // Band laeuft nach STOP noch aus
                if (statusField != null && cdTask == null) { TextView t0 = (TextView) statusField.getChildAt(0); String want = coast ? "■  BAND LÄUFT AUS" : "■  BAND STEHT"; if (!want.contentEquals(t0.getText())) t0.setText(want); }
                if (weiterBtn != null && cdTask == null) { weiterBtn.setEnabled(!coast); weiterBtn.setAlpha(coast ? 0.4f : 1f); }
                if (weiterSub != null) { setTxt(weiterSub, after ? "mit " + f1(s.optDouble("tSpeed")) + " km/h · Gehtempo" : ""); weiterSub.setVisibility(after ? View.VISIBLE : View.GONE); } }
        }
        boolean run = "LAEUFT".equals(st()) && "exp".equals(mode);
        if (cIncl != null) { setTxt(cIncl[1], f1(s.optDouble("tIncl"))); setTxt(cIncl[2], "%"); istLine(cIncl, run, s.optDouble("incline"), s.optDouble("tIncl")); }
        if (cSpd != null) { setTxt(cSpd[1], f1(s.optDouble("tSpeed"))); setTxt(cSpd[2], "km/h"); istLine(cSpd, run, s.optDouble("speed"), s.optDouble("tSpeed")); }
        if (cHr != null) { int h = s.optInt("hr"); setTxt(cHr[1], h > 0 && s.optBoolean("hrOk") ? String.valueOf(h) : "--"); setTxt(cHr[2], "bpm"); }
        if (cDist != null) { setTxt(cDist[1], String.format(Locale.US, "%.2f", s.optDouble("dist"))); setTxt(cDist[2], "km"); }
        if (graphOn && graph != null) {
            graph.setNow(s.optDouble("speed"), s.optDouble("incline"), s.optBoolean("hrOk") ? s.optInt("hr") : 0);
            JSONObject rp0 = s.optJSONObject("prog");
            if (rp0 != null && "route".equals(rp0.optString("type")) && routeProf != null) graph.setRoute(routeProf, rp0.optDouble("x"), rp0.optDouble("D"), rp0.optDouble("pace"), rp0.optInt("delta"));
            else graph.setRoute(null, 0, 0, 0, 0);
            graph.set(hist);
            double sp = s.optDouble("speed");
            setTxt(gPace, sp > 1 ? mmss((int) Math.round(3600 / sp)) : "--:--");
            setTxt(gDist, String.format(Locale.US, "%.2f", s.optDouble("dist")));
            int h = s.optInt("hr"), hf = s.optInt("hfmax", 184);
            double p = hf > 0 ? h / (double) hf : 0;
            setTxt(gZone, h > 0 ? "Z" + (p < .6 ? 1 : p < .7 ? 2 : p < .8 ? 3 : p < .9 ? 4 : 5) : "--");
            setTxt(gKcal, String.valueOf(s.optInt("kcal")));
        }
        if (fanLab != null) { JSONObject f = s.optJSONObject("fan"); boolean con = f != null && f.optBoolean("c", true);
            if (f != null) { int l = f.optInt("l"); setTxt(fanLab, !con ? "--" : l <= 0 ? "AUS" : (f.optBoolean("a") ? "A " : "") + l); fanLab.setTextColor(f.optBoolean("a") ? 0xFF7FD8FF : WHITE); }
            View fb = (View) fanLab.getParent(); if (fb != null) { fb.setAlpha(con ? 1f : 0.4f); fb.setEnabled(con); } }
        if ("pop".equals(pop)) {}
    }

    android.media.ToneGenerator tone; int lastBeep = -1; boolean bannerOn = false;
    /** 10 s vor einem Abschnittswechsel: Banner mit neuem Tempo, Ton bei 3, 2, 1. */
    void changeCheck() {
        JSONObject prog = s == null ? null : s.optJSONObject("prog");
        boolean show = false;
        // Start ueber die Geraetetaste (Countdown) und Ende des Einlaufens: gleiche Bannerform wie Wechsel
        int cd = s == null ? 0 : s.optInt("cd"), hold = s == null ? 0 : s.optInt("hold");
        if (!hiddenByUi && (cd > 0 || (hold > 0 && hold <= 10 && "LAEUFT".equals(st())))) {
            show = true;
            int left = cd > 0 ? cd : hold;
            String l1 = cd > 0 ? "Band läuft gleich an" : "Tempo steigt auf " + f1(s.optDouble("holdTo")) + " km/h";
            String l2 = cd > 0 ? "Start mit 1.0 km/h  ·  STOP bricht ab" : "nach 15 s Einlaufen mit 1.0 km/h";
            String box = " " + left + " s ";
            android.text.SpannableString sp = new android.text.SpannableString(box + "  " + l1 + "\n" + l2);
            int L = box.length();
                        sp.setSpan(new android.text.style.StyleSpan(Typeface.BOLD), 0, L + 2 + l1.length(), 0);
            sp.setSpan(new android.text.style.RelativeSizeSpan(0.8f), L + 3 + l1.length(), sp.length(), 0);
            noteView.setText(sp); noteView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 24); noteView.setGravity(Gravity.CENTER);
            noteView.setPadding(dp(28), dp(10), dp(28), dp(10)); noteView.setMinWidth(0);
            noteView.setBackground(round(WARN, dp(20), 0)); noteView.setTextColor(0xFF2A1000);
            noteView.setVisibility(View.VISIBLE); bannerOn = true;
            if (left <= 3 && left != lastBeep) { lastBeep = left; beep(); }
            return;
        }
        if (prog != null && "interval".equals(prog.optString("type")) && "LAEUFT".equals(st()) && !hiddenByUi) {
            int left = prog.optInt("segLeft", 99); JSONObject nx = prog.optJSONObject("next");
            if (nx != null && left <= 10 && left > 0) {
                show = true;
                String k = nx.optString("k"); String nm = "h".equals(k) ? "Belastung" : "r".equals(k) ? "Erholung" : "Auslaufen";
                double cur = s.optDouble("tSpeed"), ns = nx.optDouble("s");
                String dir = ns > cur + 0.05 ? "Tempo steigt ↑ auf " : ns < cur - 0.05 ? "Tempo sinkt ↓ auf " : "Tempo bleibt ";
                String box = " 0:" + (left < 10 ? "0" : "") + left + " ";
                String l1 = "Gleich " + nm, l2 = dir + f1(ns) + " km/h · Steigung " + f1(nx.optDouble("i")) + " %";
                android.text.SpannableString sp = new android.text.SpannableString(box + "  " + l1 + "\n" + l2);
                int L = box.length();
                                sp.setSpan(new android.text.style.StyleSpan(Typeface.BOLD), 0, L + 2 + l1.length(), 0);
                sp.setSpan(new android.text.style.RelativeSizeSpan(0.8f), L + 3 + l1.length(), sp.length(), 0);
                noteView.setText(sp); noteView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 24); noteView.setGravity(Gravity.CENTER);
                noteView.setPadding(dp(28), dp(10), dp(28), dp(10)); noteView.setMinWidth(0);
                if (left <= 3) noteView.animate().scaleX(1.03f).scaleY(1.03f).setDuration(150).withEndAction(new Runnable() { public void run() { noteView.animate().scaleX(1f).scaleY(1f).setDuration(150).start(); } }).start();
                boolean upw = ns > cur + 0.05;
                noteView.setBackground(round(upw ? WARN : SPD, dp(20), 0));
                noteView.setTextColor(upw ? 0xFF2A1000 : 0xFFFFFFFF);
                noteView.setVisibility(View.VISIBLE); bannerOn = true;
                if (left <= 3 && left != lastBeep) { lastBeep = left;
                    try { if (tone == null) tone = new android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 80); tone.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 120); } catch (Throwable e) {} }
            }
        }
        if (prog != null && "route".equals(prog.optString("type")) && "LAEUFT".equals(st()) && !hiddenByUi && !prog.optBoolean("done")) {
            JSONObject nx = prog.optJSONObject("next");
            double v = Math.max(1, s.optDouble("speed")) / 3.6;
            double toC = nx != null ? prog.optDouble("toChange", prog.optDouble("toNext", 9999)) : prog.optDouble("toFinish", 9999);
            int left = (int) Math.ceil(toC / v);
            // Bezug ist das, was der Laeufer gerade spuert: aktuelles Soll von Band und Tempo
            double di = nx == null ? 0 : nx.optDouble("i") - s.optDouble("tIncl"), ds = nx == null ? 3 - s.optDouble("tSpeed") : nx.optDouble("s") - s.optDouble("tSpeed");
            boolean finish = nx == null;
            if (left <= 10 && left > 0 && (finish || Math.abs(di) >= 1.0 || Math.abs(ds) >= 1.0)) {
                show = true;
                boolean upw = !finish && (di > 0 || (Math.abs(di) < 1.0 && ds > 0));
                String l1 = finish ? "Ziel" : Math.abs(di) >= 1.0 ? (di > 0 ? "Steigung ↑ auf " : "Steigung ↓ auf ") + f1(nx.optDouble("i")) + " %" : (ds > 0 ? "Tempo ↑ auf " : "Tempo ↓ auf ") + f1(nx.optDouble("s")) + " km/h";
                String l2 = finish ? "Band läuft auf 3 km/h aus und hält danach an"
                    : "Strecke " + f1(nx.optDouble("g")) + " % · Tempo " + f1(nx.optDouble("s")) + " km/h · Soll " + mmss((int) Math.round(3600 / Math.max(0.8, nx.optDouble("s")))) + " /km";
                String box = " " + left + " s ";
                android.text.SpannableString sp = new android.text.SpannableString(box + "  " + l1 + "\n" + l2);
                int L = box.length();
                                sp.setSpan(new android.text.style.StyleSpan(Typeface.BOLD), 0, L + 2 + l1.length(), 0);
                sp.setSpan(new android.text.style.RelativeSizeSpan(0.8f), L + 3 + l1.length(), sp.length(), 0);
                noteView.setText(sp); noteView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 24); noteView.setGravity(Gravity.CENTER);
                noteView.setPadding(dp(28), dp(10), dp(28), dp(10)); noteView.setMinWidth(0);
                noteView.setBackground(round(finish ? GO : upw ? WARN : SPD, dp(20), 0));
                noteView.setTextColor(upw || finish ? 0xFF2A1000 : 0xFFFFFFFF);
                noteView.setVisibility(View.VISIBLE); bannerOn = true;
                if (left <= 3 && left != lastBeep) { lastBeep = left; beep(); }
            }
        }
        if (!show && bannerOn) { bannerOn = false; lastBeep = -1; noteView.setVisibility(View.GONE); noteView.setBackground(round(GLASS, dp(20), LINE)); noteView.setTextColor(WHITE);
            noteView.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 15); noteView.setMinWidth(0); noteView.setPadding(dp(16), dp(8), dp(16), dp(8)); }
    }

    /** Ist-Wert als zweite Zeile, Platz bleibt reserviert, damit nichts springt. */
    void istLine(TextView[] t, boolean run, double ist, double soll) {
        if (t.length < 5) return;
        long now = System.currentTimeMillis(); Long since = (Long) t[4].getTag();
        boolean dev = run && Math.abs(ist - soll) > 0.2;
        if (!dev) t[4].setTag(null); else if (since == null) { t[4].setTag(now); since = now; }
        boolean show = dev && now - since >= 2000;
        t[4].setText("Ist " + f1(ist)); t[4].setVisibility(show ? View.VISIBLE : View.INVISIBLE);
    }

    void noteCheck() {
        changeCheck(); if (bannerOn) return;
        String n = s == null ? "" : s.optString("note", "");
        if (n.length() > 0 && !n.equals(lastNote)) {
            noteView.setText(n); noteView.setVisibility(View.VISIBLE);
            ui.removeCallbacks(hideNote); ui.postDelayed(hideNote, 8000);
        }
        lastNote = n;
    }
    final Runnable hideNote = new Runnable() { public void run() { noteView.setVisibility(View.GONE); } };

    // ---------------- Bausteine ----------------
    /** Zelle: Symbol, Label oben, Zahl gross, Einheit klein. [0]=View, [1]=Zahl, [2]=Einheit, [3]=Label */
    TextView[] cell(String icon, int iconCol, String label, int labCol) {
        LinearLayout c = new LinearLayout(this); c.setOrientation(LinearLayout.HORIZONTAL); c.setGravity(Gravity.CENTER);
        c.setPadding(dp(8), 0, dp(8), 0); c.setMinimumHeight(dp(64));
        if (!"none".equals(icon)) { Icon ic = new Icon(this, icon, iconCol); c.addView(ic, sq(24, 0)); }
        LinearLayout col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL);
        TextView lab = label(label, labCol); col.addView(lab);
        LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); row.setGravity(Gravity.BOTTOM);
        TextView num = num(34); TextView unit = unit(); row.addView(num); row.addView(unit, lpWrap(dp(3), 0, 0, dp(3)));
        col.addView(row);
        c.addView(col, lpWrap(dp(9), 0, 0, 0));
        TextView holder = new TextView(this); // nur als Behaelter fuer die View-Referenz
        holder.setTag(c);
        return new TextView[]{ wrap(c), num, unit, lab };
    }

    TextView[] tapCell(String icon, int iconCol, String label, int labCol, final String what) {
        TextView[] t = cell(icon, iconCol, label, labCol);
        View v = (View) t[0].getTag();
        v.setBackground(round(0x0DFFFFFF, dp(30), LINE)); v.setPadding(dp(14), dp(4), dp(18), dp(4));
        v.setOnClickListener(new View.OnClickListener() { public void onClick(View x) { touch(); togglePop(what); } });
        return t;
    }

    /** Einstellfeld: - Wert +. Tippen auf den Wert oeffnet die Schnellwahl. */
    TextView[] adj(String label, int col, final String what) {
        LinearLayout a = new LinearLayout(this); a.setOrientation(LinearLayout.HORIZONTAL); a.setGravity(Gravity.CENTER_VERTICAL);
        a.setBackground(round(0x0DFFFFFF, dp(36), LINE)); a.setPadding(dp(4), dp(4), dp(4), dp(4));
        a.addView(roundBtn("minus", col, what, -0.5f), sq(60, 0));
        LinearLayout c = new LinearLayout(this); c.setOrientation(LinearLayout.VERTICAL); c.setGravity(Gravity.CENTER);
        TextView lab = label(label, col); lab.setGravity(Gravity.CENTER); c.addView(lab);
        LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        TextView num = num(34); TextView unit = unit(); unit.setSingleLine(true); unit.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 13); row.addView(num); row.addView(unit, lpWrap(dp(2), 0, 0, dp(3)));
        c.addView(row);
        TextView ist = new TextView(this); ist.setTextColor(0xFFD6D9E3); ist.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 17); ist.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL)); ist.setIncludeFontPadding(false);
        ist.setGravity(Gravity.CENTER); ist.setText("Ist"); ist.setVisibility(View.INVISIBLE); c.addView(ist);
        c.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { touch(); togglePop(what); } });
        a.addView(c, new LinearLayout.LayoutParams(dp(118), ViewGroup.LayoutParams.WRAP_CONTENT));
        a.addView(roundBtn("plus", col, what, 0.5f), sq(60, 0));
        return new TextView[]{ wrap(a), num, unit, lab, ist };
    }

    /** Runder +/- Knopf mit Wiederholung bei langem Druck (nach 500 ms alle 250 ms). */
    View roundBtn(String icon, int col, final String what, final float d) {
        final FrameLayout b = new FrameLayout(this); b.setBackground(round(CHIP, dp(30), 0));
        Icon ic = new Icon(this, icon, col); b.addView(ic, new FrameLayout.LayoutParams(dp(26), dp(26), Gravity.CENTER));
        final Runnable rep = new Runnable() { public void run() { step(what, d); ui.postDelayed(this, 250); } };
        b.setOnTouchListener(new View.OnTouchListener() { public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: touch(); press(v, true); step(what, d); ui.postDelayed(rep, 500); return true;
                case MotionEvent.ACTION_UP: case MotionEvent.ACTION_CANCEL: press(v, false); ui.removeCallbacks(rep); return true;
            } return true; } });
        return b;
    }

    View stopBtn() {
        LinearLayout b = new LinearLayout(this); b.setGravity(Gravity.CENTER); b.setBackground(round(HR, dp(32), 0));
        Icon ic = new Icon(this, "stop", 0xFF2B0509); b.addView(ic, sq(24, 0));
        TextView t = new TextView(this); t.setText("STOP"); t.setTextColor(0xFF2B0509); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 21); t.setLetterSpacing(.08f); b.addView(t, lpWrap(dp(8), 0, 0, 0));
        b.setMinimumWidth(dp(200)); b.setMinimumHeight(dp(76));
        b.setOnTouchListener(new View.OnTouchListener() { public boolean onTouch(View v, MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) { press(v, true); touch(); doStop(); }
            else if (e.getActionMasked() == MotionEvent.ACTION_UP || e.getActionMasked() == MotionEvent.ACTION_CANCEL) press(v, false);
            return true; } });
        return b;
    }

    View bigBtn(String txt, String icon, int bg, int fg, final Runnable r) {
        // Sperre gilt fuer alle grossen Knoepfe: 1 s nach jedem Moduswechsel
        LinearLayout b = new LinearLayout(this); b.setGravity(Gravity.CENTER); b.setBackground(round(bg, dp(32), bg == 0xFF252937 ? LINE : 0));
        Icon ic = new Icon(this, icon, fg); b.addView(ic, sq(24, 0));
        TextView t = new TextView(this); t.setText(txt); t.setTextColor(fg); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 18); t.setLetterSpacing(.06f); b.addView(t, lpWrap(dp(8), 0, 0, 0));
        b.setMinimumWidth(dp(176)); b.setMinimumHeight(dp(64)); b.setPadding(dp(16), 0, dp(16), 0);
        // Sperre nach Moduswechsel: ein zweiter Tipp auf STOP darf nie WEITER oder START ausloesen
        if (r != null) b.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { if (System.currentTimeMillis() - modeAt < ("err".equals(mode) ? 1500 : 1000)) return; touch(); r.run(); } });
        pressable(b);
        return b;
    }

    View pb(String icon, int col, final Runnable r) {
        FrameLayout b = new FrameLayout(this); b.setBackground(round(CHIP, dp(30), LINE));
        Icon ic = new Icon(this, icon, col); b.addView(ic, new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER));
        b.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { touch(); r.run(); } });
        pressable(b);
        b.setLayoutParams(sq(56, 0));
        FrameLayout w = new FrameLayout(this); w.addView(b, new FrameLayout.LayoutParams(dp(56), dp(56)));
        return w;
    }

    View expBtn() {
        FrameLayout b = new FrameLayout(this); b.setBackground(round(0x14FFFFFF, dp(28), 0));
        ((GradientDrawable) b.getBackground()).setStroke(dp(2), 0x99FFFFFF);
        Icon ic = new Icon(this, "up", WHITE); b.addView(ic, new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER));
        b.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { expand(); } });
        return b;
    }

    LinearLayout textBlock(String a, String b, int bc) {
        LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL);
        TextView t1 = new TextView(this); t1.setText(a); t1.setTextColor(WHITE); t1.setTypeface(Typeface.DEFAULT_BOLD); t1.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 20);
        TextView t2 = new TextView(this); t2.setText(b); t2.setTextColor(bc); t2.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 16);
        l.addView(t1); l.addView(t2); return l;
    }

    /** Lange Etiketten (z. B. «BELASTUNG 2/5») enger setzen statt abschneiden. */
    void fitLab(TextView t) { int n = t.getText().length(); t.setLetterSpacing(n > 10 ? .02f : .1f); t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, n > 12 ? 11 : 12); }
    /** Text nur setzen, wenn er sich aendert: setText loest sonst bei jedem Abruf ein neues Layout des ganzen Pillenfensters aus. */
    static void setTxt(TextView t, CharSequence v) { if (t != null && !android.text.TextUtils.equals(t.getText(), v)) t.setText(v); }
    TextView label(String s, int col) {
        TextView t = new TextView(this); t.setText(s); t.setTextColor(col); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12); t.setLetterSpacing(.1f); t.setSingleLine(true); return t;
    }
    TextView num(int size) {
        TextView t = new TextView(this); t.setTextColor(WHITE); t.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, size); t.setFontFeatureSettings("tnum"); t.setIncludeFontPadding(false); t.setSingleLine(true);
        t.setText("--"); return t;
    }
    TextView unit() {
        TextView t = new TextView(this); t.setTextColor(MUT); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 15); t.setIncludeFontPadding(false); return t;
    }
    TextView wrap(View v) { TextView t = new TextView(this); t.setTag(v); return t; }

    void pressable(final View v) {
        v.setOnTouchListener(new View.OnTouchListener() { public boolean onTouch(View x, MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) press(x, true);
            else if (e.getActionMasked() == MotionEvent.ACTION_UP || e.getActionMasked() == MotionEvent.ACTION_CANCEL) press(x, false);
            return false; } });
    }
    void press(View v, boolean down) { v.animate().scaleX(down ? .94f : 1f).scaleY(down ? .94f : 1f).alpha(down ? .8f : 1f).setDuration(50).start(); }

    // ---------------- Aktionen ----------------
    void touch() { lastTouch = lastInteract = System.currentTimeMillis(); }

    void expand() { touch(); expanded = true; update(); }

    void doStop() {
        final boolean[] done = { false };
        new Thread(new Runnable() { public void run() {
            boolean ok = Api.cmd(OverlayService.this, "stop"); done[0] = true;
            if (!ok) directStop();
        }}).start();
        // haengt der Dienst: nach 600 ms zusaetzlich direkt (STOP doppelt schadet nicht, warten schon)
        ui.postDelayed(new Runnable() { public void run() { if (!done[0]) new Thread(new Runnable() { public void run() { directStop(); } }).start(); } }, 600);
    }
    /** Rueckfall: direkt auf den Herstellerbus (gleiche uid). */
    synchronized void directStop() {
        try { if (fallbackBus == null || !fallbackBus.isConnected()) { fallbackBus = new DataBus(); fallbackBus.connect(OverlayService.this); }
              fallbackBus.sendEvent(Core.A_STOP); } catch (Throwable e) {}
    }

    int cd = 0; Runnable cdTask;
    /** Weiter erst nach sichtbarem 3-s-Countdown mit Ton; erneutes Tippen bricht ab. */
    LinearLayout cdBtn, statusField; String cdLabel; android.graphics.drawable.Drawable cdBg;
    /** START und WEITER nur ueber 3-s-Countdown mit Ton; der Dienst verlangt dazu ein vorheriges arm.
     *  Abbrechen liegt immer an der STOP-Stelle: bei START ist das der START-Knopf selbst, in der Pause das Statusfeld. */
    void countdown(final LinearLayout b, final String what) {
        if (cdTask != null) return;
        final TextView t = (TextView) b.getChildAt(1); cdBtn = b; cdLabel = t.getText().toString(); cdBg = b.getBackground();
        cmd("arm");
        final LinearLayout abort = "start".equals(what) ? b : statusField;
        if ("start".equals(what)) { b.setBackground(round(HR, dp(32), 0)); t.setTextColor(0xFF2B0509); }
        else { b.setEnabled(false); b.setAlpha(0.6f); }
        if (abort != null) { abort.setClickable(true); abort.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { cancelCountdown(); } });
            if (abort != b) { abort.setBackground(round(HR, dp(32), 0)); ((TextView) abort.getChildAt(0)).setText("ABBRECHEN"); ((TextView) abort.getChildAt(0)).setTextColor(0xFF2B0509); ((TextView) abort.getChildAt(1)).setText("Band bleibt stehen"); ((TextView) abort.getChildAt(1)).setTextColor(0xFF2B0509); } }
        cd = 3;
        cdTask = new Runnable() { public void run() {
            if (cd == 0) { cdTask = null; restoreCd(); cmd(what); return; }
            t.setText("start".equals(what) ? cd + " · ABBRECHEN" : String.valueOf(cd)); beep(); cd--; ui.postDelayed(this, 1000);
        }};
        cdTask.run();
    }
    void restoreCd() {
        if (cdBtn != null) { ((TextView) cdBtn.getChildAt(1)).setText(cdLabel); ((TextView) cdBtn.getChildAt(1)).setTextColor(cdLabel.equals("START") || cdLabel.equals("WEITER") ? 0xFF03210F : WHITE);
            cdBtn.setBackground(cdBg); cdBtn.setEnabled(true); cdBtn.setAlpha(1f); }
        if (cdBtn != null && "START".equals(cdLabel)) { final LinearLayout b = cdBtn; b.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { if (System.currentTimeMillis() - modeAt < 1000) return; touch(); countdown(b, "start"); } }); }
        if (statusField != null) { statusField.setBackground(null); statusField.setClickable(false); ((TextView) statusField.getChildAt(0)).setText("■  BAND STEHT"); ((TextView) statusField.getChildAt(0)).setTextColor(0xFFC9CCD8); ((TextView) statusField.getChildAt(1)).setTextColor(0xFFE9C9CC); }
    }
    void cancelCountdown() { if (cdTask == null) return; ui.removeCallbacks(cdTask); cdTask = null; restoreCd(); cmd("stop"); fill(); }
    void cancelCountdownSilent() { ui.removeCallbacks(cdTask); cdTask = null; restoreCd(); }

    void beep() { try { if (tone == null) tone = new android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 80); tone.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 120); } catch (Throwable e) {} }

    volatile boolean simActive = false;
    void cmd(final String c) {
        if (simActive && !"stop".equals(c)) return;   // Simulation fuer Fotos: nie Befehle an das echte Band (ausser STOP)
        new Thread(new Runnable() { public void run() { Api.cmd(OverlayService.this, c); } }).start(); }

    void endRun() {
        if (simActive) return;   // Simulation: nie den echten Lauf beenden
        new Thread(new Runnable() { public void run() { Api.cmd(OverlayService.this, "end"); ui.post(new Runnable() { public void run() { openUi("/summary/last"); } }); } }).start();
    }

    void step(final String what, final float d) {
        if (simActive) return;
        new Thread(new Runnable() { public void run() {
            try { Api.cmd(OverlayService.this, new JSONObject().put("c", "step").put("what", what).put("d", d)); } catch (Throwable e) {}
        }}).start();
    }

    void set(final String what, final float v) {
        if (simActive) return;
        new Thread(new Runnable() { public void run() {
            try { Api.cmd(OverlayService.this, new JSONObject().put("c", what).put("v", v)); } catch (Throwable e) {}
        }}).start();
    }

    /** Schnellwahl wie in der angedockten Leiste: Werte aus dem Programm, sonst um den Sollwert herum. */
    float[] quickVals(String what) {
        boolean spd = "speed".equals(what);
        java.util.TreeSet<Float> set = new java.util.TreeSet<Float>();
        JSONObject prog = s == null ? null : s.optJSONObject("prog");
        JSONArray sg = prog == null ? null : prog.optJSONArray("segs");
        if (sg != null) for (int i = 0; i < sg.length(); i++) set.add((float) sg.optJSONObject(i).optDouble(spd ? "s" : "i"));
        if (prog != null && "zones".equals(prog.optString("type")) && spd) { float a = (float) prog.optDouble("sMin"), b = (float) prog.optDouble("sMax");
            set.add(a); set.add(Math.round((a + b)) / 2f); set.add(b); }
        if (set.size() < 3) { float c = s == null ? (spd ? 8 : 0) : (float) s.optDouble(spd ? "tSpeed" : "tIncl");
            float[] d = spd ? new float[]{-2, -1, 0, 1, 2} : new float[]{-2, -1, 0, 1, 2};
            for (float x : d) { float v = Math.round((c + x) * 2) / 2f; if (v >= 0 && v <= (spd ? 20 : 15) && (!spd || v >= 0.8f)) set.add(v); } }
        float[] r = new float[Math.min(5, set.size())]; int i = 0; for (Float f : set) { if (i < r.length) r[i++] = f; }
        return r;
    }

    boolean fanShown = false; TextView fanLab;
    /** Ventilator-Knopf: Symbol und Stufe (A = Automatik); Tipp oeffnet die Auswahl. */
    View fanBtn() {
        LinearLayout b = new LinearLayout(this); b.setOrientation(LinearLayout.VERTICAL); b.setGravity(Gravity.CENTER);
        b.setBackground(round(CHIP, dp(30), LINE));
        b.addView(new Icon(this, "fan", 0xFF7FD8FF), new LinearLayout.LayoutParams(dp(22), dp(22)));
        fanLab = new TextView(this); fanLab.setTextColor(WHITE); fanLab.setTypeface(Typeface.DEFAULT_BOLD); fanLab.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 11); fanLab.setText("--");
        b.addView(fanLab, lpWrap(0, dp(1), 0, 0));
        b.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { touch(); toggleFan(v); } });
        pressable(b);
        FrameLayout w = new FrameLayout(this); w.addView(b, new FrameLayout.LayoutParams(dp(64), dp(56)));
        return w;
    }
    void toggleFan(final View anchor) {
        if ("fan".equals(pop)) { closeAbove(); return; }
        graphOn = false; pop = "fan"; above.removeAllViews();
        LinearLayout row = new LinearLayout(this); row.setPadding(dp(8), dp(8), dp(8), dp(8)); row.setBackground(round(GLASS, dp(18), LINE));
        JSONObject f = s == null ? null : s.optJSONObject("fan");
        boolean au = f != null && f.optBoolean("a"); int lv = f == null ? 0 : f.optInt("l");
        final String[] lab = { "AUTO", "AUS", "25", "50", "75", "100" };
        for (final String k : lab) {
            TextView t = new TextView(this); t.setText(k); t.setGravity(Gravity.CENTER);
            t.setTextColor(WHITE); t.setTypeface(Typeface.DEFAULT_BOLD); t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, k.length() > 3 ? 16 : 19);
            boolean on = "AUTO".equals(k) ? au : !au && ("AUS".equals(k) ? lv <= 0 : String.valueOf(lv).equals(k));
            t.setBackground(round(on ? 0xFF2E7FA8 : CHIP, dp(12), 0));
            t.setOnClickListener(new View.OnClickListener() { public void onClick(View x) { touch(); fan(k); closeAbove(); } });
            pressable(t);
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp("AUTO".equals(k) ? 88 : 72), dp(60)); p.setMargins(dp(4), 0, dp(4), 0);
            row.addView(t, p);
        }
        above.addView(row, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.LEFT));
        final LinearLayout rowF = row;
        row.post(new Runnable() { public void run() { try {
            int[] a = new int[2], b = new int[2]; anchor.getLocationOnScreen(a); above.getLocationOnScreen(b);
            float x = a[0] - b[0] + anchor.getWidth() / 2f - rowF.getWidth() / 2f; x = Math.max(0, Math.min(above.getWidth() - rowF.getWidth(), x));
            rowF.setTranslationX(x); } catch (Throwable e) {} } });
        above.setVisibility(View.VISIBLE);
        ui.removeCallbacks(autoClosePop); ui.postDelayed(autoClosePop, 4000);
    }
    void fan(final String k) {
        if (simActive) return;
        new Thread(new Runnable() { public void run() { try {
            JSONObject b = new JSONObject();
            if ("AUTO".equals(k)) b.put("a", "auto"); else if ("AUS".equals(k)) b.put("a", "off"); else b.put("a", "level").put("v", Integer.parseInt(k));
            Api.fan(OverlayService.this, b); } catch (Throwable e) {} } }).start();
    }

    void togglePop(final String what) {
        if (what.equals(pop)) { closeAbove(); return; }
        graphOn = false; pop = what; above.removeAllViews();
        LinearLayout row = new LinearLayout(this); row.setPadding(dp(8), dp(8), dp(8), dp(8)); row.setBackground(round(GLASS, dp(18), LINE));
        float[] vals = quickVals(what);
        float cur = s == null ? -1 : (float) s.optDouble("speed".equals(what) ? "tSpeed" : "tIncl");
        for (final float v : vals) {
            TextView t = new TextView(this); t.setText(f1(v)); t.setGravity(Gravity.CENTER);
            t.setTextColor(WHITE); t.setTypeface(Typeface.DEFAULT_BOLD); t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 19);
            boolean on = Math.abs(cur - v) < 0.05f;
            t.setBackground(round(on ? ("speed".equals(what) ? SPD : INC) : CHIP, dp(12), 0));
            if (on && !"speed".equals(what)) t.setTextColor(0xFF1F1600);
            t.setOnClickListener(new View.OnClickListener() { public void onClick(View x) { touch(); set(what, v); closeAbove(); } });
            pressable(t);
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(72), dp(60)); p.setMargins(dp(4), 0, dp(4), 0);
            row.addView(t, p);
        }
        above.addView(row, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.LEFT));
        final TextView[] tgt = "speed".equals(what) ? cSpd : cIncl; final LinearLayout rowF = row;
        row.post(new Runnable() { public void run() { try {
            View t = rv(tgt[0]); int[] a = new int[2], b = new int[2]; t.getLocationOnScreen(a); above.getLocationOnScreen(b);
            float x = a[0] - b[0] + t.getWidth() / 2f - rowF.getWidth() / 2f; x = Math.max(0, Math.min(above.getWidth() - rowF.getWidth(), x));
            rowF.setTranslationX(x); } catch (Throwable e) {} } });
        above.setVisibility(View.VISIBLE);
        ui.removeCallbacks(autoClosePop); ui.postDelayed(autoClosePop, 4000);
    }
    final Runnable autoClosePop = new Runnable() { public void run() { if (pop != null) closeAbove(); } };

    void closeAbove() { pop = null; graphOn = false; above.removeAllViews(); above.setVisibility(View.GONE); }

    void toggleGraph() {
        if (graphOn) { closeAbove(); return; }
        pop = null; above.removeAllViews();
        LinearLayout strip = new LinearLayout(this); strip.setOrientation(LinearLayout.HORIZONTAL);
        strip.setBackground(round(0xFF15171C, dp(22), LINE)); strip.setPadding(dp(16), dp(12), dp(16), dp(12));
        graph = new Graph(this);
        int w = Math.max(dp(700), pill.getWidth() - pill.getPaddingLeft() - pill.getPaddingRight() + dp(16));
        strip.addView(graph, new LinearLayout.LayoutParams(w - dp(32) - dp(260), dp(116)));
        LinearLayout vals = new LinearLayout(this); vals.setOrientation(LinearLayout.VERTICAL);
        LinearLayout r1 = new LinearLayout(this), r2 = new LinearLayout(this);
        gPace = mini(r1, "PACE", "/km"); gDist = mini(r1, "DISTANZ", "km"); gZone = mini(r2, "ZONE", ""); gKcal = mini(r2, "KALORIEN", "");
        vals.addView(r1); vals.addView(r2, lpWrap(0, dp(6), 0, 0));
        strip.addView(vals, lpWrap(dp(18), 0, 0, 0));
        above.addView(strip, new FrameLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL));
        above.setVisibility(View.VISIBLE); graphOn = true;
        new Thread(new Runnable() { public void run() { JSONObject st = Api.state(true); if (st != null) { hist = st.optJSONArray("hist"); ui.post(new Runnable() { public void run() { fill(); } }); } } }).start();
    }

    TextView mini(LinearLayout row, String lab, String u) {
        LinearLayout c = new LinearLayout(this); c.setOrientation(LinearLayout.VERTICAL);
        c.addView(label(lab, MUT));
        LinearLayout r = new LinearLayout(this); r.setGravity(Gravity.BOTTOM);
        TextView n = num(26); r.addView(n); TextView un = unit(); un.setText(u); r.addView(un, lpWrap(dp(3), 0, 0, dp(2)));
        c.addView(r); row.addView(c, new LinearLayout.LayoutParams(dp(120), ViewGroup.LayoutParams.WRAP_CONTENT));
        return n;
    }

    void openUi(String route) {
        try {
            Intent i = new Intent(this, UiActivity.class).putExtra("route", route);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(i);
        } catch (Throwable e) {}
    }

    // ---------------- Einbrennschutz ----------------
    /** Alle 2 min um wenige Pixel verschieben, unmerklich. */
    final Runnable shift = new Runnable() { public void run() {
        try { lp.x = rnd.nextInt(9) - 4; lp.y = baseY() + rnd.nextInt(7) - 3; wm.updateViewLayout(root, lp); } catch (Throwable e) {}
        ui.postDelayed(this, 120000);
    }};

    /** Bildschirmschoner: im Zustand BEREIT nach x min ohne Beruehrung, wenn keine Wiedergabe laeuft. */
    final Runnable saverCheck = new Runnable() { public void run() {
        try {
            int min = 5; try { min = Integer.parseInt(prefs.getString("saverMin", "5")); } catch (Exception e) {}
            boolean idle = System.currentTimeMillis() - lastTouch > min * 60000L;
            boolean media = ((AudioManager) getSystemService(AUDIO_SERVICE)).isMusicActive();
            boolean ownScreen = s == null || s.optBoolean("bar", true);
            if (saver == null && idle && !media && ownScreen && "BEREIT".equals(st()) && pref("saver", true)) showSaver();
            if (saver != null) moveSaver();
        } catch (Throwable e) {}
        ui.postDelayed(this, saver != null ? 20000 : 10000);
    }};

    void showSaver() {
        saver = new FrameLayout(this); saver.setBackgroundColor(0xFF000000);
        LinearLayout b = new LinearLayout(this); b.setOrientation(LinearLayout.VERTICAL); b.setGravity(Gravity.CENTER_HORIZONTAL);
        saverClock = new TextView(this); saverClock.setTextColor(0xFF6E7385); saverClock.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 110);
        saverClock.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL)); saverClock.setFontFeatureSettings("tnum");
        saverDate = new TextView(this); saverDate.setTextColor(0xFF4E5262); saverDate.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 24);
        TextView hint = new TextView(this); hint.setText("Berühren zum Fortfahren"); hint.setTextColor(0xFF3A3D49); hint.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 16);
        saverClock.setSingleLine(true); saverDate.setSingleLine(true);
        Date d0 = new Date();
        saverClock.setText(new SimpleDateFormat("HH:mm", Locale.GERMAN).format(d0));
        saverDate.setText(new SimpleDateFormat("EEEE, d. MMMM", Locale.GERMAN).format(d0));
        b.addView(saverClock); b.addView(saverDate); b.addView(hint, lpWrap(0, dp(18), 0, 0));
        saver.addView(b, new FrameLayout.LayoutParams(dp(520), ViewGroup.LayoutParams.WRAP_CONTENT));
        saver.setOnTouchListener(new View.OnTouchListener() { public boolean onTouch(View v, MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_UP) { touch(); hideSaver(); } return true; } });
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_FULLSCREEN,
            PixelFormat.OPAQUE);
        try { wm.addView(saver, p); } catch (Throwable e) { saver = null; return; }
        moveSaver();
    }

    void moveSaver() {
        if (saver == null || saver.getChildCount() == 0) return;
        Date d = new Date();
        saverClock.setText(new SimpleDateFormat("HH:mm", Locale.GERMAN).format(d));
        saverDate.setText(new SimpleDateFormat("EEEE, d. MMMM", Locale.GERMAN).format(d));
        View b = saver.getChildAt(0);
        int W = saver.getWidth(), H = saver.getHeight();
        if (W == 0) { W = getResources().getDisplayMetrics().widthPixels; H = getResources().getDisplayMetrics().heightPixels; }
        float x = rnd.nextInt(Math.max(1, W - Math.max(b.getWidth(), dp(420)))), y = dp(70) + rnd.nextInt(Math.max(1, H - dp(70) - Math.max(b.getHeight(), dp(220))));
        b.animate().translationX(x).translationY(y).setDuration(4000).start();
    }

    void hideSaver() { if (saver != null) { try { wm.removeView(saver); } catch (Throwable e) {} saver = null; } }

    // ---------------- Kleinkram ----------------
    LinearLayout.LayoutParams lpWrap(int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(l, t, r, b); return p;
    }
    LinearLayout.LayoutParams sq(int size, int ml) { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(size), dp(size)); p.setMargins(dp(ml), 0, 0, 0); p.gravity = Gravity.CENTER_VERTICAL; return p; }
    GradientDrawable round(int fill, int r, int stroke) {
        GradientDrawable g = new GradientDrawable(); g.setColor(fill); g.setCornerRadius(r);
        if (stroke != 0) g.setStroke(Math.max(1, dp(1)), stroke); return g;
    }
    static String f1(double v) { return String.format(Locale.US, "%.1f", v); }
    static String mmss(int s) { if (s >= 3600) return String.format(Locale.US, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60); return String.format(Locale.US, "%d:%02d", s / 60, s % 60); }
    int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }
}
