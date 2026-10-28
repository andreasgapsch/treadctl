package com.gapsch.treadctl;

import android.content.Context;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** ESP32-S3 am USB als eigenes Bluetooth-Funkmodul (natives USB, USB-Serial-JTAG, 303A:1001, CDC-Datenschnittstelle).
 *  Zeilenprotokoll siehe esp32/src/main.cpp. Das Board vermittelt nur; Steuerbefehle laufen ueber FtmsServer.control
 *  durch die Regeln der Steuerung. Steuerleitungen (DTR/RTS) werden nie gesetzt: sie loesen beim ESP32 einen Neustart aus. */
public class UsbBridge {
    static final String T = "TREADCTL";
    static final int VID = 0x303A, PID = 0x1001;
    final Context ctx; final FtmsServer f;
    volatile boolean connected; volatile String fw = "";
    UsbDeviceConnection conn; UsbInterface dataIf; UsbEndpoint in, out;
    final Map<Integer, String> clients = new ConcurrentHashMap<Integer, String>();
    final Map<Integer, Integer> subs = new ConcurrentHashMap<Integer, Integer>();   // Verbindung -> Anzahl Abos
    volatile long lastRx, checkAt, blockedUntil; int resets; long resetWin;

    UsbBridge(Context c, FtmsServer f) { ctx = c; this.f = f; }

    void start() { new Thread(new Runnable() { public void run() { loop(); } }, "usb-esp32").start(); }

    void loop() {
        byte[] buf = new byte[512]; StringBuilder line = new StringBuilder();
        while (f.core.alive) {
            if (!connected) { FtmsServer.sleep(2000); if (f.on && Core.clock() > blockedUntil) open(); continue; }
            int n;
            try { n = conn.bulkTransfer(in, buf, buf.length, 300); } catch (Throwable e) { n = -2; }
            if (n > 0) {
                lastRx = Core.clock();
                for (int i = 0; i < n; i++) {
                    char ch = (char) (buf[i] & 0xFF);
                    if (ch == '\n') { handle(line.toString().trim()); line.setLength(0); }
                    else if (ch != '\r' && line.length() < 600) line.append(ch);
                }
            }
            long now = Core.clock();
            if (now - checkAt > 2000) {   // Anwesenheit und Lebenszeichen alle 2 s pruefen, nicht bei jedem leeren Lesen
                checkAt = now;
                if (!present()) close("getrennt");
                else if (now - lastRx > 6000) stalled(now);
            }
            if (!f.on) close("aus");
        }
    }

    /** Board antwortet nicht (Firmware haengt, USB bleibt aber angemeldet): Neustart ueber RTS; nach zwei Versuchen
     *  in einer Minute zurueck zum eigenen Bluetooth der Konsole, neuer Versuch nach 60 s. */
    void stalled(long now) {
        if (now - resetWin > 60000) { resetWin = now; resets = 0; }
        if (++resets > 2) { close("antwortet nicht, eigenes Bluetooth"); blockedUntil = now + 60000; return; }
        Log.w(T, "esp32: keine Antwort seit " + (now - lastRx) / 1000 + " s, Neustart");
        reset(); lastRx = now;
        FtmsServer.sleep(1500); hello();
    }
    /** Neustart des ESP32 ueber die USB-Serial-JTAG-Steuerleitungen: RTS an (DTR aus) haelt den Chip im Reset, RTS aus startet normal. */
    synchronized void reset() {
        try {
            UsbManager um = (UsbManager) ctx.getSystemService(Context.USB_SERVICE);
            int ifc = 0;
            for (UsbDevice d : um.getDeviceList().values()) if (d.getVendorId() == VID && d.getProductId() == PID)
                for (int i = 0; i < d.getInterfaceCount(); i++) if (d.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_COMM) ifc = d.getInterface(i).getId();
            conn.controlTransfer(0x21, 0x22, 0x02, ifc, null, 0, 300);
            FtmsServer.sleep(120);
            conn.controlTransfer(0x21, 0x22, 0x00, ifc, null, 0, 300);
        } catch (Throwable e) { Log.w(T, "esp32: Neustart " + e); }
    }

    boolean present() {
        try { UsbManager um = (UsbManager) ctx.getSystemService(Context.USB_SERVICE); for (UsbDevice d : um.getDeviceList().values()) if (d.getVendorId() == VID && d.getProductId() == PID) return true; }
        catch (Throwable e) {}
        return false;
    }

