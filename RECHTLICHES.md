# Rechtliche Hinweise

[English](LEGAL.md)

Stand 28.10.2026 (Version 1.0.0). Dies ist eine sorgfältige Einschätzung, keine Rechtsberatung.

## Urheberrecht am eigenen Code

Der Code in diesem Repository ist eigenständig geschrieben. Er enthält keinen Code der
Herstellersoftware (keine APK, keine dekompilierten Klassen, keine Bibliotheken des Herstellers).

## Interoperabilität und Reverse Engineering

Die Kenntnisse über Datenbus und serielles Protokoll wurden durch Analyse der auf dem eigenen
Gerät installierten Software gewonnen, ausschliesslich um ein unabhängig geschaffenes, interoperables
Programm zu entwickeln.

- **Schweiz**: Art. 21 URG erlaubt berechtigten Nutzern, die für die Interoperabilität nötigen
  Schnittstelleninformationen durch Entschlüsselung des Programmcodes zu beschaffen und für die
  Entwicklung, Wartung und den Gebrauch interoperabler Programme zu verwenden.
- **EU**: Art. 6 der Richtlinie 2009/24/EG (Computerprogramme) regelt die Dekompilierung zur
  Herstellung der Interoperabilität ähnlich.
- **USA**: 17 U.S.C. § 1201(f) enthält eine Ausnahme für Reverse Engineering zur Interoperabilität.

Veröffentlicht werden nur Schnittstelleninformationen (Befehlsnummern, Rahmenaufbau, Prüfsumme),
die für die Interoperabilität nötig sind, und eigener Code. Funktionale Angaben wie ein CRC-Polynom
sind keine schutzfähigen Werke.

Nicht Teil des Repositorys und nicht zu veröffentlichen: Hersteller-APKs, dekompilierter Code,
Sicherungen von Systempartitionen, Firmware.

## Vertragsbedingungen des Herstellers

Nutzungsbedingungen der Konsolensoftware können Veränderungen am Gerät untersagen. Das betrifft
die Person, die die Software auf ihrem Gerät einsetzt, nicht die Veröffentlichung des eigenen
Codes. Eingriffe können Garantie und Herstellerupdates beeinträchtigen.

## Marken

«Horizon», «Tread-XP», «Johnson Health Tech» sowie weitere genannte Produktnamen (z. B. YouTube,
Jellyfin, Zwift, Kinomap, Audiobookshelf) sind Marken ihrer Inhaber. Sie werden nur beschreibend
genannt, um die Kompatibilität zu benennen. Projekt und Oberfläche heissen «Tread Control»; es besteht
keine Verbindung zum Hersteller und keine Billigung durch ihn. Es werden keine Logos verwendet. App-Symbole zeigt die
Oberfläche zur Laufzeit aus den auf dem Gerät installierten Apps an; sie sind nicht im Repository.

## Karten und Strecken

- **swisstopo** (Luftbild SWISSIMAGE, Höhenmodell swissALTI3D): Geodaten des Bundes sind seit
  1. März 2021 frei nutzbar (Open Government Data), Quellenangabe «© swisstopo». Die Oberfläche
  zeigt sie an.
- **OpenStreetMap**: Die Wege der Beispielstrecken stammen aus OpenStreetMap (© OpenStreetMap-
  Mitwirkende, ODbL 1.0), eingepasst mit BRouter. Für diese erzeugten Werke ist die
  Quellenangabe nötig; sie steht in jeder Streckendatei.
- **Strecken von Laufveranstaltern** (GPX von Veranstaltern, Outdooractive, Strava) sind nicht
  enthalten, weil keine Weitergabe erlaubt ist.

## Bilder

Hintergrundbilder der Oberfläche sind mit einem Bildgenerator (Google Gemini) erstellt.
Bildschirmfotos fremder Apps sind nicht enthalten.

## Haftung

Die Software wird unentgeltlich und ohne Gewährleistung bereitgestellt (siehe LICENSE). In der
Schweiz haftet, wer etwas schenkt, nur für Absicht und grobe Fahrlässigkeit (Art. 248 OR); ein
vollständiger Ausschluss ist nicht möglich. Darum: keine Zusicherung von Eigenschaften, deutliche
Sicherheitshinweise ([SICHERHEIT.md](SICHERHEIT.md)), Tests dokumentiert.

## Datenschutz

Das Repository enthält keine Personendaten. Laufdaten bleiben auf der Konsole; die App sendet
nichts an Dritte. Netzzugriffe gibt es nur beim Import einer Strecke (Höhen und Kartenkacheln) und
in den Medien-Apps selbst.
