package android.content.res;

public class AssetManager {
    final String root;
    public AssetManager(String root) { this.root = root; }
    public java.io.InputStream open(String p) throws java.io.IOException { return new java.io.FileInputStream(new java.io.File(root, p)); }
    public String[] list(String p) { String[] r = new java.io.File(root, p).list(); return r == null ? new String[0] : r; }
}
