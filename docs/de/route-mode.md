# Konzept: Streckenmodus (GPX 1:1)

Stand 27.10.2026. Neuer Trainingsmodus neben Schnellstart, Intervall, Zonen und Plänen.

## Ziel

Eine echte Laufstrecke aus einer GPX-Datei wird auf dem Band nachgelaufen. Distanz und
Steigung folgen der Strecke, das Tempo folgt einer Zielzeit oder Pace, die auf das
Gelände umgerechnet wird. Die Oberfläche zeigt die Strecke auf einer Karte mit Punkt
für die aktuelle Position, grün gelaufen, rot noch offen, Start und Ziel, darunter das
Höhenprofil mit demselben Fortschritt. Gross angezeigt wird die Soll-Pace.

## Ablauf für den Läufer

1. **Strecken** (neuer Bereich): Bibliothek mit Karte im Kleinformat, Distanz, Höhenmeter,
   Ort. Drei Beispielstrecken sind dabei: Aarau HM, Arosa Trail, Hallwilersee HM.
2. **Importieren**: GPX vom USB-Stick oder aus «Downloads» (Dateiauswahl der Konsole).
   Beim Import werden Punkte geglättet, die Distanz neu berechnet und in der Schweiz die
   Höhe aus dem swisstopo-Höhenmodell geholt (GPS-Höhen sind zu ungenau für Steigungen).
3. **Streckenseite**: grosse Karte, Höhenprofil, Kennzahlen. Eingabe **Zielzeit** oder
   **Pace** (eins rechnet das andere), Verteilung **«Nach Gelände»** (gleiche Anstrengung,
   Standard) oder **«Gleichmässig»** (konstantes Tempo). Dazu Steigung **1:1** oder
   **abgeschwächt (50 %)** für steile Trails. Vorschau: Pace je Kilometer, steilste
   Stelle, Hinweis, wo das Band begrenzt (über 15 % oder Gefälle).
4. **Start** über den gewohnten Countdown. Laufansicht: Karte oben, Höhenprofil darunter,
   Soll-Pace gross, Ist-Pace, Vorsprung/Rückstand zum Plan, Prognose Zielzeit, km
   gelaufen/übrig, aktuelle Steigung Strecke und Band.
5. **Ziel**: Band läuft auf 3 km/h aus und hält nach 10 s an, Zusammenfassung mit
   Zielzeit gegen Plan.

## Rechenmodell (im Dienst, nicht im WebView)

Die Planung liegt in `RoutePlan.java` (reines Java, auf der VM prüfbar). Der Dienst
bekommt das Höhenprofil (Distanz, Höhe) und die Vorgaben und erzeugt daraus Abschnitte.

- **Glättung**: Profil alle 10 m neu abtasten, Höhe mit gleitendem Mittel über 50 m
  (Strasse) bzw. 30 m (Trail) glätten.
- **Abschnitte**: Steigung je 100 m. Benachbarte Abschnitte mit weniger als 0.5 %
  Unterschied (nach Rundung auf 0.5 %) werden zusammengelegt, damit der
  Steigungsmotor nicht dauernd fährt. Danach werden Abschnitte unter 200 m (Trail 150 m) dem Nachbarn mit der ähnlicheren Steigung zugeschlagen (Ergebnis: rund 30 Wechsel auf 21 km).
- **Bandsteigung**: Streckensteigung × Faktor (1.0 oder 0.5), gerundet auf 0.5 %,
  begrenzt auf 0 bis 15 %. Gefälle wird zu 0 % (das Band kann nicht abwärts).
- **Tempoverteilung «Nach Gelände»**: Aufwand je Abschnitt f = 1 + 0.045 × Bandsteigung
  in % (ACSM: Sauerstoffbedarf Laufen 0.2·v + 0.9·v·g, also 1 % Steigung kostet rund 4.5 % Tempo). Gleiche
  Anstrengung heisst v = k / f; k so gewählt, dass die Summe der Abschnittszeiten der
  Zielzeit entspricht. Massgebend ist die Bandsteigung, also das, was die Beine wirklich
  spüren; Gefälle bringt darum keinen Zeitgewinn, das holen die flachen Stücke auf.
