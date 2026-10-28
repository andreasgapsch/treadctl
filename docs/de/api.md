# TreadCtl API (Vertrag zwischen Dienst, Oberfläche und Pille)

Stand Version 4.6. Server `http://127.0.0.1:8765`, nur lokal, liefert auch die statischen Dateien aus `assets/www`.

## Grundregeln

- **Host:** Nur `127.0.0.1:8765` oder `localhost:8765` als `Host`-Kopf, sonst 403 «host».
- **Token:** Alle Befehle (POST, DELETE) und einige Abfragen brauchen den Kopf `X-Token`. Der Dienst erzeugt das Token beim Start (32 Byte, Datei `files/token`, nur für die eigene uid lesbar). Die Weboberfläche holt es über `TreadNative.token()`, die Pille liest die Datei. Ohne gültiges Token: 403. Vergleich in konstanter Zeit.
- **Ursprung:** Ein `Origin`-Kopf muss `http://127.0.0.1:8765` oder `http://localhost:8765` sein, sonst 403 (kein CORS).
- **Antworten:** `{"ok":true, …}` oder `{"ok":false,"error":"…"}`. Hängt die Hauptschleife des Dienstes, antwortet `GET /api/state` sofort mit 503 «Steuerkern reagiert nicht».
- **Lebenszeichen:** `GET /api/state` mit gültigem Token zählt als Lebenszeichen der Bedienung. Ohne Lebenszeichen über 60 s regeln Programme nicht mehr hoch und das Tempo wird auf höchstens 4 km/h begrenzt.
- **Server:** Thread-Pool wächst bei Bedarf bis 48, keine Warteschlange; wer 1.5 s nichts sendet, wird getrennt. Bei Überlast wird eine Verbindung sofort abgelehnt, statt zu warten (STOP hat dann den direkten Weg, siehe «STOP-Wege»).

## Zustand lesen

`GET /api/state` (ohne Token lesbar), mit `?hist=1` zusätzlich Verlauf und Streckenplan:

```
{
 "ok": true,
 "st": "BEREIT" | "LAEUFT" | "PAUSE" | "FEHLER",
 "err": "",            // Grund bei FEHLER, z. B. "Sicherheitsschlüssel gezogen", "Herstellerbus getrennt"
 "note": "",           // Hinweis, z. B. "Nach Unterbrechung: Weiter mit 3.0 km/h (Gehtempo)"
 "speed": 12.3, "incline": 4.0,     // Ist km/h, %
 "tSpeed": 12.5, "tIncl": 4.0,      // Soll km/h, %
 "hr": 142, "hrOk": true, "hrSrc": "bluetooth" | "geraet" | "",
 "pulled": 0,          // 1 = Sicherheitsschlüssel gezogen, -1 = unbekannt (Bus nicht lesbar)
 "safe": 1,
 "elapsed": 1455, "dist": 4.83, "kcal": 312, "elev": 186,
 "src": "ui",          // letzte Quelle einer Änderung: ui, pille, programm, zone, taste, geraet, uebernommen
 "hfmax": 184, "weight": 75,
 "hold": 9, "holdTo": 8.0,          // nur während des Einlaufens (s, Ziel km/h)
 "cd": 2,              // nur während des Countdowns der START-Taste (s bis Anlauf)
 "top": "app.paket",   // App im Vordergrund
 "bar": false,         // Herstellerleiste sichtbar
 "fan": {"l": 62, "a": true, "c": true},   // nur wenn ein Ventilator gespeichert ist (Stufe %, Automatik, verbunden)
 "prog": null | {…},   // siehe Programme
 "hist": [[t, speed, incline, hr], …]       // nur mit ?hist=1: 1 Punkt je 2 s, höchstens 5400
}
```

`GET /api/summary`: letzte Zusammenfassung (`end`, Programmende, 5 min Pause ohne Eingabe), `{}` wenn keine. Sie liegt auch in `files/letzter-lauf.json` und übersteht einen Neustart; die Oberfläche trägt einen nicht gespeicherten Lauf beim Start nach (bis 7 Tage alt, einmal).

`GET /api/blackbox` (Token): Ereignisprotokoll (rotiert bei 300 KB, eine Sicherung).

## Befehle

`POST /api/cmd` (Token), Body `{"c": …}`, höchstens 512 KB.

