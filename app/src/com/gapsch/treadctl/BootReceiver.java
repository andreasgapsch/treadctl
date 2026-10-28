// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Startet Daemon und Overlay nach dem Booten und nach einem Update der App (sonst fehlen Pille und Tasten bis zum naechsten Neustart). */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) {
        try {
            ctx.startForegroundService(new Intent(ctx, TreadDaemon.class));
            ctx.startForegroundService(new Intent(ctx, OverlayService.class));
            Log.i("TREADCTL", "autostart nach Boot");
        } catch (Throwable e) { Log.e("TREADCTL", "boot: " + e); }
    }
}
