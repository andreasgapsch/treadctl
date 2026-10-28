import com.gapsch.treadctl.RoutePlan;
import java.io.BufferedReader;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.Locale;

/** Zeitraffer-Simulation des Streckenmodus mit derselben Planung wie der Dienst (RoutePlan)
 *  und derselben Laufzeitlogik wie Core.runRoute. Bandmodell: Tempo folgt dem Soll mit
 *  0.5 km/h je s, Steigungsmotor 0.6 %/s.
 *  Aufruf: java RouteSim <profil.txt> <zielzeit s> <terrain|even> <scale> <trail 0|1> [offS ab km] [offS]
 *  Hinweis: die echte Laufzeitlogik pruefen die Szenariotests in tools/coretest (Core gegen Bandattrappe).
 *  Ausgabe: eine JSON-Zeile mit Kennzahlen und Verlauf (alle 10 s). */
public class RouteSim {
    public static void main(String[] a) throws Exception {
        ArrayList<double[]> pr = new ArrayList<double[]>();
        BufferedReader r = new BufferedReader(new FileReader(a[0])); String l;
        while ((l = r.readLine()) != null) { String[] p = l.trim().split("\\s+"); if (p.length == 2) pr.add(new double[]{Double.parseDouble(p[0]), Double.parseDouble(p[1])}); }
        double[] pd = new double[pr.size()], pe = new double[pr.size()];
        for (int i = 0; i < pd.length; i++) { pd[i] = pr.get(i)[0]; pe[i] = pr.get(i)[1]; }
        double target = Double.parseDouble(a[1]);
        long t0 = System.nanoTime();
        RoutePlan p = RoutePlan.build(pd, pe, target, !"even".equals(a[2]), Double.parseDouble(a[3]), "1".equals(a[4]));
        double planMs = (System.nanoTime() - t0) / 1e6;
        double offAtKm = a.length > 5 ? Double.parseDouble(a[5]) : -1, offVal = a.length > 6 ? Double.parseDouble(a[6]) : 0;

        // Laufzeit wie Core: Abschnittswechsel setzen Soll, Steigung mit Vorlauf
        double dt = 0.2, t = 0, x = 0, v = 0, inc = 0, tS = p.sp[0], tI = p.in[0], offS = 0;
        int seg = 0, iseg = 0, inclChanges = 0, speedChanges = 0;
        double maxJump = 0, maxInc = 0, minV = 99, maxV = 0, lagMax = 0, inclMoveT = 0;
        StringBuilder tl = new StringBuilder();
        double nextLog = 0; boolean offDone = false;
        while (x < p.D && t < target * 3) {
            if (!offDone && offAtKm >= 0 && x >= offAtKm * 1000) { offDone = true; offS = offVal; tS = p.sp[seg] + offS; }
            int i = p.idxAt(x);
            if (i != seg) { double ns = Math.max(0.8, Math.min(20, Math.round((p.sp[i] + offS) * 10) / 10.0)); maxJump = Math.max(maxJump, Math.abs(ns - tS)); if (ns != tS) speedChanges++; seg = i; tS = ns; }
            int ii = p.inclIdxAt(x, tS, 0);
            if (ii < iseg && iseg <= i + 1 && iseg >= i) ii = iseg;
            if (ii != iseg) { iseg = ii; if (p.in[ii] != tI) inclChanges++; tI = p.in[ii];
                if (ii == i + 1 && p.in[ii] > p.in[i] && p.sp[ii] < p.sp[i]) { double ns = Math.round((p.sp[ii] + offS) * 10) / 10.0; maxJump = Math.max(maxJump, Math.abs(ns - tS)); tS = ns; } }
            // Band
            double dv = tS - v; v += Math.max(-0.5 * dt, Math.min(0.5 * dt, dv));
            double di = tI - inc; if (Math.abs(di) > 0.01) inclMoveT += dt; inc += Math.max(-0.6 * dt, Math.min(0.6 * dt, di));
            x += v / 3.6 * dt; t += dt;
            if (t > 10) { minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
            maxInc = Math.max(maxInc, inc);
            // Wie weit hinkt die Steigung dem Plan hinterher (an Abschnittsanfaengen gemessen)
            int pi = p.idxAt(x); if (x - p.a[pi] < 5 && x > 5) lagMax = Math.max(lagMax, Math.abs(Math.min(15, Math.max(0, p.in[pi])) - inc));
            if (t >= nextLog) {
                nextLog += 10;
                if (tl.length() > 0) tl.append(',');
                tl.append(String.format(Locale.US, "[%.0f,%.0f,%.1f,%.1f,%.1f,%.0f,%.1f]", t, x, v, inc, p.eleAt(x), p.tPlanAt(x), tS));
            }
        }
        int secsShort = 0; for (int i = 0; i < p.n; i++) if (p.b[i] - p.a[i] < 150) secsShort++;
        System.out.println(String.format(Locale.US,
            "{\"D\":%.0f,\"target\":%.0f,\"plan\":%.1f,\"sim\":%.1f,\"n\":%d,\"short\":%d,\"inclChanges\":%d,\"speedChanges\":%d,\"maxJump\":%.1f,"
            + "\"minV\":%.1f,\"maxV\":%.1f,\"maxInc\":%.1f,\"lagMax\":%.1f,\"inclMoveT\":%.0f,\"up\":%.0f,\"down\":%.0f,\"capped\":%d,\"planMs\":%.1f,"
            + "\"secs\":%s,\"tl\":[%s]}",
            p.D, target, p.total, t, p.n, secsShort, inclChanges, speedChanges, maxJump, minV, maxV, maxInc, lagMax, inclMoveT, p.up, p.down, p.capped, planMs,
            secs(p), tl));
    }
    static String secs(RoutePlan p) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < p.n; i++) { if (i > 0) b.append(','); b.append(String.format(Locale.US, "[%.0f,%.0f,%.1f,%.1f,%.1f]", p.a[i], p.b[i], p.sp[i], p.in[i], p.g[i])); }
        return b.append(']').toString();
    }
}