- **Grenzen**: Tempo 0.8 bis 20 km/h, auf 0.1 gerundet; nach dem Runden wird k so lange
  nachgeführt, bis die Planzeit höchstens 2 s von der Zielzeit abweicht.
- **Vorlauf Steigung**: Der Motor braucht Zeit. Die neue Steigung wird um
  `Tempo × |Δ Steigung| / 0.6 %/s` Meter früher gesetzt (höchstens 100 m), damit sie am
  Abschnittsbeginn anliegt. Gerechnet mit dem Soll-Tempo; innerhalb eines Abschnitts springt die
  Steigung nie zurück.
- **Tempo vorziehen**: Bei einem Anstieg mit langsamerem Tempo (in[i] > in[i−1] und sp[i] < sp[i−1])
  beginnt das langsamere Tempo zusammen mit der Steigung um den Vorlauf früher (sa[i]); Planzeit
  und Startzeiten rechnen mit diesen Grenzen.
- **Tempo-Rampe**: Jeder Anlauf (Start, WEITER) läuft 15 s mit 1.0 km/h, danach und bei jeder Änderung über
  3 km/h (`routeOffset`, Planwechsel, Ziel auf 3 km/h) in Stufen von 3 km/h alle 4 s. Handeingabe Tempo bricht die Rampe ab.
- **Ankündigung**: `toChange` (Meter bis zum Beginn des Wechsels inklusive Steigungsvorlauf) bzw.
  `toFinish`; 10 s vorher Banner und Ton bei 3, 2, 1, wenn sich Steigung ab 1 % oder Tempo ab 1 km/h
  gegenüber dem aktuellen Soll ändert; im letzten Abschnitt Zielbanner.

## Laufzeit (Core.runRoute)

- Position = gelaufene Banddistanz seit Start. Die Strecke bewegt sich nur, wenn das
  Band läuft; Pausen halten den Punkt an.
- Abschnittswechsel setzt Soll-Tempo und Soll-Steigung des Plans.
- **Handeingabe Tempo**: wird als Versatz zum Plan gespeichert («Plan +0.5 km/h») und gilt
  für alle folgenden Abschnitte, bis man ihn zurücksetzt (Befehl `routeOffset`, in der
  Oberfläche «Zurück zum Plan»).
- **Handeingabe Steigung**: gilt nur bis zum nächsten Steigungswechsel, dann wieder der Plan
  (Schnellwahl «−1», «Plan», «+1»; Hinweis «Steigung von Hand bis zum nächsten Wechsel»).
- **Nach Unterbrechung** (Fehler quittiert, PAUSE mit 3 km/h) und nach Start über die
  Gerätetasten läuft der Plan relativ zum aktuellen Tempo weiter (grosser negativer Versatz,
  Anzeige «Plan pausiert · 3.0 km/h statt 12.4»).
- **Vorsprung/Rückstand**: Planzeit an der aktuellen Position minus gelaufene Zeit.
  Prognose = gelaufene Zeit + restliche Planzeit (mit aktuellem Versatz gerechnet).
- **Ziel**: bei Distanz ≥ Streckenlänge Programmende, Tempo 3 km/h, Steigung 0;
  `summary.route.t` ist die Zeit bis zum Ziel ohne Auslaufen. Die 10 s bis zum automatischen
  STOP zählen erst ab Ist-Tempo höchstens 3.3 km/h; wer im Auslaufen über 3.5 km/h erhöht,
  läuft frei weiter (STOP beendet den Lauf).
