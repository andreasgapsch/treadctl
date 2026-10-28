// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.security.SecureRandom;

/** Zufallstoken fuer Steuerbefehle. Wird bei jedem Dienststart neu erzeugt und
 *  in der privaten Datei der App abgelegt (nur uid system lesbar). Pille und
 *  Oberflaeche (eigene Prozesse, gleiche uid) lesen es von dort. */
public class Token {
    static volatile String cached;

    static File file(Context c) { return new File(c.getFilesDir(), "token"); }

    static void create(Context c) {
        byte[] b = new byte[32]; new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02x", x));
        try {
            File f = file(c), tmp = new File(f.getPath() + ".tmp");
            FileOutputStream o = new FileOutputStream(tmp); o.write(sb.toString().getBytes("UTF-8")); o.close();
            tmp.setReadable(false, false); tmp.setReadable(true, true);
            if (!tmp.renameTo(f)) throw new java.io.IOException("umbenennen");
            cached = sb.toString();
        } catch (Exception e) {
            // Schreiben gescheitert (z. B. Speicher voll): das vorhandene Token weiter verwenden. Ein neues nur im Speicher
            // wuerde Oberflaeche und Pille aussperren (sie lesen die Datei), nur das direkte STOP bliebe.
            String old = read(c); cached = old.length() >= 32 ? old : sb.toString();
        }
    }

    static String readCache = ""; static long readMod = -1;
    /** Token lesen; neu von der Platte nur, wenn sich die Datei geaendert hat (die Pille fragt bis zu 2.5-mal je Sekunde;
     *  ein neu gestarteter Dienst schreibt die Datei neu, dann wird sie wieder gelesen). */
    static synchronized String read(Context c) {
        try {
            File f = file(c); long m = f.lastModified();
            if (m == readMod && m != 0) return readCache;
            FileInputStream in = new FileInputStream(f); byte[] b = new byte[128]; int n = in.read(b); in.close();
            readCache = n > 0 ? new String(b, 0, n, "UTF-8").trim() : ""; readMod = m;
            return readCache;
        } catch (Exception e) { return ""; }
    }

    /** Vergleich in konstanter Zeit. */
    static boolean check(String given) {
        String t = cached;
        if (t == null || given == null) return false;
        return MessageDigest.isEqual(t.getBytes(), given.getBytes());
    }
}
