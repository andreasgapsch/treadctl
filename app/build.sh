#!/usr/bin/env bash
# Baut und signiert TreadCtl (Weg-1-System-App) mit dem Plattformschluessel.
set -e
S=~/android-sdk; BT=$S/build-tools/34.0.0; AJ=$S/platforms/android-29/android.jar
APP=$(cd "$(dirname "$0")" && pwd); K=${TREADCTL_KEYS:-$APP/../keys}; cd "$APP"
rm -rf out; mkdir -p out/classes
/usr/lib/jvm/java-17-openjdk-amd64/bin/javac -source 8 -target 8 -bootclasspath "$AJ" -cp "$AJ" -d out/classes $(find src -name '*.java')
$BT/d8 --min-api 29 --output out $(find out/classes -name '*.class')
$BT/aapt2 link -I "$AJ" --manifest AndroidManifest.xml --min-sdk-version 29 \
  --target-sdk-version 29 -A assets -o out/base.apk
cd out && rm -rf stage && mkdir stage && (cd stage && unzip -oq ../base.apk && cp ../classes.dex .)
(cd stage && zip -qr ../unsigned.apk .)
$BT/zipalign -f 4 unsigned.apk aligned.apk
$BT/apksigner sign --key "$K/platform.pk8" --cert "$K/platform.x509.pem" \
  --out treadctl.apk aligned.apk
echo "Fertig: out/treadctl.apk"
