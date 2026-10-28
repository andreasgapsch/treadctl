# Concept: mini player in the header

As of 28.10.2026.

## Goal

Music (YouTube Music) and audiobooks (Audiobookshelf) play in the background while the own UI or a training view is
in the foreground. The player in the header shows what is playing and handles the most common actions directly:
play/pause and volume. Everything else (source, skipping, progress, playback device, opening the app) is one tap
deeper in the player panel.

## Header capsule

A glass capsule on the right of the header, 56 px high.

**Normal (home, programs, profile):** `[cover] title / artist | ⏯ | 🔉 🔊`

- In the header only play/pause and volume. Skipping and the source are in the player panel.
- All buttons equal: 48 px round, same glass background. Play and pause differ only by the filled light surface,
  not by size.
- A thin divider between playback and volume.
- Volume: one step per tap (Android media volume, also applies to a Bluetooth speaker). Below the capsule a
  "volume 7/15" indicator with a bar appears for 1.5 s.
- Thin progress bar at the bottom edge in the colour of the source (YouTube Music red, audiobooks green).

**Compact (training views, running values take priority):** `[cover] ⏯ | 🔉 🔊` without title.

**Nothing playing:** capsule "Musik" with a note icon; a tap opens the player panel.

**Tap on cover or title:** opens the player panel.

## Player panel

Drop-down panel below the capsule in the style of the heart-rate menu (glass, 500 px wide); closes on a tap
outside, after 20 s without input and with ✕. It never covers the control bar at the bottom.

1. **Source:** two tiles, YouTube Music and audiobooks, each with its state ("playing", "paused · title",
   "not started"); the current one is marked. A tap on the other source pauses the current playback and resumes the
   other one where it stopped. If the other app has no session yet, the app opens.
2. **Now:** cover, title, artist or book, progress with times (1:03 / 3:34).
3. **Controls:** ⏮ ⏯ ⏭ (audiobooks −30 s, ⏯, +30 s), 56 px, same shape as in the header.
4. **Volume:** 🔉 [bar with steps, tappable] 🔊 with the step (7/15).
5. **Playback device:** tiles "console" (built in) and one per paired Bluetooth speaker; the active one is marked
   ("playing here"). A tap connects if needed ("connecting …") and routes the sound there; "console" takes the
   Bluetooth speaker out of playback, it stays connected.
6. **Footer:** "open in app". The panel scrolls if it gets taller than the screen.

## Technology

- Service `MediaWatch` (Android media sessions, permission MEDIA_CONTENT_CONTROL of the platform app) and `AudioOut`
  (A2DP connect/setActiveDevice). Interface: [api.md](api.md), section media.
- `source` pauses other sessions and resumes the requested one; without a session `error: "start"`, then the UI
  launches the app.
- The most recently chosen source takes priority in the display, even when paused.
- Volume via `AudioManager.STREAM_MUSIC` without the system indicator.
- Polling every 3 s while playing, otherwise 5 s, hidden page 10 s; immediately after a command. The cover is only
  reloaded for a new image. No network dependency.

## Apps

- YouTube Music (`com.google.android.apps.youtube.music`); other builds are recognised by their package name.
- Audiobooks: Audiobookshelf (`com.audiobookshelf.app`) from a home server.
