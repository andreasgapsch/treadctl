#!/bin/bash
# UI-Audit mit Speicherwaechter: bricht ab, wenn der Rechner unter 1.5 GB frei faellt (Log: out/audit.log)
cd ./app/tools
node ui-audit.mjs "$@" > out/audit.log 2>&1 &
PID=$!
while kill -0 $PID 2>/dev/null; do
  sleep 3
  av=$(free -m | awk '/Mem/{print $7}')
  if [ "$av" -lt 1500 ]; then echo "ABBRUCH: Speicher knapp ($av MB frei)" >> out/audit.log; pkill -P $PID; kill $PID; fi
done
wait $PID; echo "exit $?" >> out/audit.log
