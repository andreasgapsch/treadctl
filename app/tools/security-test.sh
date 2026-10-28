#!/bin/bash
# Sicherheitstests ohne Bandbewegung. Prueft Zugriffsschutz der Steuerung.
A="adb -s ${TREADXP_ADB:?TREADXP_ADB=ip:5555 setzen}"
U=http://127.0.0.1:8765/api
$A forward tcp:8765 tcp:8765 >/dev/null
TK=$($A shell cat /data/user/0/com.gapsch.treadctl/files/token | tr -d '\r\n')
P=0; F=0
t() { if [ "$2" = "$3" ]; then echo "  OK   $1 ($2)"; P=$((P+1)); else echo "  FEHL $1 (ist $2, soll $3)"; F=$((F+1)); fi; }
code() { curl -s -o /dev/null -w %{http_code} -m 4 "$@"; }
t "Steuern ohne Token" "$(code -X POST $U/cmd -d '{"c":"speed","v":5}')" 403
t "Steuern mit falschem Token" "$(code -X POST -H 'X-Token: falsch' $U/cmd -d '{"c":"speed","v":5}')" 403
t "Steuern per GET" "$(code "$U/cmd?c=start")" 404
t "Alte Route /api/start" "$(code $U/start)" 404
t "Fremder Host (DNS-Rebinding)" "$(code -H 'Host: boese.example:8765' $U/state)" 403
t "Fremder Origin trotz Token" "$(code -X POST -H "X-Token: $TK" -H 'Origin: http://boese.example' $U/cmd -d '{"c":"speed","v":5}')" 403
t "Kein CORS-Header" "$(curl -s -D - -o /dev/null $U/state | grep -ci access-control)" 0
t "Pfad-Ausbruch" "$(code --path-as-is 'http://127.0.0.1:8765/../token')" 400
t "Kaputtes JSON" "$(code -X POST -H "X-Token: $TK" $U/cmd -d 'xyz')" 400
t "Blackbox ohne Token" "$(code $U/blackbox)" 404
t "Strecke speichern ohne Token" "$(code -X POST $U/routes -d '{"id":"x","name":"x","pts":[],"prof":[]}')" 403
t "Strecke speichern fremder Origin" "$(code -X POST -H "X-Token: $TK" -H 'Origin: http://boese.example' $U/routes -d '{"id":"x"}')" 403
t "Strecke loeschen ohne Token" "$(code -X DELETE $U/routes/homberg-runde)" 403
t "Beispielstrecke loeschen" "$(code -X DELETE -H "X-Token: $TK" $U/routes/homberg-runde)" 404
t "Strecken-Kennung mit Pfad" "$(code --path-as-is "$U/routes/..%2Ftoken")" 400
t "Kachel fremde Quelle" "$(code http://127.0.0.1:8765/tiles/boese/1/0/0)" 404
t "Kachel ausserhalb Raster" "$(code http://127.0.0.1:8765/tiles/grau/3/99/99)" 404
t "Vorladen ohne Token" "$(code -X POST $U/tiles/prefetch -d '{"src":"luft","pts":[]}')" 403
t "Kachel-Abdeckung ohne Token" "$(code -X POST $U/tiles/coverage -d '{"src":"luft","pts":[]}')" 403
t "Ventilator steuern ohne Token" "$(code -X POST $U/fan -d '{"a":"level","v":100}')" 403
t "Ventilator trennen ohne Token" "$(code -X POST $U/fan -d '{"a":"forget"}')" 403
t "Wiedergabe steuern ohne Token" "$(code -X POST $U/media/cmd -d '{"a":"volUp"}')" 403
t "Abspielgeraet wechseln ohne Token" "$(code -X POST $U/media/cmd -d '{"a":"out","address":""}')" 403
t "Pulsmesser verbinden ohne Token" "$(code -X POST $U/hr/connect -d '{"address":"00:11:22:33:44:55"}')" 403
t "BLE-Werkzeug lesen ohne Token" "$(code $U/probe)" 403
t "Token nur fuer App lesbar" "$($A shell stat -c %a /data/user/0/com.gapsch.treadctl/files/token | tr -d '\r')" 600
$A unroot >/dev/null 2>&1; sleep 4; adb connect ${TREADXP_ADB} >/dev/null; sleep 1
t "Fremde App startet Dienst" "$($A shell 'am start-foreground-service -n com.gapsch.treadctl/.TreadDaemon 2>&1' | grep -c 'not exported')" 1
t "Fremde App startet Oberflaeche" "$($A shell 'am start -n com.gapsch.treadctl/.UiActivity 2>&1' | grep -q -i 'SecurityException\|not exported' && echo 1 || echo 0)" 1
t "Fremde App liest Token" "$($A shell 'cat /data/user/0/com.gapsch.treadctl/files/token 2>&1' | grep -c 'Permission denied')" 1
t "Fremde App sendet BOOT_COMPLETED" "$($A shell 'am broadcast -a android.intent.action.BOOT_COMPLETED -n com.gapsch.treadctl/.BootReceiver 2>&1' | grep -q -i 'SecurityException\|not allowed' && echo 1 || echo 0)" 1
$A root >/dev/null 2>&1; sleep 4; adb connect ${TREADXP_ADB} >/dev/null
echo; echo "Ergebnis: $P bestanden, $F fehlgeschlagen"