| c | Felder | Wirkung |
|---|---|---|
| `arm` | | Beginn des 3-s-Countdowns. Erlaubt genau ein folgendes `start` oder `resume` 2.5 bis 15 s später. |
| `start` | | BEREIT → LAEUFT. Nur mit Schlüssel, `safe`, stehendem Band und gültigem `arm`. |
| `stop` | | Sofort STOP auf den Bus, am Zustandslock vorbei; LAEUFT → PAUSE. Löscht ein offenes `arm`. Antwortet `ok:false`, wenn der Bus nicht erreichbar war (dann direkter STOP der Oberfläche oder Pille). |
| `resume` | | PAUSE → LAEUFT mit gültigem `arm`, erst wenn das Band steht («Band läuft noch aus»). |
| `end` | | Lauf beenden: STOP (auch aus PAUSE), Steigung 0, BEREIT. Antwort mit `summary`. |
| `speed` / `incline` | `v` | Soll-Tempo bzw. Soll-Steigung, in BEREIT nur vorladen. |
| `step` | `what`, `d` | relativ, höchstens ±0.5 |
| `program` | `p` | Programm laden (nur BEREIT), startet nicht. |
| `clearProgram` | | Programm entladen (nur BEREIT). |
| `skipTo` | `idx` | Intervall: nur vorwärts springen, im Lauf (Tempo in 3-km/h-Stufen) oder in der Pause (Ziel für WEITER vorbereitet). |
| `routeOffset` | `s`, `i` | Strecke: Versatz zum Plan; `{"s":0,"i":0}` = «Zurück zum Plan». |
| `auto` | `on` | Zonen-Automatik an oder aus. |
| `ack` | | FEHLER quittieren: nach Unterbrechung im Lauf PAUSE mit Gehtempo, sonst BEREIT. Nur bei stehendem Band und steckendem Schlüssel. |
| `inclZero` | | Steigung auf 0 (in der Pause). |
| `profile` | `weight`, `hfmax` | Gewicht 35 bis 200 kg, HFmax 120 bis 230. |
| `hideBar` | `on` | Herstellerleiste über fremden Apps ausblenden (eigene Statuszeile) oder zeigen. |

Jede Eingabe in der Pause setzt die 5-min-Frist zurück; danach beendet der Dienst den Lauf selbst.

## Sicherheitsregeln im Dienst

- **Countdown-Pflicht:** `start`/`resume` nur 2.5 bis 15 s nach `arm`. Die Prüfung verbraucht `arm`. Die Oberfläche sendet `arm` beim Öffnen des Vollbild-Countdowns 3 · 2 · 1 und `start` frühestens 3 s danach; ABBRECHEN sendet `stop`.
- **Einlaufen:** Jeder Anlauf läuft 15 s mit 1.0 km/h, dann in Stufen zum Soll. Programm-Tempi warten in `holdTo`; eine Handeingabe beendet das Einlaufen.
- **Rampen:** Tempoänderungen über 3 km/h laufen in Stufen von 3 km/h alle 4 s (Start, Weiter, Plan- und Intervallwechsel, Programmende auf 3 km/h, «Zurück zum Plan»). Handeingabe bricht die Rampe ab.
- **Fotosperre:** Existiert `files/nostart`, startet nichts (für Bildschirmfotos und Tests).
- **Gerätetasten:** Der Dienst liest STOP, START/PAUSE und die Drehregler (Tempo ±0.1, Steigung ±0.5) aus allen `/dev/input/event*` und gibt nur die Codes der Konsole weiter. START-Taste: eigener 3-s-Countdown (`state.cd`).
- **Busausfall:** Nach drei Fehltakten FEHLER und STOP (noch über die alte Verbindung), Wiederverbindung mit Wartezeit; ist der Bus zurück und läuft das Band noch, wird STOP nachgeholt. Nach STOP, Ende oder Fehler wiederholt der Dienst STOP alle 2 s, solange das Band nicht steht (in FEHLER und PAUSE ohne Zeitgrenze, solange es nicht beschleunigt).
- **Wache:** Steht die Hauptschleife 10 s, STOP über eine frische Verbindung und Eintrag in der Blackbox; nach 15 s beendet sich der Prozess und wird neu gestartet.
- **Neustart des Dienstes:** Der Laufstand (`files/laufstand.json`, alle 30 s, höchstens 15 min alt) wird übernommen. Vor der Entscheidung liest der Dienst bis 10 s lang; läuft das Band, geht der Lauf weiter, steht es, folgt PAUSE mit Gehtempo. Ist der Bus nicht lesbar, FEHLER und STOP, sobald er zurück ist.
- **Uhr:** Alle Fristen laufen auf der monotonen Uhr (`SystemClock.elapsedRealtime`), nicht auf der Wanduhr.

