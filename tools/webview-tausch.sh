#!/bin/bash
# Ersetzt die System-WebView der Konsole (Chrome 74) durch Chromium 156 (LineageOS-Build, com.android.webview).
# Schritte: Sicherung pruefen, dm-verity aus, Neustart, remount, Datei tauschen, Neustart, Kontrolle.
# Rueckweg: tools/webview-zurueck.sh (spielt die Sicherung zurueck).
set -e
A="adb -s ${TREADXP_ADB:?TREADXP_ADB=ip:5555 setzen}"
NEU=./apks/webview-lineage.apk
SICH=./backup/webview/webview/webview.apk
SOLL=1d2f61832b2596b0046cb82cf3634609ea866098d097a83fac27c35272ac726a

warte() { # wartet auf fertig gestartetes Geraet mit root
  sleep 60
  for i in $(seq 1 30); do adb connect ${TREADXP_ADB} >/dev/null 2>&1; $A shell getprop sys.boot_completed 2>/dev/null | grep -q 1 && break; sleep 5; done
  sleep 10; $A root >/dev/null 2>&1; sleep 5; adb connect ${TREADXP_ADB} >/dev/null 2>&1; sleep 2
}

echo "1/6 Pruefen"
[ -f "$SICH" ] || { echo "Sicherung fehlt: $SICH"; exit 1; }
[ "$(sha256sum "$NEU" | cut -c1-64)" = "$SOLL" ] || { echo "Neue WebView fehlt oder Pruefsumme falsch"; exit 1; }
ST=$(adb -s ${TREADXP_ADB:?TREADXP_ADB=ip:5555 setzen} forward tcp:8765 tcp:8765 >/dev/null; curl -s -m 3 http://127.0.0.1:8765/api/state | grep -o '"speed":[0-9.]*')
echo "   Band: $ST"; [ "$ST" = '"speed":0' ] || { echo "Band laeuft, abgebrochen"; exit 1; }

echo "2/6 dm-verity aus"
$A root >/dev/null; sleep 3; adb connect ${TREADXP_ADB} >/dev/null
$A disable-verity
$A reboot; warte

echo "3/6 Systempartition beschreibbar"
$A remount 2>&1 | tail -2
if ! $A shell 'touch /product/app/webview/.probe && rm /product/app/webview/.probe'; then
  echo "   remount braucht noch einen Neustart"; $A reboot; warte; $A remount 2>&1 | tail -2
fi

echo "4/6 WebView tauschen"
$A push "$NEU" /data/local/tmp/webview.apk >/dev/null
$A shell 'cp /data/local/tmp/webview.apk /product/app/webview/webview.apk && chmod 644 /product/app/webview/webview.apk && rm -rf /product/app/webview/oat && rm /data/local/tmp/webview.apk && sync'
$A shell 'ls -la /product/app/webview/'

echo "5/6 Neustart"
$A reboot; warte

echo "6/6 Kontrolle"
$A shell 'dumpsys webviewupdate | grep -E "Current WebView package"'
$A shell 'ps -A | grep treadctl' || true
echo "Fertig."
