#!/bin/bash
# Szenariotests fuer Core auf der VM (ohne Geraet, ohne Bandbewegung).
set -e
D=$(cd "$(dirname "$0")" && pwd); APP=$D/../..
J=$D/lib/json-20240303.jar
if [ ! -f "$J" ]; then   # org.json (Public Domain) nur fuer die Tests, von Maven Central mit Pruefsumme
  mkdir -p "$D/lib"; curl -sfL -o "$J" https://repo1.maven.org/maven2/org/json/json/20240303/json-20240303.jar
  echo "0ebb88e8fb5122b7506d5cf1d69f1ccdb790d22a  $J" | sha1sum -c --quiet || { rm -f "$J"; echo "Prüfsumme falsch"; exit 1; }
fi
rm -rf "$D/cls"; mkdir -p "$D/cls"
javac -nowarn -d "$D/cls" -cp "$D/lib/json-20240303.jar" \
  $(find "$D/stubs" -name '*.java') "$APP/src/com/gapsch/treadctl/Core.java" "$APP/src/com/gapsch/treadctl/RoutePlan.java" "$APP/src/com/gapsch/treadctl/KeyReader.java" "$APP/src/com/gapsch/treadctl/AppHygiene.java" "$APP/src/com/gapsch/treadctl/FtmsData.java" "$D/CoreSzenarien.java" 2>&1 | grep -v "^Note:" || true
java -Dassets="$APP/assets" -cp "$D/cls:$D/lib/json-20240303.jar" com.gapsch.treadctl.CoreSzenarien
