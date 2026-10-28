package com.gapsch.treadctl;

import java.util.UUID;

/** FTMS (Fitness Machine Service 0x1826) und Laufsensor (Running Speed and Cadence 0x1814): Kodierung der
 *  Merkmale nach den Bluetooth-Spezifikationen, ohne Android-Abhaengigkeit (in coretest geprueft).
 *  Werte kleiner Endian, Aufloesungen laut Spezifikation. */
public class FtmsData {
    static UUID u16(int v) { return UUID.fromString(String.format("%08x-0000-1000-8000-00805f9b34fb", v)); }
    static final UUID FTMS = u16(0x1826), RSC = u16(0x1814), CCC = u16(0x2902);
    static final UUID FEATURE = u16(0x2ACC), TREAD = u16(0x2ACD), STATUS_TRAIN = u16(0x2AD3), SPEED_RANGE = u16(0x2AD4),
        INCL_RANGE = u16(0x2AD5), CONTROL = u16(0x2AD9), MACHINE = u16(0x2ADA);
    static final UUID RSC_MEAS = u16(0x2A53), RSC_FEAT = u16(0x2A54), RSC_LOC = u16(0x2A5D);
    // Wahoo-Run-Dienst: Zwift schickt die Steigung der Strecke hierueber (11 lo hi, sint16 in 0.01 %)
    static final UUID WAHOO = UUID.fromString("a026ee0e-0a7d-4ab3-97fa-f1500f9feb8b"), WAHOO_N = UUID.fromString("a026e03d-0a7d-4ab3-97fa-f1500f9feb8b"),
        WAHOO_W = UUID.fromString("a026e03e-0a7d-4ab3-97fa-f1500f9feb8b");
    /** Steigung aus einem Wahoo-Befehl in %, NaN wenn es keiner ist: 0x11 (0.01 %) oder 0x46 (0..65535 auf -100..100 %). */
    static double wahooGrade(byte[] b) {
        if (b == null || b.length < 3) return Double.NaN;
        int raw = (b[1] & 0xFF) | (b[2] & 0xFF) << 8;
        if ((b[0] & 0xFF) == 0x11) return (short) raw / 100.0;
        if ((b[0] & 0xFF) == 0x46) return (raw / 65535.0 * 2 - 1) * 100;
        return Double.NaN;
    }

    // Steuerpunkt: Befehle und Ergebnisse
    static final int OP_REQUEST = 0x00, OP_RESET = 0x01, OP_SPEED = 0x02, OP_INCL = 0x03, OP_START = 0x07, OP_STOP = 0x08, OP_SIM = 0x11, OP_RESPONSE = 0x80;
    static final int RES_OK = 0x01, RES_UNSUPPORTED = 0x02, RES_INVALID = 0x03, RES_FAILED = 0x04, RES_NOT_PERMITTED = 0x05;
    // Maschinenzustand (0x2ADA)
    static final int MS_RESET = 0x01, MS_STOP_PAUSE = 0x02, MS_SAFETY = 0x03, MS_START = 0x04, MS_SPEED = 0x05, MS_INCL = 0x06, MS_LOST = 0xFF;
    // Trainingszustand (0x2AD3)
    static final int TS_IDLE = 0x01, TS_WARMUP = 0x02, TS_MANUAL = 0x0D;

    static void le16(byte[] b, int i, int v) { b[i] = (byte) v; b[i + 1] = (byte) (v >> 8); }
    static void le24(byte[] b, int i, int v) { b[i] = (byte) v; b[i + 1] = (byte) (v >> 8); b[i + 2] = (byte) (v >> 16); }
    static int clamp(long v, int lo, int hi) { return (int) Math.max(lo, Math.min(hi, v)); }

    /** Treadmill Data (0x2ACD), 19 Byte, passt ohne groessere MTU in eine Meldung:
     *  Tempo, Gesamtdistanz, Steigung und Rampenwinkel, Energie, Puls (falls gueltig), verstrichene Zeit. */
    static byte[] treadmill(double kmh, double distKm, double inclPct, double kcal, int hr, boolean hrOk, double elapsedS) {
        int flags = (1 << 2) | (1 << 3) | (1 << 7) | (1 << 10) | (hrOk && hr > 0 ? 1 << 8 : 0);
        byte[] b = new byte[hrOk && hr > 0 ? 19 : 18]; int i = 0;
        le16(b, i, flags); i += 2;
        le16(b, i, clamp(Math.round(kmh * 100), 0, 0xFFFF)); i += 2;                       // 0.01 km/h
        le24(b, i, clamp(Math.round(distKm * 1000), 0, 0xFFFFFF)); i += 3;                  // m
        le16(b, i, clamp(Math.round(inclPct * 10), -32768, 32767)); i += 2;                 // 0.1 %
        le16(b, i, clamp(Math.round(Math.toDegrees(Math.atan(inclPct / 100.0)) * 10), -32768, 32767)); i += 2;   // 0.1 Grad
        le16(b, i, clamp(Math.round(kcal), 0, 0xFFFF)); i += 2;                              // kcal gesamt
        le16(b, i, 0xFFFF); i += 2; b[i++] = (byte) 0xFF;                                    // je Stunde, je Minute: nicht verfuegbar
        if (hrOk && hr > 0) b[i++] = (byte) clamp(hr, 0, 255);
        le16(b, i, clamp(Math.round(elapsedS), 0, 0xFFFF));
        return b;
    }

