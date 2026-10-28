#!/bin/bash
# Spielt die gesicherte Original-WebView (Chrome 74) zurueck. dm-verity bleibt aus.
set -e
A="adb -s ${TREADXP_ADB:?TREADXP_ADB=ip:5555 setzen}"
SICH=./backup/webview/webview
$A root >/dev/null; sleep 3; adb connect ${TREADXP_ADB} >/dev/null
$A remount 2>&1 | tail -1
$A push "$SICH/webview.apk" /data/local/tmp/webview.apk >/dev/null
$A shell 'cp /data/local/tmp/webview.apk /product/app/webview/webview.apk && chmod 644 /product/app/webview/webview.apk && rm -rf /product/app/webview/oat && rm /data/local/tmp/webview.apk && sync'
$A push "$SICH/oat" /product/app/webview/ >/dev/null 2>&1 || true
$A reboot
echo "Original zurueck, Konsole startet neu."
