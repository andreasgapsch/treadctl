# Zwei Wege zur eigenen Steuerung (Analyse 26.10.2026)

## Weg 1: Interner DataMatrix-Bus (ueber die JHT-Software)

**Prinzip:** Eine kleine eigene System-App redet mit dem laufenden JHT-Dienst
und setzt nur Sollwerte. Rampe, Watchdog, Not-Stop, Kalibrierung bleiben in der
JHT-Software aktiv.

**Schnittstelle (statisch rekonstruiert):**
- AIDL `com.jht.datamatrixservice.IGlobalSettings`: putBundle/getBundle,
  getValue{Int,Float,Boolean,Long,Double,String}, getBytes,
  addEventHandler(IGlobalSettingsEvent, progName).
- Zugang: `ContentResolver.call(authority, method)` am Provider
  `com.jht.atsoul.datamatrixservice.contentprovider` liefert ein Bundle mit
  IBinder "binder" -> `IGlobalSettings.Stub.asInterface(binder)`.
- Schluessel = HALKeys-Namen (Strings), Werte typisiert.

**Steuer-Schluessel (HALKeys):** ACTION_SET_SPEED_KPH_FLOAT,
ACTION_SET_SPEED_RPM_INT, ACTION_SET_INCLINE_FLOAT, ACTION_SET_INCLINE_ADC_INT,
ACTION_START_MACHINE, ACTION_STOP_MACHINE, ACTION_STOP_INCLINE,
ACTION_FTMS_START_ADVERTISE / STOP, ACTION_SHUTDOWN.
**Lese-Schluessel:** DATA_ACTUAL_SPEED_KPH_FLOAT, DATA_ACTUAL_INCLINE_FLOAT,
DATA_RPM_INT, DATA_HEART_RATE_INT, DATA_CALORIES_PER_SEC_FLOAT,
DATA_SAFETY_KEY_STATUS_INT, DATA_IO_IS_SAFETY_PULLED_BOOL,
DATA_IS_SAFE_TO_START_WORKOUT_BOOL, DATA_MAIN_MOTOR_STATUS_BOOL,
DATA_MACHINE_DATA_PARCEL u.v.m.

**Voraussetzung:** App muss `sharedUserId="android.uid.system"` tragen UND mit
dem **Plattformschluessel** signiert sein (der Provider ist nur fuer UID 1000).
Schluessel liegt in `keys/` und passt zum Geraet (SHA1 41:79:1C:9B...).

**Pro:** volle JHT-Sicherheit bleibt, saubere Telemetrie, kein Byte-Gefrickel,
Band-Steuerung und UI koexistieren. **Contra:** App-Installation mit
system-UID auf dem Geraet noetig (einmalig, braucht Plattform-Signatur und evtl.
Platzierung als priv-app); etwas mehr Setup.

## Weg 2: Direkt auf /dev/ttyS4 (UART selbst besitzen)

**Prinzip:** JHT-App stoppen, unser Prozess (root) oeffnet `/dev/ttyS4` (9600),
baut Pakete selbst, sendet Heartbeat alle 400 ms, Rampe 28 RPM/200 ms.

**Pro:** maximale Kontrolle, unabhaengig von der JHT-Software. **Contra:** wir
muessen Heartbeat, Rampe, Fehlerbehandlung und Statusauswertung komplett selbst
und korrekt nachbauen; zwei Schreiber verboten (JHT-App muss aus); hoeheres
Brick-/Fehlerrisiko. Not-Stop ueber Schluessel bleibt zwar in Hardware am MCB,
aber alle Software-Schutzschichten entfallen. Root via `adb root` (droppt ADB-
ueber-TCP kurz), `su` ist gesperrt.

## Entscheid und Stand

**Weg 1 umgesetzt.** Die System-App TreadCtl (Plattformsignatur, Prozess `:core`) spricht den Herstellerbus
(DataMatrix-Binder) an: volle Steuerung und Telemetrie, die Sicherheitslogik der Motorsteuerung und der
Sicherheitsschlüssel bleiben erhalten. Weg 2 (serielle Leitung direkt) ist dokumentiert und am Gerät
validiert (`serial-protocol.md`, `tools/lcb.py`), wird aber nicht verwendet: dafür müsste die Herstellersoftware
ganz ersetzt werden. Schnittstelle, Befehle und Sicherheitsregeln: `api.md`.
