package com.gapsch.treadctl;

/** Attrappe: Startbildschirm nur merken. */
public class HomeScreen {
    public static boolean ours = true;
    static boolean isOurs(android.content.Context c) { return ours; }
    static boolean set(android.content.Context c, boolean o) { ours = o; return true; }
}