## STOP-Wege

1. Gerätetaste STOP: Dienst (KeyReader), am Lock vorbei direkt auf den Bus.
2. Oberfläche und Pille: `stop` über die API; antwortet der Dienst nicht innert 600 ms oder scheitert er, zusätzlich direkt auf den Herstellerbus (`TreadNative.stopDirect()` bzw. Pille). Die Web-STOP-Taste löst schon beim Drücken aus.
3. Ohne Dienst: Die Pille zeigt sich immer (auch über der eigenen Oberfläche), liest die STOP-Taste selbst und startet den Dienst nach 5 s ohne Antwort neu.
4. Hängt die Weboberfläche (kein Herzschlag `TreadNative.beat()` seit 6 s), wird die Pille sichtbar und die Seite neu geladen (höchstens 3 Mal je Minute).

## Programme

Programm `p` für `program`:

- Intervall: `{"type":"interval","name":"…","segs":[{"d":480,"s":8.0,"i":1.0,"k":"w"}, …]}`, `k` = `w` Ein/Auslaufen, `h` Belastung, `r` Erholung. Grenzen je Abschnitt 5 bis 7200 s, 0.8 bis 20 km/h, höchstens 200 Abschnitte.
- Zonen: `{"type":"zones","name":"…","lo":128,"hi":142,"dur":2700,"sMin":6.0,"sMax":10.5,"i":1.0,"s0":8.0}`
- Strecke: `{"type":"route","id":"homberg-runde","target":4200,"mode":"terrain"|"even","scale":1.0|0.5}` (siehe Streckenmodus)

`state.prog`:

- Intervall: `{type, name, idx (1-basiert), n, segLeft, segDur, left, total, t, kind, next, segs, done}`
- Zonen: `{type, name, lo, hi, auto (regelt gerade), autoOn, sMin, sMax, …}`
- Strecke: `{type, name, id, D, x, idx, n, sec:{a,b,s,i,g}, next, toNext, toChange, toFinish, pace, tPlan, delta, eta, total, target, t, left, offS, offI, ele, up, down, capped, mode, scale, finish, done}`, mit `?hist=1` zusätzlich `secs` und `prof`.

Stufentest HFmax: Vorlage `p-hfmax` vom Typ `test` (10 min 8.0 km/h, 17 Stufen je 1 min von 9.0 bis 17.0 km/h, 5 min 6.0 km/h, Steigung 1 %), läuft als Intervall. «Auslaufen» im Kopf springt per `skipTo` in den letzten Abschnitt; die Zusammenfassung bietet «Als HFmax übernehmen».

## Streckenmodus

Konzept und Planung: `route-mode.md`. Bibliothek:

| Aufruf | Token | Wirkung |
|---|---|---|
| `GET /api/routes` | nein | Liste mit Metadaten (`id, name, ort, art, d, up, down, bbox, quelle, offiziell, hinweis, datum, importiert, thumb, sample`); Metadaten werden zwischengespeichert. |
| `GET /api/routes/<id>` | nein | Volle Datei inkl. `pts`, `prof`, `hoehe`. |
| `POST /api/routes` | ja | Eigene Strecke speichern (höchstens 4 MB), `id` `[a-z0-9-]{1,48}`. |
| `DELETE /api/routes/<id>` | ja | Nur eigene Strecken. |

Kacheln (im Betrieb nur offline):

- `GET /tiles/<quelle>/<z>/<x>/<y>`: nur vorhandene Kacheln, sonst leere dunkle Kachel (immer 200). Quelle `luft` (swisstopo SWISSIMAGE, nur Schweiz; Strecken ausserhalb der Schweiz ohne Luftbild).
- `POST /api/tiles/prefetch` (Token) `{src, pts, zmin, zmax}`: nur beim Import und auf «Karte nachladen». Grenze 500 MB, auch während des Ladens geprüft. `GET /api/tiles/status` → `{busy, done, total, failed}`.
- `POST /api/tiles/coverage` (Token) `{src, pts}` mit höchstens 600 Punkten → `{have, total}`.

