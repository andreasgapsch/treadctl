// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.SharedPreferences;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import org.json.JSONObject;

/** Ventilator CYCPLUS F1 ueber Bluetooth LE (Nordic UART). Protokoll aus der Hersteller-App (Interoperabilitaet):
 *  App an Ventilator: 55 A5 | Laenge | Befehl | Folgenummer | Daten | Pruefsumme (16 Bit, ~Summe ab Laenge, big endian).
 *  Ventilator an App: AA 5A | gleicher Aufbau; jede Meldung wird mit Befehl 255 und ihrer Folgenummer quittiert.
 *  Befehle: 1 Stufe manuell (Stufe 0 heisst kleinste Drehzahl, nicht aus), 5 Modus (0 manuell),
 *  19 Schalter [wach 1 / schlafen 0, Smart-Start]; der Ventilator meldet ihn mit derselben Nummer.
 *  Die Steuerung folgt dem Lauf: aus in BEREIT und nach 20 s Pause, im Lauf aus Tempo, Steigung und Puls
 *  berechnet und sanft nachgefuehrt. */
public class FanControl {
    static final UUID SVC = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    static final UUID TX = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    static final UUID RX = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    static final UUID CCC = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    final Context ctx; final Core core; final SharedPreferences prefs;
    volatile String address, name, state = "aus";
    volatile boolean auto = true, awake = true;          // false = Handstufe bis zum Ende des Laufs
    volatile int manual = 40, sent = -1, target = 0;
    double level = 0; long pauseSince = 0; String lastSt = "";
    final Object ctl = new Object();   // Regelzustand (level, seq, manual, auto): HTTP-, Regel- und Bluetooth-Thread
    BluetoothGatt gatt; BluetoothGattCharacteristic tx;
    int seq = 0;
    final java.util.LinkedList<String> rx = new java.util.LinkedList<String>();   // letzte Meldungen des Ventilators (Fehlersuche)
    final LinkedBlockingQueue<byte[]> q = new LinkedBlockingQueue<byte[]>();
    volatile boolean writing; volatile long writeAt; int lastAck = -1; long lastAckAt; volatile long cmdAt; volatile int fanSays = -1, rpm;

    FanControl(Context c, Core core) {
        ctx = c; this.core = core; prefs = c.getSharedPreferences("fan", Context.MODE_PRIVATE);
        address = prefs.getString("address", ""); name = prefs.getString("name", "");
        auto = prefs.getBoolean("auto", true);
    }

