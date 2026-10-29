# Gestaltungsregeln Tread Control

Gilt für die Oberfläche (`assets/www/css/app.css`) und die Pille (`OverlayService.java`). Masse in CSS-px bzw. dp
(Konsole: 1280 × 720 CSS-px, Faktor 1.5; dp und CSS-px sind gleich gross). Geprüft wird das Regelwerk automatisch:
`node tools/gestaltung-regeln.mjs` (auch Teil von `tools/ui-audit.mjs`). Die einmalige Angleichung lief mit
`tools/gestaltung-angleichen.mjs` (29.10.2026).

## Abstände

| Was | Wert |
|---|---|
| Raster | 4 px: 4 · 8 · 12 · 16 · 24 · 32 (kleiner als 4 px nur als Feinkorrektur) |
| Seitenrand | 18 px (`--gx`), auch Abstand der Pille zum unteren Rand |
| Abstand zwischen Karten | 12 px, überall |
| Innenrand von Karten | 16 px, grosse Karten 24 px |
| Abstand in Zeilen und Rastern | 8 px eng, 12 px normal, 16 bis 24 px zwischen Gruppen |

## Ecken

| Radius | Wofür |
|---|---|
| 4 px | Balken, Fortschritt, Farbfelder in Legenden |
| 8 px | Chips (BEREIT, LÄUFT), Etiketten, Segmente in einer Leiste |
| 12 px | Symbolknöpfe (Zurück, Apps, Player, Favorit), Eingabefelder, Kacheln, Leisten von Reitern und Segmenten |
| 14 px | Textknöpfe (48 bis 56 px hoch), Flächen in Karten |
| 18 px | Karten, grosse Knöpfe (START, STOP, WEITER, BEENDEN), Banner, Menüs, Pille |
| 24 px | Dialoge und Sicherheitsmeldungen |
| rund | nur Profilbild, Kartenmarker, Punkte und der Knopf im Schalter |

Knöpfe sind nie Pillen oder Kreise. Innen liegende Flächen nehmen den äusseren Radius minus den Abstand (Leiste 12 px mit
4 px Innenrand: Segment 8 px).

## Schrift

| Stufe | Grössen |
|---|---|
| Text | 13 (Beschriftungen, Einheiten) · 15 (Fliesstext, Knöpfe) · 17 (betont) |
| Überschriften | 20 · 26 · 34 |
| Zahlen | 22 · 30 · 42 · 60 · 72; Countdown und Uhr ab 90 px als Sonderanzeige |
| Symbole | 16 (in Chips) · 20 (in Knöpfen) · 24 (Symbolknöpfe) · 28 bis 40 (Meldungen) |

Mindestgrösse 13 px, in der Pille 12 dp nur für Beschriftungen mit mehr als 12 Zeichen. Gesperrte Grossbuchstaben
(Kennzahl-Beschriftungen, Statuschips) immer mit 1.2 px Laufweite; Ausnahmen sind die Wortmarke und Grossanzeigen.
Einheiten klein, 4 px Abstand zur Zahl, nie umbrechen.

## Höhen

Chip 32 · Knopf 48 (Mindestmass für Berührung) · Hauptknopf 56 · Listenzeile 60 · START/STOP 76.
Die Statuszeile oben ist fest 40 px hoch.

## Meldungen

- Sicherheitsmeldungen (Störung, Schlüssel gezogen, Verbindung zum Dienst weg) erscheinen als quadratische Meldung
  360 × 360 in der Bildmitte: Symbol, Titel, Hinweis, Knopf unten über die ganze Breite. Kopf, Kennzahlen und
  Steuerleiste bleiben frei. In der Pille über Apps gleich.
- Wechsel- und Einlaufbanner stehen zentriert über der Steuerleiste.
- Kurzmeldungen (Toast) unten mittig.

## Pulszonen und Speichern

- Pulszonen: Grenzen 70 · 77 · 85 · 92 % HFmax, unter 50 % «Ruhe». Eine Formel (`Core.zoneOf`, `TX.zones`), der Dienst
  liefert die Zone im Zustand (`zone`), die Pille zeigt sie an.
- Speichern eines Laufs, egal wo er beendet wurde: unter 10 s nie, unter 2 min oder 0.2 km nach Rückfrage
  (Vorgabe Verwerfen), sonst sofort. Die Pille meldet nach BEENDEN in einer App «Lauf beendet» und sagt, was mit dem
  Lauf geschieht.
