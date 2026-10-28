package com.gapsch.treadctl;

import android.content.Context;
import java.io.File;
import org.json.JSONArray;
import org.json.JSONObject;

/** Szenariotests fuer Core (Zustandsmaschine und Streckenmodus) gegen eine Bandattrappe, ohne Geraet.
 *  Bau und Lauf: app/tools/coretest/test.sh */
public class CoreSzenarien {
    static int ok = 0, fail = 0;
    static void t(String name, boolean cond, String info) {
        if (cond) { ok++; System.out.println("  OK   " + name + (info.isEmpty() ? "" : " (" + info + ")")); }
        else { fail++; System.out.println("  FEHL " + name + (info.isEmpty() ? "" : " (" + info + ")")); }
    }

    Core c; DataBus b; long sim = 0; boolean lease = true;
    File files;
    CoreSzenarien() throws Exception { this(null); }
    /** Mit dem Dateiordner eines frueheren Dienstes: simuliert einen Neustart des Dienstes. */
    CoreSzenarien(File dir) throws Exception {
        files = dir != null ? dir : new File(System.getProperty("java.io.tmpdir"), "coretest-" + System.nanoTime()); files.mkdirs();
        c = new Core(new Context(files, System.getProperty("assets")));
        b = c.bus; c.connect();
    }
    long now() { return Core.clock() + sim; }
    /** s Sekunden simulieren (Takt 0.2 s wie im Dienst). */
    void run(double s) throws Exception {
        for (double q = 0; q < s; q += 0.2) {
            sim += 200; b.step(0.2); c.read();
            if (lease) c.lastLease = now();
            synchronized (c.lock) { c.tick(0.2, now()); }
        }
    }
    /** bis Bedingung erfuellt, hoechstens max s. */
    boolean until(java.util.concurrent.Callable<Boolean> f, double max) throws Exception {
        for (double q = 0; q < max; q += 0.2) { if (f.call()) return true; run(0.2); }
        return f.call();
    }
    String cmd(String json) throws Exception { return c.cmd(new JSONObject(json), "test"); }
    void arm() { c.armAt = Core.clock() - 3000; }
    double x() { return c.dist * 1000; }
    JSONObject prog() throws Exception { return new JSONObject(c.stateJson(false)).optJSONObject("prog"); }
    String load(String id, int target) throws Exception { return cmd("{\"c\":\"program\",\"p\":{\"type\":\"route\",\"id\":\"" + id + "\",\"target\":" + target + ",\"mode\":\"terrain\",\"scale\":1.0}}"); }
    void startRun() throws Exception { run(0.4); arm(); String r = cmd("{\"c\":\"start\"}"); if (!r.contains("true")) throw new Exception("start: " + r); }
    /** bis kurz vor Position (m) laufen, Zeitraffer ueber das Bandtempo. */
    void runTo(final double m) throws Exception { until(() -> x() >= m, 20000); }
    /** Aktuelles Plantempo ohne Versatz (mit vorgezogenem Tempo bei Anstieg). */
    double planNow() { RoutePlan p = c.rp; int i = Math.max(0, c.segIdx); return c.inclIdx > i && p.early(c.inclIdx) ? p.sp[c.inclIdx] : p.sp[i]; }
    int firstClimb(double minDi) {
        RoutePlan p = c.rp;
        for (int i = 1; i < p.n; i++) if (p.in[i] - p.in[i - 1] >= minDi && p.sp[i] < p.sp[i - 1]) return i;
        return -1;
    }

