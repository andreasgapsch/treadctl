// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Kern der Steuerung: Zustandsmaschine, Programme, Zonenregler, Watchdog,
 *  Messwerte und Blackbox. Laeuft im Dienstprozess, nie im WebView.
 *  Zustaende: BEREIT (Band steht, Sollwerte nur vorgeladen), LAEUFT, PAUSE,
 *  FEHLER. Das Band startet ausschliesslich ueber start() bzw. resume(). */
public class Core implements Runnable {
    static final String T = "TREADCTL";
    static final String BEREIT = "BEREIT", LAEUFT = "LAEUFT", PAUSE = "PAUSE", FEHLER = "FEHLER";
    static final float S_MIN = 0.8f, S_MAX = 20f, I_MAX = 15f;
    static final int TICK = 200;

    // HAL-Schluessel des Herstellerbusses
    static final String A_SPEED = "ACTION_SET_SPEED_KPH_FLOAT", A_INCL = "ACTION_SET_INCLINE_FLOAT";
    static final String A_START = "ACTION_START_MACHINE", A_STOP = "ACTION_STOP_MACHINE";
    static final String D_SPEED = "DATA_ACTUAL_SPEED_KPH_FLOAT", D_INCL = "DATA_ACTUAL_INCLINE_FLOAT";
    static final String D_TGT_S = "DATA_TARGET_SPEED_KPH_FLOAT", D_HR = "DATA_HEART_RATE_INT";
    static final String D_PULLED = "DATA_IO_IS_SAFETY_PULLED_BOOL", D_SAFE = "DATA_IS_SAFE_TO_START_WORKOUT_BOOL";

    final Context ctx;
    final DataBus bus = new DataBus();
    final Object lock = new Object();
    volatile boolean alive = true;

    // Zustand
    volatile String st = BEREIT, err = "", src = "", note = "";
    volatile float speed, incline, tSpeed = 1f, tIncl = 0f;
    volatile int hr, pulled = -1, safe = 0;
    volatile boolean hrOk = false;
    volatile long lastLease = 0;
    volatile int extHr; volatile long extHrAt; volatile String hrSrc = "";
    volatile int fanLevel = -1; volatile boolean fanAuto = true, fanKnown = false;   // Ventilator, -1 = nicht verbunden (setzt FanControl)
    volatile boolean leaseLost = false;   // ohne Lebenszeichen: Programme duerfen nicht hochregeln
    volatile int busFail = 0;
    long busRetryAt = 0;

    // Messwerte des Laufs
    double elapsed, dist, kcal, elev;
    long hrSum, hrN; int hrMax;
    final ArrayList<float[]> hist = new ArrayList<float[]>();
    double histAcc;
    double[] zoneSec = new double[5];
    float weight = 75f; int hfmax = 184;

    // Programm
    JSONObject prog; String progType = null;
    double progT; int segIdx = -1;
    double[] segStart; JSONArray segs;
    boolean progDone; double endTimer = -1;
    // Zonen
    boolean auto = true; volatile long manualAt = 0; double zoneTimer, lossT; int lastHr; double sameHrT;
    JSONObject lastSummary;
    // Strecke
    RoutePlan rp; double offS, offI, finishT = -1;
    // Tempo-Rampe: grosse Aenderungen (Start, Weiter, Planwechsel) in Stufen von 3 km/h alle 4 s
    double rampTarget = -1, rampLeft; String rampFrom = "programm";
    // Einlaufen: jeder Anlauf (Start, Weiter, Taste) laeuft 15 s mit 1 km/h, erst danach geht es zum Soll
    static final float HOLD_SPEED = 1.0f; static final double HOLD_SECONDS = 15;
    volatile double holdLeft = 0; double holdTarget = -1;
    // Start ueber die Geraetetaste: eigener 3-Sekunden-Countdown, STOP bricht ab
    long hwStartAt = 0; boolean hwResume; int inclDir, inclPulses; int inclIdx = -1; boolean routeFinish;
    // Steuerung durch Apps (FTMS, DIRCON): aus, bis der Laeufer sie erlaubt; nie Start, STOP immer
    static final long APP_MANUAL_MS = 30000, APP_RATE_MS = 2000;
    // Standby der Herstellersoftware (ERP): Index 0 = 30 min, 1 = 15 min, 2 = 10 min (Werk), 3 = aus. Ihr Zeitgeber
    // laeuft bei Beruehrung, Geraetetasten und laufendem Band neu an; Beruehrungen in unserer Oberflaeche und in Apps
    // meldet die Pille als EVENT_TOUCH, damit die Konsole nur nach echter Ruhe schlaeft.
    static final String ERP_KEY = "DATA_ERP_MODE_INDEX_INT";
    volatile int erpIdx = -1; long erpAt = 0, touchAt = 0;
    volatile boolean appCtl = false; volatile float appMaxS = 14f, appMaxI = 10f;
    volatile String appName = ""; volatile long appAt = 0; long appCmdAt = 0; boolean appBlocked = false;
    double appPendS = -1, appPendI = -1;

    // Blackbox
    File box;

    Core(Context c) {
        ctx = c; box = new File(c.getFilesDir(), "blackbox.log");
        // letzte Zusammenfassung ueber einen Neustart des Dienstes retten (die Oberflaeche traegt sie beim Start nach)
        try { File f = new File(c.getFilesDir(), "letzter-lauf.json"); if (f.exists()) lastSummary = new JSONObject(new String(java.nio.file.Files.readAllBytes(f.toPath()), "UTF-8")); } catch (Throwable e) {}
    }

    // ---------------- Bus ----------------
    /** Monotone Uhr fuer alle Fristen und Takte: springt nicht mit der Wanduhr (NTP, Zeitzone). Die Wanduhr nur fuer Log und Zeitstempel. */
    static long clock() { return android.os.SystemClock.elapsedRealtime(); }

    /** Verbindet den Bus. Zaehlt keine Fehltakte (das macht nur run()), damit stopNow aus anderen Threads nichts verfaelscht. */
    boolean connect() {
        try { return bus.connect(ctx); }
        catch (Throwable e) { Log.e(T, "connect: " + e); return false; }
    }

    /** Liest alle Werte; bei Fehler wird busFail erhoeht (dreiwertige Logik: pulled=-1 = unbekannt). */
    void read() throws Exception {
        speed = bus.getFloat(D_SPEED);
        incline = bus.getFloat(D_INCL);
        hr = bus.getInt(D_HR);
        // Pulsmesser ueber Bluetooth (HrBle) hat Vorrang, solange er frische Werte liefert
        if (extHr > 0 && clock() - extHrAt < 3000) { hr = extHr; hrSrc = "bluetooth"; } else hrSrc = hr > 0 ? "geraet" : "";
        pulled = bus.getBool(D_PULLED);
        safe = bus.getBool(D_SAFE);
    }

