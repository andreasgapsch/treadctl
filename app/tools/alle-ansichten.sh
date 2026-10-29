#!/bin/bash
# Fotografiert alle Ansichten am echten Geraet (ohne Bandbewegung): Weboberflaeche live und als Demo-Szenario,
# dazu die native Pille per pillsim. Ablage: captures/feedback/NN-name.png und liste.txt (Nummer|Datei|Titel|Art)
A="adb -s ${TREADXP_ADB:?TREADXP_ADB=ip:5555 setzen}"
D=./captures/feedback; rm -rf "$D"; mkdir -p "$D"
N=0
# Umschalttaste haelt den Bildschirmschoner fern (keydown setzt die Ruhezeit zurueck, loest sonst nichts aus)
wake() { $A shell input keyevent 59; }
shot() { wake; N=$((N+1)); F=$(printf "%02d-%s.png" $N "$1"); sleep "${3:-4}"; $A exec-out screencap -p > "$D/$F"; echo "$N|$F|$2|$4" >> "$D/liste.txt"; echo "  $N $1"; }
ui() { wake; if [ $# -ge 2 ]; then $A shell "am start -n com.gapsch.treadctl/.UiActivity --es route '$1' --es demo '$2'" >/dev/null 2>&1; else $A shell am start -n com.gapsch.treadctl/.UiActivity --es route "$1" >/dev/null 2>&1; fi; }
uilive() { $A shell am start -n com.gapsch.treadctl/.UiActivity --es route "$1" --es demo "" >/dev/null 2>&1; sleep 1; $A shell am start -n com.gapsch.treadctl/.UiActivity --es route "$1" >/dev/null 2>&1; }
tap() { wake; $A shell input tap "$1" "$2"; }
pill() { python3 ./app/tools/pillsim.py "$1" > /tmp/ps.json; $A push /tmp/ps.json /data/local/tmp/ps.json >/dev/null; $A shell 'cp /data/local/tmp/ps.json /data/data/com.gapsch.treadctl/files/pillsim.json'; }
nopill() { $A shell 'rm -f /data/data/com.gapsch.treadctl/files/pillsim.json'; }
home() { $A shell input keyevent 3; }
# Sicherheit: Fotosperre im Dienst setzen, damit kein Tipp das Band anlaufen laesst; am Ende wieder entfernen
$A shell 'touch /data/data/com.gapsch.treadctl/files/nostart && chmod 644 /data/data/com.gapsch.treadctl/files/nostart'
trap "$A shell 'rm -f /data/data/com.gapsch.treadctl/files/nostart /data/data/com.gapsch.treadctl/files/pillsim.json'" EXIT
nopill

echo "Weboberflaeche, live"
uilive "/";                         shot start            "Startseite" 5 live
sleep 2; tap 1345 113;              shot player-fenster    "Player-Fenster: Quelle, Steuerung, Lautstärke, Abspielgerät" 3 live
tap 1765 218; sleep 1
tap 1170 113;                       shot pulsmenue         "Pulsmenü am Pulschip" 3 live
tap 300 600; sleep 1
uilive "/"; sleep 2; tap 1856 112;   shot profil            "Profil und Bildschirm" 3 live
$A shell input keyevent 4; sleep 1
ui "/geraete";                      shot geraete           "Geräte: Pulsmesser, Ventilator, Lautsprecher" 5 live
ui "/run";                          shot schnellstart      "Schnellstart, bereit" 4 live
ui "/interval/p-schwelle";          shot intervall-bereit  "Intervall «Schwelle 5 × 4 min», bereit" 4 live
ui "/zones";                        shot zonen-einrichten  "Zonentraining einrichten" 4 live
ui "/plans";                        shot plaene            "Trainingspläne" 4 live
ui "/plans/edit/p-schwelle";        shot plan-bearbeiten   "Plan bearbeiten (Intervall)" 4 live
ui "/plans/edit/p-grundlage";       shot plan-zonen        "Plan bearbeiten (Zonen)" 4 live
ui "/interval/p-hfmax";            shot stufentest-bereit "Stufentest HFmax, bereit" 4 live
ui "/apps";                         shot apps              "Apps" 5 live
ui "/history";                      shot verlauf           "Verlauf" 4 live
ui "/strecken";                     shot strecken          "Strecken, Bibliothek" 5 live
tap 1745 212;                       shot strecke-import    "GPX importieren, Dateiauswahl" 3 live
$A shell input keyevent 4
ui "/strecke/homberg-runde";             shot strecke-aarau     "Strecke Homberg-Runde, Planung" 7 live
ui "/strecke/hallwilersee-runde";      shot strecke-hallwil   "Strecke Hallwilersee-Runde, Planung" 7 live
ui "/strecke/arosa-weisshorn";          shot strecke-arosa     "Strecke Arosa Weisshorn-Runde, Planung" 7 live
$A forward tcp:8765 tcp:8765 >/dev/null; TK=$($A shell cat /data/data/com.gapsch.treadctl/files/token | tr -d '\r')
curl -s -X POST -H "X-Token: $TK" -d '{"c":"clearProgram"}' http://127.0.0.1:8765/api/cmd >/dev/null

echo "Weboberflaeche, Demo-Szenarien (Werte simuliert, Band steht)"
ui "/run" "szenario=lauf";                         shot lauf               "Schnellstart, Lauf" 5 demo
ui "/run" "szenario=pause";                        shot pause              "Pause" 4 demo
ui "/run" "szenario=fehler";                       shot fehler             "Fehler (Sicherheitsschlüssel gezogen)" 4 demo
ui "/run" "szenario=nachfehler";                   shot nach-fehler        "Pause nach Unterbrechung, Weiter mit Gehtempo" 4 demo
ui "/interval/p-schwelle" "szenario=intervall";    shot intervall-lauf     "Intervall, Belastung" 5 demo
ui "/interval/p-schwelle" "szenario=wechsel";      shot intervall-wechsel  "Intervall, Wechsel in 7 s" 4 demo
ui "/zones" "szenario=zonen";                      shot zonen-lauf         "Zonentraining, Lauf" 5 demo
ui "/interval/p-hfmax" "szenario=stufentest";     shot stufentest-lauf    "Stufentest HFmax, Lauf (Max-Puls bisher)" 5 demo
ui "/interval/p-hfmax" "szenario=stufentest-pause"; shot stufentest-pause  "Stufentest HFmax, Pause" 4 demo
ui "/run" "szenario=lauf"; sleep 4; tap 1470 105;  shot player-im-lauf     "Player-Fenster im Lauf (lässt STOP frei)" 3 demo
ui "/geraete" "luefter=hand";                     shot geraete-hand       "Geräte: Ventilator von Hand 75 %" 5 demo
ui "/strecke/homberg-runde" "szenario=strecke";         shot strecke-lauf       "Strecke Aargau HM, Lauf bei km 12" 8 demo
ui "/strecke/homberg-runde" "szenario=strecke-versatz"; shot strecke-versatz    "Strecke, Tempo von Hand (Versatz zum Plan)" 8 demo
ui "/strecke/homberg-runde" "szenario=strecke-unterbrechung"; shot strecke-unterbrechung "Strecke, Plan pausiert nach Unterbrechung" 8 demo
ui "/strecke/homberg-runde" "szenario=strecke-ziel";    shot strecke-ziel       "Strecke, Ziel erreicht" 8 demo
ui "/strecke/homberg-runde" "szenario=strecke-ende";    shot strecke-ende       "Strecke, Pause nach dem Ziel" 7 demo
ui "/history" "";                                  shot verlauf-demo       "Verlauf mit Beispielläufen" 4 demo
ui "/summary" "";                                  shot zusammenfassung    "Zusammenfassung eines Laufs" 4 demo
ui "/" "saver=1";                                  shot bildschirmschoner  "Bildschirmschoner" 4 demo

[ "$NUR_WEB" = 1 ] && { echo "Fertig (nur Weboberflaeche): $N Bilder in $D"; exit 0; }
echo "Pille (simulierte Werte ueber der Herstelleroberflaeche)"
uilive "/"; sleep 2; home; sleep 2
$A shell input keyevent 3; sleep 2;                shot pille-ruhe         "Pille im Ruhezustand (Griff unten Mitte)" 3 pille
$A shell input swipe 960 1042 960 820 250;          shot pille-bereit       "Pille bereit (vom Griff hochgewischt)" 2 pille
pill lauf;                                         shot pille-lauf         "Pille im Lauf, eingeklappt" 4 pille
tap 960 1000;                                      shot pille-offen        "Pille ausgeklappt" 2 pille
tap 1845 985;                                      shot pille-verlauf      "Pille mit Verlauf" 3 pille
tap 960 1000; sleep 1; tap 1750 985;              shot pille-ventilator   "Pille: Ventilator AUTO, AUS, Stufen" 2 pille
pill wechsel; tap 960 1000;                        shot pille-wechsel      "Intervall: Wechselbanner" 4 pille
pill pause;                                        shot pille-pause        "Pille in Pause" 4 pille
pill nachfehler;                                   shot pille-nachfehler   "Pause nach Unterbrechung" 4 pille
pill fehler;                                       shot pille-fehler       "Fehler, Quittieren" 4 pille
pill schluessel;                                   shot pille-schluessel   "Sicherheitsschlüssel gezogen" 4 pille
pill strecke;                                      shot pille-strecke      "Strecke: Soll-Pace, Rückstand" 4 pille
tap 960 1000; sleep 1; tap 1845 985;               shot pille-strecke-profil "Strecke: Höhenprofil in der Pille" 3 pille
pill streckewechsel;                               shot pille-strecke-banner "Strecke: Steigungsbanner" 4 pille
pill lauf; $A shell am start -n "$($A shell cmd package resolve-activity --brief app.revanced.android.youtube | tail -1 | tr -d '\r')" >/dev/null 2>&1
                                                   shot pille-youtube      "Pille über YouTube" 8 pille
nopill; home
echo "Fertig: $N Bilder in $D"