    public static void main(String[] a) throws Exception {
        System.out.println("Szenariotests Core (Streckenmodus und Sicherheit)");

        { // 1 Programm nur mit id, auch die lange Arosa-Strecke
            CoreSzenarien s = new CoreSzenarien();
            t("Programm per id (Arosa Weisshorn)", s.load("arosa-weisshorn", 9000).contains("true"), "");
            t("Profil aus Bibliothek, Planzeit 2:30", Math.abs(s.c.rp.total - 9000) <= 2, String.format("%.0f s", s.c.rp.total));
            t("Unbekannte Strecke abgewiesen", s.load("gibtsnicht", 6000).contains("unbekannt"), "");
            t("Start ohne arm abgewiesen", s.cmd("{\"c\":\"start\"}").contains("Countdown fehlt"), "");
        }
        { // 2 Anstieg: Tempo mit der Steigung vorgezogen, Steigung liegt am Abschnittsbeginn an
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            int k = s.firstClimb(4); RoutePlan p = s.c.rp;
            s.runTo(p.a[k] - 1);
            t("Vor dem Anstieg Tempo schon gesenkt", s.c.tSpeed <= p.sp[k] + 0.05, String.format("Soll %.1f, Plan %.1f bei Steigung %.1f", s.c.tSpeed, p.sp[k], p.in[k]));
            t("Steigung am Abschnittsbeginn fast erreicht", Math.abs(s.b.incline - p.in[k]) < 1.6, String.format("Band %.1f, Plan %.1f", s.b.incline, p.in[k]));
        }
        { // 3 Fehler mitten im Lauf: nach Quittieren Gehtempo, Plan springt nicht zurueck
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            s.runTo(3000);
            s.b.pulled = true; s.run(1);
            t("Schluessel gezogen -> FEHLER", "FEHLER".equals(s.c.st), s.c.st);
            s.until(() -> s.b.speed < 0.1, 60);
            s.b.pulled = false; s.run(0.4);
            t("Quittieren -> PAUSE mit 3 km/h", s.cmd("{\"c\":\"ack\"}").contains("true") && "PAUSE".equals(s.c.st) && s.c.tSpeed <= 3.0f, s.c.st + " " + s.c.tSpeed);
            s.arm(); s.cmd("{\"c\":\"resume\"}");
            RoutePlan p = s.c.rp; int i0 = p.idxAt(s.x());
            s.runTo(p.b[i0] + 30); s.run(1);
            t("Nach Abschnittswechsel weiter Gehtempo", s.c.tSpeed <= 3.6f, String.format("Soll %.1f, Plan %.1f, Versatz %.1f", s.c.tSpeed, p.sp[p.idxAt(s.x())], s.c.offS));
            s.cmd("{\"c\":\"routeOffset\",\"s\":0,\"i\":0}");
            float first = s.c.tSpeed;
            t("Zurück zum Plan: erste Stufe höchstens +3 km/h", first <= 3.0f + 3.05f, String.format("%.1f", first));
            s.run(14);
            t("Zurück zum Plan -> Plantempo nach Stufen", Math.abs(s.c.tSpeed - s.planNow()) < 0.05, String.format("%.1f, Plan %.1f", s.c.tSpeed, s.planNow()));
        }
        { // 4 Steigung von Hand gilt nur bis zum naechsten Wechsel, Tempoversatz bleibt
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            s.runTo(500);
            s.cmd("{\"c\":\"incline\",\"v\":15}");
            t("Steigung 15 von Hand gesetzt", Math.abs(s.c.tIncl - 15) < 0.05, "");
            s.cmd("{\"c\":\"step\",\"what\":\"speed\",\"d\":0.5}");
            t("Tempo-Tipp löscht Steigungsversatz nicht", s.c.offI > 1, String.format("offI %.1f", s.c.offI));
            final int ii = s.c.inclIdx;
            s.until(() -> s.c.inclIdx != ii, 4000);
            RoutePlan p = s.c.rp;
            t("Nach Steigungswechsel wieder Plan", Math.abs(s.c.tIncl - p.in[s.c.inclIdx]) < 0.05, String.format("Band %.1f, Plan %.1f", s.c.tIncl, p.in[s.c.inclIdx]));
            final int si = s.c.segIdx; s.until(() -> s.c.segIdx != si, 4000);
            s.until(() -> s.c.rampTarget < 0, 30); s.run(0.4);
            t("Tempoversatz +0.5 bleibt", Math.abs(s.c.tSpeed - (s.planNow() + 0.5)) < 0.06, String.format("Soll %.1f, Plan %.1f", s.c.tSpeed, s.planNow()));
        }
        { // 5 Watchdog: ohne Lebenszeichen nicht wieder hochregeln
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            s.runTo(1000); s.lease = false; s.run(62);
            t("Watchdog senkt auf 4 km/h", s.c.tSpeed <= 4.0f, String.format("%.1f", s.c.tSpeed));
            final int si = s.c.segIdx; s.until(() -> s.c.segIdx != si, 900); s.run(5);
            t("Abschnittswechsel regelt nicht hoch", s.c.tSpeed <= 4.0f, String.format("%.1f nach Abschnitt %d", s.c.tSpeed, s.c.segIdx));
            s.lease = true; s.run(1);
            final int sj = s.c.segIdx; s.until(() -> s.c.segIdx != sj, 3000); s.run(1);
            t("Mit Lebenszeichen wieder Plan", s.c.tSpeed > 4.0f, String.format("%.1f", s.c.tSpeed));
        }
        { // 6 STOP im Steigungsvorlauf, WEITER: Steigung springt nicht zurueck
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            int k = s.firstClimb(4); RoutePlan p = s.c.rp;
            final int kk = k; s.until(() -> s.c.inclIdx == kk, 20000);
            float before = s.c.tIncl;
            s.cmd("{\"c\":\"stop\"}"); s.until(() -> s.b.speed < 0.1, 60);
            s.arm(); s.cmd("{\"c\":\"resume\"}");
            float min = 99; for (int q = 0; q < 50; q++) { s.run(0.2); min = Math.min(min, s.c.tIncl); }
            t("Steigung nach WEITER nicht zurückgesprungen", min >= before - 0.05, String.format("vorher %.1f, min danach %.1f", before, min));
        }
        { // 7 Ziel: Tempo 3, Steigung 0, nach 10 s PAUSE, Zusammenfassung mit Zeit am Ziel
            CoreSzenarien s = new CoreSzenarien(); s.load("hallwilersee-runde", 7500); s.startRun();
            s.until(() -> s.c.progDone, 9000);
            t("Ziel erkannt", s.c.routeFinish && s.c.progDone, String.format("x %.0f", s.x()));
            float z0 = s.c.tSpeed; java.util.List<Float> ab = new java.util.ArrayList<Float>(); ab.add(z0);
            for (int q = 0; q < 100 && s.c.tSpeed > 3.0f; q++) { s.run(0.2); if (ab.get(ab.size() - 1) != s.c.tSpeed) ab.add(s.c.tSpeed); }
            boolean stufen = true; for (int q = 1; q < ab.size(); q++) stufen &= ab.get(q - 1) - ab.get(q) <= 3.05f;
            t("Am Ziel in Stufen auf Tempo 3, Steigung 0", s.c.tSpeed <= 3.0f && s.c.tIncl == 0f && stufen, ab + " / " + s.c.tIncl);
            float atStop = -1; for (int q = 0; q < 250 && "LAEUFT".equals(s.c.st); q++) { atStop = s.b.speed; s.run(0.2); }
            t("Nach Auslaufen PAUSE", "PAUSE".equals(s.c.st), s.c.st);
            t("STOP erst im Gehtempo", atStop <= 3.5f, String.format("Ist beim STOP %.1f", atStop));
            JSONObject sum = new JSONObject(s.cmd("{\"c\":\"end\"}")).getJSONObject("summary").getJSONObject("route");
            t("Zusammenfassung: Zeit am Ziel nahe Plan", Math.abs(sum.getLong("t") - 7500) < 60 && sum.getBoolean("finish"), sum.getLong("t") + " s");
        }
        { // 8 Start ueber Geraetetasten aus BEREIT: Plan relativ zum Geraetetempo
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.run(16);
            s.b.running = true; s.b.target = 5f; s.run(6);
            t("Geräte-Start übernommen", "LAEUFT".equals(s.c.st), s.c.st + " " + s.c.src);
            RoutePlan p = s.c.rp; final int si = s.c.segIdx;
            s.until(() -> s.c.segIdx != si, 3000); s.run(1);
            t("Danach kein Sprung auf Plantempo", s.c.tSpeed < p.sp[s.c.segIdx] - 3, String.format("Soll %.1f, Plan %.1f", s.c.tSpeed, p.sp[s.c.segIdx]));
        }
        { // 9 Bus tot mitten im Lauf
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun(); s.runTo(800);
            s.b.dead = true;
            for (int q = 0; q < 20; q++) { s.sim += 200; try { s.c.read(); s.c.busFail = 0; } catch (Throwable e) { s.c.busFail++; if (s.c.busFail >= 3 && !"FEHLER".equals(s.c.st)) s.c.setError("Herstellerbus getrennt"); } }
            t("Bus getrennt -> FEHLER", "FEHLER".equals(s.c.st), s.c.st);
        }
        { // 10 ganze Homberg-Runde: kein Sollsprung ueber 3 km/h, Zielzeit trifft den Plan
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            float last = s.c.tSpeed, maxJ = 0;
            while (!s.c.progDone && s.sim < 3 * 3600 * 1000L) { s.run(0.2); if (!s.c.progDone) maxJ = Math.max(maxJ, Math.abs(s.c.tSpeed - last)); last = s.c.tSpeed; }   // Auslaufen am Ziel zaehlt nicht
            t("Kein Sollsprung über 3 km/h", maxJ <= 3.05f, String.format("grösster Sprung %.1f", maxJ));
            t("Zeit am Ziel nahe Zielzeit", Math.abs(s.c.finishT - 4200) < 60, String.format("%.0f s (Plan %.0f)", s.c.finishT, s.c.rp.total));
        }
        { // 11 Einlaufen: jeder Anlauf 15 s mit 1 km/h, dann Stufen zum Plan; Programm wartet
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            t("Start mit 1 km/h", s.c.tSpeed == 1.0f && s.b.target == 1.0f, String.format("%.1f", s.c.tSpeed));
            s.run(10);
            JSONObject st = new JSONObject(s.c.stateJson(false));
            t("Während Einlaufen 1 km/h, Hinweis mit Ziel", s.c.tSpeed == 1.0f && st.optInt("hold") > 0 && st.optDouble("holdTo") > 5, "hold " + st.optInt("hold") + " s, Ziel " + st.optDouble("holdTo"));
            s.run(5.2);
            t("Nach 15 s erste Stufe", s.c.tSpeed > 1.0f && s.c.tSpeed <= 4.05f, String.format("%.1f", s.c.tSpeed));
            float last = s.c.tSpeed, mj = 0; for (int q = 0; q < 100; q++) { s.run(0.2); mj = Math.max(mj, Math.abs(s.c.tSpeed - last)); last = s.c.tSpeed; }
            t("Danach Stufen bis Plantempo", Math.abs(s.c.tSpeed - s.planNow()) < 0.05 && mj <= 3.05f, String.format("%.1f, grösste Stufe %.1f", s.c.tSpeed, mj));
            s.runTo(2000); s.cmd("{\"c\":\"stop\"}"); s.until(() -> s.b.speed < 0.1, 60); s.arm(); s.cmd("{\"c\":\"resume\"}");
            t("WEITER mit 1 km/h", s.c.tSpeed == 1.0f, String.format("%.1f", s.c.tSpeed));
            CoreSzenarien q = new CoreSzenarien(); q.run(0.4); q.arm(); q.cmd("{\"c\":\"start\"}");
            t("Schnellstart ohne Programm: 1 km/h, kein Einlaufziel", q.c.tSpeed == 1.0f && q.c.holdTarget < 0, String.format("%.1f", q.c.tSpeed));
        }
        { // 12 Handeingabe bricht laufende Stufe ab; Freilauf nach Programmende
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            s.cmd("{\"c\":\"speed\",\"v\":7}"); s.run(10);
            t("Handeingabe stoppt Anlauf-Stufen", Math.abs(s.c.tSpeed - 7) < 0.05, String.format("%.1f", s.c.tSpeed));
            CoreSzenarien f = new CoreSzenarien(); f.load("hallwilersee-runde", 7500); f.startRun();
            f.until(() -> f.c.progDone, 9000); f.run(25);
            f.cmd("{\"c\":\"speed\",\"v\":8}"); f.run(15);
            t("Tempo im Auslaufen: Freilauf statt STOP", "LAEUFT".equals(f.c.st) && f.c.endTimer < 0, f.c.st + " " + f.c.note);
        }
        { // 12b Geraetetasten: STOP sofort, START mit 3-s-Countdown, START im Lauf = Pause, Drehregler, Fotosperre
            CoreSzenarien s = new CoreSzenarien(); s.run(0.4);
            s.c.hwKey(KeyReader.K_SPEED_UP); s.c.hwKey(KeyReader.K_SPEED_UP);
            t("Drehregler Tempo in BEREIT: +0.2", Math.abs(s.c.tSpeed - 1.2f) < 0.01, String.format("%.1f", s.c.tSpeed));
            s.c.hwKey(KeyReader.K_GO); s.run(1);
            t("START-Taste: Countdown, Band steht noch", "BEREIT".equals(s.c.st) && s.c.hwStartAt > 0, s.c.st);
            s.c.hwKey(KeyReader.K_STOP); s.run(4);
            t("STOP-Taste bricht Countdown ab", "BEREIT".equals(s.c.st) && s.c.hwStartAt == 0, s.c.st);
            s.c.hwKey(KeyReader.K_GO); s.run(3.4);
            t("START-Taste: nach 3 s läuft das Band", "LAEUFT".equals(s.c.st), s.c.st + " " + s.c.note);
            s.run(5); s.c.hwKey(KeyReader.K_GO);
            t("START-Taste im Lauf: Pause", "PAUSE".equals(s.c.st), s.c.st);
            s.until(() -> s.b.speed < 0.1, 30); s.c.hwKey(KeyReader.K_GO); s.run(3.4);
            t("START-Taste in Pause: Weiter nach Countdown", "LAEUFT".equals(s.c.st), s.c.st);
            s.c.hwKey(KeyReader.K_STOP);
            t("STOP-Taste im Lauf: sofort Pause", "PAUSE".equals(s.c.st) && s.b.stops > 0, s.c.st);
            CoreSzenarien f = new CoreSzenarien(); f.run(0.4);
            new java.io.File(f.c.ctx.getFilesDir(), "nostart").createNewFile();
            f.c.hwKey(KeyReader.K_GO); f.run(4);
            t("Fotosperre: START-Taste startet nicht", "BEREIT".equals(f.c.st), f.c.st);
        }
        { // 13 Watchdog begrenzt auch die Steigung
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            int k = s.firstClimb(4); s.runTo(s.c.rp.a[k] - 400); s.lease = false; s.run(62);
            float inc0 = s.c.tIncl; s.runTo(s.c.rp.a[k] + 50);
            t("Ohne Lebenszeichen keine höhere Steigung", s.c.tIncl <= inc0, String.format("vorher %.1f, im Anstieg %.1f", inc0, s.c.tIncl));
        }
        { // 14 Wechselbeginn inklusive Vorlauf
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun();
            int k = s.firstClimb(4); RoutePlan p = s.c.rp;
            s.runTo(p.a[k - 1] + 10);
            JSONObject pr = s.prog();
            t("toChange berücksichtigt Vorlauf", pr.has("toChange") && pr.getLong("toChange") <= pr.getLong("toNext") - Math.round(p.lead(k)) + 1, pr.optLong("toChange") + " m statt " + pr.optLong("toNext"));
        }
        { // 15 Intervallwechsel in 3-km/h-Stufen (z. B. Stufentest 17 auf 6 km/h)
            CoreSzenarien s = new CoreSzenarien();
            String r = s.cmd("{\"c\":\"program\",\"p\":{\"type\":\"interval\",\"segs\":[{\"d\":90,\"s\":8,\"i\":1},{\"d\":90,\"s\":17,\"i\":1},{\"d\":90,\"s\":6,\"i\":1}]}}");
            s.startRun();
            s.until(() -> Math.abs(s.c.tSpeed - 8) < 0.05, 89);
            t("Intervall geladen, erstes Soll 8 km/h erreicht", r.contains("true") && Math.abs(s.c.tSpeed - 8) < 0.05 && s.c.segIdx <= 0, r + " " + s.c.tSpeed);
            java.util.List<Float> up = new java.util.ArrayList<Float>(), dn = new java.util.ArrayList<Float>();
            s.until(() -> s.c.segIdx == 1, 120);
            for (int k = 0; k < 400 && s.c.segIdx == 1; k++) { if (up.isEmpty() || up.get(up.size() - 1) != s.c.tSpeed) up.add(s.c.tSpeed); s.run(0.2); }
            for (int k = 0; k < 200; k++) { if (dn.isEmpty() || dn.get(dn.size() - 1) != s.c.tSpeed) dn.add(s.c.tSpeed); s.run(0.2); }
            boolean okUp = up.size() >= 3 && Math.abs(up.get(up.size() - 1) - 17) < 0.05, okDn = dn.size() >= 4 && Math.abs(dn.get(dn.size() - 1) - 6) < 0.05;
            float prev = 8; for (float v : up) { okUp &= Math.abs(v - prev) <= 3.05; prev = v; }
            for (float v : dn) { okDn &= Math.abs(v - prev) <= 3.05; prev = v; }
            t("Hoch 8 auf 17 in Stufen bis 3 km/h", okUp, up.toString());
            t("Runter 17 auf 6 in Stufen bis 3 km/h", okDn, dn.toString());
        }
        { // 17 Pause ohne Eingabe: nach 5 min beendet und gespeichert, Band steht
            CoreSzenarien s = new CoreSzenarien(); s.cmd("{\"c\":\"speed\",\"v\":6}"); s.startRun(); s.run(40);
            s.cmd("{\"c\":\"stop\"}"); s.run(200);
            String st1 = s.c.st; s.run(110);
            t("Pause bleibt unter 5 min", "PAUSE".equals(st1), st1);
            t("Nach 5 min Pause: BEREIT mit Zusammenfassung", "BEREIT".equals(s.c.st) && s.c.lastSummary != null && s.b.speed < 0.3f, s.c.st + " " + (s.c.lastSummary != null));
        }
        { // 16 echte Hauptschleife run(): kurzer Busausfall im Lauf, danach Wiederverbindung und nachgeholtes STOP
            final CoreSzenarien s = new CoreSzenarien(); s.cmd("{\"c\":\"speed\",\"v\":8}"); s.startRun(); s.run(30);
            final boolean[] go = { true };
            Thread phys = new Thread(() -> { while (go[0]) { synchronized (s.b) { s.b.step(0.2); } s.c.lastLease = Core.clock(); try { Thread.sleep(200); } catch (InterruptedException e) { return; } } });
            Thread core = new Thread(s.c); phys.start(); core.start();
            Thread.sleep(1500);
            float v0 = s.b.speed; int stops0 = s.b.stops;
            s.b.dead = true; Thread.sleep(1200);   // Herstellerdienst startet neu
            String st1 = s.c.st; s.b.dead = false;
            long t0 = System.currentTimeMillis(); while (System.currentTimeMillis() - t0 < 8000 && (s.c.busFail > 0 || s.b.running)) Thread.sleep(100);
            t("run(): Busausfall im Lauf -> FEHLER", "FEHLER".equals(st1), st1 + ", Band vorher " + v0);
            t("run(): verbindet nach dem Ausfall wieder", s.c.busFail == 0 && s.b.conn && s.b.connects > 1, "busFail " + s.c.busFail + ", connects " + s.b.connects);
            t("run(): STOP nachgeholt, Band haelt an", !s.b.running && s.b.stops > stops0, "stops " + stops0 + " -> " + s.b.stops + ", laeuft " + s.b.running);
            s.c.alive = false; go[0] = false; core.join(2000); phys.join(2000);
        }
        { // 18 langer Busausfall (20 s) durch die echte Hauptschleife: nach der Wiederverbindung wird STOP nachgeholt
            final CoreSzenarien s = new CoreSzenarien(); s.cmd("{\"c\":\"speed\",\"v\":8}"); s.startRun(); s.run(30);
            final boolean[] go = { true };
            Thread phys = new Thread(() -> { while (go[0]) { synchronized (s.b) { s.b.step(0.2); } s.c.lastLease = Core.clock(); try { Thread.sleep(200); } catch (InterruptedException e) { return; } } });
            Thread core = new Thread(s.c); phys.start(); core.start();
            Thread.sleep(1000); int stops0 = s.b.stops;
            s.b.dead = true; Thread.sleep(20000); s.b.dead = false;
            long t0 = System.currentTimeMillis(); while (System.currentTimeMillis() - t0 < 15000 && s.b.running) Thread.sleep(100);
            t("run(): nach 20 s Ausfall STOP nachgeholt", !s.b.running && s.b.stops > stops0 && "FEHLER".equals(s.c.st), "stops " + stops0 + " -> " + s.b.stops + ", laeuft " + s.b.running + ", " + s.c.st + ", busFail " + s.c.busFail);
            s.c.alive = false; go[0] = false; core.join(2000); phys.join(2000);
        }
        { // 19 WEITER erst, wenn das Band nach STOP steht
            CoreSzenarien s = new CoreSzenarien(); s.cmd("{\"c\":\"speed\",\"v\":10}"); s.startRun(); s.until(() -> s.b.speed > 9.5f, 120);
            s.cmd("{\"c\":\"stop\"}"); s.run(1); s.arm();
            String r1 = s.cmd("{\"c\":\"resume\"}");
            s.until(() -> s.b.speed < 0.1f, 60); s.arm();
            String r2 = s.cmd("{\"c\":\"resume\"}");
            t("WEITER beim Auslaufen abgelehnt, im Stand erlaubt", r1.contains("läuft noch aus") && r2.contains("true"), r1 + " / " + r2);
        }
        { // 20 Neustart des Dienstes im Lauf: Messwerte, Verlauf und Streckenstand bleiben; Band steht -> Pause mit Gehtempo
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun(); s.runTo(1500); s.run(31);
            double d0 = s.c.dist, e0 = s.c.elapsed; int h0 = s.c.hist.size();
            s.cmd("{\"c\":\"stop\"}"); s.until(() -> s.b.speed < 0.05f, 60); s.run(31);
            final CoreSzenarien n = new CoreSzenarien(s.files); n.b.speed = 0;
            final Thread core = new Thread(n.c); core.start(); Thread.sleep(1500); n.c.alive = false; core.join(2000);
            t("Neustart in der Pause: Lauf wiederhergestellt", "PAUSE".equals(n.c.st) && Math.abs(n.c.dist - s.c.dist) < 0.01 && n.c.elapsed >= e0 && n.c.hist.size() >= h0 && n.c.rp != null,
                n.c.st + ", " + String.format("%.2f km (vorher %.2f), %d Punkte", n.c.dist, d0, n.c.hist.size()));
            t("Weiter nach Neustart nur mit Gehtempo", n.c.tSpeed <= 3.0f && n.c.note.startsWith("Nach Unterbrechung"), n.c.tSpeed + " " + n.c.note);
            String e = n.cmd("{\"c\":\"end\"}");
            t("Ende loescht den Laufstand", !new java.io.File(s.files, "laufstand.json").exists() && e.contains("summary"), "");
        }
        { // 21 Neustart des Dienstes bei laufendem Band: Lauf geht mit allen Werten weiter
            CoreSzenarien s = new CoreSzenarien(); s.load("homberg-runde", 4200); s.startRun(); s.runTo(1200); s.run(31);
            double d0 = s.c.dist; int seg0 = s.c.segIdx;
            final CoreSzenarien n = new CoreSzenarien(s.files); n.b.speed = 9; n.b.running = true; n.b.target = 9;
            final Thread core = new Thread(n.c); core.start(); Thread.sleep(1500); n.c.alive = false; core.join(2000);
            t("Neustart im Lauf: Lauf und Streckenstand bleiben", "LAEUFT".equals(n.c.st) && n.c.dist >= d0 - 0.01 && n.c.rp != null && n.c.segIdx >= seg0, n.c.st + String.format(", %.2f km (vorher %.2f), Abschnitt %d (vorher %d)", n.c.dist, d0, n.c.segIdx, seg0));
        }
        { // 22 Sprung ins Auslaufen (Stufentest): nur vorwaerts, im Lauf in Stufen, in der Pause fuer WEITER vorbereitet
            CoreSzenarien s = new CoreSzenarien();
            s.cmd("{\"c\":\"program\",\"p\":{\"type\":\"interval\",\"segs\":[{\"d\":60,\"s\":8,\"i\":1},{\"d\":60,\"s\":14,\"i\":1},{\"d\":60,\"s\":17,\"i\":1},{\"d\":300,\"s\":6,\"i\":1}]}}");
            s.startRun(); s.until(() -> s.c.segIdx == 2 && Math.abs(s.c.tSpeed - 17) < 0.05, 300);
            String back = s.cmd("{\"c\":\"skipTo\",\"idx\":1}"), go = s.cmd("{\"c\":\"skipTo\",\"idx\":3}");
            java.util.List<Float> dn = new java.util.ArrayList<Float>(); for (int k = 0; k < 100; k++) { s.run(0.2); if (dn.isEmpty() || dn.get(dn.size() - 1) != s.c.tSpeed) dn.add(s.c.tSpeed); }
            boolean st = true; float pv = 17; for (float v : dn) { st &= pv - v <= 3.05f; pv = v; }
            t("Sprung ins Auslaufen: rueckwaerts abgelehnt, vorwaerts in Stufen auf 6", back.contains("vorwärts") && go.contains("true") && s.c.segIdx == 3 && Math.abs(s.c.tSpeed - 6) < 0.05 && st, back + " " + dn);
            CoreSzenarien q = new CoreSzenarien();
            q.cmd("{\"c\":\"program\",\"p\":{\"type\":\"interval\",\"segs\":[{\"d\":60,\"s\":8,\"i\":1},{\"d\":60,\"s\":14,\"i\":1},{\"d\":300,\"s\":6,\"i\":0}]}}");
            q.startRun(); q.until(() -> q.c.segIdx == 1, 200); q.cmd("{\"c\":\"stop\"}"); q.until(() -> q.b.speed < 0.05f, 60);
            String pz = q.cmd("{\"c\":\"skipTo\",\"idx\":2}");
            t("Sprung in der Pause: WEITER faehrt ins Auslaufen", pz.contains("true") && "PAUSE".equals(q.c.st) && q.c.segIdx == 2 && Math.abs(q.c.tSpeed - 6) < 0.05 && q.c.tIncl == 0f, pz + " " + q.c.tSpeed + "/" + q.c.tIncl);
        }
        { // 23 Neustart des Dienstes, die ersten Lesungen scheitern 2 s lang, das Band laeuft: Uebernahme statt STOP
            CoreSzenarien s = new CoreSzenarien(); s.cmd("{\"c\":\"speed\",\"v\":8}"); s.startRun(); s.run(40); s.run(31);
            final CoreSzenarien n = new CoreSzenarien(s.files); n.b.speed = 8; n.b.running = true; n.b.target = 8; n.b.dead = true;
            final Thread core = new Thread(n.c); core.start(); Thread.sleep(2000); n.b.dead = false; Thread.sleep(2500);
            n.c.alive = false; core.join(3000);
            t("Neustart mit verzoegertem Bus: Lauf uebernommen, kein STOP", "LAEUFT".equals(n.c.st) && n.b.running && n.b.stops == 0 && n.c.elapsed > 30, n.c.st + ", laeuft " + n.b.running + ", stops " + n.b.stops + ", Zeit " + Math.round(n.c.elapsed));
        }
        { // 24 Wache: haengt die Hauptschleife (Busaufruf blockiert), meldet die Abfrage sofort, nach 15 s Neustart des Prozesses
            final CoreSzenarien s = new CoreSzenarien(); s.cmd("{\"c\":\"speed\",\"v\":6}"); s.startRun(); s.run(30);
            int k0 = android.os.Process.kills;
            Thread core = new Thread(s.c); core.start(); Thread.sleep(1000);
            s.b.hang = true; Thread.sleep(3000);
            boolean stale = Core.clock() - s.c.lastTickAt > 2000;
            Thread.sleep(15000);
            String box = new String(java.nio.file.Files.readAllBytes(new java.io.File(s.files, "blackbox.log").toPath()), "UTF-8");
            t("Wache: Haenger erkannt, Blackbox, Prozess neu gestartet", stale && android.os.Process.kills > k0 && box.contains("wache: hauptschleife steht") && box.contains("wache: prozess wird neu gestartet"), "kills " + (android.os.Process.kills - k0));
            s.b.hang = false; s.c.alive = false; core.join(3000);
        }
        System.out.println();
        System.out.println("Ergebnis: " + ok + " bestanden, " + fail + " fehlgeschlagen");
        System.exit(fail == 0 ? 0 : 1);
    }
}
