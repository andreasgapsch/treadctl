// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import java.util.LinkedHashMap;
import org.json.JSONArray;
import org.json.JSONObject;

/** Werkzeug zum Einbinden neuer Bluetooth-Geraete (z. B. Ventilator): alle Geraete in der Naehe auflisten,
 *  Dienste und Merkmale eines Geraets auslesen, testweise Werte schreiben und Meldungen mitlesen.
 *  Nur ueber die Token-geschuetzte API erreichbar. */
public class BleProbe {
    final Context ctx; final Core core;
    final LinkedHashMap<String, JSONObject> found = new LinkedHashMap<String, JSONObject>();
    volatile boolean scanning; BluetoothGatt gatt; volatile String state = "aus";
    final JSONArray log = new JSONArray(); JSONArray services = new JSONArray();
    final java.util.HashMap<String, String> lastNotify = new java.util.HashMap<String, String>();

    BleProbe(Context c, Core core) { ctx = c; this.core = core; }

    synchronized String scan() {
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a == null || !a.isEnabled()) return Core.err("Bluetooth ist aus");
        android.bluetooth.le.BluetoothLeScanner ls = a.getBluetoothLeScanner();
        if (ls == null) return Core.err("Bluetooth-Suche noch nicht bereit");
        found.clear(); scanning = true;
        try { ls.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), cb); } catch (Throwable e) { scanning = false; return Core.err("Suche fehlgeschlagen"); }
        new Thread(new Runnable() { public void run() {
            try { Thread.sleep(12000); } catch (InterruptedException e) {}
            try { BluetoothAdapter.getDefaultAdapter().getBluetoothLeScanner().stopScan(cb); } catch (Throwable e) {}
            scanning = false;
        } }).start();
        return Core.ok();
    }
    final ScanCallback cb = new ScanCallback() {
        @Override public void onScanResult(int t, ScanResult r) {
            try {
                String n = r.getDevice().getName(); if (n == null && r.getScanRecord() != null) n = r.getScanRecord().getDeviceName();
                JSONObject o = new JSONObject(); o.put("address", r.getDevice().getAddress()); o.put("name", n == null ? "" : n); o.put("rssi", r.getRssi());
                if (r.getScanRecord() != null) {
                    o.put("uuids", String.valueOf(r.getScanRecord().getServiceUuids()));
                    byte[] raw = r.getScanRecord().getBytes(); o.put("raw", hex(raw));
                }
                synchronized (BleProbe.this) { found.put(r.getDevice().getAddress(), o); }
            } catch (Throwable e) {}
        }
    };

    synchronized String connect(String addr) {
        if (gatt != null) { try { gatt.close(); } catch (Throwable e) {} gatt = null; }
        services = new JSONArray(); state = "verbinde";
        BluetoothDevice d = BluetoothAdapter.getDefaultAdapter().getRemoteDevice(addr);
        gatt = d.connectGatt(ctx, false, gcb, BluetoothDevice.TRANSPORT_LE);
        return Core.ok();
    }
    synchronized String close() { if (gatt != null) { try { gatt.disconnect(); gatt.close(); } catch (Throwable e) {} gatt = null; } state = "aus"; return Core.ok(); }

    final BluetoothGattCallback gcb = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int s, int ns) {
            if (ns == BluetoothProfile.STATE_CONNECTED) { state = "verbunden"; g.discoverServices(); } else if (ns == BluetoothProfile.STATE_DISCONNECTED) state = "getrennt";
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int s) {
            try {
                JSONArray a = new JSONArray();
                for (BluetoothGattService sv : g.getServices()) {
                    JSONObject so = new JSONObject(); so.put("uuid", sv.getUuid().toString()); JSONArray cs = new JSONArray();
                    for (BluetoothGattCharacteristic c : sv.getCharacteristics()) {
                        JSONObject co = new JSONObject(); co.put("uuid", c.getUuid().toString()); co.put("props", c.getProperties()); cs.put(co);
                    }
                    so.put("chars", cs); a.put(so);
                }
                services = a; state = "dienste";
            } catch (Throwable e) {}
        }
        @Override public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, int s) { add("read " + c.getUuid() + " " + hex(c.getValue())); }
        @Override public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int s) { add("write " + c.getUuid() + " status " + s); }
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            String v = hex(c.getValue()), k = c.getUuid().toString();
            if (v.equals(lastNotify.get(k))) return;   // nur Aenderungen protokollieren
            lastNotify.put(k, v); add("notify " + k + " " + v);
        }
    };

    synchronized void add(String s) { if (log.length() > 300) return; log.put(System.currentTimeMillis() % 100000 + " " + s); }

    BluetoothGattCharacteristic ch(String uuid) {
        if (gatt == null) return null;
        for (BluetoothGattService sv : gatt.getServices()) for (BluetoothGattCharacteristic c : sv.getCharacteristics()) if (c.getUuid().toString().equalsIgnoreCase(uuid)) return c;
        return null;
    }
    String read(String uuid) { BluetoothGattCharacteristic c = ch(uuid); if (c == null) return Core.err("Merkmal fehlt"); return gatt.readCharacteristic(c) ? Core.ok() : Core.err("read abgelehnt"); }
    String notify(String uuid) {
        BluetoothGattCharacteristic c = ch(uuid); if (c == null) return Core.err("Merkmal fehlt");
        gatt.setCharacteristicNotification(c, true);
        android.bluetooth.BluetoothGattDescriptor d = c.getDescriptor(java.util.UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"));
        if (d != null) { d.setValue((c.getProperties() & 0x20) != 0 ? android.bluetooth.BluetoothGattDescriptor.ENABLE_INDICATION_VALUE : android.bluetooth.BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE); gatt.writeDescriptor(d); }
        return Core.ok();
    }
    String write(String uuid, String hexv, boolean noResp) {
        BluetoothGattCharacteristic c = ch(uuid); if (c == null) return Core.err("Merkmal fehlt");
        c.setWriteType(noResp ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        c.setValue(unhex(hexv)); add("schreibe " + uuid + " " + hexv);
        return gatt.writeCharacteristic(c) ? Core.ok() : Core.err("write abgelehnt");
    }

    synchronized String status() {
        try {
            JSONObject o = new JSONObject(); o.put("ok", true); o.put("scanning", scanning); o.put("state", state);
            JSONArray l = new JSONArray(); for (JSONObject f : found.values()) l.put(f); o.put("found", l);
            o.put("services", services); o.put("log", log); return o.toString();
        } catch (Throwable e) { return Core.err(String.valueOf(e)); }
    }

    static String hex(byte[] b) { if (b == null) return ""; StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x)); return s.toString(); }
    static byte[] unhex(String h) { h = h.replaceAll("[^0-9a-fA-F]", ""); byte[] b = new byte[h.length() / 2]; for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16); return b; }
}
