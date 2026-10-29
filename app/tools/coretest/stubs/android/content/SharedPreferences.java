package android.content;

/** Attrappe: Einstellungen im Speicher. */
public class SharedPreferences {
    final java.util.HashMap<String, Object> m = new java.util.HashMap<String, Object>();
    public boolean getBoolean(String k, boolean d) { Object v = m.get(k); return v instanceof Boolean ? (Boolean) v : d; }
    public Editor edit() { return new Editor(); }
    public class Editor {
        public Editor putBoolean(String k, boolean v) { m.put(k, v); return this; }
        public Editor putInt(String k, int v) { m.put(k, v); return this; }
        public void apply() {}
    }
}
