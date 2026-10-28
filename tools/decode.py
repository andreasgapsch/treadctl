#!/usr/bin/env python3
"""
Decoder fuer das JHT/Horizon-Steuerprotokoll (Tread-XP, Spur C).

Modelliert nach dem Referenz-RE csacca/horizon-74-at-ble (BLE-Modulweg).
Die interne UART der Tread-XP kann abweichen; dieser Decoder ist der
Startpunkt und wird gegen echte Mitschnitte kalibriert.

Eingabe: Hex-Bytes (eine Zeile pro Frame oder ein durchgehender Strom),
z. B. aus dem strace-Log extrahiert.

Nutzung:
    python3 decode.py < frames.hex
    echo "aa55 0100 03 05 ..." | python3 decode.py
"""
import sys

HEADER_LENGTH = 10

# CRC-16-CCITT (unreflected, Poly 0x1021). Init wird gegen echte Frames
# kalibriert; Referenz nennt "CCITT CRC16 table", unreflected.
def _make_table(poly=0x1021):
    table = []
    for b in range(256):
        crc = b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ poly) if (crc & 0x8000) else (crc << 1)
            crc &= 0xFFFF
        table.append(crc)
    return table

_CRC_TABLE = _make_table()

def crc16_ccitt(data: bytes, init=0xFFFF) -> int:
    crc = init
    for byte in data:
        crc = ((crc << 8) & 0xFFFF) ^ _CRC_TABLE[((crc >> 8) ^ byte) & 0xFF]
    return crc & 0xFFFF

# Typ-Tabelle (msg[5] = Command-ID), aus der Referenz uebernommen.
TYPE_BY_MSG5 = {
    0x00: "response",
    0x01: "selectUser",
    0x02: "machineInfo/startWorkout",
    0x03: "pause/continue",
    0x04: "changeWorkout",
    0x05: "setSpeed",
    0x06: "setIncline",
    0x07: "setResistance",
    0x10: "selectProgram",
    0x11: "keyPress",
    0x12: "workoutData",
    0x13: "setHeartValue",
    0x14: "stopWorkout/timeSync",
    0x16: "userInfo",
    0x17: "setMyFirst5k",
    0x18: "setCustomProgram",
    0x19: "setCustomHRProgram",
    0x1A: "workoutSummary",
    0x1B: "setPopupInfo",
}


class Frame:
    def __init__(self, msg: bytes):
        self.msg = msg
        self.signature = msg[0:2]
        self.seq_num = int.from_bytes(msg[2:4], "little")
        self.msg4 = msg[4]
        self.msg5 = msg[5]
        self.length = int.from_bytes(msg[6:8], "little")
        self.crc = int.from_bytes(msg[8:10], "little")
        self.body = msg[10:]
        self.type = TYPE_BY_MSG5.get(self.msg5, f"unknown(0x{self.msg5:02x})")

    def check_crc(self):
        """Prueft CRC ueber den Rumpf. Welche Spanne/Init stimmt, zeigt die
        Kalibrierung gegen echte Frames (siehe calibrate_crc)."""
        for init in (0xFFFF, 0x0000):
            if crc16_ccitt(self.msg[10:10 + self.length], init) == self.crc:
                return f"ok(init=0x{init:04x})"
        return "mismatch(zu kalibrieren)"

    def interesting(self):
        out = []
        if self.msg5 == 0x05 and len(self.msg) >= 13:  # setSpeed
            spd = int.from_bytes(self.msg[11:13], "little")
            out.append(f"setSpeed={spd/10.0:.1f} km/h")
        if self.msg5 == 0x06 and len(self.msg) >= 12:  # setIncline
            inc = int.from_bytes(self.msg[10:12], "little")
            out.append(f"setIncline={inc/10.0:.1f}%")
        if self.msg5 == 0x12 and len(self.msg) >= 65:  # workoutData (live)
            spd = int.from_bytes(self.msg[61:63], "little")
            inc = int.from_bytes(self.msg[63:65], "little")
            out.append(f"LIVE speed={spd/10.0:.1f} incline={inc/10.0:.1f}")
        return "  ".join(out)

    def __str__(self):
        line = (f"seq=0x{self.seq_num:04x} msg4=0x{self.msg4:02x} "
                f"msg5=0x{self.msg5:02x} len={self.length} "
                f"crc=0x{self.crc:04x}[{self.check_crc()}] {self.type}")
        extra = self.interesting()
        return line + (f"\n    >> {extra}" if extra else "")


def parse_stream(data: bytes, sig=None):
    """Zerlegt einen Bytestrom in Frames anhand von Signatur + Laengenfeld.
    sig: erwartete 2-Byte-Signatur (aus echten Frames ableiten); None = jede."""
    i = 0
    while i + HEADER_LENGTH <= len(data):
        if sig and data[i:i+2] != sig:
            i += 1
            continue
        length = int.from_bytes(data[i+6:i+8], "little")
        end = i + HEADER_LENGTH + length
        if end > len(data):
            break
        yield Frame(data[i:end])
        i = end


def _bytes_from_text(text: str) -> bytes:
    hexs = "".join(c for c in text if c in "0123456789abcdefABCDEF")
    if len(hexs) % 2:
        hexs = hexs[:-1]
    return bytes.fromhex(hexs)


if __name__ == "__main__":
    raw = _bytes_from_text(sys.stdin.read())
    if not raw:
        print("Keine Hex-Daten auf stdin.", file=sys.stderr)
        sys.exit(1)
    n = 0
    for frame in parse_stream(raw):
        print(frame)
        n += 1
    print(f"\n{n} Frames.", file=sys.stderr)
