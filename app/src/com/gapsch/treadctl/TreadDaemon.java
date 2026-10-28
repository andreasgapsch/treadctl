// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

/** Steuerdienst im eigenen Prozess (:core). Haelt den Kern (Zustandsmaschine,
 *  Programme, Watchdog) und eine lokale HTTP-Schnittstelle auf 127.0.0.1:8765.
 *  Lesen ist offen, Steuern nur mit Token (siehe Token, Conn). */
public class TreadDaemon extends Service {
    static final String T = "TREADCTL";
    static final int PORT = 8765;
    Core core;
    Httpd httpd;
    HrBle hrBle;
    MediaWatch media;
    BleProbe probe;
    FtmsServer ftms;
    FanControl fan;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        // Unbehandelte Fehler in einem Thread: in die Blackbox, dann normal beenden (Android startet neu); so bleibt eine Absturzserie nachvollziehbar
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() { public void uncaughtException(Thread th, Throwable e) {
            try { java.io.FileOutputStream f = new java.io.FileOutputStream(new java.io.File(getFilesDir(), "blackbox.log"), true);
                  f.write(String.format(java.util.Locale.US, "%tF %<tT absturz %s: %s%n", System.currentTimeMillis(), th.getName(), String.valueOf(e)).getBytes("UTF-8")); f.close(); } catch (Throwable x) {}
            if (prev != null) prev.uncaughtException(th, e); else android.os.Process.killProcess(android.os.Process.myPid());
        } });
        startForegroundSafe();
        Token.create(this);
        core = new Core(this);
        Thread t = new Thread(core, "core"); t.setPriority(Thread.MAX_PRIORITY); t.start();
        new KeyReader(core).start();   // Tasten und Drehregler der Konsole
        media = new MediaWatch(this);   // Mini-Player
        try { media.out = new AudioOut(this); } catch (Throwable e) {}   // Abspielgeraet
        probe = new BleProbe(this, core);   // Werkzeug zum Einbinden neuer BLE-Geraete
        fan = new FanControl(this, core); try { fan.start(); } catch (Throwable e) {}   // Ventilator CYCPLUS F1
        hrBle = new HrBle(this, core); try { hrBle.startup(); } catch (Throwable e) {}   // gekoppelter Pulsmesser
        ftms = new FtmsServer(this, core); try { ftms.start(); } catch (Throwable e) {}   // Laufband als FTMS-Geraet und Laufsensor fuer Apps und Uhren
        httpd = new Httpd(this, PORT);
        new Thread(httpd, "httpd").start();
        Log.i(T, "Dienst gestartet, uid=" + android.os.Process.myUid());
        // Pille mitstarten und gegenseitig ueberwachen
        new Thread(new Runnable() { public void run() { guard(); } }, "guard").start();
    }

    android.os.PowerManager.WakeLock wake;
    /** Startet die Pille neu, falls ihr Prozess verschwunden ist; haelt das Geraet wach, solange das Band in Gebrauch ist. */
    void guard() {
        while (core.alive) {
            try {
                Thread.sleep(5000);
                if (!OverlayService.isRunning(this)) startForegroundService(new Intent(this, OverlayService.class));
                boolean use = !Core.BEREIT.equals(core.st) || core.speed > 0.3f;
                if (use && (wake == null || !wake.isHeld())) {
                    if (wake == null) { wake = ((android.os.PowerManager) getSystemService(Context.POWER_SERVICE)).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "treadctl:lauf"); wake.setReferenceCounted(false); }
                    wake.acquire(4 * 3600 * 1000L); core.log("wachhalten an", 0);   // Obergrenze 4 h, wird im Lauf erneuert
                } else if (!use && wake != null && wake.isHeld()) { wake.release(); core.log("wachhalten aus", 0); }
            } catch (Throwable e) {}
        }
    }

    void startForegroundSafe() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel("treadctl", "TreadCtl", NotificationManager.IMPORTANCE_LOW));
            startForeground(1, new Notification.Builder(this, "treadctl")
                .setContentTitle("TreadCtl").setContentText("Steuerdienst aktiv")
                .setSmallIcon(android.R.drawable.ic_media_play).build());
        } catch (Throwable e) { Log.e(T, "fg: " + e); }
    }

    @Override public int onStartCommand(Intent i, int f, int id) { return START_STICKY; }
    @Override public void onDestroy() {
        if (core != null) { core.log("dienst-ende", 0); core.alive = false; core.barRestore(); }
        if (httpd != null) httpd.stop();
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Throwable e) {}
        super.onDestroy();
        // Eigener Prozess: sauber beenden statt Tasten-, Bluetooth- und Wachthreads weiterlaufen zu lassen
        // (ein neuer Dienst im selben Prozess haette sonst doppelte Threads und zwei Bluetooth-Verbindungen je Geraet)
        android.os.Process.killProcess(android.os.Process.myPid());
    }
}