    synchronized void open() {
        try {
            UsbManager um = (UsbManager) ctx.getSystemService(Context.USB_SERVICE);
            UsbDevice dev = null;
            for (UsbDevice d : um.getDeviceList().values()) if (d.getVendorId() == VID && d.getProductId() == PID) dev = d;
            if (dev == null) return;
            if (!um.hasPermission(dev)) {   // System-App: Recht ohne Rueckfrage (verborgene API, MANAGE_USB)
                try { UsbManager.class.getMethod("grantPermission", UsbDevice.class).invoke(um, dev); } catch (Throwable e) { Log.w(T, "esp32: Recht " + e); }
            }
            UsbInterface di = null; UsbEndpoint ei = null, eo = null;
            for (int i = 0; i < dev.getInterfaceCount(); i++) {
                UsbInterface it = dev.getInterface(i);
                if (it.getInterfaceClass() != UsbConstants.USB_CLASS_CDC_DATA) continue;
                for (int k = 0; k < it.getEndpointCount(); k++) {
                    UsbEndpoint e = it.getEndpoint(k);
                    if (e.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                    if (e.getDirection() == UsbConstants.USB_DIR_IN) ei = e; else eo = e;
                }
                if (ei != null && eo != null) { di = it; break; }
            }
            if (di == null) { Log.w(T, "esp32: keine CDC-Datenschnittstelle"); return; }
            UsbDeviceConnection c = um.openDevice(dev);
            if (c == null) { Log.w(T, "esp32: oeffnen fehlgeschlagen"); return; }
            if (!c.claimInterface(di, true)) { c.close(); Log.w(T, "esp32: Schnittstelle belegt"); return; }
            conn = c; dataIf = di; in = ei; out = eo; clients.clear(); subs.clear(); lastRx = Core.clock();
            connected = true;
            Log.i(T, "esp32: verbunden");
            send("?"); hello();
            f.onRadio(true);
        } catch (Throwable e) { Log.w(T, "esp32: " + e); }
    }

    synchronized void close(String why) {
        if (!connected) return;
        connected = false;
        try { conn.releaseInterface(dataIf); conn.close(); } catch (Throwable e) {}
        conn = null; clients.clear(); subs.clear();
        Log.i(T, "esp32: " + why);
        f.onRadio(false);
    }

    /** Name und alle lesbaren Werte an das Board (nach dem Verbinden und bei Aenderungen). */
    void hello() {
        send("H " + f.name);
        for (UUID u : new UUID[] { FtmsData.FEATURE, FtmsData.SPEED_RANGE, FtmsData.INCL_RANGE, FtmsData.STATUS_TRAIN, FtmsData.RSC_FEAT, FtmsData.RSC_LOC }) {
            byte[] v = f.read(u); if (v != null) send("V " + u16(u) + " " + hex(v));
        }
    }

    void notifyAll(UUID u, byte[] v) { if (connected) send("N " + u16(u) + " " + hex(v)); }
    void ping() { if (connected) send("P"); }
    boolean hasClients() { return connected && !clients.isEmpty(); }

    synchronized void send(String s) {
        if (!connected || conn == null) return;
        byte[] b = (s + "\n").getBytes(StandardCharsets.US_ASCII);
        int r = conn.bulkTransfer(out, b, b.length, 300);
        if (r < 0) Log.w(T, "esp32: senden fehlgeschlagen");
    }

    void handle(String l) {
        if (l.length() < 1) return;
        String[] p = l.split(" ");
        try {
            switch (p[0]) {
                case "R": fw = p.length > 2 ? p[2] : ""; Log.i(T, "esp32: bereit, Firmware " + fw); break;
                case "A": break;   // Antwort auf das Lebenszeichen
                case "C": clients.put(Integer.parseInt(p[1]), p.length > 2 ? p[2] : ""); Log.i(T, "esp32: Gegenstelle " + l.substring(2)); break;
                case "X": { int c = Integer.parseInt(p[1]); clients.remove(c); subs.remove(c); Log.i(T, "esp32: getrennt " + c); break; }
                case "S": { int c = Integer.parseInt(p[1]); int on = Integer.parseInt(p[3]); Integer n = subs.get(c); subs.put(c, Math.max(0, (n == null ? 0 : n) + (on != 0 ? 1 : -1))); break; }
                case "W": {   // Steuerpunkt: Entscheid in der Steuerung, Antwort zurueck ans Board
                    byte[] r = f.control(unhex(p.length > 2 ? p[2] : ""), "App (Bluetooth)");
                    send("I " + p[1] + " " + hex(r)); break;   // Antwort nur an die App, die den Befehl geschickt hat
                }
                default: break;
            }
        } catch (Throwable e) { Log.w(T, "esp32: Zeile «" + l + "»: " + e); }
    }

    static String u16(UUID u) { return u.toString().substring(4, 8); }
    static String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x)); return s.toString(); }
    static byte[] unhex(String h) { int n = h.length() / 2; byte[] b = new byte[n]; for (int i = 0; i < n; i++) b[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16); return b; }
}