- Sicherheit bleibt unverändert: arm/Countdown, STOP mit Vorrang, Schlüssel. Watchdog: ohne
  Lebenszeichen über 60 s regeln Programme weder Tempo noch Steigung hoch.

## Daten und Schnittstellen

- Streckendateien liegen im Dienst unter `files/routes/<id>.json`:
  `{id, name, ort, quelle, d (m), up, down, pts: [[lat, lon, ele, dist], ...] (alle ~10 m),
  prof: [[dist, ele], ...] (~400 Punkte)}`. Beispielstrecken liegen in
  `assets/www/strecken/` und werden beim ersten Start übernommen.
- `GET /api/routes` (Liste), `GET /api/routes/<id>`, `POST /api/routes` (Token, ≤ 4 MB),
  `DELETE /api/routes/<id>` (Token).
- Programm `{"type":"route","id":"...","target":6300,"mode":"terrain|even","scale":1.0}`
  (nur Kennung; Profil, Art und Höhenquelle liest der Dienst selbst). Der Dienst plant und liefert in `prog`:
  `x` (m), `D`, `idx`, `n`, `sec` (aktueller Abschnitt a, b, s, i, g), `next`, `pace`
  (Soll s/km), `tPlan`, `delta` (s, positiv = Rückstand), `eta`, `offS`, `offI`, `ele`.
  Mit `?hist=1` zusätzlich `secs` (alle Abschnitte) und `prof`.
- **Keine Live-Abhängigkeiten** (Vorgabe 27.10.2026): Im Betrieb hängt das Band von nichts
  Externem ab. Kacheln liefert ausschliesslich der Dienst aus dem Gerät: vorgeladene Kacheln
  (`files/tiles`), sonst das Paket der Beispielstrecken im APK (`assets/tiles/luft`, Luftbild, Zoom 12 bis
  16, 1112 Kacheln, 28 MB), sonst eine neutrale leere Kachel. Die Anzeige löst nie einen
  Internetzugriff aus. Online geladen wird nur einmal beim Import einer eigenen Strecke
  (`POST /api/tiles/prefetch`); ohne Netz wird trotzdem importiert, die Karte zeigt dann die
  Linie auf dunklem Grund. Vorgeladene Kacheln werden nie automatisch gelöscht (Obergrenze 500 MB).
- swisstopo-Höhen gibt es nur beim Import und nur als Verbesserung; ohne Netz gelten die
  GPX-Höhen (`hoehe: "gpx"`), der Dienst glättet sie dann über 110 m.
- Kartenbibliothek: Leaflet 1.9 lokal im Paket (keine CDN-Abhängigkeit).

## Pille (Overlay über Apps)

- Ausgeklappt zeigt das Phasenfeld «km 12.4 / 21.1», darunter Soll-Pace und
  Vorsprung/Rückstand. Das Diagrammband zeigt das Höhenprofil mit Positionsmarke
  statt des Zeitverlaufs. 10 s vor einer Steigungsänderung ab 1 % kommt das gewohnte
  Wechselbanner («Steigung auf 6.5 % in 50 m»).

## Prüfung

- `RouteSim` auf der VM prüft Planung und Planzeit (Planzeit = Zielzeit ±2 s, Abschnitte,
  Grenzen); der UI-Audit vergleicht den JS-Port der Planung damit (RouteSim und PlanDump,
  Abweichung 0).
- Die Laufzeit (Abschnittswechsel, Steigungsvorlauf, Tempo vorziehen, Versatz, Tempo-Rampe,
  Auslaufen und Freilauf, Watchdog für Tempo und Steigung, `toChange`/`toFinish`) prüfen die
  Core-Szenariotests auf der VM: `app/tools/coretest/test.sh` (alle Szenarien des Dienstes, derzeit 65).
- Demo-Szenario und Pillensimulation «strecke» für Fotos ohne Bandbewegung.
- Audit der Weboberfläche mit eigenen Prüfpunkten, Review-Runde mit Streckenmodus.
