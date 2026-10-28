# LCB-Protokoll Tread-XP (statisch aus der JHT-App rekonstruiert, 26.10.2026)

Quelle: `com.jht.atsoul.nezuko` (163 MB), Bibliothek `com.jht.lcb.lcbcommlib`,
HAL `com.jht.soul.hal.lcb`, Dienst `com.jht.atsoul.service.hal.LCBService`.
Ermittelt durch Analyse der Herstellerschnittstelle zum Zweck der Interoperabilität (siehe RECHTLICHES.md).

## Physik
- Port **`/dev/ttyS4`**, Besitzer system.
- **9600 Baud** im Betrieb, 115200 nur fuer LCB-Firmware-Update.
- Serial-Lib: `libserialport.so` (android-serialport-api).
- Prozess `com.jhtp.atsoul.lcbservice` (gehoert zur App nezuko).

## Paketformat
```
TX: 00 | FF | CMD | LEN | DATA[LEN] | CRC8
```
- Byte 0 = 0x00 (Startbyte), Byte 1 = Statusbyte (TX immer 0xFF).
- Nutzdaten Big-Endian.
- CRC-8 ueber alle Bytes davor, Nibble-Tabelle (Polynom 0x31, Init 0):
  `{00,31,62,53,C4,F5,A6,97,B9,88,DB,EA,7D,4C,1F,2E}`.
- RX-Parser: Startbyte, Status, Message-ID, Laenge, Daten, CRC (gleiches Schema,
  Status vom MCB). Antwort-Timeout 150 ms.

## Wichtige Befehle (Laufband)
| Befehl | Code | Daten |
|---|---|---|
| SetLCBInitialize | 0x70 | |
| GetLCBStatus | 0x71 | Heartbeat |
| GetLCBErrorCode | 0x72 | |
| GetLCBVersion | 0x73 | |
| SetLCBTreadmillOperate | 0x7E | Bytefolge |
| SetLCBMotorSpeedRtnRPM | 0xF0 | u16 |
| **SetLCBMotorRPM** | **0xF1** | **u16 BE = Ziel-RPM** |
| SetLCBIncPWMStep / Dec / Stop | 0xF2 / 0xF3 / 0xF4 | |
| SetLCBInclineAction | 0xF5 | |
| **SetLCBInclineLoc** | **0xF6** | **u16 BE = Steigungs-ADC** |
| SetLCBOperatingStatus | 0xF7 | 1 Byte |
| GetLCBRollerRPM / MotorRPM / InclineLoc | 0xF8 / 0xF9 / 0xFA | Ist-Werte |
| SetLCBInclinePercent / Get | 0x80 / 0x81 | u16 |
| SetLCBMotorPowerOff | 0x93 | |
| GetLCBTreadmillInUsed / MainMotorInfo / ExtStatus | 0x95 / 0x96 / 0x97 | |
| GetLCBDCIinclineRange / rpmSpeedRange | 0xA0 / 0xA6 | |
Weitere Befehle sind nicht dokumentiert.

## Kalibrierung (Laufband-Rahmen, LCB-Typ 4)
- Tempo **0,8 bis 20,0 km/h** linear auf **173 bis 4283 RPM**
  (unter 0,8 km/h = 0). Etwa 214 RPM pro km/h.
- Steigung **0 bis 15 %**, Schritt 0,5, Positions-ADC **34 bis 990**.
- Kalibrierung ist aktiv: Werte koennen per Kalibrierung auf
  dem LCB abweichen, darum live bestaetigen (logcat-Zeile
  `ACTION_SET_SPEED_KPH_FLOAT <kph> | rpm = <rpm>` aus LCBService).
- HAS_TM_ESTOP = true.

## Timing / Sicherheit (Original nachbauen!)
- **Heartbeat alle 400 ms** (TreadMillHandler.HeartBeatThread, autoReplyCmd):
  Status-Poll plus, je nach Zaehler, RPM, Steigung, InUse, MotorInfo, ExtStatus.
- **Tempo-Rampe:** max. 28 RPM pro 200 ms (LCBInterface.RpmRamper), Stopp = 0
  sofort.
- Steigung max. 0,71 %/s.

## Oberhalb der UART: interner Datenbus
LCBService hoert auf dataMatrix-Schluessel `HALKeys.ACTION_SET_SPEED_KPH_FLOAT`
und `ACTION_SET_SPEED_RPM_INT`. Moeglicher sicherer Steuer-Einstieg MIT
JHT-Sicherheitslogik (Rampe, Watchdog), ohne die UART selbst zu besitzen.
Noch zu pruefen, ob von aussen erreichbar (datamatrixservice, apiservice :9090).

## Offen (dynamisch bestaetigen)
- Live-Werte kph -> rpm per logcat (ohne Root, null Risiko).
- Antwortformat/Statusbits, Inhalt SetLCBTreadmillOperate fuer Start/Stop.
- Rohmitschnitt nur falls noetig (strace braucht Root; `adb root` hat einmal
  ADB-ueber-TCP gekillt, `su` ist gesperrt).

## Live bestaetigt (Phase B, logcat, 26.10.2026 18:11 bis 18:13)
- Tempo: alle Sollwerte 0,8 bis 4,0 km/h **exakt** = Formel
  `round(173 + (kph-0,8)*(4283-173)/(20-0,8))`. Beispiel 2,0 -> 430.
- Steigung: `int(34 + pct*(990-34)/15)`, **abgeschnitten** (1,0->97, 1,5->129,
  2,0->161, 2,5->193, 3,0->225), 15 von 15 Werten konsistent.
- Ist-Steigung faellt real ca. 0,6 %/s.
- **Not-Stop:** Schluessel gezogen -> `SafetyManager value=48`, `MCB Safety :
  E-STOP true, event 1, state 1`, danach MCB State 2. Das MCB erkennt den
  Schluessel selbst (Hardware). Android reagiert nach ~6 ms mit
  ACTION_STOP_INCLINE und Tempo 0.
- Rohmitschnitt: `captures/phaseB_logcat.txt`.
