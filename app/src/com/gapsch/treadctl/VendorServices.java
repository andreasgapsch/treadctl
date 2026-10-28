// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Dienste der Herstellerapp, die sonst nur deren Startbildschirm startet (SplashScreenActivity → NezukoServiceStarter):
 *  LCBService spricht mit dem Motorboard, HalService mit der Hardware, UiService traegt den Standby-Zeitgeber.
 *  Ist Tread Control der Startbildschirm, laeuft der Herstellerstart nie; dann startet der Dienst sie selbst, wie dort
 *  (startForegroundService), nur die fehlenden. GATTServerService (Hersteller-FTMS) bewusst nicht. */
public class VendorServices {
    static final String PKG = "com.jht.atsoul.nezuko";
    static final String[] CLS = {
        "com.jht.atsoul.service.hal.LCBService", "com.jht.atsoul.service.hal.HalService",
        "com.jht.soul.service.LoggerService", "com.jht.soul.service.ApiService", "com.jht.atsoul.service.ui.UiService",
        "com.jht.atsoul.service.WorkoutControllerService", "com.jht.soul.service.HdmiService",
        "com.jht.atsoul.service.matrixcomm.MatrixCommService", "com.jht.atsoul.service.WirelessCastingService",
        "com.jht.soul.service.NetworkService" };

    /** Fuer die regelmaessige Pruefung nur die fuer Band und Standby noetigen (die uebrigen duerfen sich selbst beenden). */
    static final String[] CRITICAL = { "com.jht.atsoul.service.hal.LCBService", "com.jht.atsoul.service.hal.HalService",
        "com.jht.atsoul.service.ui.UiService", "com.jht.atsoul.service.matrixcomm.MatrixCommService" };
    /** Nur wenn Tread Control der Startbildschirm ist (sonst startet sie der Herstellerstart selbst). */
    static boolean wanted(Context c) { try { return c.getSharedPreferences("core", Context.MODE_PRIVATE).getBoolean("home", true); } catch (Throwable e) { return true; } }
    static int ensure(Context c) { return ensure(c, CLS); }
    /** Fehlende Herstellerdienste starten; Rueckgabe: Anzahl gestarteter. */
    static int ensure(Context c, String[] list) {
        if (!wanted(c)) return 0;
        int n = 0;
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            java.util.Set<String> running = new java.util.HashSet<String>();
            @SuppressWarnings("deprecation") java.util.List<ActivityManager.RunningServiceInfo> l = am.getRunningServices(300);
            if (l != null) for (ActivityManager.RunningServiceInfo i : l) if (i.service != null && i.pid > 0 && i.restarting == 0) running.add(i.service.getClassName());   // auch nur gebundene zaehlen; «wird neu gestartet» (Android wartet mit Abstand) gilt als fehlend
            for (String k : list) {
                if (running.contains(k)) continue;
                try { c.startForegroundService(new Intent().setComponent(new ComponentName(PKG, k))); n++; }
                catch (Throwable e) { Log.w("TREADCTL", "herstellerdienst " + k + ": " + e); }
            }
        } catch (Throwable e) { Log.w("TREADCTL", "herstellerdienste: " + e); }
        return n;
    }
}
