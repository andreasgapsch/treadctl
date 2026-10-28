# Konzept: Mini-Player im Kopf der Standardseiten

Stand 28.10.2026.

## Ziel

Musik (YouTube Music) und Hörbücher (Audiobookshelf) laufen im Hintergrund, während die eigene
Oberfläche oder eine Trainingsansicht im Vordergrund ist. Der Player im Kopf zeigt, was läuft, und
bedient das Häufigste direkt: Wiedergabe/Pause und Lautstärke. Alles Weitere (Quelle, Titel vor und zurück,
Fortschritt, Abspielgerät, App öffnen) liegt eine Berührung tiefer im Player-Fenster.

## Kopf-Kapsel

Eine Glas-Kapsel rechts im Kopf, 56 px hoch.

**Normal (Start, Programme, Profil):**

`[Cover] Titel / Interpret | ⏯ | 🔉 🔊`

- Im Kopf nur Wiedergabe/Pause und Lautstärke. Vor, zurück und die Quelle
  liegen im Player-Fenster.
- Alle Knöpfe gleich: 48 px rund, gleicher Glas-Hintergrund. Wiedergabe und Pause unterscheiden
  sich nur durch die gefüllte helle Fläche, nicht durch die Grösse.
- Ein feiner Trennstrich zwischen Wiedergabe und Lautstärke.
- Lautstärke: jeder Tipp 1 Stufe (Android-Medienlautstärke, wirkt auch auf den Bluetooth-Lautsprecher).
  Unter der Kapsel erscheint 1.5 s eine Anzeige «Lautstärke 7/15» mit Balken.
- Dünner Fortschrittsbalken am unteren Rand, Farbe der Quelle (YouTube Music rot, Hörbücher grün).

**Kompakt (Trainingsansichten, Laufwerte haben Vorrang):** `[Cover] ⏯ | 🔉 🔊` ohne Titel.

**Läuft nichts:** Kapsel «Musik» mit Notensymbol, Tipp öffnet das Player-Fenster.

**Tipp auf Cover oder Titel:** öffnet das Player-Fenster (nicht mehr direkt die App).

## Player-Fenster

Ausklappfenster unter der Kapsel im Stil des Pulsmenüs (Glas, 500 px breit), schliesst bei Tipp
daneben, nach 20 s ohne Bedienung und mit ✕.

1. **Quelle:** zwei Kacheln nebeneinander, YouTube Music und Hörbücher, je mit Zustand
   («spielt», «pausiert · Titel», «nicht gestartet»). Die laufende ist markiert.
   Tipp auf die andere Quelle: die laufende Wiedergabe pausiert, die andere setzt dort fort, wo sie
   zuletzt war. Hat die andere App noch keine Sitzung, öffnet sich die App (ein Tipp auf Play dort).
2. **Jetzt:** Cover 96 px, Titel, Interpret bzw. Hörbuch, Fortschritt mit Zeiten (1:03 / 3:34).
3. **Steuerung:** ⏮ ⏯ ⏭ (Hörbücher −30 s, ⏯, +30 s), 56 px, gleiche Form wie im Kopf.
4. **Lautstärke:** 🔉 [Balken mit Stufen, antippbar] 🔊 mit Stufe (7/15).
5. **Abspielgerät:** Kacheln «Konsole» (eingebaut) und je gekoppeltem Bluetooth-Lautsprecher (z. B.
   ein Sonos-Lautsprecher), aktive markiert («spielt hier»). Tipp verbindet bei Bedarf («verbindet …») und
   schaltet den Ton dorthin; «Konsole» nimmt den Bluetooth-Lautsprecher aus der Wiedergabe, er bleibt
   verbunden. Koppeln neuer Geräte über die Seite «Geräte» bzw. die Bluetooth-Einstellungen.
6. **Fuss:** «In App öffnen». Das Fenster scrollt, wenn es höher als der Bildschirm wird.

## Technik

- Dienst `MediaWatch` (Android-Mediensitzungen, Recht MEDIA_CONTENT_CONTROL der Plattform-App) und `AudioOut`
  (A2DP connect/setActiveDevice). Schnittstelle: `api.md`, Abschnitt Medien.
- `source` pausiert andere Sitzungen und setzt die gewünschte fort; ohne Sitzung `error: "start"`, dann startet
  die Oberfläche die App.
- Die zuletzt gewählte Quelle hat bei der Anzeige Vorrang, auch wenn sie pausiert ist.
- Lautstärke über `AudioManager.STREAM_MUSIC` ohne Systemanzeige (Flag 0).
- Abfrage alle 3 s bei Wiedergabe, sonst alle 5 s, bei versteckter Seite alle 10 s; nach einem Befehl sofort. Das Cover wird nur bei einem neuen Bild geladen. Keine Netzabhängigkeit.

## Apps

- YouTube Music (`com.google.android.apps.youtube.music`); andere Fassungen erkennt der Dienst am Paketnamen.
- Hörbücher: Audiobookshelf (`com.audiobookshelf.app`) vom Heimserver.
