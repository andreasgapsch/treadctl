// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Andreas Gapsch
package com.gapsch.treadctl;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.util.Log;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/** Sprachansagen aus Bausteinen (assets/stimme/<schluessel>.ogg, erzeugt mit tools/stimme/erzeugen.py): die Konsole hat
 *  keine Sprachausgabe. Eine Ansage ist eine Folge von Schluesseln; sie werden nacheinander abgespielt, Musik und Videos
 *  werden dabei leiser (Audiofokus «vorübergehend, leiser stellen erlaubt»). Eigener Thread: der Kern wartet nie. */
public class Announcer {
    static final String T = "TREADCTL";
    final Context ctx;
    final LinkedBlockingQueue<String[]> q = new LinkedBlockingQueue<String[]>(6);   // voll: neue Ansage verwerfen statt stauen
    final AudioAttributes attr = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();

    Announcer(Context c) {
        ctx = c.getApplicationContext();
        Thread t = new Thread(new Runnable() { public void run() { loop(); } }, "ansagen");
        t.setDaemon(true); t.start();
    }

    /** Ansage einreihen (vom Kern, unter dessen Sperre: nur einreihen, nie warten). */
    void say(String[] keys) { if (keys != null && keys.length > 0 && !q.offer(keys)) Log.w(T, "ansage verworfen (Warteschlange voll)"); }

    void loop() {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        AudioFocusRequest fr = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attr).build();
        while (true) {
            String[] keys;
            try { keys = q.take(); } catch (InterruptedException e) { return; }
            try {
                am.requestAudioFocus(fr);
                for (String k : keys) play(k);
                // direkt folgende Ansagen ohne Fokuswechsel anhaengen
                String[] more;
                while ((more = q.poll(150, TimeUnit.MILLISECONDS)) != null) { Thread.sleep(250); for (String k : more) play(k); }
            } catch (Throwable e) { Log.w(T, "ansage: " + e); }
            finally { try { am.abandonAudioFocusRequest(fr); } catch (Throwable e) {} }
        }
    }

    /** Einen Baustein abspielen und auf sein Ende warten (hoechstens 4 s). */
    void play(String key) {
        MediaPlayer mp = null;
        try {
            AssetFileDescriptor fd = ctx.getAssets().openFd("stimme/" + key + ".ogg");
            mp = new MediaPlayer(); mp.setAudioAttributes(attr);
            mp.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength()); fd.close();
            final CountDownLatch done = new CountDownLatch(1);
            mp.setOnCompletionListener(new MediaPlayer.OnCompletionListener() { public void onCompletion(MediaPlayer m) { done.countDown(); } });
            mp.setOnErrorListener(new MediaPlayer.OnErrorListener() { public boolean onError(MediaPlayer m, int a, int b) { done.countDown(); return true; } });
            mp.prepare(); mp.start();
            done.await(4, TimeUnit.SECONDS);
            Thread.sleep(40);   // kurze Fuge zwischen den Bausteinen
        } catch (Throwable e) { Log.w(T, "baustein " + key + ": " + e); }
        finally { if (mp != null) try { mp.release(); } catch (Throwable e) {} }
    }
}
