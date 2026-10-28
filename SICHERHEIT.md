# Sicherheit

[English](SAFETY.md)

Diese Software steuert Tempo und Steigung eines Laufbands. Ein Fehler in Software, Gerät oder
Bedienung kann zu Stürzen und schweren Verletzungen führen. Nutzung auf **eigene Gefahr**.

## Grundregeln

1. **Sicherheitsschlüssel immer am Körper befestigen.** Er ist die einzige Sicherung, die
   unabhängig von dieser Software wirkt (das Motorboard stoppt selbst).
2. Der **physische STOP-Knopf** der Konsole wirkt über diese Software (der Dienst liest die Taste direkt). Er ist nicht fest mit dem Motorboard verdrahtet; die vom Programm unabhängige Sicherung ist allein der Schlüssel.
3. Tests mit laufendem Band **nie unbeaufsichtigt** und nie ohne Person am Gerät, die den
   Schlüssel ziehen kann. Erste Tests mit leerem Band und Gehtempo.
4. Kinder und Haustiere fernhalten.
5. Nach jeder Änderung am Code die Szenariotests (`app/tools/coretest/test.sh`) und den
   Zugriffsschutz-Test laufen lassen, vor dem ersten Lauf den Fehlertest am Band.
6. Skripte, die Tipps auf der Konsole automatisieren (`adb input`), setzen zuerst die Startsperre
   `files/nostart`; der Dienst lässt das Band dann nicht anlaufen. Nie auf START tippen lassen.

## Was die Software zusätzlich absichert

- Anlauf nur nach 3-Sekunden-Countdown (`arm` muss 2.5 bis 15 s vor `start` bzw. `resume` kommen).
- Jeder Anlauf (Start, Weiter, Gerätetaste) läuft 15 s mit 1 km/h; danach steigt das Tempo in Stufen von 3 km/h alle 4 s zum Soll, angekündigt 10 s vorher.
- Die physischen Tasten der Konsole wirken auch in dieser Steuerung: STOP hält sofort an, START/PAUSE startet nach 3-Sekunden-Countdown (STOP bricht ab) oder pausiert, die Drehregler ändern Tempo und Steigung.
- STOP hat Vorrang vor allen anderen Befehlen und mehrere unabhängige Wege: Gerätetaste direkt im Dienst; Oberfläche und Pille zusätzlich direkt auf den Herstellerbus, wenn der Dienst nicht innert 600 ms antwortet; ohne Dienst liest die Pille die STOP-Taste selbst und startet den Dienst neu.
- Nach STOP, Ende oder Fehler wiederholt der Dienst STOP alle 2 s, solange das Band noch läuft.
- Gezogener Schlüssel oder getrennter Herstellerbus führen in den Zustand FEHLER; nach dem
  Quittieren geht es nur mit Gehtempo weiter.
- Watchdog: ohne Lebenszeichen der Bedienelemente sinkt das Tempo auf 4 km/h, Programme erhöhen
  weder Tempo noch Steigung.
- Programmende: Auslaufen in Stufen auf 3 km/h, Halt erst im Gehtempo.
- Wache über die Hauptschleife: steht sie 10 s, geht STOP über eine frische Verbindung raus, nach 15 s startet der Dienst neu.
- Nach einem Neustart des Dienstes entscheidet er erst nach sicheren Messwerten; ein stehendes Band setzt den Lauf nur mit Gehtempo fort.
- Hängt die Oberfläche, erscheint die Pille mit STOP.
- Steuer-API nur auf `127.0.0.1`, mit Token, ohne CORS.
- Apps über Bluetooth (FTMS) können das Band nie starten oder weiterlaufen lassen; STOP aus einer App wirkt immer.
  Tempo und Steigung durch Apps sind standardmässig aus und, wenn erlaubt, begrenzt (Standard 14 km/h, 10 %),
  höchstens alle 2 s und nach jeder Handeingabe 30 s gesperrt.

Diese Massnahmen ersetzen weder den Sicherheitsschlüssel noch die Aufmerksamkeit der laufenden
Person.

## Eingriffe ins Gerät

- Die App braucht Root-Zugang per `adb` und die Plattform-Signatur des Geräts.
- `tools/webview-tausch.sh` schaltet dm-verity ab und ersetzt die System-WebView. Das ist ein
  tiefer Eingriff ins System, der Garantie und Herstellerupdates beeinträchtigen kann. Vorher die
  Sicherung anlegen (`tools/webview-zurueck.sh` stellt sie wieder her).
- Die Herstellersoftware und die Firmware des Motorboards werden nicht verändert.
