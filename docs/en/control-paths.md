# Two paths to custom control (analysis 26.10.2026)

## Path 1: Internal DataMatrix bus (via the JHT software)

**Principle:** A small custom system app talks to the running JHT service
and only sets target values. Ramp, watchdog, emergency stop and calibration remain active in the
JHT software.

**Interface (statically reconstructed):**
- AIDL `com.jht.datamatrixservice.IGlobalSettings`: putBundle/getBundle,
  getValue{Int,Float,Boolean,Long,Double,String}, getBytes,
  addEventHandler(IGlobalSettingsEvent, progName).
- Access: `ContentResolver.call(authority, method)` on the provider
  `com.jht.atsoul.datamatrixservice.contentprovider` returns a Bundle with
  IBinder "binder" -> `IGlobalSettings.Stub.asInterface(binder)`.
- Keys = HALKeys names (strings), values are typed.

**Control keys (HALKeys):** ACTION_SET_SPEED_KPH_FLOAT,
ACTION_SET_SPEED_RPM_INT, ACTION_SET_INCLINE_FLOAT, ACTION_SET_INCLINE_ADC_INT,
ACTION_START_MACHINE, ACTION_STOP_MACHINE, ACTION_STOP_INCLINE,
ACTION_FTMS_START_ADVERTISE / STOP, ACTION_SHUTDOWN.
**Read keys:** DATA_ACTUAL_SPEED_KPH_FLOAT, DATA_ACTUAL_INCLINE_FLOAT,
DATA_RPM_INT, DATA_HEART_RATE_INT, DATA_CALORIES_PER_SEC_FLOAT,
DATA_SAFETY_KEY_STATUS_INT, DATA_IO_IS_SAFETY_PULLED_BOOL,
DATA_IS_SAFE_TO_START_WORKOUT_BOOL, DATA_MAIN_MOTOR_STATUS_BOOL,
DATA_MACHINE_DATA_PARCEL and many more.

**Prerequisite:** The app must declare `sharedUserId="android.uid.system"` AND be signed with
the **platform key** (the provider is only available to UID 1000).
The key is in `keys/` and matches the device (SHA1 41:79:1C:9B...).

**Pros:** full JHT safety remains, clean telemetry, no fiddling with bytes,
belt control and UI coexist. **Cons:** requires installing an app with
the system UID on the device (one time, needs the platform signature and possibly
placement as a priv-app); somewhat more setup.

## Path 2: Directly on /dev/ttyS4 (owning the UART)

**Principle:** Stop the JHT app; our process (root) opens `/dev/ttyS4` (9600),
builds the packets itself, sends a heartbeat every 400 ms, ramp 28 RPM/200 ms.

**Pros:** maximum control, independent of the JHT software. **Cons:** we
have to replicate heartbeat, ramp, error handling and status evaluation completely
and correctly ourselves; two writers are forbidden (the JHT app must be off); higher
risk of bricking and errors. The emergency stop via the key does remain in hardware at the MCB,
but all software protection layers are lost. Root via `adb root` (briefly drops ADB
over TCP), `su` is blocked.

## Decision and status

**Path 1 implemented.** The system app TreadCtl (platform signature, process `:core`) talks to the manufacturer
bus (DataMatrix binder): full control and telemetry, while the motor board's safety logic and the safety key
stay in place. Path 2 (serial line directly) is documented and validated on the device
([serial-protocol.md](serial-protocol.md), `tools/lcb.py`) but not used: it would require replacing the
manufacturer software entirely. Interface, commands and safety rules: [api.md](api.md).
