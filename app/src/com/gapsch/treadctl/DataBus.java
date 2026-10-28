// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Parcel;
import android.os.RemoteException;

/** Direkter Client fuer den JHT-DataMatrix-Bus (IGlobalSettings) ueber rohe
 *  Binder-Transaktionen. Transaktionscodes und Descriptor aus der JHT-App. */
public class DataBus {
    static final String DESC = "com.jht.datamatrixservice.IGlobalSettings";
    static final String AUTH = "com.jht.atsoul.datamatrixservice.contentprovider";

    // Transaktionscodes (aus IGlobalSettings.Stub; ungenutzt: 6 GET_STRING, 9 PUT_INT)
    static final int PUT_FLOAT = 3,  GET_FLOAT = 4;
    static final int PUT_INT = 9, GET_INT = 10;
    static final int PUT_BOOL = 11,  GET_BOOL = 12;
    static final int SEND_EVENT = 20; // sendEventNotification(String)

    private volatile IBinder mSvc;   // auch aus HTTP- und Tastenthreads (stopNow)

    public boolean connect(Context ctx) {
        Bundle b = ctx.getContentResolver().call(
                Uri.parse("content://" + AUTH), "method", "args", null);
        if (b == null) return false;
        mSvc = b.getBinder("binder");
        return mSvc != null;
    }

    public boolean isConnected() { return mSvc != null && mSvc.isBinderAlive(); }
    public void reset() { mSvc = null; }

    public float getFloat(String key) throws RemoteException {
        Parcel d = Parcel.obtain(), r = Parcel.obtain();
        try {
            d.writeInterfaceToken(DESC); d.writeString(key);
            mSvc.transact(GET_FLOAT, d, r, 0); r.readException();
            return r.readFloat();
        } finally { d.recycle(); r.recycle(); }
    }

    public int getInt(String key) throws RemoteException {
        Parcel d = Parcel.obtain(), r = Parcel.obtain();
        try {
            d.writeInterfaceToken(DESC); d.writeString(key);
            mSvc.transact(GET_INT, d, r, 0); r.readException();
            return r.readInt();
        } finally { d.recycle(); r.recycle(); }
    }

    /** getValueBoolean liefert laut AIDL ein int (0/1). */
    public int getBool(String key) throws RemoteException {
        Parcel d = Parcel.obtain(), r = Parcel.obtain();
        try {
            d.writeInterfaceToken(DESC); d.writeString(key);
            mSvc.transact(GET_BOOL, d, r, 0); r.readException();
            return r.readInt();
        } finally { d.recycle(); r.recycle(); }
    }

    // --- Setzen ---
    public void putFloat(String key, float v) throws RemoteException {
        Parcel d = Parcel.obtain(), r = Parcel.obtain();
        try {
            d.writeInterfaceToken(DESC); d.writeString(key); d.writeFloat(v);
            mSvc.transact(PUT_FLOAT, d, r, 0); r.readException();
        } finally { d.recycle(); r.recycle(); }
    }

    public void putInt(String key, int v) throws RemoteException {
        Parcel d = Parcel.obtain(), r = Parcel.obtain();
        try {
            d.writeInterfaceToken(DESC); d.writeString(key); d.writeInt(v);
            mSvc.transact(PUT_INT, d, r, 0); r.readException();
        } finally { d.recycle(); r.recycle(); }
    }

    public void putBool(String key, boolean v) throws RemoteException {
        Parcel d = Parcel.obtain(), r = Parcel.obtain();
        try {
            d.writeInterfaceToken(DESC); d.writeString(key); d.writeInt(v ? 1 : 0);
            mSvc.transact(PUT_BOOL, d, r, 0); r.readException();
        } finally { d.recycle(); r.recycle(); }
    }

    /** sendEvent (ACTION_START_MACHINE / ACTION_STOP_MACHINE). */
    public void sendEvent(String key) throws RemoteException {
        Parcel d = Parcel.obtain(), r = Parcel.obtain();
        try {
            d.writeInterfaceToken(DESC); d.writeString(key);
            mSvc.transact(SEND_EVENT, d, r, 0); r.readException();
        } finally { d.recycle(); r.recycle(); }
    }
}
