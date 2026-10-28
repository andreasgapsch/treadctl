package com.gapsch.treadctl;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;

/** DIRCON (Wahoo Direct Connect): dieselben FTMS- und Laufsensor-Merkmale wie ueber Bluetooth, aber ueber TCP im WLAN.
 *  Noetig fuer Apps auf der Konsole selbst (Bluetooth verbindet nicht mit sich selbst). Gefunden per mDNS
 *  `_wahoo-fitness-tnp._tcp`, Port 36866. Kopf: Version 1, Nachricht, Folgenummer, Antwortcode, Laenge (2 Byte, gross).
 *  UUIDs als 16 Byte in Textreihenfolge. Standardmaessig nur Verbindungen von der Konsole selbst (lan = false). */
public class Dircon {
    static final String T = "TREADCTL";
    static final int PORT = 36866;
    static final int M_SERVICES = 1, M_CHARS = 2, M_READ = 3, M_WRITE = 4, M_NOTIFY_EN = 5, M_NOTIFY = 6, M_07 = 7;
    static final int R_OK = 0, R_UNKNOWN = 1, R_ERROR = 2, R_NO_SERVICE = 3, R_NO_CHAR = 4, R_NOT_SUPPORTED = 5, R_WRITE_FAILED = 6;
    static final int P_READ = 1, P_WRITE = 2, P_NOTIFY = 4, P_INDICATE = 8;
    // Dienst -> Merkmale mit Eigenschaften (wie im Bluetooth-Server)
    static final UUID[] SERVICES = { FtmsData.FTMS, FtmsData.RSC };
    static final Object[][] CHARS = {
        { FtmsData.FTMS, FtmsData.FEATURE, P_READ }, { FtmsData.FTMS, FtmsData.TREAD, P_NOTIFY },
        { FtmsData.FTMS, FtmsData.STATUS_TRAIN, P_READ | P_NOTIFY }, { FtmsData.FTMS, FtmsData.SPEED_RANGE, P_READ },
        { FtmsData.FTMS, FtmsData.INCL_RANGE, P_READ }, { FtmsData.FTMS, FtmsData.CONTROL, P_WRITE | P_INDICATE },
        { FtmsData.FTMS, FtmsData.MACHINE, P_NOTIFY },
        { FtmsData.RSC, FtmsData.RSC_MEAS, P_NOTIFY }, { FtmsData.RSC, FtmsData.RSC_FEAT, P_READ }, { FtmsData.RSC, FtmsData.RSC_LOC, P_READ } };

    final Context ctx; final FtmsServer f;
    volatile boolean lan; volatile String state = "aus";
    ServerSocket ss; NsdManager.RegistrationListener reg;
    final CopyOnWriteArrayList<Client> clients = new CopyOnWriteArrayList<Client>();

    /** Gegenstelle mit eigener Sendewarteschlange: ein langsamer oder toter Client blockiert nie den gemeinsamen Takt
     *  (Bluetooth, ESP32). Laeuft die Warteschlange voll (rund 30 s Meldungen), wird er getrennt. */
    class Client {
        final Socket s; final OutputStream out; final String who;
        final Set<UUID> subs = Collections.synchronizedSet(new HashSet<UUID>());
        final LinkedBlockingQueue<byte[]> q = new LinkedBlockingQueue<byte[]>(96);
        volatile boolean open = true;
        Client(Socket s, String who) throws IOException {
            this.s = s; out = s.getOutputStream(); this.who = who;
            new Thread(new Runnable() { public void run() { write(); } }, "dircon-w").start();
        }
        void send(int id, int seq, int code, byte[] data) {
            int n = data == null ? 0 : data.length; byte[] b = new byte[6 + n];
            b[0] = 1; b[1] = (byte) id; b[2] = (byte) seq; b[3] = (byte) code; b[4] = (byte) (n >> 8); b[5] = (byte) n;
            if (n > 0) System.arraycopy(data, 0, b, 6, n);
            if (open && !q.offer(b)) { Log.w(T, "dircon: Client liest nicht, getrennt"); close(); }
        }
        void write() {
            try { while (open) { byte[] b = q.take(); out.write(b); out.flush(); } } catch (Throwable e) {}
            close();
        }
        void close() {
            if (!open) return;
            open = false; q.clear(); q.offer(new byte[0]);   // weckt den Schreiber
            try { s.close(); } catch (Throwable e) {} clients.remove(this);
        }
    }

