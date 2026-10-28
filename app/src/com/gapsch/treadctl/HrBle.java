// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.ParcelUuid;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Pulsmesser ueber Bluetooth LE (Standardprofil Heart Rate 0x180D): Brustgurt (z. B. Garmin HRM 600)
 *  oder Uhr mit «Herzfrequenz senden» (z. B. Forerunner). Ein gekoppeltes Geraet wird gemerkt und
 *  automatisch wieder verbunden. Laeuft im Dienstprozess, unabhaengig vom Herstellerempfaenger. */
public class HrBle {
    static final UUID HRS = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
    static final UUID HRM = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
    static final UUID CCC = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    final Context ctx; final Core core;
    final SharedPreferences prefs;
    volatile int hr; volatile long hrAt;
    volatile String state = "aus", name = "", address = "";
    volatile boolean scanning; long scanUntil;
    final LinkedHashMap<String, JSONObject> found = new LinkedHashMap<String, JSONObject>();
    BluetoothGatt gatt;

    HrBle(Context c, Core core) {
        ctx = c; this.core = core; prefs = c.getSharedPreferences("hr", Context.MODE_PRIVATE);
        address = prefs.getString("address", ""); name = prefs.getString("name", "");
    }

    BluetoothAdapter ad() { return BluetoothAdapter.getDefaultAdapter(); }

    /** Frischer Wert (hoechstens 3 s alt), sonst 0. */
    int value() { return Core.clock() - hrAt < 3000 ? hr : 0; }

