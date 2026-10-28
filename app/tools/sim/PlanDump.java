import com.gapsch.treadctl.RoutePlan;
import java.io.BufferedReader;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.Locale;

/** Nur Planung (fuer den Abgleich mit dem JS-Port im UI-Audit), mit allen Schaltern inkl. gpxHeights.
 *  Aufruf: java PlanDump <profil.txt> <zielzeit> <terrain|even> <scale> <trail 0|1> <gpx 0|1>
 *  Ausgabe: {"plan":..,"n":..,"capped":..,"up":..,"down":..,"secs":[[a,b,speed,incl,grad],..]} */
public class PlanDump {
    public static void main(String[] a) throws Exception {
        ArrayList<double[]> pr = new ArrayList<double[]>();
        BufferedReader r = new BufferedReader(new FileReader(a[0])); String l;
        while ((l = r.readLine()) != null) { String[] p = l.trim().split("\\s+"); if (p.length == 2) pr.add(new double[]{Double.parseDouble(p[0]), Double.parseDouble(p[1])}); }
        double[] pd = new double[pr.size()], pe = new double[pr.size()];
        for (int i = 0; i < pd.length; i++) { pd[i] = pr.get(i)[0]; pe[i] = pr.get(i)[1]; }
        RoutePlan p = RoutePlan.build(pd, pe, Double.parseDouble(a[1]), !"even".equals(a[2]), Double.parseDouble(a[3]), "1".equals(a[4]), "1".equals(a[5]));
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < p.n; i++) { if (i > 0) b.append(','); b.append(String.format(Locale.US, "[%.0f,%.0f,%.1f,%.1f,%.1f]", p.a[i], p.b[i], p.sp[i], p.in[i], p.g[i])); }
        b.append(']');
        System.out.println(String.format(Locale.US, "{\"plan\":%.1f,\"n\":%d,\"capped\":%d,\"up\":%.0f,\"down\":%.0f,\"secs\":%s}", p.total, p.n, p.capped, p.up, p.down, b));
    }
}
