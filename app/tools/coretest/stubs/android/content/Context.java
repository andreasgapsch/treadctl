package android.content;

/** Testattrappe: nur was Core braucht. */
public class Context {
    public static final String ACTIVITY_SERVICE = "activity";
    final java.io.File files; final String assets;
    public Context(java.io.File files, String assets) { this.files = files; this.assets = assets; }
    public java.io.File getFilesDir() { return files; }
    public ContentResolver getContentResolver() { return new ContentResolver(); }
    public Object getSystemService(String n) { return null; }
    public android.content.res.AssetManager getAssets() { return new android.content.res.AssetManager(assets); }
}