    long downSince = 0;
    synchronized void dropGatt() { if (gatt != null) { try { gatt.close(); } catch (Throwable e) {} gatt = null; } tx = null; state = "aus"; sent = -1; }
    void start() {
        try { ctx.registerReceiver(new android.content.BroadcastReceiver() { @Override public void onReceive(android.content.Context c, android.content.Intent i) {
            int st = i.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1);
            if (st == BluetoothAdapter.STATE_TURNING_OFF || st == BluetoothAdapter.STATE_OFF) dropGatt();
            else if (st == BluetoothAdapter.STATE_ON && address.length() > 0) findConnect();
        } }, new android.content.IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)); } catch (Throwable e) {}
        if (address.length() > 0) findConnect();   // nach Neustart von Konsole oder Bluetooth kennt Android den Adresstyp nur per Suche
        new Thread(new Runnable() { public void run() {
            while (true) {
                try { Thread.sleep(100); pump(); } catch (Throwable e) {}
            }
        } }, "fan").start();
        new Thread(new Runnable() { public void run() {
            int k = 0;
            while (true) {
                try { Thread.sleep(2000); control(); } catch (Throwable e) {}
                // Wache alle 10 s: Bluetooth war aus, oder die Verbindung kommt 2 min nicht zustande: alte Verbindung verwerfen, neu verbinden
                if (++k % 5 == 0) try {
                    BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
                    if (address.length() == 0 || a == null || !a.isEnabled()) { downSince = 0; }
                    else if (tx != null) downSince = 0;
                    else {
                        long now = Core.clock(); if (downSince == 0) downSince = now;
                        if (now - downSince > 120000) { dropGatt(); downSince = now; core.log("ventilator neu verbinden", 0); }
                        if (gatt == null || "aus".equals(state)) findConnect();
                    }
                } catch (Throwable e) {}
            }
        } }, "fan-ctl").start();
    }

    // ---------------- Verbindung ----------------
    synchronized String connect(String addr, String nm, BluetoothDevice dev) {
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a == null || !a.isEnabled()) { state = "aus"; return Core.err("Bluetooth ist aus"); }
        if (!BluetoothAdapter.checkBluetoothAddress(addr)) return Core.err("Adresse ungültig");
        if (gatt != null) { try { gatt.close(); } catch (Throwable e) {} gatt = null; }
        address = addr; if (nm != null && nm.length() > 0) name = nm;
        prefs.edit().putString("address", address).putString("name", name).apply();
        state = "verbinde"; sent = -1; q.clear();
        gatt = (dev != null ? dev : a.getRemoteDevice(addr)).connectGatt(ctx, dev == null, cb, BluetoothDevice.TRANSPORT_LE);   // gefunden: direkt (schnell), sonst im Hintergrund
        core.log("ventilator verbinde " + name + (dev != null ? " (gefunden)" : ""), 0);
        return Core.ok();
    }
    synchronized String connect(String addr, String nm) { return connect(addr, nm, null); }
    /** Erst kurz suchen, dann mit dem gefundenen Geraet verbinden (richtiger Adresstyp); sonst direkt. */
    volatile boolean finding;
    void findConnect() {
        if (finding || address.length() == 0) return; finding = true; state = "verbinde";
        final String addr = address, nm = name;
        BleFind.find(addr, 12000, new BleFind.Found() { public void found(BluetoothDevice d) { finding = false; if (addr.equals(address)) connect(addr, nm, d); } });
    }
    /** Trennen: zuerst ausschalten und warten, bis das Paket draussen ist (hoechstens 1.5 s), erst dann trennen. */
    String forget() {
        if (gatt != null && tx != null) {
            synchronized (ctl) { setLevelNow(0); }
            long t0 = Core.clock();
            while ((!q.isEmpty() || writing) && Core.clock() - t0 < 1500) { try { Thread.sleep(50); } catch (InterruptedException e) { break; } }
        }
        synchronized (this) {
            if (gatt != null) { try { gatt.disconnect(); gatt.close(); } catch (Throwable e) {} gatt = null; }
            address = ""; name = ""; state = "aus"; tx = null; q.clear(); prefs.edit().remove("address").remove("name").apply();
        }
        return Core.ok();
    }

    /** Sucht 10 s nach einem CYCPLUS F1 (Name beginnt mit «F1_») und verbindet sich. */
    String scan() {
        final BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a == null || !a.isEnabled()) return Core.err("Bluetooth ist aus");
        state = "suche";
        final ScanCallback sc = new ScanCallback() {
            @Override public void onScanResult(int t, ScanResult r) {
                String n = r.getDevice().getName(); if (n == null && r.getScanRecord() != null) n = r.getScanRecord().getDeviceName();
                if (n != null && n.startsWith("F1_") && "suche".equals(state)) {
                    try { a.getBluetoothLeScanner().stopScan(this); } catch (Throwable e) {}
                    connect(r.getDevice().getAddress(), n, r.getDevice());
                }
            }
        };
        android.bluetooth.le.BluetoothLeScanner ls = a.getBluetoothLeScanner();
        if (ls == null) { state = "aus"; return Core.err("Bluetooth-Suche noch nicht bereit"); }   // kurz nach dem Einschalten
        try { ls.startScan(sc); } catch (Throwable e) { state = "aus"; return Core.err("Suche fehlgeschlagen"); }
        new Thread(new Runnable() { public void run() {
            try { Thread.sleep(10000); } catch (InterruptedException e) {}
            try { a.getBluetoothLeScanner().stopScan(sc); } catch (Throwable e) {}
            if ("suche".equals(state)) state = "nicht gefunden";
        } }).start();
        return Core.ok();
    }

    final BluetoothGattCallback cb = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int s, int ns) {
            if (ns == BluetoothProfile.STATE_CONNECTED) { state = "verbunden"; g.discoverServices(); }
            else if (ns == BluetoothProfile.STATE_DISCONNECTED) { state = address.length() > 0 ? "verbinde" : "aus"; tx = null; sent = -1; }
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int s) {
            BluetoothGattService sv = g.getService(SVC);
            if (sv == null) { state = "kein Ventilator"; return; }
            BluetoothGattCharacteristic t = sv.getCharacteristic(TX), rx = sv.getCharacteristic(RX);
            BluetoothGattDescriptor d = rx == null ? null : rx.getDescriptor(CCC);
            if (t == null || d == null) { state = "kein Ventilator"; return; }   // gleiche UUID, anderer Aufbau
            tx = t;
            g.setCharacteristicNotification(rx, true);
            d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            writing = true; writeAt = Core.clock(); g.writeDescriptor(d);
            synchronized (ctl) { send(5, new byte[]{0}); }        // Modus manuell: die Stufe kommt von uns
            state = "bereit"; sent = -1;
        }
        @Override public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int s) { writing = false; pump(); }
        @Override public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int s) { writing = false; pump(); }   // sofort weiter, sonst stauen sich die Quittungen
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            byte[] v = c.getValue();
            if (v == null || v.length < 7 || (v[0] & 0xff) != 0xAA || (v[1] & 0xff) != 0x5A) return;
            int id = v[3] & 0xff, sq = v[4] & 0xff;
            if (id != 255) synchronized (rx) { rx.add(Core.clock() % 100000 + " " + BleProbe.hex(v)); if (rx.size() > 30) rx.removeFirst(); }
            long now = Core.clock();
            if (id != 255 && (sq != lastAck || now - lastAckAt > 400)) { lastAck = sq; lastAckAt = now; q.offer(packet(255, new byte[0], sq)); }   // Quittung, sonst wiederholt der Ventilator die Meldung
            if (id == 11 && v.length > 6) rpm = (v[5] & 0xff) | ((v[6] & 0xff) << 8);   // Drehzahl
            if (id == 1 && v.length > 5) {                                // Stufe gemeldet: nach eigenem Befehl Echo, sonst Taste +/- am Ventilator
                int lv = v[5] & 0xff; fanSays = lv;
                if (sent > 0 && now - cmdAt > 3000 && Math.abs(lv - sent) > 2) handOverride(lv);
            }
            if (id == 19 && v.length > 5) {                               // Ein/Aus am Ventilator oder unser Schalter
                awake = (v[5] & 0xff) != 0;
                if (!awake && sent > 0) handOverride(0);                  // am Geraet ausgeschaltet: so lassen bis Laufende
            }
        }
    };

    // ---------------- Senden ----------------
    static byte[] packet(int id, byte[] payload, int sequence) {
        byte[] b = new byte[payload.length + 7];
        b[0] = 0x55; b[1] = (byte) 0xA5; b[2] = (byte) payload.length; b[3] = (byte) id; b[4] = (byte) sequence;
        System.arraycopy(payload, 0, b, 5, payload.length);
        int s = 0; for (int i = 2; i < payload.length + 5; i++) s += b[i] & 0xff;
        int c = ~s; b[payload.length + 5] = (byte) ((c >> 8) & 0xff); b[payload.length + 6] = (byte) (c & 0xff);
        return b;
    }
    void send(int id, byte[] payload) { seq = (seq + 1) & 0xff; if (seq == 0) seq = 1; q.offer(packet(id, payload, seq)); }

    /** Eine Nachricht nach der anderen (BLE erlaubt nur einen offenen Schreibvorgang). */
    synchronized void pump() {
        if (tx == null || gatt == null) return;
        if (writing && Core.clock() - writeAt < 1000) return;
        byte[] p = q.poll(); if (p == null) return;
        tx.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT); tx.setValue(p);
        writing = true; writeAt = Core.clock();
        if (!gatt.writeCharacteristic(tx)) writing = false;
    }

    /** 0 = aus (schlafen), sonst Stufe 5 bis 100 %; weckt den Ventilator bei Bedarf und setzt ihn auf manuell. */
    void setLevelNow(int pct) {
        pct = Math.max(0, Math.min(100, pct));
        if (pct == 0) { send(19, new byte[]{0, 0}); awake = false; sent = 0; return; }
        if (!awake) { send(19, new byte[]{1, 0}); send(5, new byte[]{0}); awake = true; }
        pct = Math.max(5, pct); send(1, new byte[]{(byte) pct}); sent = pct; cmdAt = Core.clock();
    }

    // ---------------- Regelung ----------------
    /** Zielstufe aus dem Lauf: Tempo (5 km/h ~ 15 %, 14 km/h ~ 87 %), Steigung (+2.5 % je %), Puls ueber 70 % HFmax (bis +25 %). */
    int autoTarget() {
        String st = core.st; long now = Core.clock();
        if (Core.LAEUFT.equals(st)) {
            if (core.holdLeft > 0) return 15;                                  // Einlaufen: schon wecken, kleinste Stufe
            double v = core.speed, inc = core.incline, t = 15 + (v - 5) * 8 + inc * 2.5;
            if (core.hrOk && core.hr > 0) t += Math.max(0, Math.min(1, (core.hr - 0.70 * core.hfmax) / (0.20 * core.hfmax))) * 25;
            return (int) Math.round(Math.max(15, Math.min(100, t)));
        }
        if (Core.PAUSE.equals(st) && now - pauseSince < 20000) return (int) Math.round(level);   // kurze Pause: weiter kuehlen
        return 0;
    }

    void control() { synchronized (ctl) { control0(); } }
    void control0() {
        core.fanLevel = tx == null ? -1 : Math.max(0, sent); core.fanAuto = auto; core.fanKnown = address.length() > 0;
        String st = core.st;
        if (!st.equals(lastSt)) {   // Zustandswechsel immer verfolgen, auch bei Handstufe und ohne Verbindung
            if (Core.PAUSE.equals(st)) pauseSince = Core.clock();
            if (!auto && Core.BEREIT.equals(st) && !"".equals(lastSt)) { auto = true; prefs.edit().putBoolean("auto", true).apply(); }   // Handstufe gilt bis Laufende
            lastSt = st;
        }
        if (tx == null) return;
        target = auto ? autoTarget() : manual;
        // sanft nachfuehren: hoechstens 8 % je 2 s, aus sofort
        if (target == 0) level = 0;
        else if (level == 0 && target > 0) level = Math.min(target, 30);
        else level += Math.max(-8, Math.min(8, target - level));
        int want = (int) Math.round(level);
        if (sent < 0 || Math.abs(want - sent) >= 3 || (want == 0) != (sent == 0) || (want > 0 && !awake)) setLevelNow(want);
    }

    void handOverride(int pct) { synchronized (ctl) { manual = pct; auto = false; level = pct; sent = pct; target = pct; } }

    String cmd(JSONObject j) {
        String a = j.optString("a");
        if ("scan".equals(a)) return scan();
        if ("connect".equals(a)) return connect(j.optString("address"), j.optString("name"));
        if ("forget".equals(a)) return forget();
        synchronized (ctl) { return cmd0(a, j); }
    }
    String cmd0(String a, JSONObject j) {
        if ("auto".equals(a)) { auto = true; prefs.edit().putBoolean("auto", true).apply(); return Core.ok(); }
        if ("level".equals(a)) { manual = Math.max(0, Math.min(100, j.optInt("v", 40))); auto = false; level = manual; setLevelNow(manual); return Core.ok(); }
        if ("step".equals(a)) { manual = Math.max(0, Math.min(100, (auto ? sent < 0 ? 0 : sent : manual) + j.optInt("d", 10))); auto = false; level = manual; setLevelNow(manual); return Core.ok(); }
        if ("off".equals(a)) { manual = 0; auto = false; level = 0; setLevelNow(0); return Core.ok(); }
        return Core.err("unbekannt");
    }

    String status() {
        try {
            JSONObject o = new JSONObject(); o.put("ok", true); o.put("state", state); o.put("name", name); o.put("address", address);
            o.put("auto", auto); o.put("level", Math.max(0, sent)); o.put("target", target); o.put("manual", manual);
            o.put("connected", tx != null); o.put("awake", awake); o.put("fanSays", fanSays); o.put("rpm", rpm);
            synchronized (rx) { o.put("rx", new org.json.JSONArray(rx)); }
            return o.toString();
        } catch (Throwable e) { return Core.err(String.valueOf(e)); }
    }
}
