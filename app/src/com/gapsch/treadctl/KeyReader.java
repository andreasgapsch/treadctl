// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.util.Log;
import java.io.FileInputStream;

/** Liest die Tasten und Drehregler der Konsole direkt aus dem Linux-Eingabesystem
 *  (alle /dev/input/event*, weitergegeben werden nur die Codes der Konsole, siehe isOurs).
 *  Die Herstellersoftware wertet sie nur in ihren eigenen Trainings aus; ohne diesen Leser
 *  waeren STOP, START/PAUSE und die Drehregler in unserer Steuerung wirkungslos.
 *  input_event: timeval (8 Byte im 32-Bit-Prozess, 16 Byte im 64-Bit-Prozess), type (u16), code (u16), value (s32). */
public class KeyReader {
    static final int EV_KEY = 1;
    static final int K_INCL_UP = 452, K_INCL_DOWN = 453, K_SPEED_DOWN = 454, K_SPEED_UP = 455, K_STOP = 251, K_GO = 252, K_SAFETY = 249;
    final Core core;

    KeyReader(Core c) { core = c; }

    final java.util.Set<String> open = java.util.Collections.synchronizedSet(new java.util.HashSet<String>());
    /** Alle Eingabegeraete lesen statt fester Nummern: ein beim Booten eingestecktes USB-Geraet verschiebt die Nummern.
     *  Weitergegeben werden nur die Codes der Konsole (siehe isOurs). Alle 10 s nach neuen Geraeten schauen. */
    void start() {
        new Thread(new Runnable() { public void run() {
            while (true) {
                String[] l = new java.io.File("/dev/input").list();
                if (l != null) for (String n : l) if (n.startsWith("event")) {
                    final String d = "/dev/input/" + n;
                    if (open.add(d)) new Thread(new Runnable() { public void run() { loop(d); } }, "keys-" + n).start();
                }
                try { Thread.sleep(10000); } catch (InterruptedException e) { return; }
            }
        } }, "keys-scan").start();
    }
    static boolean isOurs(int code) { return code == K_STOP || code == K_GO || code == K_SAFETY || (code >= K_INCL_UP && code <= K_SPEED_UP); }

    void loop(String dev) {
        String arch = System.getProperty("os.arch", "");
        final int SZ = arch.contains("64") ? 24 : 16, T = SZ - 8;   // Versatz von type
        byte[] b = new byte[SZ];
        while (true) {
            try (FileInputStream in = new FileInputStream(dev)) {
                core.log("tasten offen " + dev + " (" + SZ + " Byte)", 0);
                while (true) {
                    int n = 0;
                    while (n < SZ) { int r = in.read(b, n, SZ - n); if (r < 0) throw new Exception("ende"); n += r; }
                    int type = (b[T] & 0xff) | (b[T + 1] & 0xff) << 8, code = (b[T + 2] & 0xff) | (b[T + 3] & 0xff) << 8;
                    int value = (b[T + 4] & 0xff) | (b[T + 5] & 0xff) << 8 | (b[T + 6] & 0xff) << 16 | (b[T + 7] & 0xff) << 24;
                    if (type == EV_KEY && value == 1 && isOurs(code)) core.hwKey(code);   // nur Druck, nur Konsolentasten
                }
            } catch (Throwable e) {
                Log.w("TREADCTL", "tasten " + dev + ": " + e);
                if (!new java.io.File(dev).exists()) { open.remove(dev); return; }   // Geraet weg: die Suche oeffnet es neu, falls es wiederkommt
                if (String.valueOf(e).contains("EACCES")) return;   // nicht lesbar (bleibt in open, kein neuer Versuch)
                try { Thread.sleep(3000); } catch (InterruptedException ie) { return; }
            }
        }
    }
}
