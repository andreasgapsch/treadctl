// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/** Abspielgeraet waehlen: eingebaute Lautsprecher der Konsole oder ein gekoppelter Bluetooth-Lautsprecher (A2DP).
 *  Verbinden und Umschalten ueber die (versteckten) Systemfunktionen connect/setActiveDevice, erlaubt fuer die
 *  Plattform-App. Koppeln selbst geschieht in den Bluetooth-Einstellungen. */
public class AudioOut {
    final Context ctx;
    volatile BluetoothA2dp a2dp;
    volatile String pending = "";   // Adresse, die gerade verbunden wird
    volatile long pendingAt;

    AudioOut(Context c) {
        ctx = c;
        try {
            BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
            if (a != null) a.getProfileProxy(c, new BluetoothProfile.ServiceListener() {
                public void onServiceConnected(int p, BluetoothProfile proxy) { a2dp = (BluetoothA2dp) proxy; }
                public void onServiceDisconnected(int p) { a2dp = null; }
            }, BluetoothProfile.A2DP);
        } catch (Throwable e) {}
        new Thread(new Runnable() { public void run() {   // nach dem Verbinden zum aktiven Geraet machen
            while (true) {
                try { Thread.sleep(500); finishPending(); } catch (Throwable e) {}
            }
        } }, "audio-out").start();
    }

    BluetoothDevice active() {
        try { return (BluetoothDevice) BluetoothA2dp.class.getMethod("getActiveDevice").invoke(a2dp); } catch (Throwable e) { return null; }
    }
    boolean setActive(BluetoothDevice d) {
        try { return (Boolean) BluetoothA2dp.class.getMethod("setActiveDevice", BluetoothDevice.class).invoke(a2dp, d); } catch (Throwable e) { return false; }
    }
    boolean call(String m, BluetoothDevice d) {
        try { return (Boolean) BluetoothA2dp.class.getMethod(m, BluetoothDevice.class).invoke(a2dp, d); } catch (Throwable e) { return false; }
    }
    boolean connected(BluetoothDevice d) { return a2dp != null && a2dp.getConnectionState(d) == BluetoothProfile.STATE_CONNECTED; }

    void finishPending() {
        if (pending.length() == 0 || a2dp == null) return;
        if (Core.clock() - pendingAt > 20000) { pending = ""; return; }   // Lautsprecher nicht erreichbar
        BluetoothDevice d = BluetoothAdapter.getDefaultAdapter().getRemoteDevice(pending);
        if (connected(d)) { setActive(d); pending = ""; }
    }

    /** Konsole plus alle gekoppelten Audiogeraete mit Zustand. */
    JSONArray list() throws Exception {
        JSONArray l = new JSONArray();
        BluetoothDevice act = a2dp == null ? null : active();
        JSONObject k = new JSONObject(); k.put("address", ""); k.put("name", "Konsole"); k.put("connected", true); k.put("active", act == null); k.put("busy", false);
        l.put(k);
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a != null && a.isEnabled()) for (BluetoothDevice d : a.getBondedDevices()) {
            BluetoothClass c = d.getBluetoothClass();
            if (c == null || c.getMajorDeviceClass() != BluetoothClass.Device.Major.AUDIO_VIDEO) continue;
            String nm = d.getName(); JSONObject o = new JSONObject(); o.put("address", d.getAddress()); o.put("name", nm == null || nm.length() == 0 ? d.getAddress() : nm);
            o.put("connected", connected(d)); o.put("active", act != null && act.getAddress().equals(d.getAddress()));
            o.put("busy", d.getAddress().equals(pending));
            l.put(o);
        }
        return l;
    }

    /** Umschalten: "" = Konsole, sonst Adresse eines gekoppelten Lautsprechers (wird bei Bedarf verbunden). */
    String select(String addr) {
        if (a2dp == null) return Core.err("Bluetooth nicht bereit");
        BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (addr == null || addr.length() == 0) {
            pending = "";
            BluetoothDevice act = active();
            if (act == null) return Core.ok();
            if (!setActive(null)) call("disconnect", act);   // ohne aktives Bluetooth-Geraet spielt die Konsole selbst
            return Core.ok();
        }
        if (!BluetoothAdapter.checkBluetoothAddress(addr)) return Core.err("Adresse ungültig");
        BluetoothDevice d = a.getRemoteDevice(addr);
        if (d.getBondState() != BluetoothDevice.BOND_BONDED) return Core.err("nicht gekoppelt");
        if (connected(d)) { setActive(d); return Core.ok(); }
        pending = addr; pendingAt = Core.clock();
        return call("connect", d) ? Core.ok() : Core.err("Verbinden abgelehnt");
    }
}
