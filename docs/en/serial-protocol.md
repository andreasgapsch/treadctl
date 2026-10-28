# LCB protocol Tread-XP (statically reconstructed from the JHT app, 26.10.2026)

Source: `com.jht.atsoul.nezuko` (163 MB), library `com.jht.lcb.lcbcommlib`,
HAL `com.jht.soul.hal.lcb`, service `com.jht.atsoul.service.hal.LCBService`.
Determined by analyzing the manufacturer interface for the purpose of interoperability (see RECHTLICHES.md).

## Physical layer
- Port **`/dev/ttyS4`**, owner system.
- **9600 baud** in operation, 115200 only for LCB firmware updates.
- Serial library: `libserialport.so` (android-serialport-api).
- Process `com.jhtp.atsoul.lcbservice` (belongs to the nezuko app).

## Packet format
```
TX: 00 | FF | CMD | LEN | DATA[LEN] | CRC8
```
- Byte 0 = 0x00 (start byte), byte 1 = status byte (TX always 0xFF).
- Payload big-endian.
- CRC-8 over all preceding bytes, nibble table (polynomial 0x31, init 0):
  `{00,31,62,53,C4,F5,A6,97,B9,88,DB,EA,7D,4C,1F,2E}`.
- RX parser: start byte, status, message ID, length, data, CRC (same scheme,
  status from the MCB). Response timeout 150 ms.

## Important commands (treadmill)
| Command | Code | Data |
|---|---|---|
| SetLCBInitialize | 0x70 | |
| GetLCBStatus | 0x71 | Heartbeat |
| GetLCBErrorCode | 0x72 | |
| GetLCBVersion | 0x73 | |
| SetLCBTreadmillOperate | 0x7E | Byte sequence |
| SetLCBMotorSpeedRtnRPM | 0xF0 | u16 |
| **SetLCBMotorRPM** | **0xF1** | **u16 BE = target RPM** |
| SetLCBIncPWMStep / Dec / Stop | 0xF2 / 0xF3 / 0xF4 | |
| SetLCBInclineAction | 0xF5 | |
| **SetLCBInclineLoc** | **0xF6** | **u16 BE = incline ADC** |
| SetLCBOperatingStatus | 0xF7 | 1 byte |
| GetLCBRollerRPM / MotorRPM / InclineLoc | 0xF8 / 0xF9 / 0xFA | Actual values |
| SetLCBInclinePercent / Get | 0x80 / 0x81 | u16 |
| SetLCBMotorPowerOff | 0x93 | |
| GetLCBTreadmillInUsed / MainMotorInfo / ExtStatus | 0x95 / 0x96 / 0x97 | |
| GetLCBDCIinclineRange / rpmSpeedRange | 0xA0 / 0xA6 | |
Further commands are not documented.

## Calibration (treadmill frame, LCB type 4)
- Speed **0.8 to 20.0 km/h** mapped linearly to **173 to 4283 RPM**
  (below 0.8 km/h = 0). About 214 RPM per km/h.
- Incline **0 to 15 %**, step 0.5, position ADC **34 to 990**.
- Calibration is enabled: values can differ due to calibration on
  the LCB, so confirm them live (logcat line
  `ACTION_SET_SPEED_KPH_FLOAT <kph> | rpm = <rpm>` from LCBService).
- HAS_TM_ESTOP = true.

## Timing / safety (replicate the original!)
- **Heartbeat every 400 ms** (TreadMillHandler.HeartBeatThread, autoReplyCmd):
  status poll plus, depending on the counter, RPM, incline, InUse, MotorInfo, ExtStatus.
- **Speed ramp:** max. 28 RPM per 200 ms (LCBInterface.RpmRamper), stop = 0
  immediately.
- Incline max. 0.71 %/s.

## Above the UART: internal data bus
LCBService listens for the dataMatrix keys `HALKeys.ACTION_SET_SPEED_KPH_FLOAT`
and `ACTION_SET_SPEED_RPM_INT`. A possible safe control entry point WITH the
JHT safety logic (ramp, watchdog), without owning the UART itself.
Still to be checked whether it is reachable from outside (datamatrixservice, apiservice :9090).

## Open (to be confirmed dynamically)
- Live values kph -> rpm via logcat (no root, zero risk).
- Response format/status bits, content of SetLCBTreadmillOperate for start/stop.
- Raw capture only if necessary (strace needs root; `adb root` once killed
  ADB over TCP, `su` is blocked).

## Confirmed live (phase B, logcat, 26.10.2026 18:11 to 18:13)
- Speed: all target values 0.8 to 4.0 km/h **exactly** = formula
  `round(173 + (kph-0.8)*(4283-173)/(20-0.8))`. Example 2.0 -> 430.
- Incline: `int(34 + pct*(990-34)/15)`, **truncated** (1.0->97, 1.5->129,
  2.0->161, 2.5->193, 3.0->225), 15 of 15 values consistent.
- In practice, the actual incline drops at about 0.6 %/s.
- **Emergency stop:** key pulled -> `SafetyManager value=48`, `MCB Safety :
  E-STOP true, event 1, state 1`, then MCB state 2. The MCB detects the
  key itself (hardware). Android reacts after ~6 ms with
  ACTION_STOP_INCLINE and speed 0.
- Raw capture: `captures/phaseB_logcat.txt`.