Laufzeit: Tempo-Eingaben ändern `offS` (bis «Zurück zum Plan»), Steigungs-Eingaben `offI` (bis zum nächsten Steigungswechsel). Nach einer Unterbrechung setzt der Dienst `offS` so, dass der Plan im Gehtempo pausiert; die Oberfläche zeigt dann die Plan-Pace gross und das Gehtempo als Hinweis. Ziel: Tempo in Stufen auf 3 km/h, Steigung 0, 10 s nach Erreichen des Gehtempos PAUSE.

## Geräte

- **Lautsprecher:** `GET /api/bt/audio` → `{ok, audio:[{name, address, connected}]}` (gekoppelte Audiogeräte; Umschalten über `/api/media/cmd` `out`).
- **Pulsmesser:** `GET /api/hr` → `{state, name, address, hr, scanning, bt, found}`; `POST /api/hr/scan` (15 s), `/api/hr/connect {address, name}`, `/api/hr/forget` (Token).
- **Ventilator CYCPLUS F1:** `GET /api/fan` → `{state, name, address, auto, level, target, manual, connected, awake, rpm}`; `POST /api/fan` (Token) `{"a": "scan" | "connect" | "forget" | "auto" | "level" (v 5 bis 100) | "step" (d) | "off"}`. Automatik: BEREIT aus, Einlaufen 15 %, im Lauf 15 % plus 8 % je km/h über 5, plus 2.5 % je % Steigung, plus bis 25 % zwischen 70 und 90 % HFmax; höchstens 8 % Änderung je 2 s; Pause 20 s weiter, dann aus. Handstufe (Pille, Seite, Ein/Aus-Taste am Ventilator) gilt bis zum Laufende.
- **Bluetooth allgemein:** Ventilator und Pulsgurt verbinden nach dem Start, nach Bluetooth aus/ein und nach 2 min ohne Verbindung neu. Wegen zufälliger Adressen zuerst eine kurze Suche, dann direkte Verbindung mit dem gefundenen Gerät.
- **Ventilatorprotokoll** (Nordic UART 6e400001): App an Ventilator `55 A5 len id seq daten chkH chkL`, chk = ~Summe ab len; jede Meldung `AA 5A …` wird mit id 255 und ihrer seq quittiert. id 1 Stufe (0 = kleinste Drehzahl), id 5 Modus (0 manuell), id 19 `[wach 1 | schlafen 0, SmartStart]`. Den DFU-Dienst FE59 nie anfassen; die Hersteller-App darf nicht gleichzeitig verbunden sein.
- **BLE-Werkzeug** (nur zum Einbinden neuer Geräte): `GET /api/probe` und `POST /api/probe/cmd` (Token) für Suche, Verbinden, Lesen, Melden, Schreiben.

## Bildschirm und Standby

- Bildschirmschoner (Oberfläche und Pille): Minuten im Dialog «Profil und Bildschirm» (1 bis 30 min oder aus), gespeichert
  als `saverMin` in den Einstellungen der Oberfläche und der Pille (`saver` aus bei 0).
- Standby der Herstellersoftware (ERP): Befehl `standby {i}` schreibt `DATA_ERP_MODE_INDEX_INT` (0 = 30 min, 1 = 15 min,
  2 = 10 min, Werk, 3 = aus); Zustand `erp` (alle 30 s gelesen, -1 unbekannt). Ihr Zeitgeber läuft bei Berührung,
  Gerätetasten und laufendem Band neu an. Die Pille meldet Berührungen in allen Apps und laufende Wiedergabe als
  Befehl `touch` (höchstens alle 20 s), der Dienst sendet dann `EVENT_TOUCH`. So schläft die Konsole nur nach echter Ruhe.

## Apps und Uhren (FTMS, Laufsensor)