    long downSince = 0;
    /** Alte Verbindung verwerfen (nach Bluetooth aus oder einem Neustart des Bluetooth-Stacks ist sie tot, der Zustand bliebe sonst «verbinde»). */
    synchronized void dropGatt() { if (gatt != null) { try { gatt.close(); } catch (Throwable e) {} gatt = null; } state = "aus"; }
    void startup() {
        if (address.length() > 0) findConnect();
        // Bluetooth aus: Verbindung schliessen; wieder an: neu verbinden
        try { ctx.registerReceiver(new android.content.BroadcastReceiver() { @Override public void onReceive(android.content.Context c, android.content.Intent i) {
            int st = i.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1);
            if (st == BluetoothAdapter.STATE_TURNING_OFF || st == BluetoothAdapter.STATE_OFF) dropGatt();
            else if (st == BluetoothAdapter.STATE_ON && address.length() > 0) findConnect();
        } }, new android.content.IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)); } catch (Throwable e) {}
        // Wache alle 10 s: Bluetooth war beim Start aus, oder eine Verbindung kommt 2 min nicht zustande: neu anlegen
        new Thread(new Runnable() { public void run() {
            while (true) {
                try { Thread.sleep(10000); } catch (InterruptedException e) { return; }
                try {
                    BluetoothAdapter a = ad(); if (address.length() == 0 || a == null || !a.isEnabled()) { downSince = 0; continue; }
                    if ("verbunden".equals(state)) { downSince = 0; continue; }
                    long now = Core.clock(); if (downSince == 0) downSince = now;
                    if (now - downSince > 120000) { dropGatt(); downSince = now; core.log("puls neu verbinden", 0); }
                    if (gatt == null || "aus".equals(state)) findConnect();
                } catch (Throwable e) {}
            }
        } }, "puls-wache").start();
    }

    synchronized String scan() {
        BluetoothAdapter a = ad();
        if (a == null || !a.isEnabled()) return Core.err("Bluetooth ist aus");
        BluetoothLeScanner s = a.getBluetoothLeScanner(); if (s == null) return Core.err("Bluetooth-Suche nicht verfügbar");
        found.clear(); scanning = true; scanUntil = Core.clock() + 15000;
        ArrayList<ScanFilter> f = new ArrayList<ScanFilter>(); f.add(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(HRS)).build());
        try { s.startScan(f, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCb); }
        catch (Throwable e) { scanning = false; return Core.err("Suche fehlgeschlagen: " + e.getMessage()); }
        new Thread(new Runnable() { public void run() {
            try { Thread.sleep(15000); } catch (InterruptedException e) {}
            stopScan();
        } }).start();
        core.log("puls suche", 0);
        return Core.ok();
    }
    synchronized void stopScan() {
        scanning = false;
        try { ad().getBluetoothLeScanner().stopScan(scanCb); } catch (Throwable e) {}
    }
    final ScanCallback scanCb = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult r) {
            try {
                BluetoothDevice d = r.getDevice(); String n = d.getName();
                if (n == null && r.getScanRecord() != null) n = r.getScanRecord().getDeviceName();
                JSONObject o = new JSONObject(); o.put("address", d.getAddress()); o.put("name", n == null ? "Pulsmesser" : n); o.put("rssi", r.getRssi());
                synchronized (HrBle.this) { found.put(d.getAddress(), o); }
            } catch (Throwable e) {}
        }
    };

    synchronized String connect(String addr, String nm) { return connect(addr, nm, null); }
    /** Erst kurz suchen, dann mit dem gefundenen Geraet verbinden (richtiger Adresstyp nach Neustart); sonst direkt. */
    volatile boolean finding;
    void findConnect() {
        if (finding || address.length() == 0) return; finding = true; state = "verbinde";
        final String addr = address, nm = name;
        BleFind.find(addr, 12000, new BleFind.Found() { public void found(BluetoothDevice d) { finding = false; if (addr.equals(address)) connect(addr, nm, d); } });
    }
    synchronized String connect(String addr, String nm, BluetoothDevice dev) {
        BluetoothAdapter a = ad();
        if (a == null || !a.isEnabled()) { state = "aus"; return Core.err("Bluetooth ist aus"); }
        if (!BluetoothAdapter.checkBluetoothAddress(addr)) return Core.err("Adresse ungültig");
        if (scanning) stopScan();
        if (gatt != null) { try { gatt.close(); } catch (Throwable e) {} gatt = null; }
        address = addr; if (nm != null && nm.length() > 0) name = nm;
        prefs.edit().putString("address", address).putString("name", name).apply();
        state = "verbinde";
        gatt = (dev != null ? dev : a.getRemoteDevice(addr)).connectGatt(ctx, dev == null, cb, BluetoothDevice.TRANSPORT_LE);   // gefunden: direkt (schnell), sonst im Hintergrund
        core.log("puls verbinde " + name, 0);
        return Core.ok();
    }

    synchronized String forget() {
        if (gatt != null) { try { gatt.disconnect(); gatt.close(); } catch (Throwable e) {} gatt = null; }
        address = ""; name = ""; state = "aus"; hr = 0;
        prefs.edit().clear().apply();
        return Core.ok();
    }

    final BluetoothGattCallback cb = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) { state = "verbunden"; g.discoverServices(); }
            else if (newState == BluetoothProfile.STATE_DISCONNECTED) { state = address.length() > 0 ? "verbinde" : "aus"; }   // autoConnect verbindet wieder
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int status) {
            try {
                BluetoothGattCharacteristic c = g.getService(HRS).getCharacteristic(HRM);
                g.setCharacteristicNotification(c, true);
                BluetoothGattDescriptor d = c.getDescriptor(CCC);
                d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE); g.writeDescriptor(d);
            } catch (Throwable e) { state = "kein Pulsdienst"; }
        }
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            byte[] v = c.getValue(); if (v == null || v.length < 2) return;
            int bpm = (v[0] & 1) != 0 && v.length >= 3 ? (v[1] & 0xff) | (v[2] & 0xff) << 8 : v[1] & 0xff;
            hr = bpm; hrAt = Core.clock(); state = "verbunden"; core.extHr = bpm; core.extHrAt = hrAt;
        }
    };

    /** Gekoppelte Audiogeraete (Lautsprecher, Kopfhoerer) mit Verbindungsstatus. */
    String audio() {
        try {
            JSONArray l = new JSONArray(); BluetoothAdapter a = ad();
            if (a != null && a.isEnabled()) for (BluetoothDevice d : a.getBondedDevices()) {
                if (d.getBluetoothClass() == null || d.getBluetoothClass().getMajorDeviceClass() != android.bluetooth.BluetoothClass.Device.Major.AUDIO_VIDEO) continue;
                boolean con = false;
                try { con = (Boolean) BluetoothDevice.class.getMethod("isConnected").invoke(d); } catch (Throwable e) {}
                JSONObject o = new JSONObject(); o.put("name", d.getName()); o.put("address", d.getAddress()); o.put("connected", con); l.put(o);
            }
            return new JSONObject().put("ok", true).put("audio", l).toString();
        } catch (Throwable e) { return Core.err(String.valueOf(e)); }
    }

    synchronized String status() {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true); o.put("state", state); o.put("name", name); o.put("address", address);
            o.put("hr", value()); o.put("scanning", scanning);
            BluetoothAdapter a = ad(); o.put("bt", a != null && a.isEnabled());
            JSONArray l = new JSONArray(); for (JSONObject f : found.values()) l.put(f); o.put("found", l);
            return o.toString();
        } catch (Throwable e) { return Core.err(String.valueOf(e)); }
    }
}
