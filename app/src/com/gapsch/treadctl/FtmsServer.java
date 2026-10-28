package com.gapsch.treadctl;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.ParcelUuid;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/** Laufband als Bluetooth-Geraet fuer Apps und Uhren: FTMS (0x1826) und Laufsensor (RSC 0x1814) ueber das eigene
 *  Funkmodul der Konsole. Alle Befehle laufen durch die Regeln der Steuerung (Core.appCmd): nie Start, STOP immer,
 *  Tempo und Steigung nur, wenn der Laeufer es erlaubt. Der FTMS-Dienst des Herstellers wird angehalten, weil er
 *  an unseren Regeln vorbei direkt auf den Bus schreibt und sonst ein zweites 0x1826 im GATT steht. */
public class FtmsServer {
    static final String T = "TREADCTL";
    static final ComponentName JHT = new ComponentName("com.jht.atsoul.nezuko", "com.jht.atsoul.service.gattserver.GATTServerService");
    final Context ctx; final Core core; final SharedPreferences prefs;
    volatile boolean on, ctl, keepJht, dirconOn, lan; volatile String name, mfr; volatile float maxS, maxI;
    final Dircon dircon; final UsbBridge usb;
    volatile String state = "aus"; volatile boolean advertising;
    BluetoothGattServer server; BluetoothLeAdvertiser adv; String oldName;
    BluetoothGattCharacteristic cTread, cTrain, cCtrl, cMach, cRsc;
    final Map<String, Set<UUID>> subs = new HashMap<String, Set<UUID>>();   // Abos je Geraet (nur echte Gegenstellen, nicht Ventilator/Puls)
    final Map<String, String> names = new HashMap<String, String>();
    final Semaphore sent = new Semaphore(0);
    Thread loop; long lastManual; String lastSt = ""; int lastTrain = -1; volatile long advRestartAt;
    final Object tx = new Object();
    double lastWg = Double.NaN; int lastWr = -1;   // Bluetooth-Meldungen nacheinander (eine Bestaetigung je Meldung)

    FtmsServer(Context c, Core core) {
        ctx = c; this.core = core; prefs = c.getSharedPreferences("ftms", Context.MODE_PRIVATE);
        on = prefs.getBoolean("on", false); ctl = prefs.getBoolean("ctl", false); keepJht = prefs.getBoolean("keepJht", false);
        name = prefs.getString("name", "Tread Control"); maxS = prefs.getFloat("maxS", 14f); maxI = prefs.getFloat("maxI", 10f);
        dirconOn = prefs.getBoolean("dircon", false); lan = prefs.getBoolean("lan", false); mfr = prefs.getString("mfr", "Tread Control");
        dircon = new Dircon(c, this); dircon.lan = lan; usb = new UsbBridge(c, this);
        applyCore();
    }
    void applyCore() { core.appCtl = on && ctl; core.appMaxS = maxS; core.appMaxI = maxI; }

