package android.os;

/** Attrappe: in den Tests nie den Prozess beenden, nur zaehlen. */
public class Process {
    public static int kills = 0;
    public static final int THREAD_PRIORITY_URGENT_DISPLAY = -8, THREAD_PRIORITY_BACKGROUND = 10;
    public static void setThreadPriority(int p) {}
    public static int myPid() { return 1; }
    public static void killProcess(int pid) { kills++; }
}
