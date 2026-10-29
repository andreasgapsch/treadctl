package com.gapsch.treadctl;

/** Attrappe: Ansagen nur zaehlen (Core merkt sich den Text in said). */
public class Announcer {
    public int count = 0;
    void say(String[] keys) { count++; }
}
