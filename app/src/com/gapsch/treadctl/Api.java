// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

/** Client der Pille zum Dienst. Steuerbefehle mit Token per POST. */
public class Api {
    static final String BASE = "http://127.0.0.1:8765/api";

    static volatile Context ctx;   // setzt die Pille: Token fuer das Lebenszeichen
    static volatile long uiBeat;    // letzter Herzschlag des UI-Threads der Pille

    /** Zustand lesen, null bei Fehler oder Antwort ohne Zustand. */
    public static JSONObject state(boolean hist) {
        // Lebenszeichen (Token) nur, wenn der UI-Thread der Pille lebt: ein eingefrorener UI-Thread darf den Watchdog nicht stillhalten
        boolean alive = Core.clock() - uiBeat < 3000;   // monoton: Uhrsprung haelt keinen eingefrorenen UI-Thread fuer lebendig
        String s = http("GET", "/state" + (hist ? "?hist=1" : ""), null, ctx == null || !alive ? null : Token.read(ctx));
        try { JSONObject o = s == null ? null : new JSONObject(s); return o != null && o.optString("st").length() > 0 ? o : null; } catch (Exception e) { return null; }   // ohne gueltigen Zustand: wie keine Antwort
    }

    /** Befehl senden; liefert true bei ok. */
    public static boolean cmd(Context c, JSONObject body) {
        String s = http("POST", "/cmd", body.toString(), Token.read(c));
        try { return s != null && new JSONObject(s).optBoolean("ok"); } catch (Exception e) { return false; }
    }

    /** Befehl senden; liefert die Antwort (null ohne Antwort). */
    public static JSONObject cmdResult(Context c, String name) {
        try { String s = http("POST", "/cmd", new JSONObject().put("c", name).toString(), Token.read(c)); return s == null ? null : new JSONObject(s); } catch (Exception e) { return null; }
    }

    public static boolean cmd(Context c, String name) {
        try { return cmd(c, new JSONObject().put("c", name)); } catch (Exception e) { return false; }
    }

    /** Mini-Player: {a: toggle|next|prev|volUp|volDown}. */
    public static boolean media(Context c, JSONObject body) {
        String s = http("POST", "/media/cmd", body.toString(), Token.read(c));
        try { return s != null && new JSONObject(s).optBoolean("ok"); } catch (Exception e) { return false; }
    }

    /** Zustand des Mini-Players (Titel, Interpret, App, spielt), null bei Fehler. */
    public static JSONObject mediaState(Context c) {
        String s = http("GET", "/media?lite=1", null, Token.read(c));
        try { return s == null ? null : new JSONObject(s); } catch (Exception e) { return null; }
    }

    /** Ventilator: {a: auto|off|level, v}. */
    public static boolean fan(Context c, JSONObject body) {
        String s = http("POST", "/fan", body.toString(), Token.read(c));
        try { return s != null && new JSONObject(s).optBoolean("ok"); } catch (Exception e) { return false; }
    }

    static String http(String method, String path, String body, String token) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(BASE + path).openConnection();
            c.setConnectTimeout(1200); c.setReadTimeout(1500);
            c.setRequestMethod(method);
            c.setRequestProperty("X-From", "pille");
            if (token != null) c.setRequestProperty("X-Token", token);
            if (body != null) {
                byte[] b = body.getBytes("UTF-8");
                c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(b.length);
                OutputStream o = c.getOutputStream(); o.write(b); o.close();
            }
            java.io.InputStream is = c.getResponseCode() < 400 ? c.getInputStream() : c.getErrorStream();
            BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"));
            StringBuilder sb = new StringBuilder(); String ln;
            while ((ln = r.readLine()) != null) sb.append(ln);
            r.close();
            return sb.toString();
        } catch (Throwable e) { return null; }
        finally { if (c != null) c.disconnect(); }
    }
}