    // ---------------- Hauptschleife ----------------
    public void run() {
        lastTickAt = clock(); startWatch();
        // Erst einen sicheren Messwert haben (bis 10 s), dann ueber Lauf oder Pause entscheiden: ein einzelner Fehlversuch
        // (Herstellerdienst im selben Speicherengpass beendet) darf ein laufendes Band nicht als stehend werten.
        boolean readOk = false; long t0 = clock();
        while (alive && !readOk && clock() - t0 < 10000) {
            try { if (!bus.isConnected()) connect(); read(); readOk = true; }
            catch (Throwable e) { try { Thread.sleep(500); } catch (InterruptedException ie) { return; } }
        }
        // Uebernahme: laeuft das Band bereits (z. B. nach Neustart des Dienstes), nicht bei 0 beginnen
        boolean had;
        synchronized (lock) { had = restore(); }
        if (!readOk) {   // Bus nach 10 s noch nicht lesbar: Zustand unbekannt, wie ein Busausfall behandeln (STOP, sobald er wieder da ist)
            busFail = 3; busRetryAt = clock() + 1500; pulled = -1;
            synchronized (lock) { if (had) st = PAUSE; setError("Herstellerbus beim Start nicht erreichbar"); }
            bus.reset();
        } else if (speed > 0.3f) {
            st = LAEUFT; src = "uebernommen"; note = had ? "Dienst neu gestartet, Lauf geht weiter" : "Steuerung neu verbunden, Band lief bereits";
            try { tSpeed = bus.getFloat(D_TGT_S); } catch (Throwable e) { tSpeed = speed; }
            tIncl = incline; log("uebernahme", tSpeed);
        } else if (had) {   // Band steht: als Pause weiter, Weiter nur mit Gehtempo (wie nach einer Unterbrechung)
            st = PAUSE; pausedAt = clock(); lastStopAt = pausedAt; tSpeed = Math.max(HOLD_SPEED, Math.min((float) tSpeed, 3f));
            note = "Nach Unterbrechung: Weiter mit " + String.format(Locale.US, "%.1f", tSpeed) + " km/h (Gehtempo)";   // wie nach einer Quittung
            synchronized (lock) { try { routeSpeedOffset(); } catch (Throwable e) {} }
            log("laufstand pause", tSpeed);
        }
        long last = clock();
        while (alive) {
            long now = clock();
            double dt = Math.max(0, Math.min(1.0, (now - last) / 1000.0)); last = now;   // nie negativ, hoechstens 1 s
            try {
                if (busFail >= 3 && now < busRetryAt) throw new Exception("warte");
                boolean wasDown = busFail > 0 || !bus.isConnected();   // vor connect() merken: connect() setzt busFail zurueck
                if (!bus.isConnected()) { if (!connect()) throw new Exception("kein Bus"); }
                read();
                if (wasDown) busRecovered();
                busFail = 0;
                synchronized (lock) { tick(dt, now); }
            } catch (Throwable e) {
                if (!"warte".equals(e.getMessage())) {   // Wartezeit zaehlt nicht als Fehltakt, sonst laeuft sie nie ab
                    busFail++;
                    if (busFail >= 3) {
                        synchronized (lock) { if (!FEHLER.equals(st)) setError("Herstellerbus getrennt"); }   // STOP noch ueber die alte Verbindung
                        pulled = -1;
                        bus.reset();
                        busRetryAt = now + Math.min(10000, 500L * busFail);
                    }
                }
            }
            lastTickAt = clock();
            try { Thread.sleep(TICK); } catch (InterruptedException ie) { return; }
        }
    }

    // ---------------- Wache ueber die Hauptschleife ----------------
    volatile long lastTickAt = clock();
    /** Haengt die Hauptschleife (z. B. Binder-Aufruf an einen haengenden Herstellerdienst), steht alles still, der Prozess
     *  lebt aber weiter und wird nie neu gestartet. Nach 10 s: Blackbox und STOP ueber eine frische Verbindung; nach 15 s
     *  beendet sich der Prozess, Android und die Pille starten ihn neu (Laufstand wird wiederhergestellt). */
    void startWatch() {
        Thread w = new Thread(new Runnable() { public void run() {
            boolean warned = false;
            while (alive) {
                try { Thread.sleep(2000); } catch (InterruptedException e) { return; }
                long idle = clock() - lastTickAt;
                if (idle > 10000 && !warned) {
                    warned = true; logBox("wache: hauptschleife steht seit " + idle / 1000 + " s");
                    new Thread(new Runnable() { public void run() {
                        try { DataBus b = new DataBus(); if (b.connect(ctx)) b.sendEvent(A_STOP); } catch (Throwable e) {}
                    } }, "wache-stop").start();
                }
                if (idle > 15000) { logBox("wache: prozess wird neu gestartet"); android.os.Process.killProcess(android.os.Process.myPid()); }
                if (idle < 2000) warned = false;
            }
        } }, "wache");
        w.setDaemon(true); w.start();
    }
    /** Blackbox-Zeile ohne Zugriff auf Zustandsfelder (fuer die Wache, die nie auf den haengenden Kern warten darf). */
    void logBox(String what) {
        try { FileOutputStream f = new FileOutputStream(box, true); f.write(String.format(Locale.US, "%tF %<tT %s%n", System.currentTimeMillis(), what).getBytes("UTF-8")); f.close(); } catch (Throwable e) {}
        Log.w(T, what);
    }

