package com.gapsch.treadctl;

import android.content.Context;

/** Bandattrappe fuer Szenariotests: gleiche Methoden wie der echte DataMatrix-Bus, dazu ein
 *  einfaches Bandmodell (Tempo 0.5 km/h je s, Steigungsmotor 0.6 %/s, STOP bremst auf 0). */
public class DataBus {
    public float speed, incline, target, inclTarget; public boolean running; public int hr = 140;
    public boolean pulled = false, safe = true, dead = false;
    public int starts, stops;

    public boolean conn = true; public int connects; public volatile boolean hang;   // hang: jeder Aufruf blockiert (haengender Herstellerdienst)   // nach reset() getrennt bis zum naechsten connect() (wie der echte Bus)
    public boolean connect(Context ctx) { connects++; conn = !dead; return conn; }
    public boolean isConnected() { return conn && !dead; }
    public void reset() { conn = false; }
    public float getFloat(String k) throws Exception {
        while (hang) Thread.sleep(50);
        if (dead || !conn) throw new Exception("tot");
        if (k.equals(Core.D_SPEED)) return speed;
        if (k.equals(Core.D_INCL)) return incline;
        if (k.equals(Core.D_TGT_S)) return running ? target : 0f;
        return 0f;
    }
    public int getInt(String k) throws Exception { if (dead || !conn) throw new Exception("tot"); return hr; }
    public int getBool(String k) throws Exception {
        if (dead || !conn) throw new Exception("tot");
        if (k.equals(Core.D_PULLED)) return pulled ? 1 : 0;
        if (k.equals(Core.D_SAFE)) return safe && !pulled ? 1 : 0;
        return 0;
    }
    public void putFloat(String k, float v) throws Exception {
        if (dead || !conn) throw new Exception("tot");
        if (k.equals(Core.A_SPEED)) target = v;
        if (k.equals(Core.A_INCL)) inclTarget = v;
    }
    public void putBool(String k, boolean v) {}
    public void sendEvent(String k) throws Exception {
        if (dead || !conn) throw new Exception("tot");
        if (k.equals(Core.A_START)) { running = true; starts++; }
        if (k.equals(Core.A_STOP)) { running = false; stops++; }
    }

    /** Physik einen Schritt weiter. */
    public void step(double dt) {
        if (pulled) running = false;
        float want = running ? target : 0f;
        float dv = want - speed; speed += (float) Math.max(-0.5 * dt, Math.min(0.5 * dt, dv)); if (speed < 0.05f && want == 0) speed = 0;
        float di = inclTarget - incline; incline += (float) Math.max(-0.6 * dt, Math.min(0.6 * dt, di));
    }
}
