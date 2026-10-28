#!/usr/bin/env python3
"""
JHT-LCB-Protokoll (Tread-XP, /dev/ttyS4, 9600 Baud), statisch aus der
JHT-App rekonstruiert. Siehe notes/lcb-protokoll.md.

Paket: 00 | STATUS | CMD | LEN | DATA[LEN] | CRC8   (Daten Big-Endian)

Nutzung:
    python3 lcb.py build F1 1500        # SetLCBMotorRPM 1500 bauen
    python3 lcb.py kph 10.0             # km/h -> RPM / Paket
    python3 lcb.py incline 5.0          # % -> ADC / Paket
    python3 lcb.py parse 00ff f1 02 05dc <crc>   # Paket(e) zerlegen
"""
import sys

_T = [0x00, 0x31, 0x62, 0x53, 0xC4, 0xF5, 0xA6, 0x97,
      0xB9, 0x88, 0xDB, 0xEA, 0x7D, 0x4C, 0x1F, 0x2E]


def crc8(data: bytes) -> int:
    """CRC-8 der LCB-Pakete (Nibble-Tabelle, Polynom 0x31, Start 0)."""
    c = 0
    for b in data:
        t = ((c << 4) & 0xFF) ^ _T[(c >> 4) ^ (b >> 4)]
        c = ((t << 4) & 0xFF) ^ _T[(b & 0x0F) ^ (t >> 4)]
    return c


CMDS = {
    0x70: "SetLCBInitialize", 0x71: "GetLCBStatus", 0x72: "GetLCBErrorCode",
    0x73: "GetLCBVersion", 0x74: "SetLCBCalibrate", 0x76: "SetLCBSkipCurrError",
    0x7C: "GetLCBProtocolVersion", 0x7E: "SetLCBTreadmillOperate",
    0xF0: "SetLCBMotorSpeedRtnRPM", 0xF1: "SetLCBMotorRPM",
    0xF2: "SetLCBIncPWMStep", 0xF3: "SetLCBDecPWMStep", 0xF4: "SetLCBStopPWMStep",
    0xF5: "SetLCBInclineAction", 0xF6: "SetLCBInclineLoc",
    0xF7: "SetLCBOperatingStatus", 0xF8: "GetLCBRollerRPM", 0xF9: "GetLCBMotorRPM",
    0xFA: "GetLCBInclineLoc", 0x80: "SetLCBInclinePercent", 0x81: "GetLCBInclinePercent",
    0x93: "SetLCBMotorPowerOff", 0x95: "GetLCBTreadmillInUsed",
    0x96: "GetLCBMainMotorInfo", 0x97: "GetLCBTreadmillExtStatus",
    0xA0: "GetLCBDCIinclineRange", 0xA6: "GetLCBDCIrpmSpeedRange",
}

# Kalibrierung FrameConfigEnum.Treadmill (TM1032)
KPH_MIN, KPH_MAX, RPM_MIN, RPM_MAX = 0.8, 20.0, 173.0, 4283.0
INC_MIN, INC_MAX, ADC_MIN, ADC_MAX = 0.0, 15.0, 34, 990
RAMP_RPM_PER_200MS = 28


def kph_to_rpm(kph: float) -> int:
    if round(kph * 10) < round(KPH_MIN * 10):
        return 0
    kph = min(kph, KPH_MAX)
    return round(RPM_MIN + (kph - KPH_MIN) * (RPM_MAX - RPM_MIN) / (KPH_MAX - KPH_MIN))


def rpm_to_kph(rpm: int) -> float:
    if rpm <= 0:
        return 0.0
    return KPH_MIN + (rpm - RPM_MIN) * (KPH_MAX - KPH_MIN) / (RPM_MAX - RPM_MIN)


def incline_to_adc(pct: float) -> int:
    pct = max(INC_MIN, min(INC_MAX, pct))
    # App schneidet ab (int-Cast), live bestaetigt: 1.0%->97, 2.5%->193
    return int(ADC_MIN + pct * (ADC_MAX - ADC_MIN) / (INC_MAX - INC_MIN))


def build(cmd: int, data: bytes = b"", status: int = 0xFF) -> bytes:
    body = bytes([0x00, status, cmd, len(data)]) + data
    return body + bytes([crc8(body)])


def u16(v: int) -> bytes:
    return int(v).to_bytes(2, "big")


def parse(buf: bytes):
    i = 0
    while i + 5 <= len(buf):
        if buf[i] not in (0x00, 0x01):
            i += 1
            continue
        n = buf[i + 3]
        end = i + 4 + n + 1
        if end > len(buf):
            break
        pkt = buf[i:end]
        ok = crc8(pkt[:-1]) == pkt[-1]
        yield pkt, ok
        i = end if ok else i + 1


def describe(pkt: bytes, ok: bool) -> str:
    cmd, data = pkt[2], pkt[4:-1]
    name = CMDS.get(cmd, f"0x{cmd:02X}")
    s = f"{pkt.hex(' ')}  start={pkt[0]:02x} st={pkt[1]:02x} {name} len={len(data)} crc={'ok' if ok else 'FALSCH'}"
    if len(data) == 2:
        v = int.from_bytes(data, "big")
        if cmd in (0xF1, 0xF9, 0xF8):
            s += f"  -> {v} rpm ~ {rpm_to_kph(v):.1f} km/h"
        elif cmd in (0xF6, 0xFA):
            s += f"  -> adc {v} ~ {(v - ADC_MIN) * 15 / (ADC_MAX - ADC_MIN):.1f} %"
    return s


def _hex(args):
    return bytes.fromhex("".join(args).replace(" ", ""))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] in ("-h", "--help"):
        print(__doc__)
    elif a[0] == "build":
        cmd = int(a[1], 16)
        data = u16(int(a[2])) if len(a) > 2 else b""
        print(build(cmd, data).hex(" "))
    elif a[0] == "kph":
        r = kph_to_rpm(float(a[1]))
        print(f"{a[1]} km/h -> {r} rpm  Paket: {build(0xF1, u16(r)).hex(' ')}")
    elif a[0] == "incline":
        d = incline_to_adc(float(a[1]))
        print(f"{a[1]} % -> adc {d}  Paket: {build(0xF6, u16(d)).hex(' ')}")
    elif a[0] == "parse":
        for p, ok in parse(_hex(a[1:])):
            print(describe(p, ok))
