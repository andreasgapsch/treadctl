// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;

/** Sucht ein bekanntes BLE-Geraet kurz per Scan und liefert das gefundene BluetoothDevice.
 *  Grund: Ventilator und Pulsgurte nutzen zufaellige Adressen. Nach einem Neustart von Bluetooth oder der Konsole kennt
 *  Android den Adresstyp nicht mehr; getRemoteDevice(adresse).connectGatt verbindet dann nie. Das gescannte Geraet traegt
 *  den richtigen Typ. Findet der Scan nichts, bekommt der Aufrufer null (und verbindet direkt als Rueckfall). */
public class BleFind {
    interface Found { void found(BluetoothDevice d); }

    static void find(final String addr, final long ms, final Found cb) {
        final BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        final BluetoothLeScanner ls = a == null || !a.isEnabled() ? null : a.getBluetoothLeScanner();
        if (ls == null) { cb.found(null); return; }
        final boolean[] done = { false };
        final ScanCallback sc = new ScanCallback() {
            @Override public void onScanResult(int t, ScanResult r) {
                if (!addr.equalsIgnoreCase(r.getDevice().getAddress())) return;
                synchronized (done) { if (done[0]) return; done[0] = true; }
                try { ls.stopScan(this); } catch (Throwable e) {}
                cb.found(r.getDevice());
            }
        };
        try { ls.startScan(sc); } catch (Throwable e) { cb.found(null); return; }
        new Thread(new Runnable() { public void run() {
            try { Thread.sleep(ms); } catch (InterruptedException e) {}
            synchronized (done) { if (done[0]) return; done[0] = true; }
            try { ls.stopScan(sc); } catch (Throwable e) {}
            cb.found(null);
        } }, "ble-suche").start();
    }
}
