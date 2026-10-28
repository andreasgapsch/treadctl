#!/bin/bash
# Fehlertests bei 2 km/h OHNE Person auf dem Band. Jeder Test prueft Soll gegen Ist.
# Aufruf: tools/fault-test.sh [testname ...]   (ohne Argument: alle)
A="adb -s ${TREADXP_ADB:?TREADXP_ADB=ip:5555 setzen}"
U=http://127.0.0.1:8765/api
$A forward tcp:8765 tcp:8765 >/dev/null
rtok() { TK=$($A shell cat /data/user/0/com.gapsch.treadctl/files/token | tr -d '\r\n'); }
rtok
TOK() { echo "$TK"; }
C() { curl -s -m 4 -X POST -H "X-Token: $(TOK)" -H 'X-From: test' $U/cmd -d "$1"; }
S() { curl -s -m 3 $U/state; }
J() { S | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }
PASS=0; FAIL=0
ok() { echo "  OK   $1"; PASS=$((PASS+1)); }
no() { echo "  FEHL $1"; FAIL=$((FAIL+1)); }
check() { if python3 -c "import sys; sys.exit(0 if ($2) else 1)"; then ok "$1"; else no "$1 ($2)"; fi; }
waitfor() { # waitfor <python-ausdruck auf d> <sekunden>
  for i in $(seq 1 $(( $2 * 2 ))); do
    if S | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)" 2>/dev/null; then return 0; fi; sleep 0.5; done; return 1; }
ensure_ready() { C '{"c":"end"}' >/dev/null; C '{"c":"ack"}' >/dev/null; waitfor "d['st']=='BEREIT' and d['speed']<0.3" 40; }

t_start_stop() {
  echo "Start, Stop, Weiter, Ende"
  ensure_ready
  C '{"c":"incline","v":1.0}' >/dev/null; C '{"c":"speed","v":2.0}' >/dev/null
  sleep 1; check "Vorladen bewegt nichts" "$(J "['speed']") < 0.3"
  C '{"c":"arm"}' >/dev/null; sleep 3; C '{"c":"start"}' | grep -q '"ok":true' && ok "START angenommen" || no "START"
  waitfor "d['st']=='LAEUFT' and d['speed']>1.7" 25 && ok "Band auf 2 km/h" || no "Band auf 2 km/h: $(S|head -c 160)"
  C '{"c":"arm"}' >/dev/null; sleep 3; C '{"c":"start"}' | grep -q '"ok":false' && ok "zweites START abgewiesen" || no "zweites START"
  C '{"c":"stop"}' >/dev/null
  waitfor "d['st']=='PAUSE' and d['speed']<0.3" 25 && ok "STOP: PAUSE und Band steht" || no "STOP"
  check "Steigung bleibt in Pause (Soll)" "$(J "['tIncl']") == 1.0"
  C '{"c":"arm"}' >/dev/null; sleep 3; C '{"c":"resume"}' >/dev/null
  waitfor "d['st']=='LAEUFT' and d['speed']>1.7" 25 && ok "Weiter" || no "Weiter"
  R=$(C '{"c":"end"}'); echo "$R" | grep -q summary && ok "Ende liefert Zusammenfassung" || no "Ende: $R"
  waitfor "d['st']=='BEREIT' and d['speed']<0.3" 25 && ok "BEREIT, Band steht" || no "nach Ende"
}

t_kill_overlay() {
  echo "Pille-Prozess beenden"
  ensure_ready; C '{"c":"speed","v":2.0}' >/dev/null; C '{"c":"arm"}' >/dev/null; sleep 3; C '{"c":"start"}' >/dev/null; waitfor "d['speed']>1.7" 25
  $A shell 'kill $(pidof com.gapsch.treadctl:ovl)'
  sleep 2; check "Band laeuft weiter" "$(J "['speed']") > 1.7"
  for i in $(seq 1 20); do $A shell pidof com.gapsch.treadctl:ovl >/dev/null && break; sleep 1; done
  $A shell pidof com.gapsch.treadctl:ovl >/dev/null && ok "Pille neu gestartet" || no "Pille nicht neu gestartet"
  C '{"c":"stop"}' >/dev/null; waitfor "d['speed']<0.3" 25; C '{"c":"end"}' >/dev/null
}