    void start() {
        IntentFilter f = new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED);
        ctx.registerReceiver(new BroadcastReceiver() { @Override public void onReceive(Context c, Intent i) {
            int s = i.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1);
            if (s == BluetoothAdapter.STATE_ON && on) new Thread(new Runnable() { public void run() { sleep(1500); restart(); } }).start();
            if (s == BluetoothAdapter.STATE_TURNING_OFF || s == BluetoothAdapter.STATE_OFF) close("Bluetooth aus");
        } }, f);
        loop = new Thread(new Runnable() { public void run() { run1(); } }, "ftms"); loop.start();
        // Hersteller-FTMS wirbt nach dem Booten sofort: gleich und nach 10 s anhalten, nicht erst im 30-s-Takt
        new Thread(new Runnable() { public void run() { jhtGuard(); sleep(10000); jhtGuard(); } }).start();
        if (on) restart();
        if (on && dirconOn) dircon.start(name);
        usb.start();   // ESP32-S3 am USB: uebernimmt Bluetooth, sobald es steckt
    }

    /** Hersteller-FTMS anhalten (Werbung aus, Dienst stoppen) bzw. auf Wunsch wieder starten. Gleiche UID, darum erlaubt. */
    void jhtGuard() {
        try {
            if (keepJht) return;
            if (!running("com.jhtp.atsoul.gattserverservice")) return;
            try { if (core.bus.isConnected()) core.bus.sendEvent("ACTION_FTMS_STOP_ADVERTISE"); } catch (Throwable e) {}
            Intent i = new Intent(); i.setComponent(JHT); ctx.stopService(i);
            Log.i(T, "ftms: Hersteller-FTMS angehalten");
        } catch (Throwable e) { Log.w(T, "ftms: hersteller " + e); }
    }
    boolean running(String proc) {
        try {
            android.app.ActivityManager am = (android.app.ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            for (android.app.ActivityManager.RunningServiceInfo s : am.getRunningServices(200))
                if (JHT.equals(s.service) && s.started) return true;
        } catch (Throwable e) {}
        return false;
    }
    void jhtRestore() { try { Intent i = new Intent(); i.setComponent(JHT); ctx.startService(i); Log.i(T, "ftms: Hersteller-FTMS wieder gestartet"); } catch (Throwable e) { Log.w(T, "ftms: " + e); } }

    // ---------------- Server ----------------
    synchronized void restart() {
        close(null);
        if (!on) { state = "aus"; return; }
        jhtGuard();
        if (usb.connected) { restoreName(); state = "Funkmodul ESP32"; return; }   // Bluetooth kommt vom Board
        try {
            BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
            if (a == null || !a.isEnabled()) { state = "Bluetooth aus"; return; }
            BluetoothManager bm = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
            server = bm.openGattServer(ctx, cb);
            if (server == null) { state = "fehler: kein GATT-Server"; return; }
            state = "startet";
            server.addService(ftmsService());   // RSC folgt in onServiceAdded (Android nimmt Dienste nur nacheinander an)
        } catch (Throwable e) { state = "fehler: " + e.getMessage(); Log.w(T, "ftms: " + e); }
    }
    synchronized void close(String why) {
        stopAdv();
        try { if (server != null) { server.clearServices(); server.close(); } } catch (Throwable e) {}
        server = null; synchronized (subs) { subs.clear(); names.clear(); }
        if (why != null) state = why;
    }

    BluetoothGattService ftmsService() {
        BluetoothGattService s = new BluetoothGattService(FtmsData.FTMS, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        s.addCharacteristic(ch(FtmsData.FEATURE, BluetoothGattCharacteristic.PROPERTY_READ, false));
        cTread = ch(FtmsData.TREAD, BluetoothGattCharacteristic.PROPERTY_NOTIFY, true); s.addCharacteristic(cTread);
        cTrain = ch(FtmsData.STATUS_TRAIN, BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_NOTIFY, true); s.addCharacteristic(cTrain);
        s.addCharacteristic(ch(FtmsData.SPEED_RANGE, BluetoothGattCharacteristic.PROPERTY_READ, false));
        s.addCharacteristic(ch(FtmsData.INCL_RANGE, BluetoothGattCharacteristic.PROPERTY_READ, false));
        cCtrl = ch(FtmsData.CONTROL, BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_INDICATE, true); s.addCharacteristic(cCtrl);
        cMach = ch(FtmsData.MACHINE, BluetoothGattCharacteristic.PROPERTY_NOTIFY, true); s.addCharacteristic(cMach);
        return s;
    }
    BluetoothGattService rscService() {
        BluetoothGattService s = new BluetoothGattService(FtmsData.RSC, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        cRsc = ch(FtmsData.RSC_MEAS, BluetoothGattCharacteristic.PROPERTY_NOTIFY, true); s.addCharacteristic(cRsc);
        s.addCharacteristic(ch(FtmsData.RSC_FEAT, BluetoothGattCharacteristic.PROPERTY_READ, false));
        s.addCharacteristic(ch(FtmsData.RSC_LOC, BluetoothGattCharacteristic.PROPERTY_READ, false));
        return s;
    }
    BluetoothGattService wahooService() {
        BluetoothGattService s = new BluetoothGattService(FtmsData.WAHOO, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        BluetoothGattCharacteristic n = ch(FtmsData.WAHOO_N, BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE | BluetoothGattCharacteristic.PROPERTY_NOTIFY, true);
        n.setValue(new byte[] { 0 }); s.addCharacteristic(n);
        s.addCharacteristic(ch(FtmsData.WAHOO_W, BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE | BluetoothGattCharacteristic.PROPERTY_INDICATE, true));
        return s;
    }
    static BluetoothGattCharacteristic ch(UUID u, int props, boolean ccc) {
        int perm = (props & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0 ? BluetoothGattCharacteristic.PERMISSION_WRITE | BluetoothGattCharacteristic.PERMISSION_READ : BluetoothGattCharacteristic.PERMISSION_READ;
        BluetoothGattCharacteristic c = new BluetoothGattCharacteristic(u, props, perm);
        if (ccc) c.addDescriptor(new BluetoothGattDescriptor(FtmsData.CCC, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
        return c;
    }

    void startAdv() {
        try {
            BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
            adv = a.getBluetoothLeAdvertiser();
            if (adv == null) { state = "fehler: keine Werbung moeglich"; return; }
            if (oldName == null) oldName = a.getName();
            if (oldName != null && !oldName.equals(name) && !prefs.contains("origName")) prefs.edit().putString("origName", oldName).apply();
            if (!name.equals(a.getName())) a.setName(name);   // Name, den Uhren und Apps anzeigen
            AdvertiseSettings st = new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)   // ~100 ms wie die Vorbilder: Apps finden das Band schneller
                .setConnectable(true).setTimeout(0).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM).build();
            AdvertiseData d = new AdvertiseData.Builder().setIncludeDeviceName(false)
                .addServiceUuid(new ParcelUuid(FtmsData.FTMS)).addServiceUuid(new ParcelUuid(FtmsData.RSC))
                .addServiceData(new ParcelUuid(FtmsData.FTMS), FtmsData.advData()).build();
            AdvertiseData scan = new AdvertiseData.Builder().setIncludeDeviceName(true).build();
            adv.startAdvertising(st, d, scan, advCb);
        } catch (Throwable e) { state = "fehler: " + e.getMessage(); Log.w(T, "ftms adv: " + e); }
    }
    void stopAdv() {
        try { if (adv != null) adv.stopAdvertising(advCb); } catch (Throwable e) {}
        advertising = false;
        if (!on) restoreName();
    }
    final AdvertiseCallback advCb = new AdvertiseCallback() {
        @Override public void onStartSuccess(AdvertiseSettings s) { advertising = true; state = "bereit"; Log.i(T, "ftms: Werbung aktiv als " + name); }
        @Override public void onStartFailure(int code) { advertising = false; if (code != ADVERTISE_FAILED_ALREADY_STARTED) { state = "fehler: Werbung " + code; Log.w(T, "ftms: Werbung " + code); } }
    };

    // ---------------- Rueckrufe ----------------
    final BluetoothGattServerCallback cb = new BluetoothGattServerCallback() {
        @Override public void onServiceAdded(int status, BluetoothGattService s) {
            if (status != BluetoothGatt.GATT_SUCCESS) { state = "fehler: Dienst " + status; return; }
            if (FtmsData.FTMS.equals(s.getUuid())) { try { server.addService(rscService()); } catch (Throwable e) {} }
            else if (FtmsData.RSC.equals(s.getUuid())) { try { server.addService(wahooService()); } catch (Throwable e) {} }
            else startAdv();
        }
        @Override public void onConnectionStateChange(BluetoothDevice d, int status, int ns) {
            if (ns == BluetoothProfile.STATE_DISCONNECTED) {
                boolean was; synchronized (subs) { was = subs.remove(d.getAddress()) != null; names.remove(d.getAddress()); }
                if (was) Log.i(T, "ftms: getrennt " + d.getAddress());
            }
            // Werbung weiter, damit Uhr und App gleichzeitig verbinden koennen; hoechstens alle 5 s (auch Ventilator und Puls melden sich hier)
            if (ns == BluetoothProfile.STATE_CONNECTED && on && server != null && Core.clock() - advRestartAt > 5000) { advRestartAt = Core.clock(); stopAdv(); startAdv(); }
        }
        @Override public void onCharacteristicReadRequest(BluetoothDevice d, int id, int off, BluetoothGattCharacteristic c) {
            byte[] v = read(c.getUuid());
            if (v == null) { server.sendResponse(d, id, BluetoothGatt.GATT_READ_NOT_PERMITTED, 0, null); return; }
            if (off > v.length) off = v.length;
            byte[] r = new byte[v.length - off]; System.arraycopy(v, off, r, 0, r.length);
            server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, off, r);
        }
        @Override public void onDescriptorReadRequest(BluetoothDevice d, int id, int off, BluetoothGattDescriptor ds) {
            boolean sub; synchronized (subs) { Set<UUID> s = subs.get(d.getAddress()); sub = s != null && s.contains(ds.getCharacteristic().getUuid()); }
            server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, 0, sub ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE : BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);
        }
        @Override public void onDescriptorWriteRequest(BluetoothDevice d, int id, BluetoothGattDescriptor ds, boolean prep, boolean resp, int off, byte[] v) {
            UUID cu = ds.getCharacteristic().getUuid(); boolean en = v != null && v.length > 0 && v[0] != 0;
            synchronized (subs) {
                Set<UUID> s = subs.get(d.getAddress()); if (s == null) { s = new HashSet<UUID>(); subs.put(d.getAddress(), s); }
                if (en) s.add(cu); else s.remove(cu);
                if (!names.containsKey(d.getAddress())) { String n = null; try { n = d.getName(); } catch (Throwable e) {} names.put(d.getAddress(), n == null || n.isEmpty() ? "App" : n); }
            }
            if (resp) server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, 0, v);
            Log.i(T, "ftms: " + d.getAddress() + (en ? " abonniert " : " beendet ") + cu.toString().substring(4, 8));
        }
        @Override public void onCharacteristicWriteRequest(BluetoothDevice d, int id, BluetoothGattCharacteristic c, boolean prep, boolean resp, int off, byte[] v) {
            if (FtmsData.WAHOO_W.equals(c.getUuid()) || FtmsData.WAHOO_N.equals(c.getUuid())) {
                if (resp) server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, 0, null);
                String who; synchronized (subs) { who = names.get(d.getAddress()); }
                wahooGrade(v, who == null ? "Zwift" : who); return;
            }
            if (!FtmsData.CONTROL.equals(c.getUuid())) { if (resp) server.sendResponse(d, id, BluetoothGatt.GATT_WRITE_NOT_PERMITTED, 0, null); return; }
            if (resp) server.sendResponse(d, id, BluetoothGatt.GATT_SUCCESS, 0, null);
            String who; synchronized (subs) { who = names.get(d.getAddress()); }
            send(d, cCtrl, control(v, who == null ? "App" : who), true);
        }
        @Override public void onNotificationSent(BluetoothDevice d, int status) { sent.release(); }
    };

    /** Befehl am Steuerpunkt (Bluetooth oder DIRCON) durch die Regeln der Steuerung; Antwort 0x80 fuer die App. */
    byte[] control(byte[] v, String who) {
        FtmsData.Cp cp = FtmsData.parse(v);
        // Steigung aus der Simulation (Zwift) wie ein Steigungsbefehl: Gefaelle wird 0, mehr als das Band kann wird begrenzt
        int op = cp.op == FtmsData.OP_SIM ? FtmsData.OP_INCL : cp.op; double val = cp.op == FtmsData.OP_SIM ? Math.max(0, Math.min(Core.I_MAX, cp.v)) : cp.v;
        int res = cp.bad ? FtmsData.RES_INVALID : core.appCmd(op, val, who);
        Log.i(T, "ftms: steuerpunkt " + cp.op + " " + cp.v + " von " + who + " -> " + res);
        if (res == FtmsData.RES_OK) {
            if (cp.op == FtmsData.OP_SPEED) emit(FtmsData.MACHINE, FtmsData.machineSpeed(Math.min(cp.v, core.appMaxS)));
            if (op == FtmsData.OP_INCL) emit(FtmsData.MACHINE, FtmsData.machineIncl(Math.max(0, Math.min(val, core.appMaxI))));
        }
        return FtmsData.response(cp.op, res);
    }
    /** Steigung von Zwift ueber den Wahoo-Run-Dienst (Bluetooth, DIRCON, ESP32): wie ein Steigungsbefehl durch die Regeln
     *  der Steuerung, Gefaelle wird 0, mehr als das Band kann wird begrenzt. Zwift erwartet keine Antwort. */
    int wahooGrade(byte[] v, String who) {
        double g = FtmsData.wahooGrade(v);
        if (Double.isNaN(g)) return FtmsData.RES_UNSUPPORTED;
        int res = core.appCmd(FtmsData.OP_INCL, Math.max(0, Math.min(Core.I_MAX, g)), who);
        if (g != lastWg || res != lastWr) { Log.i(T, "ftms: wahoo-steigung " + g + " von " + who + " -> " + res); lastWg = g; lastWr = res; }   // Zwift schickt sie fast jede Sekunde
        return res;
    }
    /** Funkmodul ESP32 gesteckt oder entfernt: eigenes Bluetooth der Konsole aus bzw. wieder an. */
    void onRadio(final boolean esp) {
        new Thread(new Runnable() { public void run() { restart(); if (esp) usb.hello(); } }).start();
    }
    void restoreName() {
        try { BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter(); String o = oldName != null ? oldName : prefs.getString("origName", null);
            if (o != null && a != null && !o.equals(a.getName())) a.setName(o); oldName = null; } catch (Throwable e) {}
    }
    void emit(UUID u, byte[] v) {
        BluetoothGattCharacteristic c = FtmsData.TREAD.equals(u) ? cTread : FtmsData.STATUS_TRAIN.equals(u) ? cTrain : FtmsData.MACHINE.equals(u) ? cMach : FtmsData.RSC_MEAS.equals(u) ? cRsc : null;
        if (c != null && server != null) toAll(c, v);
        dircon.notifyAll(u, v);
        usb.notifyAll(u, v);
    }

    byte[] read(UUID u) {
        if (FtmsData.FEATURE.equals(u)) return FtmsData.feature(core.appCtl);
        if (FtmsData.SPEED_RANGE.equals(u)) return FtmsData.speedRange(Core.S_MIN, Math.min(Core.S_MAX, maxS));
        if (FtmsData.INCL_RANGE.equals(u)) return FtmsData.inclRange(Math.min(Core.I_MAX, maxI));
        if (FtmsData.STATUS_TRAIN.equals(u)) return FtmsData.training(FtmsData.trainingStatus(core.st, core.holdLeft > 0));
        if (FtmsData.RSC_FEAT.equals(u)) return FtmsData.rscFeature();
        if (FtmsData.RSC_LOC.equals(u)) return FtmsData.rscLocation();
        return null;
    }

    /** Meldung an ein Geraet, wartet auf die Bestaetigung des Stacks (sonst gehen Meldungen verloren). */
    void send(BluetoothDevice d, BluetoothGattCharacteristic c, byte[] v, boolean indicate) {
        BluetoothGattServer s = server; if (s == null || c == null) return;
        boolean subd; synchronized (subs) { Set<UUID> x = subs.get(d.getAddress()); subd = x != null && x.contains(c.getUuid()); }
        if (!subd) return;
        synchronized (tx) { try { sent.drainPermits(); c.setValue(v); if (s.notifyCharacteristicChanged(d, c, indicate)) sent.tryAcquire(300, TimeUnit.MILLISECONDS); } catch (Throwable e) {} }
    }
    void toAll(BluetoothGattCharacteristic c, byte[] v) {
        BluetoothGattServer s = server; if (s == null) return;
        String[] ads; synchronized (subs) { ads = subs.keySet().toArray(new String[0]); }
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        for (String ad : ads) { try { send(a.getRemoteDevice(ad), c, v, false); } catch (Throwable e) {} }
    }

    /** Takt 1 s: Laufwerte, Laufsensor, Zustandswechsel; alle 30 s Hersteller-FTMS pruefen. */
    void run1() {
        int n = 0;
        while (core.alive) {
            sleep(1000); n++;
            try {
                usb.ping(); if (n % 10 == 0 && usb.connected) usb.values();   // Lebenszeichen und lesbare Werte fuer das Board
                if (n % 30 == 0) { if (!keepJht) jhtGuard(); if (on && server == null && !usb.connected && !state.startsWith("Bluetooth aus")) restart(); }
                boolean any; synchronized (subs) { any = server != null && !subs.isEmpty(); }
                if (!any && !dircon.hasClients() && !usb.hasClients()) continue;
                String st = core.st;
                emit(FtmsData.TREAD, FtmsData.treadmill(core.speed, core.dist, core.incline, core.kcal, core.hr, core.hrOk, core.elapsed));
                emit(FtmsData.RSC_MEAS, FtmsData.rsc(Core.LAEUFT.equals(st) ? core.speed : 0, core.dist));
                int tr = FtmsData.trainingStatus(st, core.holdLeft > 0);
                if (tr != lastTrain) { emit(FtmsData.STATUS_TRAIN, FtmsData.training(tr)); lastTrain = tr; }
                if (!st.equals(lastSt)) {
                    if (Core.LAEUFT.equals(st)) emit(FtmsData.MACHINE, FtmsData.machine(FtmsData.MS_START));
                    else if (Core.PAUSE.equals(st)) emit(FtmsData.MACHINE, FtmsData.machineStop(true));
                    else if (Core.LAEUFT.equals(lastSt) || Core.PAUSE.equals(lastSt)) emit(FtmsData.MACHINE, core.pulled == 1 ? FtmsData.machine(FtmsData.MS_SAFETY) : FtmsData.machineStop(false));
                    lastSt = st;
                }
                // Handeingabe an der Konsole: App verliert die Steuerung (30 s Vorrang)
                if (core.manualAt != lastManual) { if (lastManual != 0 && core.appAt > 0) emit(FtmsData.MACHINE, FtmsData.machine(FtmsData.MS_LOST)); lastManual = core.manualAt; }
            } catch (Throwable e) { Log.w(T, "ftms takt: " + e); }
        }
    }

    // ---------------- Schnittstelle ----------------
    String status() {
        try {
            JSONObject o = new JSONObject(); o.put("ok", true);
            o.put("on", on); o.put("ctl", ctl); o.put("keepJht", keepJht); o.put("name", name); o.put("mfr", mfr); o.put("maxS", maxS); o.put("maxI", maxI);
            o.put("state", state); o.put("advertising", advertising);
            JSONArray cl = new JSONArray(); synchronized (subs) { for (Map.Entry<String, Set<UUID>> e : subs.entrySet()) if (!e.getValue().isEmpty()) cl.put(new JSONObject().put("addr", e.getKey()).put("name", names.get(e.getKey()))); }
            for (Dircon.Client c : dircon.clients) cl.put(new JSONObject().put("addr", String.valueOf(c.s.getInetAddress())).put("name", c.who).put("wlan", true));
            o.put("clients", cl);
            o.put("dircon", dirconOn); o.put("lan", lan); o.put("dirconState", dircon.state);
            o.put("radio", usb.connected ? "esp32" : "konsole"); if (usb.connected) o.put("espFw", usb.fw);
            for (Map.Entry<Integer, String> e : usb.clients.entrySet()) cl.put(new JSONObject().put("addr", e.getValue()).put("name", "Bluetooth (ESP32)").put("esp", true));
            return o.toString();
        } catch (Throwable e) { return Core.err(String.valueOf(e)); }
    }
    String cmd(JSONObject j) {
        boolean wasOn = on, wasKeep = keepJht, wasDc = dirconOn, wasLan = lan; String wasName = name;
        if (j.has("on")) on = j.optBoolean("on");
        if (j.has("ctl")) ctl = j.optBoolean("ctl");
        if (j.has("keepJht")) keepJht = j.optBoolean("keepJht");
        if (j.has("dircon")) dirconOn = j.optBoolean("dircon");
        if (j.has("lan")) { lan = j.optBoolean("lan"); dircon.lan = lan; }
        if (j.has("name")) { String n = j.optString("name").replaceAll("[^\\p{L}\\p{N} _.-]", "").trim(); if (n.length() > 0) name = n.length() > 20 ? n.substring(0, 20) : n; }
        if (j.has("mfr")) { String m = j.optString("mfr").replaceAll("[^\\p{L}\\p{N} _.-]", "").trim(); if (m.length() > 0) mfr = m.length() > 30 ? m.substring(0, 30) : m; }
        if (j.has("origName")) { String o = j.optString("origName").trim(); if (o.length() > 0 && o.length() <= 40) prefs.edit().putString("origName", o).apply(); }   // urspruenglicher Name der Konsole
        if (j.has("maxS")) maxS = (float) Math.max(Core.S_MIN, Math.min(Core.S_MAX, j.optDouble("maxS", maxS)));
        if (j.has("maxI")) maxI = (float) Math.max(0, Math.min(Core.I_MAX, j.optDouble("maxI", maxI)));
        prefs.edit().putBoolean("on", on).putBoolean("ctl", ctl).putBoolean("keepJht", keepJht).putString("name", name)
            .putFloat("maxS", maxS).putFloat("maxI", maxI).putBoolean("dircon", dirconOn).putBoolean("lan", lan).putString("mfr", mfr).apply();
        applyCore();
        if (keepJht && !wasKeep) jhtRestore();
        if (usb.connected) new Thread(new Runnable() { public void run() { usb.hello(); } }).start();   // Name, Grenzen, Steuerung ans Board
        if (on != wasOn || (on && !name.equals(wasName))) { final boolean o = on; new Thread(new Runnable() { public void run() { if (o) restart(); else { close("aus"); stopAdv(); } } }).start(); }
        boolean dcNow = on && dirconOn, dcWas = wasOn && wasDc;
        if (dcNow != dcWas || (dcNow && (!name.equals(wasName) || lan != wasLan))) { final boolean d = dcNow; final String n = name; new Thread(new Runnable() { public void run() { if (d) dircon.start(n); else dircon.stop(); } }).start(); }
        return status();
    }
    static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException e) {} }
}