Die Konsole erscheint über ihr eigenes Bluetooth als Laufband (FTMS 0x1826) und als Laufsensor (RSC 0x1814), Name
standardmässig «Tread Control». Uhren koppeln den Laufsensor (Tempo und Distanz vom Band), Apps auf anderen Geräten
das Laufband. Apps auf der Konsole selbst nutzen DIRCON (FTMS über TCP, Port 36866, mDNS `_wahoo-fitness-tnp._tcp`
als «Tread-Control»), weil Bluetooth nicht mit sich selbst verbindet. DIRCON nimmt standardmässig nur Verbindungen
von der Konsole selbst an (`lan: false`); `lan: true` öffnet es für Apps im WLAN (PC, Apple TV). Prüfen:
`adb forward tcp:36866 tcp:36866 && python3 app/tools/dircon-test.py` (nur lesend).

- `GET /api/ftms` → `{on, ctl, keepJht, name, maxS, maxI, state, advertising, dircon, lan, dirconState, clients:[{addr, name, wlan}]}`.
- `POST /api/ftms` (Token) mit beliebigen Feldern `{on, ctl, name, maxS, maxI, keepJht, dircon, lan}`; gespeichert im Dienst.
  `name` bis 20 Zeichen (Buchstaben, Ziffern, Leerzeichen, `_.-`), wird zum Bluetooth-Namen der Konsole.
- Steuerpunkt der Apps → `Core.appCmd` mit eigenen Regeln: **nie Start oder Weiter**, STOP und Pause immer;
  Tempo und Steigung nur mit `ctl`, nur im Lauf ohne Programm, nicht im Einlaufen, Grenzen `maxS` (Standard 14 km/h)
  und `maxI` (10 %), Werte ausserhalb des gemeldeten Bereichs sind ungültig, höchstens ein Befehl je 2 s (spätere
  Werte gelten im nächsten Takt), Tempo in Stufen von 3 km/h, nach einer Handeingabe 30 s Vorrang der Konsole
  (Meldung «Steuerung verloren» an die App), ohne Lebenszeichen der Oberfläche nicht hochregeln.
- Zustand: `appCtl` (Steuerung erlaubt), `app` (Name der App, die in den letzten 15 s gesteuert hat), Quelle `src: "app"`.
- Befehl `appRelease`: «Zurück an Konsole», sperrt Apps bis zum nächsten Start.
- Start/Weiter einer App: bei laufendem Band nur bestätigt (Apps erwarten Erfolg). Läuft Kinomap oder Zwift auf der Konsole
  im Vordergrund und ist App-Steuerung erlaubt, wirkt der Start wie die START-Taste (3 s Countdown, STOP bricht ab, 15 s mit
  1 km/h); sonst «nicht erlaubt». BEENDEN in der Pille bleibt in diesen Apps (Zusammenfassung im Verlauf).
- Opcode `0x11` (Indoor Bike Simulation, Zwift): die Steigung (Bytes 3 und 4, 0.01 %) wirkt wie ein Steigungsbefehl,
  Gefälle wird 0. Wahoo-Run-Dienst (`A026EE0E-…`, E03E schreiben, E03D melden): Zwift schickt dort `11 lo hi`
  (0.01 %), DIRCON auch `46 lo hi`; gleiche Regeln, über Bluetooth ohne Antwort, über DIRCON `FE op 02`.
- Zwift-Profil (nur lokal): `POST /api/ftms {"name": …, "mfr": …}` setzt Werbenamen und Hersteller in Device Information.
- Laufsensor für Garmin: Sensorort «auf dem Schuh», Erscheinungsbild 0x0441, Koppeln ohne Eingabe mit gespeicherten
  Schlüsseln (ESP32), Akkudienst 100 %. Uhr: Laufsensor koppeln, Tempo und Distanz «Immer», Kalibrierung 100 %,
  automatische Kalibrierung aus.
- Last: `adb forward tcp:36866 tcp:36866 && TREADXP_ADB=… python3 app/tools/ftms-last.py` (4 WLAN-Apps, 20 Befehle/s,
  200 Verbindungswechsel; misst CPU, Speicher, Threads und Dateien des Dienstes).
- Der FTMS-Dienst des Herstellers (`GATTServerService`, Prozess `com.jhtp.atsoul.gattserverservice`) wird angehalten
  und alle 30 s geprüft, weil sein Steuerpunkt direkt auf den Bus schreibt und einen Start über die GO-Taste auslöst.
  `keepJht: true` lässt ihn laufen (startet ihn wieder).