    // ---------------- Herstellerleiste ----------------
    /** Blendet die JHT-Leiste ueber Fremd-Apps aus, damit diese den ganzen Bildschirm haben. */
    volatile String topPkg = ""; Boolean barShown = null; long barCheck = 0; volatile boolean hideBar = true;
    void barGuard(long now) {
        if (now - barCheck < 700) return; barCheck = now;
        try {
            android.app.ActivityManager am = (android.app.ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            java.util.List<android.app.ActivityManager.RunningTaskInfo> t = am.getRunningTasks(1);
            if (t == null || t.isEmpty() || t.get(0).topActivity == null) return;
            String pkg = t.get(0).topActivity.getPackageName(); topPkg = pkg;
            boolean own = !hideBar || pkg.startsWith("com.jht") || pkg.startsWith("com.jhtp") || pkg.startsWith("com.cvte") || pkg.equals("com.android.launcher3");
            if (barShown == null || barShown != own) { bus.putBool("ACTION_STATUS_BAR_PANEL_BOOL", own); barShown = own; log("leiste " + (own ? "ein" : "aus") + " " + pkg, 0); }
        } catch (Throwable e) {}
    }
    /** Fremd-Apps zeigen die Systemstatuszeile (Platz fuer die eigene Zeile der Pille), eigene und Herstellerseiten bleiben im Vollbild;
     *  die Navigationsleiste bleibt ueberall weg. Wird alle 30 s geprueft und bei Bedarf wiederhergestellt. */
    static final String POLICY = "immersive.full=com.jht.atsoul.nezuko,com.gapsch.treadctl,com.android.launcher3,com.cvte.factory:immersive.navigation=*";
    long policyCheck = 0;
    void policyGuard(long now) {
        if (now - policyCheck < 30000) return; policyCheck = now;
        try {
            android.content.ContentResolver cr = ctx.getContentResolver();
            if (!POLICY.equals(android.provider.Settings.Global.getString(cr, "policy_control"))) { android.provider.Settings.Global.putString(cr, "policy_control", POLICY); log("policy_control gesetzt", 0); }
            if (!"confirmed".equals(android.provider.Settings.Secure.getString(cr, "immersive_mode_confirmations"))) android.provider.Settings.Secure.putString(cr, "immersive_mode_confirmations", "confirmed");
        } catch (Throwable e) { log("policy_control " + e, 0); }
    }
    void barRestore() { try { bus.putBool("ACTION_STATUS_BAR_PANEL_BOOL", true); } catch (Throwable e) {} }

    void tick(double dt, long now) throws Exception {
        barGuard(now);
        policyGuard(now);
        // Sicherheitsschluessel
        if (pulled == 1 && !FEHLER.equals(st) && !BEREIT.equals(st)) { setError("Sicherheitsschlüssel gezogen"); }
        if (pulled == 1 && BEREIT.equals(st)) err = "Sicherheitsschlüssel gezogen"; else if (BEREIT.equals(st)) err = "";

        // 5 min Pause ohne Eingabe: Lauf beenden und speichern (die Oberflaeche holt die Zusammenfassung beim Wechsel nach BEREIT)
        if (PAUSE.equals(st)) pauseIdle += dt; else pauseIdle = 0;
        if ((LAEUFT.equals(st) || PAUSE.equals(st)) && elapsed > 0) { snapAcc += dt; if (snapAcc >= 30) { snapAcc = 0; snapshot(); } }
        if (PAUSE.equals(st) && pauseIdle > 300 && speed < 0.3f) endRun("pause-zeit");
        // Nach STOP, Ende oder Fehler laeuft das Band noch (STOP verloren, z. B. gleichzeitiges START): STOP alle 2 s wiederholen
        boolean lost = FEHLER.equals(st) || (PAUSE.equals(st) && speed <= prevSpeed + 0.05f) || now - lastStopAt < 15000;   // in FEHLER/PAUSE ohne Zeitgrenze, solange das Band nicht beschleunigt
        if (!LAEUFT.equals(st) && speed > 0.5f && lost && now - stopSentAt > 2000) {
            try { bus.sendEvent(A_STOP); stopSentAt = now; log("stop wiederholt", speed); } catch (Throwable e) {}
        }
        // Band wurde ausserhalb gestartet (Herstellertasten): uebernehmen statt bekaempfen
        // nur wenn das Band nach einem Halt wieder anlaeuft (nicht beim Auslaufen nach STOP/Ende)
        if ((BEREIT.equals(st) || PAUSE.equals(st)) && speed > 0.5f && speed > prevSpeed + 0.05f && now - lastStopAt > 15000) {
            st = LAEUFT; src = "geraet"; note = "Band über die Gerätetasten gestartet";
            try { tSpeed = bus.getFloat(D_TGT_S); } catch (Throwable e) { tSpeed = speed; }
            routeSpeedOffset();
            log("uebernahme-geraet", tSpeed);
        }
        // Gerätetasten aendern das Soll: uebernehmen
        if (LAEUFT.equals(st) && now - lastSet > 3000) {
            try { float jt = bus.getFloat(D_TGT_S); if (jt > 0.5f && Math.abs(jt - tSpeed) > 0.15f) { tSpeed = jt; src = "geraet"; manualAt = now; routeSpeedOffset(); } } catch (Throwable e) {}
        }

        prevSpeed = speed;
        hrCheck(dt);

        if (LAEUFT.equals(st) || PAUSE.equals(st)) {
            if (LAEUFT.equals(st)) elapsed += dt;
            double v = speed;                         // km/h
            double dd = v * dt / 3600.0;              // km
            dist += dd;
            if (incline > 0) elev += dd * 1000.0 * incline / 100.0;
            if (v > 0.3) {
                double mpm = v * 1000 / 60.0, g = incline / 100.0;
                double vo2 = v < 7.5 ? 0.1 * mpm + 1.8 * mpm * g + 3.5 : 0.2 * mpm + 0.9 * mpm * g + 3.5;
                kcal += vo2 * weight / 1000.0 * 5.0 * dt / 60.0;
            }
            if (hr > 0 && hrOk && LAEUFT.equals(st)) {
                hrSum += hr; hrN++; if (hr > hrMax) hrMax = hr;
                double p = hr / (double) hfmax; int z = p < .6 ? 0 : p < .7 ? 1 : p < .8 ? 2 : p < .9 ? 3 : 4;
                zoneSec[z] += dt;
            }
            histAcc += dt;
            if (histAcc >= 2.0 && LAEUFT.equals(st)) {
                histAcc = 0;
                if (hist.size() < 5400) hist.add(new float[]{(float) elapsed, speed, incline, hrOk ? hr : 0});
            }
        }

        if (LAEUFT.equals(st)) {
            // Lebenszeichen der Bedienelemente (Pille oder Oberflaeche); ohne sanft auf Gehtempo
            leaseLost = lastLease > 0 && now - lastLease > 60000;
            if (leaseLost && tSpeed > 4f) {
                applySpeed(4f, "watchdog"); note = "Keine Bedienoberfläche erreichbar, Tempo auf 4 km/h"; log("lease", 4f);
            }
            if ("interval".equals(progType)) runInterval(dt);
            else if ("zones".equals(progType)) runZones(dt, now);
            else if ("route".equals(progType)) runRoute(dt);
        }
        // automatisches Programmende: sanft auf 3 km/h, nach 10 s anhalten
        if (hwStartAt > 0 && now >= hwStartAt) hwFire();
        if (LAEUFT.equals(st) && holdLeft > 0) {
            holdLeft -= dt;
            if (holdLeft <= 0) { holdLeft = 0; double t = holdTarget; holdTarget = -1; note = ""; if (t > HOLD_SPEED + 0.05) rampSpeed(t, "programm"); }
        }
        if (LAEUFT.equals(st) && rampTarget > 0 && holdLeft <= 0) { rampLeft -= dt; if (rampLeft <= 0) rampSpeed(rampTarget, rampFrom); }
        if (now - erpAt > 30000) { erpAt = now; try { erpIdx = bus.getInt(ERP_KEY); } catch (Throwable e) {} }
        if ((appPendS >= 0 || appPendI >= 0) && now - appCmdAt >= APP_RATE_MS) {
            if (appAllowed() == 0) appApply(); else { appPendS = -1; appPendI = -1; }
        }
        if (endTimer >= 0 && LAEUFT.equals(st)) {
            if (speed <= 3.3f) endTimer += dt;            // die 10 s laufen erst, wenn das Band im Gehtempo ist
            if (endTimer >= 10) { endTimer = -1; doStop("programm"); note = "Programm beendet"; }
        }
    }

    long pausedAt = 0, lastStopAt = 0; double pauseIdle = 0;   // Sekunden in PAUSE ohne Eingabe
    float prevSpeed = 0f;
    long lastSet = 0;

    // ---------------- Puls ----------------
    void hrCheck(double dt) {
        boolean ok = hr >= 40 && hr <= 220;
        if (ok && lastHr > 0 && Math.abs(hr - lastHr) > 15) ok = false;
        if (hr > 0 && hr == lastHr) sameHrT += dt; else sameHrT = 0;
        if (sameHrT > 20) ok = false;
        lastHr = hr;
        hrOk = ok;
    }

    // ---------------- Intervall ----------------
    void runInterval(double dt) throws Exception {
        if (segs == null || progDone) return;
        progT += dt;
        int i = segIdx < 0 ? 0 : segIdx;
        while (i < segs.length() && progT >= segStart[i] + segs.getJSONObject(i).getDouble("d")) i++;
        if (i >= segs.length()) {
            progDone = true; rampSpeed(Math.min(tSpeed, 3f), "programm"); endTimer = 0; log("programmende", 0); return;   // in 3-km/h-Stufen auf Gehtempo
        }
        if (i != segIdx) {
            segIdx = i; JSONObject s = segs.getJSONObject(i);
            rampSpeed(s.getDouble("s"), "programm");   // grosse Spruenge (z. B. 17 auf 6 km/h) in 3-km/h-Stufen
            applyIncl((float) s.optDouble("i", 0), "programm");
            log("segment " + i, (float) s.getDouble("s"));
        }
    }

    // ---------------- Zonen ----------------
    void runZones(double dt, long now) throws Exception {
        progT += dt;
        double dur = prog.optDouble("dur", 2700);
        if (progT >= dur && !progDone) { progDone = true; rampSpeed(Math.min(tSpeed, 3f), "programm"); endTimer = 0; return; }
        if (!auto || progDone) return;
        if (now - manualAt < 120000) return;                 // Handeingabe hat 2 min Vorrang
        float sMin = (float) prog.optDouble("sMin", 6), sMax = (float) prog.optDouble("sMax", 10.5);
        int lo = prog.optInt("lo", 128), hi = prog.optInt("hi", 142);
        if (!hrOk || hr == 0) {                               // Signalverlust: halten, nach 20 s schrittweise runter
            lossT += dt;
            if (lossT > 20 && tSpeed > sMin) { zoneTimer += dt; if (zoneTimer >= 5) { zoneTimer = 0; applySpeed(Math.max(sMin, tSpeed - 0.5f), "zone"); note = "Kein Pulssignal, Tempo wird gesenkt"; } }
            return;
        }
        lossT = 0;
        zoneTimer += dt;
        if (hr > hi + 15 || hr > hfmax) {                     // deutlich zu hoch: rasch runter
            if (zoneTimer >= 10) { zoneTimer = 0; applySpeed(Math.max(sMin, tSpeed - 0.5f), "zone"); note = tSpeed <= sMin ? "Puls zu hoch, Pause empfohlen" : "Puls zu hoch"; }
            return;
        }
        if (zoneTimer < 30) return;
        zoneTimer = 0;
        if (hr > hi + 2) applySpeed(Math.max(sMin, tSpeed - 0.3f), "zone");
        else if (hr < lo - 2 && progT > 300) applySpeed(Math.min(sMax, tSpeed + 0.3f), "zone");  // erst nach 5 min schneller
    }

    // ---------------- Strecke ----------------
    void runRoute(double dt) throws Exception {
        if (rp == null || progDone) return;
        progT += dt;
        double x = dist * 1000.0;
        if (x >= rp.D) {
            progDone = true; routeFinish = true; finishT = progT; rampSpeed(Math.min(tSpeed, 3f), "programm"); applyIncl(0f, "programm"); endTimer = 0;
            note = "Ziel erreicht"; log("ziel", (float) progT); return;
        }
        int i = rp.idxAt(x);
        if (i != segIdx) { segIdx = i; routeSpeed(rp.sp[i] + offS); }
        // Steigung mit Vorlauf (aus dem Soll-Tempo); innerhalb eines Abschnitts nie zurueckspringen
        int ii = rp.inclIdxAt(x, tSpeed, 0);
        if (ii < inclIdx && inclIdx <= i + 1 && inclIdx >= i) ii = inclIdx;
        if (ii != inclIdx) {
            inclIdx = ii; offI = 0;                       // Handeingabe Steigung gilt nur bis zum naechsten Wechsel
            applyIncl((float) rp.in[ii], "programm");
            // Anstieg: das langsamere Tempo zusammen mit der Steigung vorziehen
            if (ii == i + 1 && rp.early(ii)) routeSpeed(rp.sp[ii] + offS);
        }
    }
    void routeSpeed(double v) throws Exception { rampSpeed(v, "programm"); }

    /** Tempo setzen; Aenderungen ueber 3 km/h in Stufen von 3 km/h alle 4 s. */
    void rampSpeed(double v, String from) throws Exception {
        v = Math.max(S_MIN, Math.min(S_MAX, v));
        if (holdLeft > 0 && ("programm".equals(from) || "zone".equals(from))) { holdTarget = v; rampTarget = -1; return; }   // Einlaufen: Ziel merken, Stufen danach
        if (LAEUFT.equals(st) && Math.abs(v - tSpeed) > 3.0) {
            applySpeed((float) (tSpeed + Math.signum(v - tSpeed) * 3.0), from); rampTarget = v; rampLeft = 4; rampFrom = from;
        } else { rampTarget = -1; applySpeed((float) v, from); }
    }
    /** Handeingabe Tempo wird zum Versatz gegenueber dem Plan (gilt bis «Zurück zum Plan»). */
    void routeSpeedOffset() {
        if (rp == null) return;
        int i = Math.max(0, inclIdx > segIdx ? inclIdx : segIdx);
        if (inclIdx > segIdx && !(rp.in[inclIdx] > rp.in[segIdx] && rp.sp[inclIdx] < rp.sp[segIdx])) i = Math.max(0, segIdx);
        offS = Math.round((r1(tSpeed) - rp.sp[i]) * 10) / 10.0;
    }
    /** Handeingabe Steigung: gilt bis zum naechsten Steigungswechsel. */
    void routeInclOffset() {
        if (rp == null) return;
        offI = Math.round((r1(tIncl) - rp.in[Math.max(0, inclIdx)]) * 10) / 10.0;
    }

    // ---------------- Befehle ----------------
    void applySpeed(float v, String from) throws Exception {
        v = Math.max(S_MIN, Math.min(S_MAX, round1(v)));
        if (leaseLost && ("programm".equals(from) || "zone".equals(from)) && v > tSpeed) { rampTarget = -1; return; }
        if (holdLeft > 0 && ("programm".equals(from) || "zone".equals(from))) { holdTarget = v; return; }   // Einlaufen: Programm wartet
        tSpeed = v; src = from; lastSet = clock();
        if (LAEUFT.equals(st)) bus.putFloat(A_SPEED, v);
    }
    void applyIncl(float v, String from) throws Exception {
        v = Math.max(0f, Math.min(I_MAX, round1(v)));
        if (leaseLost && "programm".equals(from) && v > tIncl) return;   // ohne Lebenszeichen keine hoehere Steigung
        tIncl = v; src = from;
        if (LAEUFT.equals(st)) bus.putFloat(A_INCL, v);
    }
    static float round1(float v) { return Math.round(v * 10f) / 10f; }

    boolean errDuringRun = false;
    volatile long armAt = 0;   // Countdown-Pflicht: start/resume nur 2.5 bis 15 s nach arm
    /** Bus wieder da: lief das Band waehrend des Ausfalls weiter, STOP jetzt nachholen. */
    void busRecovered() {
        log("bus wieder da", speed);
        if (!LAEUFT.equals(st) && speed > 0.3f) { lastStopAt = clock(); try { bus.sendEvent(A_STOP); stopSentAt = lastStopAt; log("stop nachgeholt", speed); } catch (Throwable e) {} }
    }
    volatile long stopSentAt = 0;

    void setError(String m) {
        if (!FEHLER.equals(st)) errDuringRun = LAEUFT.equals(st) || PAUSE.equals(st);
        err = m; st = FEHLER; lastStopAt = clock();
        try { bus.sendEvent(A_STOP); stopSentAt = lastStopAt; } catch (Throwable e) {}
        log("fehler " + m, speed);
    }

    /** STOP mit Vorrang: am Lock vorbei, direkt auf den Bus. */
    String stopNow(String from) {
        boolean sent = false;
        try { bus.sendEvent(A_STOP); sent = true; } catch (Throwable e) {
            try { if (connect()) { bus.sendEvent(A_STOP); sent = true; } } catch (Throwable e2) {}   // Bus getrennt: sofort neu verbinden und nochmals
        }
        if (sent) stopSentAt = clock(); else log("stop-fehler", speed);
        synchronized (lock) {
            doStopState(from);
            if (sent) try { bus.sendEvent(A_STOP); } catch (Throwable e) {}   // nochmals unter dem Lock: ein gleichzeitiges START verliert
        }
        return sent ? ok() : err("STOP nicht gesendet, Herstellerbus getrennt");
    }
    void doStop(String from) { try { bus.sendEvent(A_STOP); stopSentAt = clock(); } catch (Throwable e) {} doStopState(from); }
    void doStopState(String from) {
        if (LAEUFT.equals(st)) { st = PAUSE; pausedAt = clock(); }
        lastStopAt = clock();
        endTimer = -1; rampTarget = -1; holdLeft = 0; holdTarget = -1; hwStartAt = 0; src = from; log("stop", speed);
    }

    /** Lauf beenden: STOP (auch aus PAUSE, das Band darf nie in BEREIT weiterlaufen), Zusammenfassung, BEREIT. Aufruf unter lock. */
    JSONObject endRun(String from) throws Exception {
        if (LAEUFT.equals(st) || speed > 0.3f) doStop(from);
        try { bus.putFloat(A_INCL, 0f); } catch (Throwable e) {}
        JSONObject sum = summary();
        lastSummary = sum;
        try { java.nio.file.Files.write(new File(ctx.getFilesDir(), "letzter-lauf.json").toPath(), sum.toString().getBytes("UTF-8")); } catch (Throwable e) {}   // nicht nur im RAM
        resetRun(); st = BEREIT; lastStopAt = clock(); tIncl = 0f; tSpeed = HOLD_SPEED; prog = null; progType = null; segs = null; rp = null; endTimer = -1; note = ""; err = "";
        try { snapFile().delete(); } catch (Throwable e) {}
        log("ende " + from, 0);
        return sum;
    }

    String cmd(JSONObject j, String from) {
        String c = j.optString("c");
        if ("stop".equals(c)) { armAt = 0; hwStartAt = 0; return stopNow(from); }
        synchronized (lock) {
            try {
                if (!"touch".equals(c)) pauseIdle = 0;   // jede Eingabe verlaengert die Pause
                if (!"touch".equals(c)) log("cmd " + c + " " + j.optString("v", j.optString("d", "")), speed);
                if ("arm".equals(c)) { armAt = clock(); log("arm", tSpeed); return ok(); }
                if ("start".equals(c)) {
                    if (!BEREIT.equals(st)) return err("nicht bereit");
                    if (!armed()) return err("Countdown fehlt");
                    if (pulled != 0) return err(pulled == 1 ? "Sicherheitsschlüssel gezogen" : "Schlüsselzustand unbekannt");
                    if (safe != 1) return err("Gerät meldet nicht startbereit");
                    if (speed > 0.3f) return err("Band bewegt sich noch");
                    if (tSpeed < S_MIN) tSpeed = HOLD_SPEED;
                    resetRun();
                    new Thread(new Runnable() { public void run() { AppHygiene.trim(ctx); } }).start();   // Speicher fuer Musik und Videos waehrend des Laufs
                    bus.sendEvent(A_START);
                    st = LAEUFT; pausedAt = 0; src = from; note = ""; appBlocked = false; appPendS = appPendI = -1;
                    beginHold(tSpeed);
                    bus.putFloat(A_SPEED, tSpeed); bus.putFloat(A_INCL, tIncl);
                    if (prog != null) { progT = 0; segIdx = -1; inclIdx = -1; progDone = false; zoneTimer = 0; lossT = 0; routeFinish = false; if (rp != null) { segIdx = 0; inclIdx = 0; } }
                    lastLease = clock();
                    return ok();
                }
                if ("resume".equals(c)) {
                    if (!PAUSE.equals(st)) return err("nicht pausiert");
                    if (speed > 0.3f) return err("Band läuft noch aus");
                    if (!armed()) return err("Countdown fehlt");
                    if (pulled != 0 || safe != 1) return err("nicht startbereit");
                    bus.sendEvent(A_START); st = LAEUFT; pausedAt = 0; src = from; note = "";
                    beginHold(Math.max(S_MIN, tSpeed));
                    bus.putFloat(A_SPEED, tSpeed); bus.putFloat(A_INCL, tIncl);
                    return ok();
                }
                if ("end".equals(c)) return "{\"ok\":true,\"summary\":" + endRun(from).toString() + "}";
                if ("inclZero".equals(c)) { tIncl = 0f; bus.putFloat(A_INCL, 0f); return ok(); }
                if ("ack".equals(c)) {
                    if (!FEHLER.equals(st)) return ok();
                    if (speed > 0.3f) return err("Band bewegt sich noch");
                    if (pulled != 0) return err(pulled == 1 ? "Schlüssel stecken" : "Verbindung zum Band unsicher");
                    // Nach Unterbrechung im Lauf: Pause, Weiter nur mit Gehtempo; das alte Tempo braucht einen eigenen Tipp
                    if (errDuringRun) { st = PAUSE; pausedAt = clock(); tSpeed = Math.min(tSpeed, 3f); err = "";
                        note = "Nach Unterbrechung: Weiter mit " + String.format(Locale.US, "%.1f", tSpeed) + " km/h (Gehtempo)"; errDuringRun = false; routeSpeedOffset(); log("ack-pause", tSpeed); return ok(); }
                    st = BEREIT; err = ""; note = ""; return ok();
                }
                if (FEHLER.equals(st)) return err("Fehler zuerst quittieren");
                if ("speed".equals(c)) { manual(from); rampTarget = -1; endHold(); freeRun((float) j.getDouble("v")); applySpeed((float) j.getDouble("v"), from); routeSpeedOffset(); return ok(); }
                if ("incline".equals(c)) { manual(from); applyIncl((float) j.getDouble("v"), from); routeInclOffset(); return ok(); }
                if ("step".equals(c)) {
                    float d = (float) Math.max(-0.5, Math.min(0.5, j.getDouble("d")));
                    manual(from);
                    if (!"incline".equals(j.optString("what"))) { rampTarget = -1; endHold(); freeRun(tSpeed + d); }
                    if ("incline".equals(j.optString("what"))) applyIncl(tIncl + d, from);
                    else applySpeed((tSpeed < S_MIN ? S_MIN - 0.5f : tSpeed) + d, from);
                    if ("incline".equals(j.optString("what"))) routeInclOffset(); else routeSpeedOffset();
                    return ok();
                }
                if ("program".equals(c)) {
                    if (!BEREIT.equals(st)) return err("Programm nur im Zustand BEREIT laden");
                    loadProgram(j.optJSONObject("p")); return ok();
                }
                if ("skipTo".equals(c)) {   // Intervall: nur vorwaerts springen (z. B. Stufentest direkt ins Auslaufen)
                    if (!"interval".equals(progType) || segs == null) return err("kein Intervallprogramm");
                    if (!LAEUFT.equals(st) && !PAUSE.equals(st)) return err("nur im Lauf oder in der Pause");
                    int idx = j.optInt("idx", -1);
                    if (idx <= segIdx || idx >= segs.length()) return err("nur vorwärts innerhalb des Programms");
                    progT = segStart[idx] + 0.01;
                    if (PAUSE.equals(st)) { JSONObject sg = segs.getJSONObject(idx); segIdx = idx; tSpeed = (float) sg.getDouble("s"); tIncl = (float) sg.optDouble("i", 0); try { bus.putFloat(A_INCL, tIncl); } catch (Throwable e) {} }
                    log("sprung " + idx, tSpeed); return ok();   // im Lauf stellt runInterval im naechsten Takt um, in 3-km/h-Stufen
                }
                if ("clearProgram".equals(c)) { if (BEREIT.equals(st)) { prog = null; progType = null; segs = null; rp = null; } return ok(); }
                if ("routeOffset".equals(c)) {
                    if (rp == null) return err("keine Strecke geladen");
                    offS = Math.max(-15, Math.min(15, j.optDouble("s", 0))); offI = Math.max(-15, Math.min(15, j.optDouble("i", 0)));
                    int i = Math.max(0, segIdx), ii = Math.max(0, inclIdx);
                    rampSpeed(rp.sp[i] + offS, from); applyIncl((float) (rp.in[ii] + offI), from); return ok();
                }
                if ("standby".equals(c)) {
                    int i = j.optInt("i", -1);
                    if (i < 0 || i > 3) return err("Stufe 0 bis 3");
                    bus.putInt(ERP_KEY, i); erpIdx = i; erpAt = clock(); log("standby " + i, 0); return ok();
                }
                if ("touch".equals(c)) {   // Beruehrung oder Wiedergabe: Standby-Zeitgeber der Herstellersoftware neu starten
                    if (clock() - touchAt > 20000) { touchAt = clock(); bus.sendEvent("EVENT_TOUCH"); }
                    return ok();
                }
                if ("appRelease".equals(c)) { appBlocked = true; appPendS = appPendI = -1; log("app-freigabe", tSpeed); return ok(); }   // «Zurück an Konsole»
                if ("hideBar".equals(c)) { hideBar = j.optBoolean("on", true); barShown = null; return ok(); }
                if ("auto".equals(c)) { auto = j.optBoolean("on", true); manualAt = 0; return ok(); }
                if ("profile".equals(c)) {
                    weight = (float) Math.max(35, Math.min(200, j.optDouble("weight", weight)));
                    hfmax = Math.max(120, Math.min(230, j.optInt("hfmax", hfmax))); return ok();
                }
                return err("unbekannter Befehl");
            } catch (Throwable e) { return err(String.valueOf(e.getMessage())); }
        }
    }

    // ---------------- Steuerung durch Apps ----------------
    /** 0 = erlaubt, sonst Ergebniscode des FTMS-Steuerpunkts (nicht erlaubt bzw. fehlgeschlagen). */
    int appAllowed() {
        if (!appCtl || appBlocked) return FtmsData.RES_NOT_PERMITTED;
        if (!LAEUFT.equals(st) || holdLeft > 0) return FtmsData.RES_FAILED;            // nur im Lauf, nicht im Einlaufen
        if (prog != null && !progDone) return FtmsData.RES_NOT_PERMITTED;              // Programme fuehren das Band
        if (clock() - manualAt < APP_MANUAL_MS) return FtmsData.RES_NOT_PERMITTED;    // Handeingabe hat 30 s Vorrang
        return 0;
    }
    /** Befehl einer App (Steuerpunkt). Nie Start oder Weiter; STOP wirkt immer. Rueckgabe: FtmsData.RES_*. */
    int appCmd(int op, double v, String app) {
        if (op == FtmsData.OP_STOP) { stopNow("app"); return FtmsData.RES_OK; }
        synchronized (lock) {
            // Start/Weiter: laeuft das Band schon, nur bestaetigen (Apps erwarten Erfolg); sonst nie, der Start bleibt an der Konsole
            if (op == FtmsData.OP_START) { if (LAEUFT.equals(st)) return FtmsData.RES_OK; log("app-start abgewiesen", tSpeed); return FtmsData.RES_NOT_PERMITTED; }
            if (op == FtmsData.OP_REQUEST || op == FtmsData.OP_RESET) return appCtl && !appBlocked ? FtmsData.RES_OK : FtmsData.RES_NOT_PERMITTED;
            if (op != FtmsData.OP_SPEED && op != FtmsData.OP_INCL) return FtmsData.RES_UNSUPPORTED;
            if (Double.isNaN(v)) return FtmsData.RES_INVALID;
            int a = appAllowed(); if (a != 0) return a;
            if (op == FtmsData.OP_SPEED) {
                if (v < S_MIN - 0.05 || v > S_MAX + 0.05) return FtmsData.RES_INVALID;
                v = Math.min(v, appMaxS);
                if (leaseLost && v > tSpeed) return FtmsData.RES_NOT_PERMITTED;   // ohne Oberflaeche nicht hochregeln
                appPendS = v;
            } else {
                if (v < -0.05 || v > I_MAX + 0.05) return FtmsData.RES_INVALID;
                v = Math.max(0, Math.min(v, appMaxI));
                if (leaseLost && v > tIncl) return FtmsData.RES_NOT_PERMITTED;
                appPendI = v;
            }
            appName = app == null ? "" : app; appAt = clock();
            if (clock() - appCmdAt >= APP_RATE_MS) appApply();   // hoechstens ein Befehl je 2 s, spaetere Werte im naechsten Takt
            return FtmsData.RES_OK;
        }
    }
    void appApply() {
        appCmdAt = clock();
        try {
            // Blackbox nur bei geaendertem Wert (Zwift schickt die Steigung fast jede Sekunde)
            if (appPendS >= 0) { boolean ch = Math.abs(appPendS - (rampTarget > 0 ? rampTarget : tSpeed)) > 0.05; endHold(); rampSpeed(appPendS, "app"); if (ch) log("app tempo", (float) appPendS); }
            if (appPendI >= 0) { boolean ch = Math.abs(appPendI - tIncl) > 0.05; applyIncl((float) appPendI, "app"); if (ch) log("app steigung " + appPendI, tSpeed); }
        } catch (Throwable e) { log("app-fehler", tSpeed); }
        appPendS = -1; appPendI = -1;
    }

    /** Einlaufen beginnen: Band mit 1 km/h, Ziel merken. */
    void beginHold(float want) {
        rampTarget = -1;
        if (want > HOLD_SPEED + 0.05f) { holdTarget = want; holdLeft = HOLD_SECONDS; tSpeed = HOLD_SPEED; note = "Einlaufen mit 1.0 km/h"; }
        else { holdTarget = -1; holdLeft = 0; tSpeed = Math.max(S_MIN, want); }
    }
    /** Handeingabe beendet das Einlaufen sofort (bewusste Wahl des Laeufers). */
    void endHold() { if (holdLeft > 0) { holdLeft = 0; holdTarget = -1; note = ""; } }

    // ---------------- Geraetetasten ----------------
    /** Taste oder Drehregler der Konsole (aus KeyReader). STOP wirkt immer und sofort. */
    void hwKey(int code) {
        if (code == KeyReader.K_STOP) { armAt = 0; hwStartAt = 0; stopNow("taste"); log("taste stop", speed); return; }   // erst STOP, dann Logbuch
        synchronized (lock) {
            try {
                lastLease = clock(); pauseIdle = 0;
                if (code == KeyReader.K_GO) {
                    if (LAEUFT.equals(st)) { log("taste pause", speed); doStop("taste"); return; }
                    if (hwStartAt > 0) return;
                    if (pulled != 0 || safe != 1 || photoLock()) { log("taste start ignoriert (Schlüssel/Sperre)", 0); return; }
                    if (BEREIT.equals(st) || PAUSE.equals(st)) {
                        hwResume = PAUSE.equals(st); armAt = clock(); hwStartAt = armAt + 3000;
                        note = "Band läuft in 3 s an · STOP bricht ab"; log("taste start", 0);
                    }
                    return;
                }
                if (FEHLER.equals(st)) return;
                if (code == KeyReader.K_SPEED_UP || code == KeyReader.K_SPEED_DOWN) {
                    float d = code == KeyReader.K_SPEED_UP ? 0.1f : -0.1f;
                    manual("taste"); rampTarget = -1; endHold(); freeRun(tSpeed + d);
                    applySpeed(Math.max(S_MIN, tSpeed + d), "taste"); routeSpeedOffset();
                } else if (code == KeyReader.K_INCL_UP || code == KeyReader.K_INCL_DOWN) {
                    // Drehregler liefert rund 3 Impulse je Raste: 0.5 % je Raste
                    int dir = code == KeyReader.K_INCL_UP ? 1 : -1;
                    if (dir != inclDir) { inclDir = dir; inclPulses = 0; }
                    if (++inclPulses < 3) return;
                    inclPulses = 0;
                    manual("taste"); applyIncl(tIncl + 0.5f * dir, "taste"); routeInclOffset();
                }
            } catch (Throwable e) { log("taste fehler " + e, 0); }
        }
    }
    /** Countdown der Geraetetaste abgelaufen: start bzw. resume ueber den normalen Weg (mit allen Pruefungen). */
    void hwFire() {
        hwStartAt = 0; note = "";
        armAt = clock() - 3000;   // der Countdown ist ueber hwStartAt (Takt der Hauptschleife) abgelaufen
        String r;
        try { r = cmd(new JSONObject().put("c", hwResume ? "resume" : "start"), "taste"); } catch (Exception e) { r = err(String.valueOf(e)); }
        if (!r.contains("\"ok\":true")) { note = "Start über Taste nicht möglich"; log("taste start abgelehnt " + r, 0); }
    }

    /** Tempo erhoeht im Auslaufen nach Programmende: Programm bleibt beendet, das Band laeuft frei weiter. */
    void freeRun(float v) {
        if (progDone && endTimer >= 0 && v > 3.5f) { endTimer = -1; note = "Freilauf nach Programmende, STOP beendet den Lauf"; log("freilauf", v); }
    }

    /** Fotosperre: solange files/nostart existiert (von Werkzeugen per root gesetzt), laeuft das Band nie an. */
    boolean photoLock() { try { return new File(ctx.getFilesDir(), "nostart").exists(); } catch (Throwable e) { return false; } }
    boolean armed() { long d = clock() - armAt; armAt = 0; if (photoLock()) { log("fotosperre", 0); return false; } return d >= 2500 && d <= 15000; }

    void manual(String from) { if (!"programm".equals(from) && !"zone".equals(from)) manualAt = clock(); }

    void loadProgram(JSONObject p) throws Exception {
        if (p == null) throw new Exception("kein Programm");
        String type = p.optString("type");
        if ("interval".equals(type)) {
            JSONArray a = p.getJSONArray("segs");
            if (a.length() == 0 || a.length() > 200) throw new Exception("Segmente ungültig");
            segStart = new double[a.length()]; double t = 0;
            for (int i = 0; i < a.length(); i++) {
                JSONObject s = a.getJSONObject(i);
                double d = s.getDouble("d"), sp = s.getDouble("s"), in = s.optDouble("i", 0);
                if (d < 5 || d > 7200 || sp < S_MIN || sp > S_MAX || in < 0 || in > I_MAX) throw new Exception("Segment " + (i + 1) + " ausserhalb der Grenzen");
                segStart[i] = t; t += d;
            }
            segs = a; tSpeed = (float) a.getJSONObject(0).getDouble("s"); tIncl = (float) a.getJSONObject(0).optDouble("i", 0);
        } else if ("zones".equals(type)) {
            float sMin = (float) p.optDouble("sMin", 6), sMax = (float) p.optDouble("sMax", 10.5);
            if (sMin < S_MIN || sMax > 16 || sMin >= sMax) throw new Exception("Tempo-Grenzen ungültig");
            segs = null; tSpeed = (float) Math.max(sMin, Math.min(sMax, p.optDouble("s0", sMin))); tIncl = (float) Math.min(8, p.optDouble("i", 1));
            auto = true;
        } else if ("route".equals(type)) {
            if (p.optJSONArray("prof") == null) {        // nur id: Profil aus der Streckenbibliothek
                JSONObject f = routeFile(p.optString("id"));
                if (f == null) throw new Exception("Strecke unbekannt");
                p.put("prof", f.getJSONArray("prof"));
                if (!p.has("trail")) p.put("trail", "trail".equals(f.optString("art")));
                if (!p.has("hoehe")) p.put("hoehe", f.optString("hoehe").startsWith("gpx") ? "gpx" : "swisstopo");
                if (!p.has("name")) p.put("name", f.optString("name"));
            }
            JSONArray pr = p.getJSONArray("prof");
            if (pr.length() < 2 || pr.length() > 20000) throw new Exception("Profil ungültig");
            double[] pd = new double[pr.length()], pe = new double[pr.length()];
            for (int i = 0; i < pr.length(); i++) {
                JSONArray q = pr.getJSONArray(i); pd[i] = q.getDouble(0); pe[i] = q.getDouble(1);
                if (i > 0 && pd[i] < pd[i - 1]) throw new Exception("Profil nicht aufsteigend");
                if (pe[i] < -500 || pe[i] > 9000) throw new Exception("Höhe ausserhalb der Grenzen");
            }
            double sc = p.optDouble("scale", 1.0); if (sc != 0.5 && sc != 1.0) sc = 1.0;
            RoutePlan r;
            try { r = RoutePlan.build(pd, pe, p.getDouble("target"), !"even".equals(p.optString("mode")), sc, p.optBoolean("trail", false), "gpx".equals(p.optString("hoehe"))); }
            catch (IllegalArgumentException e) { throw new Exception(e.getMessage()); }
            rp = r; offS = 0; offI = 0; finishT = -1; segs = null; segIdx = 0; inclIdx = 0; routeFinish = false;
            tSpeed = (float) r.sp[0]; tIncl = (float) r.in[0];
        } else throw new Exception("Programmtyp unbekannt");
        if (!"route".equals(type)) rp = null;
        prog = p; progType = type; progT = 0; if (rp == null) segIdx = -1; progDone = false; endTimer = -1;
        resetRun();   // BEREIT zeigt nie Werte des vorigen Laufs
    }

    JSONObject routeFile(String id) {
        if (id == null || !id.matches("[a-z0-9-]{1,48}")) return null;
        try {
            java.io.File f = new java.io.File(new java.io.File(ctx.getFilesDir(), "routes"), id + ".json");
            java.io.InputStream is = f.exists() ? new java.io.FileInputStream(f) : ctx.getAssets().open("www/strecken/" + id + ".json");
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream(); byte[] buf = new byte[16384]; int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            is.close(); byte[] b = bo.toByteArray();
            return new JSONObject(new String(b, "UTF-8"));
        } catch (Throwable e) { return null; }
    }

    // ---------------- Laufstand: ueberlebt einen Neustart des Dienstes ----------------
    double snapAcc = 0;
    File snapFile() { return new File(ctx.getFilesDir(), "laufstand.json"); }
    /** Alle 30 s im Lauf und in der Pause: Messwerte, Verlauf und Programmstand auf die Platte (Aufruf unter lock). */
    void snapshot() {
        try {
            JSONObject o = new JSONObject();
            o.put("ts", System.currentTimeMillis()); o.put("st", st);
            o.put("elapsed", elapsed); o.put("dist", dist); o.put("kcal", kcal); o.put("elev", elev);
            o.put("hrSum", hrSum); o.put("hrN", hrN); o.put("hrMax", hrMax);
            JSONArray z = new JSONArray(); for (double v : zoneSec) z.put(v); o.put("zoneSec", z);
            JSONArray h = new JSONArray(); for (float[] q : hist) { JSONArray e = new JSONArray(); for (float v : q) e.put((double) v); h.put(e); } o.put("hist", h);
            if (prog != null) { o.put("prog", prog); o.put("progT", progT); o.put("segIdx", segIdx); o.put("inclIdx", inclIdx); o.put("offS", offS); o.put("offI", offI); o.put("progDone", progDone); }
            o.put("tSpeed", tSpeed); o.put("tIncl", tIncl);
            File t = new File(ctx.getFilesDir(), "laufstand.tmp");
            java.nio.file.Files.write(t.toPath(), o.toString().getBytes("UTF-8"));
            t.renameTo(snapFile());   // atomar: nie eine halbe Datei
        } catch (Throwable e) {}
    }
    /** Beim Start des Dienstes: Laufstand bis 15 min alt uebernehmen. Laeuft das Band, geht der Lauf weiter, sonst Pause mit Gehtempo. */
    boolean restore() {
        try {
            File f = snapFile(); if (!f.exists()) return false;
            JSONObject o = new JSONObject(new String(java.nio.file.Files.readAllBytes(f.toPath()), "UTF-8"));
            if (System.currentTimeMillis() - o.getLong("ts") > 15 * 60000L) { f.delete(); return false; }
            JSONObject pr = o.optJSONObject("prog");
            if (pr != null) loadProgram(pr);   // zuerst: laedt und setzt Programmzustand zurueck, danach die Messwerte
            elapsed = o.optDouble("elapsed"); dist = o.optDouble("dist"); kcal = o.optDouble("kcal"); elev = o.optDouble("elev");
            hrSum = o.optLong("hrSum"); hrN = o.optLong("hrN"); hrMax = o.optInt("hrMax");
            JSONArray z = o.optJSONArray("zoneSec"); if (z != null) for (int i = 0; i < Math.min(5, z.length()); i++) zoneSec[i] = z.optDouble(i);
            hist.clear(); JSONArray h = o.optJSONArray("hist");
            if (h != null) for (int i = 0; i < h.length(); i++) { JSONArray e = h.getJSONArray(i); float[] q = new float[e.length()]; for (int k = 0; k < q.length; k++) q[k] = (float) e.getDouble(k); hist.add(q); }
            if (pr != null) {
                progT = o.optDouble("progT"); segIdx = o.optInt("segIdx", -1); inclIdx = o.optInt("inclIdx", -1);
                offS = o.optDouble("offS"); offI = o.optDouble("offI"); progDone = o.optBoolean("progDone");
            }
            tIncl = (float) o.optDouble("tIncl", incline);
            log("laufstand wiederhergestellt", (float) elapsed);
            return true;
        } catch (Throwable e) { log("laufstand fehler " + e, 0); return false; }
    }

    void resetRun() { elapsed = dist = kcal = elev = 0; hrSum = hrN = 0; hrMax = 0; hist.clear(); histAcc = 0; zoneSec = new double[5]; }

    JSONObject summary() throws Exception {
        JSONObject s = new JSONObject();
        s.put("elapsed", Math.round(elapsed)); s.put("dist", round2(dist)); s.put("kcal", Math.round(kcal)); s.put("elev", Math.round(elev));
        s.put("avgHr", hrN > 0 ? hrSum / hrN : 0); s.put("maxHr", hrMax);
        s.put("avgSpeed", elapsed > 0 ? round2(dist / (elapsed / 3600.0)) : 0);
        s.put("name", prog != null ? prog.optString("name", "Training") : "Freies Laufen");
        s.put("type", progType != null ? progType : "free");
        JSONArray z = new JSONArray(); for (double v : zoneSec) z.put(Math.round(v)); s.put("zones", z);
        s.put("hist", histJson()); s.put("ts", System.currentTimeMillis());
        if ("route".equals(progType) && rp != null) {
            JSONObject r = new JSONObject();
            r.put("id", prog.optString("id")); r.put("D", Math.round(rp.D)); r.put("target", Math.round(prog.optDouble("target")));
            r.put("plan", Math.round(rp.total)); r.put("finish", routeFinish); r.put("x", Math.round(Math.min(rp.D, dist * 1000)));
            r.put("up", Math.round(rp.up)); r.put("offS", offS); r.put("t", Math.round(finishT >= 0 ? finishT : progT)); s.put("route", r);
        }
        return s;
    }
    static double round2(double v) { return Math.round(v * 100) / 100.0; }

    JSONArray histJson() throws Exception {
        JSONArray a = new JSONArray();
        for (float[] p : hist) { JSONArray q = new JSONArray(); q.put(Math.round(p[0])); q.put(p[1]); q.put(p[2]); q.put(Math.round(p[3])); a.put(q); }
        return a;
    }

    String stateJson(boolean withHist) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true); o.put("st", st); o.put("err", err); o.put("note", note);
            o.put("speed", r1(speed)); o.put("incline", r1(incline)); o.put("tSpeed", r1(tSpeed)); o.put("tIncl", r1(tIncl));
            o.put("hr", hr); o.put("hrOk", hrOk); o.put("pulled", pulled); o.put("safe", safe);
            o.put("elapsed", Math.round(elapsed)); o.put("dist", round2(dist)); o.put("kcal", Math.round(kcal)); o.put("elev", Math.round(elev));
            o.put("src", src); o.put("hfmax", hfmax); o.put("weight", weight); o.put("hrSrc", hrSrc);
            if (fanKnown) o.put("fan", new JSONObject().put("l", Math.max(0, fanLevel)).put("a", fanAuto).put("c", fanLevel >= 0));   // Platz in der Pille bleibt, solange ein Ventilator gespeichert ist
            if (holdLeft > 0) { o.put("hold", Math.ceil(holdLeft)); o.put("holdTo", r1((float) holdTarget)); }
            if (appCtl) o.put("appCtl", true);
            o.put("erp", erpIdx);
            if (LAEUFT.equals(st) && !appBlocked && appAt > 0 && clock() - appAt < 15000) o.put("app", appName);   // App steuert gerade
            if (hwStartAt > 0) o.put("cd", Math.max(1, (int) Math.ceil((hwStartAt - clock()) / 1000.0))); o.put("top", topPkg); o.put("bar", barShown == null || barShown);
            if (prog != null) o.put("prog", progJson(withHist)); else o.put("prog", JSONObject.NULL);
            if (withHist) o.put("hist", histJson());
            return o.toString();
        } catch (Throwable e) { return err(String.valueOf(e)); }
    }
    static double r1(float v) { return Math.round(v * 10) / 10.0; }

    JSONObject progJson(boolean full) throws Exception {
        JSONObject p = new JSONObject();
        p.put("type", progType); p.put("name", prog.optString("name"));
        if ("route".equals(progType) && rp != null) {
            double x = Math.min(rp.D, dist * 1000.0);
            int i = Math.max(0, Math.min(rp.n - 1, rp.idxAt(x)));
            p.put("id", prog.optString("id")); p.put("D", Math.round(rp.D)); p.put("x", Math.round(x));
            p.put("idx", i + 1); p.put("n", rp.n);
            p.put("sec", secJson(i, offI)); p.put("next", i + 1 < rp.n ? secJson(i + 1, 0) : JSONObject.NULL);
            p.put("toNext", Math.round(rp.b[i] - x));
            // Beginn des naechsten Wechsels inklusive Steigungsvorlauf (Banner und Toene richten sich danach)
            if (i + 1 < rp.n) { double cs = rp.in[i + 1] != rp.in[i] ? rp.a[i + 1] - rp.lead(i + 1) : rp.a[i + 1]; p.put("toChange", Math.max(0, Math.round(cs - x))); }
            p.put("toFinish", Math.max(0, Math.round(rp.D - x)));
            double ps = Math.max(S_MIN, rp.sp[i] + offS);
            p.put("pace", Math.round(3600.0 / ps));
            double tp = rp.tPlanAt(x); p.put("tPlan", Math.round(tp)); p.put("delta", Math.round(progT - tp));
            // Prognose: restliche Planzeit, mit dem aktuellen Tempoversatz umgerechnet
            double rest = 0;
            for (int k = i; k < rp.n; k++) { double l = rp.b[k] - Math.max(rp.a[k], x); if (l > 0) rest += l / (Math.max(S_MIN, rp.sp[k] + offS) / 3.6); }
            p.put("eta", Math.round(progT + rest)); p.put("total", Math.round(rp.total)); p.put("target", Math.round(prog.optDouble("target")));
            p.put("t", Math.round(progT)); p.put("left", Math.round(rest));
            p.put("offS", offS); p.put("offI", offI); p.put("ele", Math.round(rp.eleAt(x)));
            p.put("up", Math.round(rp.up)); p.put("down", Math.round(rp.down)); p.put("capped", rp.capped);
            p.put("mode", prog.optString("mode", "terrain")); p.put("scale", prog.optDouble("scale", 1.0)); p.put("finish", routeFinish);
            if (full) {
                JSONArray ss = new JSONArray();
                for (int k = 0; k < rp.n; k++) { JSONArray q = new JSONArray(); q.put(Math.round(rp.a[k])); q.put(Math.round(rp.b[k])); q.put(rp.sp[k]); q.put(rp.in[k]); q.put(Math.round(rp.g[k] * 10) / 10.0); q.put(Math.round(rp.tA[k])); ss.put(q); }
                p.put("secs", ss);
                JSONArray pf = new JSONArray(); int step = Math.max(1, rp.pd.length / 400);
                for (int k = 0; k < rp.pd.length; k += step) { JSONArray q = new JSONArray(); q.put(Math.round(rp.pd[k])); q.put(Math.round(rp.pe[k] * 10) / 10.0); pf.put(q); }
                JSONArray q = new JSONArray(); q.put(Math.round(rp.D)); q.put(Math.round(rp.pe[rp.pe.length - 1] * 10) / 10.0); pf.put(q);
                p.put("prof", pf);
            }
            p.put("done", progDone);
            return p;
        }
        if ("interval".equals(progType)) {
            double total = segStart[segs.length() - 1] + segs.getJSONObject(segs.length() - 1).getDouble("d");
            int i = Math.max(0, Math.min(segs.length() - 1, segIdx));
            JSONObject s = segs.getJSONObject(i);
            double segLeft = segStart[i] + s.getDouble("d") - progT;
            p.put("idx", i + 1); p.put("n", segs.length());
            p.put("segLeft", Math.max(0, Math.round(segLeft))); p.put("segDur", Math.round(s.getDouble("d")));
            p.put("left", Math.max(0, Math.round(total - progT))); p.put("total", Math.round(total));
            p.put("kind", s.optString("k", "h"));
            p.put("next", i + 1 < segs.length() ? segs.getJSONObject(i + 1) : JSONObject.NULL);
            p.put("segs", segs); p.put("t", Math.round(progT));
        } else {
            double dur = prog.optDouble("dur", 2700);
            p.put("left", Math.max(0, Math.round(dur - progT))); p.put("total", Math.round(dur)); p.put("t", Math.round(progT));
            p.put("auto", auto && clock() - manualAt >= 120000); p.put("autoOn", auto);
            p.put("lo", prog.optInt("lo")); p.put("hi", prog.optInt("hi"));
            p.put("sMin", prog.optDouble("sMin", 6)); p.put("sMax", prog.optDouble("sMax", 10.5));
        }
        p.put("done", progDone);
        return p;
    }

    JSONObject secJson(int i, double oi) throws Exception {
        JSONObject s = new JSONObject();
        s.put("a", Math.round(rp.a[i])); s.put("b", Math.round(rp.b[i])); s.put("s", r1((float) (rp.sp[i] + offS)));
        s.put("i", r1((float) Math.max(0, Math.min(I_MAX, rp.in[i] + oi)))); s.put("g", Math.round(rp.g[i] * 10) / 10.0);
        return s;
    }

    // ---------------- Blackbox ----------------
    synchronized void log(String what, float v) {
        String line = String.format(Locale.US, "%tF %<tT %s v=%.1f st=%s ist=%.1f soll=%.1f src=%s%n",
            System.currentTimeMillis(), what, v, st, speed, tSpeed, src);
        Log.i(T, line.trim());
        try {
            if (box.length() > 300000) { File old = new File(box.getPath() + ".1"); old.delete(); box.renameTo(old); }
            FileOutputStream f = new FileOutputStream(box, true); f.write(line.getBytes("UTF-8")); f.close();
        } catch (Throwable e) {}
    }

    static String ok() { return "{\"ok\":true}"; }
    static String err(String m) { return "{\"ok\":false,\"error\":" + JSONObject.quote(m) + "}"; }
}