    /** Fitness Machine Feature (0x2ACC): Distanz, Steigung, Energie, Puls, Zeit; Sollwerte nur bei erlaubter Steuerung. */
    static byte[] feature(boolean control) {
        byte[] b = new byte[8];
        int f = (1 << 2) | (1 << 3) | (1 << 9) | (1 << 10) | (1 << 12);
        le16(b, 0, f); le16(b, 2, f >> 16);
        int t = control ? 0x03 : 0;   // Tempo- und Steigungssoll
        le16(b, 4, t); le16(b, 6, 0);
        return b;
    }
    /** Supported Speed Range (0x2AD4) in 0.01 km/h. */
    static byte[] speedRange(double min, double max) { byte[] b = new byte[6]; le16(b, 0, (int) Math.round(min * 100)); le16(b, 2, (int) Math.round(max * 100)); le16(b, 4, 10); return b; }
    /** Supported Inclination Range (0x2AD5) in 0.1 %. */
    static byte[] inclRange(double max) { byte[] b = new byte[6]; le16(b, 0, 0); le16(b, 2, (int) Math.round(max * 10)); le16(b, 4, 5); return b; }
    static byte[] training(int status) { return new byte[] { 0, (byte) status }; }
    static byte[] response(int op, int result) { return new byte[] { (byte) OP_RESPONSE, (byte) op, (byte) result }; }
    static byte[] machine(int code) { return new byte[] { (byte) code }; }
    static byte[] machineStop(boolean pause) { return new byte[] { (byte) MS_STOP_PAUSE, (byte) (pause ? 2 : 1) }; }
    static byte[] machineSpeed(double kmh) { byte[] b = new byte[3]; b[0] = (byte) MS_SPEED; le16(b, 1, (int) Math.round(kmh * 100)); return b; }
    static byte[] machineIncl(double pct) { byte[] b = new byte[3]; b[0] = (byte) MS_INCL; le16(b, 1, (int) Math.round(pct * 10)); return b; }

    /** Trainingszustand aus dem Zustand der Steuerung. */
    static int trainingStatus(String st, boolean hold) {
        if (!Core.LAEUFT.equals(st)) return TS_IDLE;
        return hold ? TS_WARMUP : TS_MANUAL;
    }

    /** Befehl am Steuerpunkt. Wert: Tempo in km/h, Steigung in %, Stop: 1 = Stopp, 2 = Pause; NaN ohne Wert. */
    static class Cp { int op; double v = Double.NaN; boolean bad; }
    static Cp parse(byte[] b) {
        Cp c = new Cp();
        if (b == null || b.length < 1) { c.bad = true; return c; }
        c.op = b[0] & 0xFF;
        if (c.op == OP_SPEED) { if (b.length < 3) c.bad = true; else c.v = ((b[1] & 0xFF) | (b[2] & 0xFF) << 8) / 100.0; }
        else if (c.op == OP_INCL) { if (b.length < 3) c.bad = true; else c.v = (short) ((b[1] & 0xFF) | (b[2] & 0xFF) << 8) / 10.0; }
        else if (c.op == OP_STOP) { c.v = b.length >= 2 ? (b[1] & 0xFF) : 1; }
        // Indoor Bike Simulation (Zwift): Wind sint16, Steigung sint16 in 0.01 %, Crr, Cw; fuer das Band zaehlt nur die Steigung
        else if (c.op == OP_SIM) { if (b.length < 5) c.bad = true; else c.v = (short) ((b[3] & 0xFF) | (b[4] & 0xFF) << 8) / 100.0; }
        return c;
    }

    /** Laufsensor: RSC Measurement (0x2A53) mit Tempo (1/256 m/s), Schrittfrequenz (geschaetzt) und Gesamtdistanz (0.1 m). */
    static byte[] rsc(double kmh, double distKm) {
        boolean running = kmh >= 7.0;
        byte[] b = new byte[8];
        b[0] = (byte) ((1 << 1) | (running ? 1 << 2 : 0));
        le16(b, 1, clamp(Math.round(kmh / 3.6 * 256), 0, 0xFFFF));
        b[3] = (byte) cadence(kmh);
        long d = Math.round(distKm * 10000);
        b[4] = (byte) d; b[5] = (byte) (d >> 8); b[6] = (byte) (d >> 16); b[7] = (byte) (d >> 24);
        return b;
    }
    /** Geschaetzte Schrittfrequenz je Minute: Gehen 100 bis 125, Laufen 155 bis 185; Stillstand 0. */
    static int cadence(double kmh) {
        if (kmh < 0.5) return 0;
        if (kmh < 7.0) return clamp(Math.round(95 + kmh * 4), 95, 125);
        return clamp(Math.round(150 + (kmh - 7) * 3), 150, 185);
    }
    static byte[] rscFeature() { return new byte[] { 0x06, 0x00 }; }   // Gesamtdistanz, Gehen/Laufen
    static byte[] rscLocation() { return new byte[] { 0x01 }; }      // auf dem Schuh (wie gaengige Laufsensoren, Garmin)

    /** Service-Daten der Werbung: verfuegbar, Laufband. */
    static byte[] advData() { return new byte[] { 0x01, 0x01, 0x00 }; }
}
