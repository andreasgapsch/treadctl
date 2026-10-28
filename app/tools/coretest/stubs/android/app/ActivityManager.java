package android.app;

public class ActivityManager {
    public static class RunningTaskInfo { public android.content.ComponentName topActivity; }
    public java.util.List<RunningTaskInfo> getRunningTasks(int n) { return null; }
    public void killBackgroundProcesses(String pkg) {}
    public static class RunningAppProcessInfo { public String[] pkgList; }
    public static java.util.List<String> running = new java.util.ArrayList<String>(), stopped = new java.util.ArrayList<String>();
    public java.util.List<RunningAppProcessInfo> getRunningAppProcesses() {
        java.util.List<RunningAppProcessInfo> l = new java.util.ArrayList<RunningAppProcessInfo>();
        for (String q : running) { RunningAppProcessInfo i = new RunningAppProcessInfo(); i.pkgList = new String[]{ q }; l.add(i); }
        return l;
    }
    public void forceStopPackage(String pkg) { stopped.add(pkg); running.remove(pkg); }
}
