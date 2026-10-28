// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.util.Log;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** HTTP-Server nur auf 127.0.0.1. Pool waechst bei Bedarf bis 48 Threads (keine Warteschlange): haengende Verbindungen
 *  (langsame oder fehlerhafte App) duerfen STOP nie warten lassen. Wer nach 1.5 s noch nichts gesendet hat, fliegt raus. */
public class Httpd implements Runnable {
    final TreadDaemon d;
    final int port;
    volatile boolean run = true;
    ServerSocket ss;
    final ThreadPoolExecutor pool = new ThreadPoolExecutor(4, 48, 30, TimeUnit.SECONDS, new SynchronousQueue<Runnable>());

    public Httpd(TreadDaemon d, int port) { this.d = d; this.port = port; }

    public void run() {
        while (run) {
            try {
                ss = new ServerSocket(port, 32, InetAddress.getByName("127.0.0.1"));
                ss.setReuseAddress(true);
                while (run) {
                    Socket s = ss.accept();
                    s.setSoTimeout(1500);
                    try { pool.execute(new Conn(d, s)); }
                    catch (java.util.concurrent.RejectedExecutionException re) { try { s.close(); } catch (Exception e) {} }   // voll: diese Verbindung ablehnen, der Server laeuft weiter
                }
            } catch (Exception e) {
                try { if (ss != null) ss.close(); } catch (Exception e2) {}   // vor dem Neuversuch freigeben, sonst ist der Port belegt
                if (run) { Log.e("TREADCTL", "httpd: " + e); try { Thread.sleep(1000); } catch (InterruptedException ie) { return; } }
            }
        }
    }

    public void stop() {
        run = false;
        try { if (ss != null) ss.close(); } catch (Exception e) {}
        pool.shutdownNow();
    }
}
