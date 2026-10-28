package android.os;

/** Attrappe: monotone Uhr wie auf dem Geraet (springt nicht mit der Wanduhr). */
public class SystemClock {
    public static long elapsedRealtime() { return System.nanoTime() / 1000000L; }
    public static long uptimeMillis() { return System.nanoTime() / 1000000L; }
}
