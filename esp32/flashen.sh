#!/bin/bash
# Firmware bauen und auf das Board schreiben (nativer USB, Reset in den Bootloader macht esptool selbst)
set -e
cd "$(dirname "$0")"
P=${1:-$(ls /dev/ttyACM* | head -1)}
.venv/bin/pio run -t upload --upload-port "$P"
