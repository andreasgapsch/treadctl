package android.provider;

import android.content.ContentResolver;

/** Testattrappe: Einstellungen im Speicher. */
public class Settings {
    static final java.util.HashMap<String, String> M = new java.util.HashMap<String, String>();
    public static class Global { public static String getString(ContentResolver r, String k) { return M.get("g" + k); } public static boolean putString(ContentResolver r, String k, String v) { M.put("g" + k, v); return true; } }
    public static class Secure { public static String getString(ContentResolver r, String k) { return M.get("s" + k); } public static boolean putString(ContentResolver r, String k, String v) { M.put("s" + k, v); return true; } }
}