t_kill_core() {
  echo "Dienst-Prozess beenden (Band laeuft)"
  ensure_ready; C '{"c":"speed","v":2.0}' >/dev/null; C '{"c":"arm"}' >/dev/null; sleep 3; C '{"c":"start"}' >/dev/null; waitfor "d['speed']>1.7" 25
  $A shell 'kill $(pidof com.gapsch.treadctl:core)'
  T0=$(date +%s)
  for i in $(seq 1 90); do S | grep -q '"ok":true' && break; sleep 1; done
  if S | grep -q '"ok":true'; then
    ok "Dienst wieder da nach $(( $(date +%s) - T0 )) s"; rtok
    check "uebernimmt laufendes Band (LAEUFT)" "'$(J "['st']")' == 'LAEUFT'"
    check "Soll nicht auf 0 (keine Vollbremsung)" "$(J "['tSpeed']") > 1.5"
  else no "Dienst nicht zurueck"; fi
  C '{"c":"stop"}' >/dev/null; waitfor "d['speed']<0.3" 25 && ok "STOP nach Neustart" || no "STOP nach Neustart"
  C '{"c":"end"}' >/dev/null
}

t_program() {
  echo "Intervallprogramm 2 x 12 s"
  ensure_ready
  C '{"c":"program","p":{"type":"interval","name":"Test","segs":[{"d":12,"s":2.0,"i":0.5,"k":"w"},{"d":12,"s":2.6,"i":1.0,"k":"h"}]}}' | grep -q '"ok":true' && ok "Programm geladen" || no "Programm laden"
  sleep 1; check "Programm startet nicht von selbst" "$(J "['speed']") < 0.3"
  C '{"c":"arm"}' >/dev/null; sleep 3; C '{"c":"start"}' >/dev/null
  waitfor "d['prog'] and d['prog']['idx']==2" 30 && ok "Segmentwechsel" || no "Segmentwechsel"
  check "Soll Tempo im Segment 2" "$(J "['tSpeed']") == 2.6"
  waitfor "d['st']=='PAUSE'" 40 && ok "Programmende fuehrt sanft in PAUSE" || no "Programmende: $(S | head -c 200)"
  C '{"c":"end"}' >/dev/null
}

t_bad_input() {
  echo "Grenzen und Unsinn"
  ensure_ready
  C '{"c":"speed","v":99}' >/dev/null; check "Tempo begrenzt auf 20" "$(J "['tSpeed']") <= 20"
  C '{"c":"incline","v":-5}' >/dev/null; check "Steigung nicht negativ" "$(J "['tIncl']") >= 0"
  C '{"c":"step","what":"speed","d":7}' >/dev/null; check "Schritt hoechstens 0.5" "$(J "['tSpeed']") <= 20"
  R=$(C '{"c":"program","p":{"type":"interval","segs":[{"d":10,"s":30}]}}'); echo "$R" | grep -q '"ok":false' && ok "Programm ausserhalb der Grenzen abgewiesen" || no "Programm-Grenzen: $R"
  R=$(curl -s -m 3 -X POST -H "X-Token: $(TOK)" $U/cmd -d 'kein json'); echo "$R" | grep -q '"ok":false' && ok "Kaputtes JSON abgewiesen" || no "JSON: $R"
  C '{"c":"speed","v":3.0}' >/dev/null
}

T="${@:-start_stop bad_input program kill_overlay kill_core}"
for t in $T; do t_$t; done
C '{"c":"end"}' >/dev/null
echo; echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
