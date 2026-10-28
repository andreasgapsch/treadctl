# ESP32-Funkmodul: Einrichtung

Ein ESP32-S3 am USB der Konsole dient als eigenes Bluetooth-Funkmodul. Er macht das Laufband für Apps und Uhren als
gewöhnliches Bluetooth-Laufband sichtbar (FTMS, Fitness Machine Service) und zusätzlich als Laufsensor (RSC) für Uhren.
Das Board entscheidet nichts: Werte, Grenzen und Freigaben kommen von Tread Control auf der Konsole.

## Wozu

- **Apps auf der Konsole selbst** (Kinomap, Zwift) suchen ein Laufband per Bluetooth. Die Konsole kann sich mit ihrem
  eigenen Funkchip nicht zugleich als Laufband zeigen und von einer App auf demselben Gerät gefunden werden. Das Board
  ist ein zweites Gerät, das die App ganz normal findet.
- **Uhren** (z. B. Garmin) koppeln das Board als Laufsensor: Tempo und Distanz kommen vom Band statt aus der Schätzung
  am Handgelenk.
- **Apps auf anderen Geräten** (Handy, Tablet, PC) sehen ebenfalls ein normales Bluetooth-Laufband.

Ohne Board übernimmt der Funkchip der Konsole FTMS und Laufsensor für andere Geräte. Steckt das Board, schaltet die
Konsole ihr eigenes Bluetooth-FTMS ab und gibt den Namen frei.

## Hardware

- **ESP32-S3 mit nativem USB** (USB-Serial-JTAG, Kennung `303A:1001`). Getestet: Olimex ESP32-S3-DevKit-Lipo
  (ESP32-S3-WROOM-1-N8R8, 8 MB Flash). Andere ESP32-S3-Boards mit nativem USB-Anschluss sollten gehen, wenn
  `platformio.ini` angepasst wird.
- **Nicht geeignet:** Boards, deren USB über einen eigenen Seriell-Wandler läuft (CH340, CP210x, z. B. FireBeetle ESP32).
  Die Konsole erkennt nur den nativen USB des ESP32-S3.
- **Kabel:** USB-C (Board) auf USB-A (Konsole). Beim Olimex-Board den Anschluss für den nativen USB verwenden. Das
  Board wird über die Konsole versorgt, ein Akku ist nicht nötig.

## Firmware bauen und flashen

Am Rechner (Linux, Python 3), Board per USB angeschlossen:

```sh
cd esp32
python3 -m venv .venv
.venv/bin/pip install platformio
./flashen.sh            # oder ./flashen.sh /dev/ttyACM0
```

`flashen.sh` baut mit PlatformIO (`espressif32@6.9.0`, Arduino, NimBLE-Arduino 1.4.3) und schreibt die Firmware über den
nativen USB; den Bootloader startet esptool selbst. Nach dem Start meldet das Board `R tread-control-esp32 <version>`
(aktuell 1.2.1), auch auf die Zeile `?` hin.

Optionaler Ende-zu-Ende-Test vor dem Einbau: `bridge-test.py` spielt am Rechner die Konsole (Zeilen über USB) und lässt
die Konsole per ADB als App mit dem Board verbinden. Er steuert nichts am Band.

```sh
.venv/bin/pip install pyserial
.venv/bin/python bridge-test.py /dev/ttyACM0
```

## Inbetriebnahme an der Konsole

1. Board an einen USB-Anschluss der Konsole stecken. Tread Control erkennt es selbst (die USB-Freigabe erteilt die
   System-App ohne Nachfrage) und sendet Namen und Werte.
2. In Tread Control unter **Apps** den Schalter **Daten an Apps und Uhren** einschalten. Darunter steht dann
   «sichtbar als ‹Tread Control› · Funkmodul ESP32».
3. Optional **Apps dürfen Tempo und Steigung steuern** einschalten (bis 14 km/h und 10 %, siehe Sicherheit).
4. Der Zustand steht auch in `GET /api/ftms`: `radio` (`esp32` oder `konsole`) und `espFw` (Firmware des Boards).

## Apps und Uhren

- **Kinomap auf der Konsole:** in Kinomap das Laufband per Bluetooth koppeln und «Tread Control» wählen. Tempo und
  Steigung zeigt dann Kinomap; ist die App-Steuerung erlaubt, kann Kinomap die Steigung der Strecke setzen. Der Start in Kinomap läuft
  wie die START-Taste mit 3 s Countdown.
