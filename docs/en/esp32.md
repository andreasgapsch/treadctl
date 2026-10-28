# ESP32 radio: setup

An ESP32-S3 on the console's USB acts as a separate Bluetooth radio. It makes the treadmill visible to apps and
watches as an ordinary Bluetooth treadmill (FTMS, Fitness Machine Service) and as a running speed sensor (RSC) for
watches. The board decides nothing: values, limits and permissions come from Tread Control on the console.

## Why

- **Apps on the console itself** (Kinomap, Zwift) look for a treadmill over Bluetooth. With its own radio, the console
  cannot advertise as a treadmill and be found by an app on the same device at the same time. The board is a second
  device that the app finds normally.
- **Watches** (e.g. Garmin) pair the board as a footpod: pace and distance come from the belt instead of the wrist
  estimate.
- **Apps on other devices** (phone, tablet, PC) also see an ordinary Bluetooth treadmill.

Without the board, the console's own radio provides FTMS and the footpod for other devices. When the board is plugged
in, the console switches its own Bluetooth FTMS off and restores its name.

## Hardware

- **ESP32-S3 with native USB** (USB Serial/JTAG, ID `303A:1001`). Tested: Olimex ESP32-S3-DevKit-Lipo
  (ESP32-S3-WROOM-1-N8R8, 8 MB flash). Other ESP32-S3 boards with a native USB port should work with an adjusted
  `platformio.ini`.
- **Not suitable:** boards whose USB goes through a separate serial chip (CH340, CP210x, e.g. FireBeetle ESP32). The
  console only recognises the ESP32-S3's native USB.
- **Cable:** USB-C (board) to USB-A (console). On the Olimex board use the native USB connector. The console powers the
  board; no battery is needed.

## Build and flash the firmware

On a computer (Linux, Python 3) with the board connected over USB:

```sh
cd esp32
python3 -m venv .venv
.venv/bin/pip install platformio
./flashen.sh            # or ./flashen.sh /dev/ttyACM0
```

`flashen.sh` builds with PlatformIO (`espressif32@6.9.0`, Arduino, NimBLE-Arduino 1.4.3) and writes the firmware over
the native USB; esptool enters the bootloader by itself. After start the board reports `R tread-control-esp32 <version>`
(currently 1.2.1), also in reply to the line `?`.

Optional end-to-end test before installing: `bridge-test.py` plays the console on the computer (lines over USB) and
lets the console connect to the board as an app via ADB. It does not control the belt.

```sh
.venv/bin/pip install pyserial
.venv/bin/python bridge-test.py /dev/ttyACM0
```

## Setup on the console

1. Plug the board into a USB port of the console. Tread Control detects it by itself (the system app grants the USB
   permission without a prompt) and sends the name and values.
2. In Tread Control under **Apps**, switch on **Daten an Apps und Uhren** (data to apps and watches). The line below
   then reads "sichtbar als ‹Tread Control› · Funkmodul ESP32".
3. Optionally switch on **Apps dürfen Tempo und Steigung steuern** (apps may control speed and incline; up to 14 km/h
   and 10 %, see Safety).
4. The state is also in `GET /api/ftms`: `radio` (`esp32` or `konsole`) and `espFw` (the board's firmware).

## Apps and watches

- **Kinomap on the console:** pair the treadmill over Bluetooth in Kinomap and choose "Tread Control". Kinomap then
  shows speed and incline; with app control allowed, Kinomap can set the route's incline. Starting in Kinomap works
  like the START key with a 3 s countdown.
- **Zwift on the console:** pair as a treadmill (FTMS); speed and distance come from the belt. Incline control by
  Zwift is not part of the default setup (Zwift only offers it for certain treadmill models and with a subscription).
- **Garmin watch:** add a footpod under sensors and choose "Tread Control". Recommended: speed and distance from the
  sensor "always", calibration 100 %, auto calibration off. The board pairs with "Just Works" and remembers the watch.
- Some apps cache names; after a name change, pair again in the app.

## Safety

- Every app command goes through Tread Control's rules: limits for speed and incline, at most one command per 2 s,
  manual input at the console takes priority for 30 s, programs lock app control. STOP always works.
- An app can only start the belt when it runs in the foreground on the console itself (Kinomap, Zwift), and only with
  the countdown of the START key. After a STOP at the console, app starts are blocked for 10 s.
- Without a heartbeat from the console (3 s) the board answers commands itself with "operation failed", stops sending
  run data and reports "control lost": an app never reacts to stale values.
- The safety key and the motor board's own safety logic stay unchanged.

## Line protocol (USB, 115200 baud, lines end with `\n`)

Console to board:

| Line | Meaning |
|---|---|
| `H <name>` | name for advertising and GAP (up to 20 characters), starts advertising |
| `D <manufacturer>` | manufacturer name in Device Information |
| `V <uuid16> <hex>` | readable value (features, ranges, training status, footpod) |
| `N <uuid16> <hex>` | notification to all subscribers (run data, footpod, status) |
| `I <conn> <hex>` | control point 0x2AD9 response to the app that sent the command |
| `P` | heartbeat, every second |
| `?` | query the version |

Board to console:

| Line | Meaning |
|---|---|
| `R tread-control-esp32 <version>` | ready |
| `A` | heartbeat reply |
| `C <conn> <address>` / `X <conn>` | peer connected / disconnected |
| `S <conn> <uuid16> <0\|1\|2>` | subscription off / notify / indicate |
| `W <conn> <hex>` | control point write (the console decides) |
| `G <conn> <hex>` | incline from Zwift via the Wahoo Run service (`11 lo hi`, 0.01 %) |

Services of the board: FTMS (0x1826), running speed and cadence RSC (0x1814, sensor location "top of shoe",
appearance 0x0441), Device Information, Battery (0x180F, fixed 100 %), Wahoo Run (`A026EE0E-…`). Up to 4 connections
at the same time.

## Troubleshooting

- **Board not detected:** `GET /api/ftms` shows `radio: konsole`. Check cable and port (the board's native USB), and
  query the firmware with `?` from a serial terminal on a computer.
- **Board hangs:** if it does not answer for 6 s, the console restarts it via the RTS control line. After two attempts
  within a minute, the console's own Bluetooth takes over for 1 min, then the console tries again.
- **App does not find the treadmill:** is "Daten an Apps und Uhren" on? Is Bluetooth on for the app? Delete the old
  pairing in the app and search again.
- **Watch shows wrong pace:** set calibration to 100 % and the source to "always" (see above).
