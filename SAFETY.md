# Safety

[Deutsch](SICHERHEIT.md)

This software controls the speed and incline of a treadmill. A fault in software, device or
operation can cause falls and serious injury. Use entirely **at your own risk**.

## Ground rules

1. **Always attach the safety key to your body.** It is the only safeguard that works
   independently of this software (the motor board stops by itself).
2. The console's **physical STOP button** works through this software (the service reads the key directly). It is not hardwired to the motor board; the only safeguard independent of software is the safety key.
3. Never run tests with a moving belt **unattended** or without a person at the treadmill who can
   pull the key. Start with an empty belt at walking speed.
4. Keep children and pets away.
5. After every code change run the scenario tests (`app/tools/coretest/test.sh`) and the access
   protection test; run the fault test on the belt before the first run.
6. Scripts that automate taps on the console (`adb input`) must set the start lock
   `files/nostart` first; the service then refuses to start the belt. Never automate taps on START.

## Additional safeguards in the software

- The belt only starts after a 3-second countdown (`arm` must arrive 2.5 to 15 s before `start`
  or `resume`).
- Every start (start, resume, hardware key) runs 15 s at 1 km/h; then the speed rises in steps of 3 km/h every 4 s to the target, announced 10 s ahead.
- The console's physical keys work in this control too: STOP stops immediately, START/PAUSE starts after a 3-second countdown (STOP cancels) or pauses, the rotary knobs change speed and incline.
- STOP takes priority over every other command and has several independent paths: the hardware key directly in the service; the UI and the pill additionally straight to the manufacturer bus if the service does not answer within 600 ms; without the service the pill reads the STOP key itself and restarts the service.
- After STOP, end or an error the service repeats STOP every 2 s while the belt still moves.
- A pulled safety key or a lost manufacturer bus leads to the ERROR state; after acknowledging,
  the run continues only at walking speed.
- Watchdog: without a sign of life from the controls the speed drops to 4 km/h and programs raise
  neither speed nor incline.
- End of program: cool-down in steps to 3 km/h, stop only at walking speed.
- Main-loop watchdog: if it stands for 10 s, STOP goes out over a fresh connection; after 15 s the service restarts.
- After a service restart it only decides on reliable readings; with the belt standing the run continues only at walking speed.
- If the UI hangs, the pill appears with STOP.
- Control API on `127.0.0.1` only, with token, without CORS.

These measures replace neither the safety key nor the attention of the person running.

## Changes to the device

- The app needs root access via `adb` and the device's platform signature.
- `tools/webview-tausch.sh` disables dm-verity and replaces the system WebView. This is a deep
  change to the system that can affect warranty and manufacturer updates. Make the backup first
  (`tools/webview-zurueck.sh` restores it).
- The manufacturer software and the motor board firmware are not modified.