- **Zwift auf der Konsole:** als Laufband (FTMS) koppeln, Tempo und Distanz kommen vom Band. Eine Steigungssteuerung
  durch Zwift gehört nicht zur Grundeinrichtung (Zwift setzt sie nur bei bestimmten Laufbandmodellen und mit Abo).
- **Garmin-Uhr:** unter Sensoren einen Laufsensor (Footpod) hinzufügen und «Tread Control» wählen. Empfohlen:
  Tempo und Distanz aus dem Sensor «immer», Kalibrierung 100 %, automatische Kalibrierung aus. Das Board koppelt mit
  «Just Works» und merkt sich die Uhr.
- Apps merken sich Namen teils zwischen; nach einer Namensänderung die Kopplung in der App neu anlegen.

## Sicherheit

- Jeder Befehl einer App geht über die Regeln von Tread Control: Grenzen für Tempo und Steigung, höchstens ein
  Befehl je 2 s, Handeingabe an der Konsole hat 30 s Vorrang, Programme sperren die App-Steuerung. STOP wirkt immer.
- Starten kann eine App nur, wenn sie auf der Konsole selbst im Vordergrund läuft (Kinomap, Zwift), und dann nur mit
  dem Countdown der START-Taste. Nach einem STOP an der Konsole ist ein App-Start 10 s gesperrt.
- Ohne Lebenszeichen der Konsole (3 s) beantwortet das Board Befehle selbst mit «fehlgeschlagen», meldet keine
  Laufdaten mehr und zeigt «Steuerung verloren»: eine App reagiert nie auf veraltete Werte.
- Der Sicherheitsschlüssel und die eigene Sicherheitslogik des Motorboards bleiben unverändert.

## Zeilenprotokoll (USB, 115200 Baud, Zeilen mit `\n`)

Konsole an Board:

| Zeile | Bedeutung |
|---|---|
| `H <name>` | Name für Werbung und GAP (bis 20 Zeichen), startet die Werbung |
| `D <hersteller>` | Herstellername in Device Information |
| `V <uuid16> <hex>` | lesbarer Wert (Merkmale, Bereiche, Trainingszustand, Laufsensor) |
| `N <uuid16> <hex>` | Meldung an alle Abonnenten (Laufdaten, Laufsensor, Zustand) |
| `I <conn> <hex>` | Antwort des Steuerpunkts 0x2AD9 an die App, die den Befehl geschickt hat |
| `P` | Lebenszeichen, jede Sekunde |
| `?` | Version abfragen |

Board an Konsole:

| Zeile | Bedeutung |
|---|---|
| `R tread-control-esp32 <version>` | bereit |
| `A` | Antwort auf das Lebenszeichen |
| `C <conn> <adresse>` / `X <conn>` | Gegenstelle verbunden / getrennt |
| `S <conn> <uuid16> <0\|1\|2>` | Abo aus / Meldung / Anzeige |
| `W <conn> <hex>` | Befehl am Steuerpunkt (die Konsole entscheidet) |
| `G <conn> <hex>` | Steigung von Zwift über den Wahoo-Run-Dienst (`11 lo hi`, 0.01 %) |

Dienste des Boards: FTMS (0x1826), Laufsensor RSC (0x1814, Sensorort «Schuh oben», Erscheinung 0x0441), Device
Information, Batterie (0x180F, fest 100 %), Wahoo Run (`A026EE0E-…`). Bis zu 4 Verbindungen gleichzeitig.

## Fehlersuche

- **Board wird nicht erkannt:** `GET /api/ftms` zeigt `radio: konsole`. Kabel und Anschluss prüfen (nativer USB des
  Boards), Firmware mit `?` über eine serielle Konsole am Rechner abfragen.
- **Board hängt:** Antwortet es 6 s nicht, startet die Konsole es über die Steuerleitung RTS neu. Nach zwei Versuchen
  innert einer Minute übernimmt für 1 min wieder das eigene Bluetooth der Konsole, danach versucht sie es erneut.
- **App findet das Laufband nicht:** «Daten an Apps und Uhren» eingeschaltet? Bluetooth der App an? Alte Kopplung in der
  App löschen und neu suchen.
- **Uhr zeigt falsches Tempo:** Kalibrierung auf 100 % und Quelle «immer» setzen (siehe oben).