- Werbung: ein einziger Werbesatz (das Funkmodul MT7663 meldet keine Mehrfachwerbung), nach jeder Verbindung neu
  gestartet, damit Uhr und App gleichzeitig verbinden können.
- **Funkmodul ESP32** (`UsbBridge`, Firmware in `esp32/`): steckt ein ESP32-S3 am nativen USB (303A:1001), übernimmt
  es Bluetooth; das eigene Bluetooth-FTMS der Konsole geht aus, der Name der Konsole wird zurückgesetzt. So sehen auch
  Apps auf der Konsole (Kinomap kann kein DIRCON) ein normales Bluetooth-Laufband. Zeilenprotokoll über USB (Konsole →
  Board: `H` Name, `V` lesbarer Wert, `N` Meldung, `I` Antwort Steuerpunkt an die sendende App, `P` Lebenszeichen jede Sekunde; Board →
  Konsole: `R` bereit, `A` Antwort aufs Lebenszeichen, `C`/`X` verbunden/getrennt, `S` Abo, `W` Befehl am Steuerpunkt). Antwortet das Board 6 s nicht, startet die Konsole es über RTS neu, nach zwei Versuchen in einer Minute nimmt sie wieder das eigene Bluetooth. Das Board entscheidet nichts:
  Befehle gehen durch `Core.appCmd`; ohne Lebenszeichen 3 s antwortet es selbst «fehlgeschlagen» und meldet
  «Steuerung verloren». Zustand in `GET /api/ftms`: `radio` (`konsole` oder `esp32`), `espFw`.

## Medien (Mini-Player)

Konzept: `player.md`.

- `GET /api/media` → `{ok, active, pkg, app, playing, title, artist, album, dur, pos, art, canNext, canPrev, vol, volMax, out, outs, sources}`. `art` ist eine Versionsnummer, die sich nur bei einem neuen Bild ändert (0 = keins). `outs`: `[{address, name, connected, active, busy}]`, erster Eintrag ist die Konsole (`address: ""`). `sources`: YouTube Music und Hörbücher mit `installed, session, playing, title`.
- `GET /api/media/art?v=<art>` → Cover als JPEG (höchstens 240 px).
- `POST /api/media/cmd` (Token) `{"a": …}`: `toggle`, `play`, `pause`, `next`, `prev`, `back30`, `fwd30`, `volUp`, `volDown`, `vol` (`v` Stufe), `source` (`pkg`; ohne Sitzung `error: "start"`, dann startet die Oberfläche die App), `out` (`address`, `""` = Konsole).
- Abfragetakt der Oberfläche: 3 s bei Wiedergabe, sonst 5 s, versteckt 10 s, nach jedem Befehl sofort.

## Abfragetakt der Bedienung

- Weboberfläche `GET /api/state`: 400 ms, solange das Band in Gebrauch ist oder ein Countdown läuft, sonst 1 s, versteckte Seite 2 s; nach jedem Befehl sofort.
- Pille: 400 ms im Gebrauch, sonst 1 s, versteckt hinter der eigenen Oberfläche 2 s. Lebenszeichen (Token) nur, wenn ihr UI-Thread lebt.

## Native Brücke der Weboberfläche (`TreadNative`)

`token()`, `stopDirect()` (nur STOP, eigener Thread), `beat()` (Herzschlag), `launch(pkg)` (nur Apps der Positivliste; räumt Hilfs-Apps aus dem Hintergrund), `installed()`, `icon(pkg)`, `listGpx()`, `readGpx(path)`, `openBluetooth()`, `openSettings()`, `setPref(k, v)`.

## Messen und Prüfen

- Kerntests: `app/tools/coretest/test.sh` (Szenarien gegen eine Bandattrappe, inklusive echter Hauptschleife).
- Oberfläche: `app/tools/ui-audit.mjs` im Demo-Modus (`?demo=1`, Szenarien über `szenario=…`).
- Zugriffsschutz: `app/tools/security-test.sh` am Gerät.
- Leistung am Gerät: `files/webdebug` anlegen (root), dann `app/tools/perf-messung.mjs`, `perf-profil.mjs`, `perf-trace.mjs` über die Chrome-Werkzeuge; danach die Datei löschen.
