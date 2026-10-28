// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import org.json.JSONObject;

/** Eine HTTP-Verbindung. Regeln:
 *  - Host muss 127.0.0.1:8765 oder localhost:8765 sein (gegen DNS-Rebinding).
 *  - Lesen: GET /api/state. Steuern: nur POST /api/cmd mit gueltigem X-Token.
 *  - Kein CORS-Header: fremde Webseiten koennen weder lesen noch steuern.
 *  - Fremder Origin bei POST wird abgelehnt. */
public class Conn implements Runnable {
    final TreadDaemon d;
    final Socket s;
    String method = "", path = "/", query = "", host = "", token = "", origin = "", from = "ui";
    int clen = 0;
    String cache = "no-store";

    public Conn(TreadDaemon d, Socket s) { this.d = d; this.s = s; }

    public void run() {
        try {
            InputStream in = s.getInputStream();
            String line = readLine(in);
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) { send(400, "text/plain", "bad".getBytes()); return; }
            method = parts[0]; path = parts[1];
            int q = path.indexOf('?'); if (q >= 0) { query = path.substring(q + 1); path = path.substring(0, q); }
            String h;
            while ((h = readLine(in)) != null && h.length() > 0) {
                int c = h.indexOf(':'); if (c < 0) continue;
                String k = h.substring(0, c).trim().toLowerCase(), v = h.substring(c + 1).trim();
                if (k.equals("host")) host = v;
                else if (k.equals("x-token")) token = v;
                else if (k.equals("origin")) origin = v;
                else if (k.equals("x-from")) from = v;
                else if (k.equals("content-length")) try { clen = Integer.parseInt(v); } catch (Exception e) {}
            }
            if (!host.equals("127.0.0.1:" + TreadDaemon.PORT) && !host.equals("localhost:" + TreadDaemon.PORT)) {
                send(403, "text/plain", "host".getBytes()); return;
            }
            if (path.startsWith("/api/")) api(in); else if (path.startsWith("/tiles/")) Tiles.serve(this, d); else serveStatic();
        } catch (Throwable e) {   // auch OutOfMemoryError: eine Anfrage darf nie den ganzen Dienst beenden
            Log.w("TREADCTL", "conn: " + e);
            if (e instanceof Error) try { json(500, Core.err("interner Fehler")); } catch (Throwable e2) {}
        } finally {
            try { s.close(); } catch (Exception e) {}
        }
    }

    void api(InputStream in) throws Exception {
        Core c = d.core;
        if (path.equals("/api/state") && method.equals("GET")) {
            if (Token.check(token)) c.lastLease = Core.clock();   // Lebenszeichen nur von der eigenen Oberflaeche bzw. Pille (Token), nicht von fremden Apps
            // Haengt die Hauptschleife, nicht auf den Lock warten (der Thread waere sonst blockiert): sofort melden
            if (Core.clock() - c.lastTickAt > 2000) { json(503, Core.err("Steuerkern reagiert nicht")); return; }
            String js; synchronized (c.lock) { js = c.stateJson(query.contains("hist=1")); }   // Schnappschuss: tick() aendert Verlauf und Programm nebenher
            json(200, js);
            return;
        }
        if (path.equals("/api/cmd") && method.equals("POST")) {
            if (origin.length() > 0 && !origin.equals("http://127.0.0.1:" + TreadDaemon.PORT) && !origin.equals("http://localhost:" + TreadDaemon.PORT)) {
                json(403, Core.err("fremder Ursprung")); return;
            }
            if (!Token.check(token)) { json(403, Core.err("Token fehlt oder ungültig")); return; }
            if (clen <= 0 || clen > 524288) { json(400, Core.err("Länge")); return; }
            byte[] b = new byte[clen]; int r = 0;
            while (r < clen) { int n = in.read(b, r, clen - r); if (n < 0) break; r += n; }
            JSONObject j;
            try { j = new JSONObject(new String(b, 0, r, "UTF-8")); } catch (Exception e) { json(400, Core.err("ungültiges JSON")); return; }
            String src = from.matches("[a-z]{1,12}") ? from : "ui";
            c.lastLease = Core.clock();
            json(200, c.cmd(j, src));
            return;
        }
        if (path.startsWith("/api/routes")) { routes(in); return; }
        if (path.equals("/api/media") && method.equals("GET")) { json(200, d.media == null ? Core.err("kein Player") : d.media.status()); return; }
        if (path.equals("/api/media/art") && method.equals("GET")) {
            byte[] b = d.media == null ? null : d.media.artwork();
            if (b == null) { send(404, "text/plain", "kein Bild".getBytes()); return; }
            cache = "max-age=3600"; send(200, "image/jpeg", b); return;
        }
        if (path.equals("/api/media/cmd") && method.equals("POST")) {
            if (!postAllowed()) return;
            JSONObject j = body(in, 1024); if (j == null) return;
            json(200, d.media == null ? Core.err("kein Player") : d.media.cmd(j)); return;
        }
        if (path.startsWith("/api/probe")) {   // nur mit Token, auch lesend
            if (!Token.check(token)) { json(403, Core.err("Token")); return; }
            BleProbe p = d.probe;
            if (path.equals("/api/probe") && method.equals("GET")) { json(200, p.status()); return; }
            if (!postAllowed()) return;
            JSONObject j = body(in, 4096); if (j == null) return;
            String a = j.optString("a");
            json(200, "scan".equals(a) ? p.scan() : "connect".equals(a) ? p.connect(j.optString("address")) : "close".equals(a) ? p.close()
                : "read".equals(a) ? p.read(j.optString("uuid")) : "notify".equals(a) ? p.notify(j.optString("uuid"))
                : "write".equals(a) ? p.write(j.optString("uuid"), j.optString("hex"), j.optBoolean("noResp")) : Core.err("unbekannt"));
            return;
        }
        if (path.equals("/api/fan") && method.equals("GET")) { json(200, d.fan == null ? Core.err("kein Ventilator") : d.fan.status()); return; }
        if (path.equals("/api/fan") && method.equals("POST")) {
            if (!postAllowed()) return;
            JSONObject j = body(in, 1024); if (j == null) return;
            if (d.fan == null) { json(200, Core.err("kein Ventilator")); return; }
            if (("scan".equals(j.optString("a")) || "connect".equals(j.optString("a"))) && d.probe != null) d.probe.close();   // nur eine Verbindung zum Ventilator
            json(200, d.fan.cmd(j)); return;
        }
        if (path.equals("/api/bt/audio") && method.equals("GET")) { json(200, d.hrBle == null ? Core.err("kein Bluetooth") : d.hrBle.audio()); return; }
        if (path.equals("/api/hr") && method.equals("GET")) { json(200, d.hrBle == null ? Core.err("kein Bluetooth") : d.hrBle.status()); return; }
        if (path.startsWith("/api/hr/") && method.equals("POST")) {
            if (!postAllowed()) return;
            if (d.hrBle == null) { json(200, Core.err("kein Bluetooth")); return; }
            if (path.equals("/api/hr/scan")) { json(200, d.hrBle.scan()); return; }
            if (path.equals("/api/hr/forget")) { json(200, d.hrBle.forget()); return; }
            if (path.equals("/api/hr/connect")) { JSONObject j = body(in, 4096); if (j == null) return; json(200, d.hrBle.connect(j.optString("address"), j.optString("name"))); return; }
        }
        if (path.equals("/api/tiles/status") && method.equals("GET")) { json(200, Tiles.status()); return; }
        if (path.equals("/api/tiles/coverage") && method.equals("POST")) {
            if (!postAllowed()) return;   // Token und Ursprung: fremde Seiten duerfen keine Threads binden
            JSONObject j = body(in, 200000); if (j == null) return;
            json(200, Tiles.coverage(d, j)); return;
        }
        if (path.equals("/api/tiles/prefetch") && method.equals("POST")) {
            if (!postAllowed()) return;
            JSONObject j = body(in, 2000000); if (j == null) return;
            json(200, Tiles.prefetch(d, j)); return;
        }
        if (path.equals("/api/summary") && method.equals("GET")) {
            JSONObject sm = c.lastSummary; json(200, sm == null ? "{}" : sm.toString()); return;
        }
        if (path.equals("/api/blackbox") && method.equals("GET") && Token.check(token)) {
            send(200, "text/plain; charset=utf-8", readFile(c.box));
            return;
        }
        json(404, Core.err("unbekannt"));
    }

    boolean postAllowed() throws Exception {
        if (origin.length() > 0 && !origin.equals("http://127.0.0.1:" + TreadDaemon.PORT) && !origin.equals("http://localhost:" + TreadDaemon.PORT)) {
            json(403, Core.err("fremder Ursprung")); return false;
        }
        if (!Token.check(token)) { json(403, Core.err("Token fehlt oder ungültig")); return false; }
        return true;
    }

    JSONObject body(InputStream in, int max) throws Exception {
        if (clen <= 0 || clen > max) { json(400, Core.err("Länge")); return null; }
        byte[] b = new byte[clen]; int r = 0;
        while (r < clen) { int n = in.read(b, r, clen - r); if (n < 0) break; r += n; }
        try { return new JSONObject(new String(b, 0, r, "UTF-8")); } catch (Exception e) { json(400, Core.err("ungültiges JSON")); return null; }
    }

    /** Streckenbibliothek: Beispiele aus assets/www/strecken (nur lesen), eigene unter files/routes. */
    /** Metadaten der Strecken zwischenspeichern (Schluessel: Pfad, Aenderungszeit und Groesse): die Bibliothek parst sonst bei
     *  jedem Aufruf alle Dateien vollstaendig (bis 4 MB je Strecke), unter Speicherdruck bis zum Absturz von :core. */
    static final java.util.HashMap<String, Object[]> META = new java.util.HashMap<String, Object[]>();
    JSONObject metaCached(String key, String ver, boolean lib, java.io.File f, String asset) throws Exception {
        synchronized (META) { Object[] c = META.get(key); if (c != null && ver.equals(c[0])) return (JSONObject) c[1]; }
        byte[] b;
        if (f != null) b = readFile(f); else { java.io.InputStream is = d.getAssets().open("www/strecken/" + asset); b = readAll(is); is.close(); }
        JSONObject m = meta(new JSONObject(new String(b, "UTF-8")), lib);
        synchronized (META) { META.put(key, new Object[]{ ver, m }); }
        return m;
    }

    void routes(InputStream in) throws Exception {
        java.io.File dir = new java.io.File(d.getFilesDir(), "routes"); dir.mkdirs();
        String id = path.length() > "/api/routes/".length() ? path.substring("/api/routes/".length()) : "";
        if (id.length() > 0 && !id.matches("[a-z0-9-]{1,48}")) { json(400, Core.err("Kennung ungültig")); return; }
        if (method.equals("GET") && id.length() == 0) {
            org.json.JSONArray out = new org.json.JSONArray();
            java.util.HashSet<String> seen = new java.util.HashSet<String>();
            java.io.File[] fs = dir.listFiles();
            if (fs != null) for (java.io.File f : fs) if (f.getName().endsWith(".json")) {
                try { JSONObject m = metaCached(f.getPath(), f.lastModified() + ":" + f.length(), false, f, null); if (m != null) { out.put(m); seen.add(m.optString("id")); } } catch (Throwable e) {}
            }
            try {
                for (String n : d.getAssets().list("www/strecken")) if (n.endsWith(".json")) {
                    JSONObject m = metaCached("asset:" + n, "1", true, null, n);   // Beispielstrecken aendern sich nur mit einer neuen Version
                    if (m != null && !seen.contains(m.optString("id"))) out.put(m);
                }
            } catch (Exception e) {}
            json(200, out.toString()); return;
        }
        if (method.equals("GET")) {
            java.io.File f = new java.io.File(dir, id + ".json");
            if (f.exists()) { send(200, "application/json; charset=utf-8", readFile(f)); return; }
            try { java.io.InputStream is = d.getAssets().open("www/strecken/" + id + ".json"); byte[] b = readAll(is); is.close(); send(200, "application/json; charset=utf-8", b); }
            catch (Exception e) { json(404, Core.err("Strecke unbekannt")); }
            return;
        }
        if (method.equals("POST") && id.length() == 0) {
            if (!postAllowed()) return;
            JSONObject o = body(in, 4000000); if (o == null) return;
            String nid = o.optString("id");
            if (!nid.matches("[a-z0-9-]{1,48}")) { json(400, Core.err("Kennung ungültig")); return; }
            if (o.optJSONArray("pts") == null || o.optJSONArray("prof") == null || o.optString("name").length() == 0) { json(400, Core.err("Strecke unvollständig")); return; }
            if (o.optString("name").length() > 80) { json(400, Core.err("Name zu lang")); return; }
            o.remove("sample");
            java.io.File[] all = dir.listFiles(); if (all != null && all.length >= 200) { json(400, Core.err("Bibliothek voll (200 Strecken)")); return; }
            java.io.FileOutputStream fo = new java.io.FileOutputStream(new java.io.File(dir, nid + ".json")); fo.write(o.toString().getBytes("UTF-8")); fo.close();
            json(200, Core.ok()); return;
        }
        if (method.equals("DELETE") && id.length() > 0) {
            if (!postAllowed()) return;
            java.io.File f = new java.io.File(dir, id + ".json");
            if (!f.exists()) { json(404, Core.err("nur eigene Strecken lassen sich löschen")); return; }
            f.delete(); json(200, Core.ok()); return;
        }
        json(405, Core.err("Methode"));
    }

    static JSONObject meta(JSONObject o, boolean sample) throws Exception {
        JSONObject m = new JSONObject();
        String[] keys = { "id", "name", "ort", "quelle", "art", "d", "up", "down", "bbox", "datum", "hinweis", "offiziell", "thumb", "kind", "importiert" };
        for (String k : keys) if (o.has(k)) m.put(k, o.get(k));
        m.put("sample", sample);
        return m;
    }

    static byte[] readFile(java.io.File f) {
        try { java.io.FileInputStream i = new java.io.FileInputStream(f); byte[] b = readAll(i); i.close(); return b; }
        catch (Exception e) { return new byte[0]; }
    }

    void serveStatic() throws Exception {
        if (!method.equals("GET")) { send(405, "text/plain", "method".getBytes()); return; }
        if (path.equals("/")) path = "/index.html";
        if (path.contains("..")) { send(400, "text/plain", "bad".getBytes()); return; }
        try {
            InputStream is = d.getAssets().open("www" + path);
            byte[] data = readAll(is); is.close();
            send(200, mime(path), data);
        } catch (Exception e) {
            send(404, "text/plain", ("nicht gefunden: " + path).getBytes("UTF-8"));
        }
    }

    static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream(); int c, n = 0;
        while ((c = in.read()) >= 0) { if (c == '\n') break; if (c != '\r') b.write(c); if (++n > 8192) throw new Exception("zeile"); }
        if (c < 0 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    static byte[] readAll(InputStream is) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n;
        while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    static String mime(String p) {
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    void json(int code, String body) throws Exception { send(code, "application/json; charset=utf-8", body.getBytes("UTF-8")); }

    void send(int code, String ctype, byte[] body) throws Exception {
        OutputStream o = s.getOutputStream();
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " ERR") + "\r\n"
            + "Content-Type: " + ctype + "\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Cache-Control: " + cache + "\r\n"
            + "X-Content-Type-Options: nosniff\r\n"
            + "Connection: close\r\n\r\n";
        o.write(head.getBytes("UTF-8")); o.write(body); o.flush();
    }
}
