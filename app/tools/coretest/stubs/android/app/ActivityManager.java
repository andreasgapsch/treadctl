package android.app;

public class ActivityManager {
    public static class RunningTaskInfo { public android.content.ComponentName topActivity; }
    public java.util.List<RunningTaskInfo> getRunningTasks(int n) { return null; }
    public void killBackgroundProcesses(String pkg) {}
    public static class RunningAppProcessInfo { public String[] pkgList; }
    public java.util.List<RunningAppProcessInfo> getRunningAppProcesses() { return null; }
    public void forceStopPackage(String pkg) {}
}
