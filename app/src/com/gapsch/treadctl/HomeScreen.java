// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.util.Log;

/** Startbildschirm der Konsole: Tread Control (Alias .Home) oder die Herstelleroberflaeche. Die Herstellerapp bleibt
 *  installiert und aktiv (nie deaktivieren, brick-sicher); umgestellt wird nur die bevorzugte Startseite. */
public class HomeScreen {
    static final ComponentName OURS = new ComponentName("com.gapsch.treadctl", "com.gapsch.treadctl.Home");
    static final ComponentName VENDOR = new ComponentName("com.jht.atsoul.nezuko", "com.jht.atsoul.ui.SplashScreenActivity");

    /** true, wenn Tread Control beim Einschalten und mit der Home-Taste erscheint. */
    static boolean isOurs(Context c) {
        try {
            ResolveInfo r = c.getPackageManager().resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0);
            return r != null && r.activityInfo != null && OURS.getPackageName().equals(r.activityInfo.packageName);
        } catch (Throwable e) { return false; }
    }

    /** Bevorzugte Startseite setzen (wie «cmd package set-home-activity»); Rueckgabe: danach gesetzt wie gewuenscht. */
    static boolean set(Context c, boolean ours) {
        ComponentName cn = ours ? OURS : VENDOR;
        try {
            Object ipm = Class.forName("android.app.ActivityThread").getMethod("getPackageManager").invoke(null);
            ipm.getClass().getMethod("setHomeActivity", ComponentName.class, int.class).invoke(ipm, cn, 0);
        } catch (Throwable e) {
            Log.w("TREADCTL", "startseite per Paketdienst: " + e);
            try {
                Process p = Runtime.getRuntime().exec(new String[]{ "cmd", "package", "set-home-activity", cn.flattenToString() });
                p.waitFor();
            } catch (Throwable e2) { Log.w("TREADCTL", "startseite per cmd: " + e2); }
        }
        return isOurs(c) == ours;
    }
}
