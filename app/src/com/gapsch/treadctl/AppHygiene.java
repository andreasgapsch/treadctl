// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.app.ActivityManager;
import android.content.Context;

/** Speicher fuer die Medien-Apps freihalten: Hilfs-Apps, die nur selten gebraucht werden und im Hintergrund
 *  viel Speicher halten (ReVanced Manager rund 220 MB, Aurora Store, Einstellungen), werden beim Start einer App
 *  aus der eigenen Oberflaeche und beim Laufstart aus dem Hintergrund entfernt. Nur Hintergrundprozesse
 *  (killBackgroundProcesses): eine App im Vordergrund oder mit laufendem Dienst bleibt unberuehrt.
 *  Medien- und Trainings-Apps stehen bewusst nicht auf der Liste (Wiedergabe, Fortsetzen). */
public class AppHygiene {
    static final String[] HELPERS = { "app.revanced.manager.flutter", "com.aurora.store", "com.android.settings" };
    static long lastAt = 0;

    /** Trainings- und Video-Apps: kommt eine davon in den Vordergrund, werden die anderen geschlossen (Zwift allein braucht
     *  rund 140 % CPU und 1.3 GB; zwei davon gleichzeitig ueberlasten die Konsole). Audio-Apps (YouTube Music,
     *  Audiobookshelf) fehlen bewusst: sie spielen im Hintergrund weiter. */
    static final String[] HEAVY = { "com.zwift.zwiftgame", "com.kinomap.training", "org.jellyfin.mobile", "app.revanced.android.youtube",
        "com.google.android.youtube", "org.smarttube.stable" };
    /** Apps mit eigener Anzeige von Tempo und Steigung, die auf der Konsole selbst laufen: statt der Pille die Seitenleiste;
     *  ihr Start-Befehl gilt wie die START-Taste (die Person steht vor der Konsole). */
    static final String[] OWN_DISPLAY = { "com.kinomap.training", "com.zwift.zwiftgame" };
    /** Hoehe der Leiste am unteren Rand (dp), ueber der die Pille sitzt: YouTube Reiter; YouTube Music Reiter und Mini-Player. */
    static int bottomBarDp(String pkg) {
        if ("app.revanced.android.youtube".equals(pkg) || "com.google.android.youtube".equals(pkg)) return 48;
        if ("app.revanced.android.apps.youtube.music".equals(pkg) || "com.google.android.apps.youtube.music".equals(pkg)) return 96;
        return 0;
    }
    static boolean ownDisplay(String pkg) { for (String p : OWN_DISPLAY) if (p.equals(pkg)) return true; return false; }
    static boolean heavy(String pkg) { for (String p : HEAVY) if (p.equals(pkg)) return true; return false; }
    /** Alle anderen schweren Apps beenden (force-stop, Plattform-App), die eben gestartete bleibt. */
    static void closeOthers(Context c, String keep) {
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            java.util.Set<String> running = new java.util.HashSet<String>();
            java.util.List<ActivityManager.RunningAppProcessInfo> ps = am.getRunningAppProcesses();
            if (ps != null) for (ActivityManager.RunningAppProcessInfo i : ps) if (i.pkgList != null) for (String q : i.pkgList) running.add(q);
            java.lang.reflect.Method stop = ActivityManager.class.getMethod("forceStopPackage", String.class);
            for (String p : HEAVY) if (!p.equals(keep) && running.contains(p)) { stop.invoke(am, p); android.util.Log.i("TREADCTL", "app geschlossen: " + p + " (vorne " + keep + ")"); }
        } catch (Throwable e) { android.util.Log.w("TREADCTL", "apps schliessen: " + e); }
    }

    static void trim(Context c) {
        long now = System.currentTimeMillis();
        if (now - lastAt < 60000) return;   // hoechstens einmal je Minute
        lastAt = now;
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            for (String p : HELPERS) am.killBackgroundProcesses(p);
        } catch (Throwable e) {}
    }
}
