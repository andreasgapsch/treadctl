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