    Dircon(Context c, FtmsServer f) { ctx = c; this.f = f; }

    synchronized void start(final String name) {
        stop();
        try {
            ss = new ServerSocket(); ss.setReuseAddress(true); ss.bind(new InetSocketAddress(PORT), 4);
            final ServerSocket me = ss;
            new Thread(new Runnable() { public void run() { accept(me); } }, "dircon").start();
            register(name);
            state = "bereit";
        } catch (Throwable e) { state = "fehler: " + e.getMessage(); Log.w(T, "dircon: " + e); }
    }
    synchronized void stop() {
        try { if (reg != null) ((NsdManager) ctx.getSystemService(Context.NSD_SERVICE)).unregisterService(reg); } catch (Throwable e) {}
        reg = null;
        try { if (ss != null) ss.close(); } catch (Throwable e) {}
        ss = null;
        for (Client c : clients) c.close();
        state = "aus";
    }
    boolean hasClients() { return !clients.isEmpty(); }

    void register(String name) {
        NsdServiceInfo si = new NsdServiceInfo();
        si.setServiceName(name.replace(' ', '-'));   // manche Apps setzen Leerzeichen in Bindestriche um
        si.setServiceType("_wahoo-fitness-tnp._tcp"); si.setPort(PORT);
        si.setAttribute("ble-service-uuids", (FtmsData.FTMS + "," + FtmsData.RSC).toUpperCase(java.util.Locale.ROOT));
        si.setAttribute("mac-address", "00:00:00:00:00:00");
        si.setAttribute("serial-number", "treadctl");
        reg = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo s) { Log.i(T, "dircon: mDNS als " + s.getServiceName()); }
            @Override public void onRegistrationFailed(NsdServiceInfo s, int e) { state = "fehler: mDNS " + e; Log.w(T, "dircon: mDNS " + e); }
            @Override public void onServiceUnregistered(NsdServiceInfo s) {}
            @Override public void onUnregistrationFailed(NsdServiceInfo s, int e) {}
        };
        ((NsdManager) ctx.getSystemService(Context.NSD_SERVICE)).registerService(si, NsdManager.PROTOCOL_DNS_SD, reg);
    }

    /** Nur die Konsole selbst, ausser lan: Gegenstelle muss eine eigene Adresse haben. */
    boolean allowed(InetAddress a) {
        if (lan || a.isLoopbackAddress()) return true;
        try { return NetworkInterface.getByInetAddress(a) != null; } catch (Throwable e) { return false; }
    }

    void accept(ServerSocket me) {
        while (!me.isClosed()) {
            try {
                final Socket s = me.accept();
                if (!allowed(s.getInetAddress()) || clients.size() >= 4) { Log.i(T, "dircon: abgewiesen " + s.getInetAddress()); s.close(); continue; }
                s.setTcpNoDelay(true); s.setKeepAlive(true); s.setSoTimeout(0);
                final Client c = new Client(s, "App (WLAN)"); clients.add(c);
                Log.i(T, "dircon: verbunden " + s.getInetAddress());
                new Thread(new Runnable() { public void run() { serve(c); } }, "dircon-c").start();
            } catch (Throwable e) { if (!me.isClosed()) Log.w(T, "dircon accept: " + e); }
        }
    }

    void serve(Client c) {
        try {
            DataInputStream in = new DataInputStream(c.s.getInputStream());
            byte[] h = new byte[6];
            while (true) {
                in.readFully(h);
                int id = h[1] & 0xFF, seq = h[2] & 0xFF, len = (h[4] & 0xFF) << 8 | (h[5] & 0xFF);
                if (len > 512) break;
                byte[] d = new byte[len]; in.readFully(d);
                handle(c, id, seq, d);
            }
        } catch (Throwable e) {}
        Log.i(T, "dircon: getrennt " + c.s.getInetAddress());
        c.close();
    }

    void handle(Client c, int id, int seq, byte[] d) {
        switch (id) {
            case M_SERVICES: {
                ByteBuffer b = ByteBuffer.allocate(16 * SERVICES.length); for (UUID u : SERVICES) b.put(uuid(u));
                c.send(id, seq, R_OK, b.array()); return;
            }
            case M_CHARS: {
                if (d.length < 16) { c.send(id, seq, R_ERROR, null); return; }
                UUID svc = uuid(d, 0); int n = 0;
                for (Object[] x : CHARS) if (x[0].equals(svc)) n++;
                if (n == 0) { c.send(id, seq, R_NO_SERVICE, null); return; }
                ByteBuffer b = ByteBuffer.allocate(16 + 17 * n); b.put(uuid(svc));
                for (Object[] x : CHARS) if (x[0].equals(svc)) { b.put(uuid((UUID) x[1])); b.put((byte) (int) (Integer) x[2]); }
                c.send(id, seq, R_OK, b.array()); return;
            }
            case M_READ: {
                if (d.length < 16) { c.send(id, seq, R_ERROR, null); return; }
                UUID u = uuid(d, 0); Integer p = props(u);
                if (p == null) { c.send(id, seq, R_NO_CHAR, null); return; }
                byte[] v = f.read(u);
                if ((p & P_READ) == 0 || v == null) { c.send(id, seq, R_NOT_SUPPORTED, null); return; }
                c.send(id, seq, R_OK, cat(uuid(u), v)); return;
            }
            case M_WRITE: {
                if (d.length < 17) { c.send(id, seq, R_ERROR, null); return; }
                UUID u = uuid(d, 0); Integer p = props(u);
                if (p == null) { c.send(id, seq, R_NO_CHAR, null); return; }
                if ((p & P_WRITE) == 0) { c.send(id, seq, R_NOT_SUPPORTED, null); return; }
                byte[] v = new byte[d.length - 16]; System.arraycopy(d, 16, v, 0, v.length);
                c.send(id, seq, R_OK, uuid(u));
                byte[] r = f.control(v, c.who);   // Antwort des Steuerpunkts als Meldung, wie eine Bluetooth-Anzeige
                if (c.subs.contains(FtmsData.CONTROL)) c.send(M_NOTIFY, 0, R_OK, cat(uuid(FtmsData.CONTROL), r));
                return;
            }
            case M_NOTIFY_EN: {
                if (d.length < 17) { c.send(id, seq, R_ERROR, null); return; }
                UUID u = uuid(d, 0); Integer p = props(u);
                if (p == null) { c.send(id, seq, R_NO_CHAR, null); return; }
                if ((p & (P_NOTIFY | P_INDICATE)) == 0) { c.send(id, seq, R_NOT_SUPPORTED, null); return; }
                if (d[16] != 0) c.subs.add(u); else c.subs.remove(u);
                c.send(id, seq, R_OK, uuid(u));
                Log.i(T, "dircon: " + (d[16] != 0 ? "abonniert " : "beendet ") + u.toString().substring(4, 8));
                return;
            }
            case M_07: c.send(id, seq, R_OK, null); return;
            default: c.send(id, seq, R_UNKNOWN, null);
        }
    }

    /** Meldung an alle Gegenstellen, die das Merkmal abonniert haben. */
    void notifyAll(UUID u, byte[] v) {
        byte[] p = null;
        for (Client c : clients) if (c.subs.contains(u)) { if (p == null) p = cat(uuid(u), v); c.send(M_NOTIFY, 0, R_OK, p); }
    }

    static Integer props(UUID u) { for (Object[] x : CHARS) if (x[1].equals(u)) return (Integer) x[2]; return null; }
    static byte[] uuid(UUID u) { ByteBuffer b = ByteBuffer.allocate(16); b.putLong(u.getMostSignificantBits()); b.putLong(u.getLeastSignificantBits()); return b.array(); }
    static UUID uuid(byte[] d, int off) { ByteBuffer b = ByteBuffer.wrap(d, off, 16); return new UUID(b.getLong(), b.getLong()); }
    static byte[] cat(byte[] a, byte[] b) { byte[] r = new byte[a.length + b.length]; System.arraycopy(a, 0, r, 0, a.length); System.arraycopy(b, 0, r, a.length, b.length); return r; }
}
