package android.os;

/** Attrappe: in den Tests nie den Prozess beenden, nur zaehlen. */
public class Process {
    public static int kills = 0;
    public static int myPid() { return 1; }
    public static void killProcess(int pid) { kills++; }
}
