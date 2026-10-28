package android.content;

/** Testattrappe: nur was Core braucht. */
public class Context {
    public static final String ACTIVITY_SERVICE = "activity";
    final java.io.File files; final String assets;
    public Context(java.io.File files, String assets) { this.files = files; this.assets = assets; }
    public java.io.File getFilesDir() { return files; }
    public ContentResolver getContentResolver() { return new ContentResolver(); }
    public static final int MODE_PRIVATE = 0;
    final java.util.HashMap<String, SharedPreferences> sp = new java.util.HashMap<String, SharedPreferences>();
    public SharedPreferences getSharedPreferences(String n, int m) { if (!sp.containsKey(n)) sp.put(n, new SharedPreferences()); return sp.get(n); }
    public Object getSystemService(String n) { return "activity".equals(n) ? new android.app.ActivityManager() : null; }
    public android.content.res.AssetManager getAssets() { return new android.content.res.AssetManager(assets); }
}
