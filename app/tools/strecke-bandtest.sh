#!/bin/bash
# Bandtest Streckenmodus. NUR mit Person am Band und Schluessel griffbereit (Band laeuft ~6 min mit Gehtempo).
# Strecke 500 m: 150 m flach, 200 m mit 4 %, 150 m flach. Zielzeit 6:00 (Mittel 5 km/h).
# Prueft: Planung, Start mit arm, Steigung vor dem Anstieg, STOP/WEITER im Anstieg, Rueckkehr auf 0 %, Ziel, Auslaufen, Zusammenfassung.
# Ausserdem Motorrate messen: Zeit von 0 auf 4 % im Log (tIncl gegen incline) fuer RoutePlan.MOTOR.
A="adb -s ${TREADXP_ADB:?TREADXP_ADB=ip:5555 setzen}"
U=http://127.0.0.1:8765/api
$A forward tcp:8765 tcp:8765 >/dev/null
TK=$($A shell cat /data/user/0/com.gapsch.treadctl/files/token | tr -d '\r\n')
P=0; F=0
t() { if [ "$2" = "$3" ]; then echo "  OK   $1 ($2)"; P=$((P+1)); else echo "  FEHL $1 (ist $2, soll $3)"; F=$((F+1)); fi; }
cmd() { curl -s -m 4 -X POST -H "X-Token: $TK" -H 'X-From: test' $U/cmd -d "$1"; }
st() { curl -s -m 3 $U/state | python3 -c "import json,sys;o=json.load(sys.stdin);p=o.get('prog') or {};print($1)"; }
read -p "Person am Band, Schluessel steckt, Band frei? (ja) " OK; [ "$OK" = "ja" ] || exit 1
PROF=$(python3 -c "
import json;p=[]
for d in range(0,501,10):
    e=400 if d<=150 else (400+(d-150)*0.04 if d<=350 else 408)
    p.append([d,round(e,2)])
print(json.dumps(p))")
t "Programm laden" "$(cmd '{"c":"program","p":{"type":"route","id":"bandtest","name":"Bandtest","target":360,"mode":"terrain","scale":1.0,"prof":'"$PROF"'}}')" '{"ok":true}'
t "Abschnitte" "$(st "p['n']")" 3
cmd '{"c":"arm"}' >/dev/null; sleep 3
t "Start" "$(cmd '{"c":"start"}')" '{"ok":true}'
MAXI=0; SAWDONE=0; PAUSED=0
for i in $(seq 1 120); do
  sleep 4
  L=$(st "'%d %.1f %.1f %.1f %s %s' % (p.get('x',0), o['speed'], o['tIncl'], o['incline'], p.get('done'), o['st'])")
  echo "   $L"
  set -- $L
  awk "BEGIN{exit !($3 > $MAXI)}" && MAXI=$3
  [ "$1" -lt 140 ] && [ "$(awk "BEGIN{print ($3>0)}")" = 1 ] && echo "   Hinweis: Steigung schon vor 140 m"
  [ "$5" = "True" ] && SAWDONE=1
  # einmal mitten im Anstieg STOP und WEITER: Steigung darf nicht zurueckspringen
  if [ "$PAUSED" != 1 ] && [ "$1" -ge 220 ]; then PAUSED=1; INC0=$3
    cmd '{"c":"stop"}' >/dev/null; sleep 8; cmd '{"c":"arm"}' >/dev/null; sleep 3
    t "WEITER im Anstieg" "$(cmd '{"c":"resume"}')" '{"ok":true}'
    sleep 4; t "Steigung nach WEITER gehalten" "$(st "o['tIncl']")" "$INC0"; fi
  [ "$6" = "PAUSE" ] && break
done
t "Steigung im Anstieg erreicht" "$MAXI" 4.0
t "Ziel erkannt" "$SAWDONE" 1
t "Nach Ziel in Pause" "$(st "o['st']")" PAUSE
t "Steigung nach Anstieg wieder 0" "$(st "o['tIncl']")" 0.0
R=$(cmd '{"c":"end"}')
t "Zusammenfassung mit Strecke" "$(echo "$R" | python3 -c "import json,sys;print(json.load(sys.stdin)['summary']['route']['finish'])")" True
echo; echo "Ergebnis: $P bestanden, $F fehlgeschlagen"
