# TreadCtl API (contract between service, web UI and pill)

Version 4.6. Server `http://127.0.0.1:8765`, local only; it also serves the static files from `assets/www`.

## Ground rules

- **Host:** only `127.0.0.1:8765` or `localhost:8765` as `Host` header, otherwise 403 "host".
- **Token:** all commands (POST, DELETE) and some reads need the `X-Token` header. The service creates the token at start (32 bytes, file `files/token`, readable only by its own uid). The web UI gets it via `TreadNative.token()`, the pill reads the file. Without a valid token: 403. Constant-time comparison.
- **Origin:** an `Origin` header must be `http://127.0.0.1:8765` or `http://localhost:8765`, otherwise 403 (no CORS).
- **Responses:** `{"ok":true, …}` or `{"ok":false,"error":"…"}`. If the service's main loop hangs, `GET /api/state` answers immediately with 503 "control core not responding".
- **Sign of life:** `GET /api/state` with a valid token counts as a sign of life of the operator UI. Without one for 60 s, programs no longer increase speed or incline and speed is capped at 4 km/h.
- **Server:** thread pool grows on demand up to 48, no queue; a client that sends nothing for 1.5 s is dropped. Under overload a connection is rejected immediately instead of waiting (STOP then takes the direct path, see "STOP paths").

## Reading the state

`GET /api/state` (no token needed), with `?hist=1` also the history and the route plan:

```
{
 "ok": true,
 "st": "BEREIT" | "LAEUFT" | "PAUSE" | "FEHLER",     // ready, running, paused, error
 "err": "",            // reason in FEHLER, e.g. safety key pulled, manufacturer bus disconnected
 "note": "",           // hint, e.g. after an interruption: resume with walking pace
 "speed": 12.3, "incline": 4.0,     // actual km/h, %
 "tSpeed": 12.5, "tIncl": 4.0,      // target km/h, %
 "hr": 142, "hrOk": true, "hrSrc": "bluetooth" | "geraet" | "",
 "pulled": 0,          // 1 = safety key pulled, -1 = unknown (bus not readable)
 "safe": 1,
 "elapsed": 1455, "dist": 4.83, "kcal": 312, "elev": 186,
 "src": "ui",          // last source of a change: ui, pille, programm, zone, taste, geraet, uebernommen
 "hfmax": 184, "weight": 75,
 "hold": 9, "holdTo": 8.0,          // only during the warm-up (s, target km/h)
 "cd": 2,              // only during the countdown of the hardware START key (s until the belt moves)
 "top": "app.package", // app in the foreground
 "bar": false,         // manufacturer bar visible
 "fan": {"l": 62, "a": true, "c": true},   // only if a fan is stored (level %, automatic, connected)
 "prog": null | {…},   // see programs
 "hist": [[t, speed, incline, hr], …]       // only with ?hist=1: one point per 2 s, at most 5400
}
```

`GET /api/summary`: last summary (`end`, program end, 5 min of pause without input), `{}` if none. It is also stored in `files/letzter-lauf.json` and survives a restart; the web UI adds an unsaved run to the history at start (up to 7 days old, once).

`GET /api/blackbox` (token): event log (rotates at 300 KB, one backup).

## Commands

`POST /api/cmd` (token), body `{"c": …}`, at most 512 KB.

| c | Fields | Effect |
|---|---|---|
| `arm` | | Start of the 3 s countdown. Allows exactly one following `start` or `resume` 2.5 to 15 s later. |
| `start` | | Ready to running. Only with the key inserted, `safe`, belt standing and a valid `arm`. |
| `stop` | | Immediate STOP on the bus, bypassing the state lock; running to paused. Clears an open `arm`. Answers `ok:false` if the bus could not be reached (then the UI or pill sends the direct STOP). |
| `resume` | | Paused to running with a valid `arm`, only once the belt stands still. |
| `end` | | End the run: STOP (also from pause), incline 0, ready. Response includes `summary`. |
| `speed` / `incline` | `v` | Target speed or incline; in ready only preloaded. |
| `step` | `what`, `d` | relative, at most ±0.5 |
| `program` | `p` | Load a program (ready only); does not start. |
| `clearProgram` | | Unload the program (ready only). |
| `skipTo` | `idx` | Interval: jump forward only, while running (speed in 3 km/h steps) or paused (target prepared for resume). |
| `routeOffset` | `s`, `i` | Route: offset to the plan; `{"s":0,"i":0}` = back to plan. |
| `auto` | `on` | Zone automatic on or off. |
| `ack` | | Acknowledge an error: after an interruption during a run, pause with walking pace; otherwise ready. Only with the belt standing and the key inserted. |
| `inclZero` | | Incline to 0 (in pause). |
| `profile` | `weight`, `hfmax` | Weight 35 to 200 kg, HRmax 120 to 230. |
| `hideBar` | `on` | Hide the manufacturer bar above other apps (own status line) or show it. |

Any input during a pause resets the 5 min limit; after that the service ends the run itself.

## Safety rules in the service

- **Mandatory countdown:** `start`/`resume` only 2.5 to 15 s after `arm`; the check consumes `arm`. The UI sends `arm` when it opens the full-screen countdown 3 · 2 · 1 and `start` at the earliest 3 s later; CANCEL sends `stop`.
- **Warm-up:** every start runs 15 s at 1.0 km/h, then steps up to the target. Program speeds wait in `holdTo`; a manual speed input ends the warm-up.
- **Ramps:** speed changes above 3 km/h run in steps of 3 km/h every 4 s (start, resume, plan and interval changes, program end down to 3 km/h, back to plan). Manual input cancels the ramp.
- **Photo lock:** if `files/nostart` exists, nothing starts (for screenshots and tests).
- **Hardware keys:** the service reads STOP, START/PAUSE and the rotary knobs (speed ±0.1, incline ±0.5) from all `/dev/input/event*` devices and passes on only the console's key codes. START key: own 3 s countdown (`state.cd`).
- **Bus failure:** after three failed ticks, error state and STOP (still over the old connection), reconnect with back-off; once the bus is back and the belt still moves, STOP is sent again. After STOP, end or error the service repeats STOP every 2 s while the belt still moves (in error and pause without time limit, as long as it does not speed up).
- **Watchdog:** if the main loop stands for 10 s, STOP over a fresh connection and an entry in the black box; after 15 s the process ends and is restarted.
- **Service restart:** the run state (`files/laufstand.json`, every 30 s, at most 15 min old) is restored. Before deciding, the service reads for up to 10 s; if the belt runs, the run continues, if it stands, pause with walking pace follows. If the bus cannot be read, error state and STOP as soon as it returns.
- **Clock:** all deadlines use the monotonic clock (`SystemClock.elapsedRealtime`), not wall time.

## STOP paths

1. Hardware STOP key: service (KeyReader), bypassing the lock, straight to the bus.
2. Web UI and pill: `stop` via the API; if the service does not answer within 600 ms or fails, additionally straight to the manufacturer bus (`TreadNative.stopDirect()` or the pill). The web STOP button fires on press.
3. Without the service: the pill always shows (also above the own UI), reads the STOP key itself and restarts the service after 5 s without an answer.
4. If the web UI hangs (no heartbeat `TreadNative.beat()` for 6 s), the pill becomes visible and the page reloads (at most 3 times per minute).

## Programs

Program `p` for `program`:

- Interval: `{"type":"interval","name":"…","segs":[{"d":480,"s":8.0,"i":1.0,"k":"w"}, …]}`, `k` = `w` warm-up/cool-down, `h` work, `r` recovery. Limits per section 5 to 7200 s, 0.8 to 20 km/h, at most 200 sections.
- Zones: `{"type":"zones","name":"…","lo":128,"hi":142,"dur":2700,"sMin":6.0,"sMax":10.5,"i":1.0,"s0":8.0}`
- Route: `{"type":"route","id":"homberg-runde","target":4200,"mode":"terrain"|"even","scale":1.0|0.5}` (see route mode)

`state.prog`:

- Interval: `{type, name, idx (1-based), n, segLeft, segDur, left, total, t, kind, next, segs, done}`
- Zones: `{type, name, lo, hi, auto (currently regulating), autoOn, sMin, sMax, …}`
- Route: `{type, name, id, D, x, idx, n, sec:{a,b,s,i,g}, next, toNext, toChange, toFinish, pace, tPlan, delta, eta, total, target, t, left, offS, offI, ele, up, down, capped, mode, scale, finish, done}`, with `?hist=1` also `secs` and `prof`.

Step test for HRmax: template `p-hfmax` of type `test` (10 min 8.0 km/h, 17 steps of 1 min from 9.0 to 17.0 km/h, 5 min 6.0 km/h, incline 1 %), runs as an interval program. "Cool down" in the header jumps to the last section via `skipTo`; the summary offers to take over the maximum as HRmax.

## Route mode

Concept and planning: [route-mode.md](route-mode.md). Library:

| Call | Token | Effect |
|---|---|---|
| `GET /api/routes` | no | List with metadata (`id, name, ort, art, d, up, down, bbox, quelle, offiziell, hinweis, datum, importiert, thumb, sample`); metadata is cached. |
| `GET /api/routes/<id>` | no | Full file incl. `pts`, `prof`, `hoehe`. |
| `POST /api/routes` | yes | Save an own route (at most 4 MB), `id` `[a-z0-9-]{1,48}`. |
| `DELETE /api/routes/<id>` | yes | Own routes only. |

Map tiles (offline only during operation):

- `GET /tiles/<source>/<z>/<x>/<y>`: only tiles present on the device, otherwise an empty dark tile (always 200). Source `luft` (swisstopo SWISSIMAGE, Switzerland only; routes outside Switzerland are shown without aerial imagery).
- `POST /api/tiles/prefetch` (token) `{src, pts, zmin, zmax}`: only at import and on "load map". Limit 500 MB, also checked while loading. `GET /api/tiles/status` → `{busy, done, total, failed}`.
- `POST /api/tiles/coverage` (token) `{src, pts}` with at most 600 points → `{have, total}`.

At run time speed inputs change `offS` (until back to plan), incline inputs `offI` (until the next incline change). After an interruption the service sets `offS` so that the plan pauses at walking pace; the UI then shows the plan pace large and the walking pace as a hint. Finish: speed steps down to 3 km/h, incline 0, pause 10 s after reaching walking pace.

## Devices

- **Speakers:** `GET /api/bt/audio` → `{ok, audio:[{name, address, connected}]}` (paired audio devices; switching via `/api/media/cmd` `out`).
- **Heart rate:** `GET /api/hr` → `{state, name, address, hr, scanning, bt, found}`; `POST /api/hr/scan` (15 s), `/api/hr/connect {address, name}`, `/api/hr/forget` (token).
- **Fan CYCPLUS F1:** `GET /api/fan` → `{state, name, address, auto, level, target, manual, connected, awake, rpm}`; `POST /api/fan` (token) `{"a": "scan" | "connect" | "forget" | "auto" | "level" (v 5 to 100) | "step" (d) | "off"}`. Automatic: off when ready, 15 % during warm-up, while running 15 % plus 8 % per km/h above 5, plus 2.5 % per % incline, plus up to 25 % between 70 and 90 % of HRmax; at most 8 % change per 2 s; in pause 20 s on, then off. A manual level (pill, devices page, power button on the fan) applies until the end of the run.
- **Bluetooth in general:** fan and heart-rate strap reconnect after start, after Bluetooth off/on and after 2 min without a connection. Because of random addresses, a short scan comes first, then a direct connection to the device found.
- **Fan protocol** (Nordic UART 6e400001): app to fan `55 A5 len id seq data chkH chkL`, chk = ~sum from len; every fan message `AA 5A …` is acknowledged with id 255 and its seq. id 1 level (0 = lowest speed, not off), id 5 mode (0 manual), id 19 `[awake 1 | sleep 0, smart start]`. Never touch the DFU service FE59; the manufacturer app must not be connected at the same time.
- **BLE tool** (only for integrating new devices): `GET /api/probe` and `POST /api/probe/cmd` (token) for scan, connect, read, notify, write.

## Media (mini player)

- `GET /api/media` → `{ok, active, pkg, app, playing, title, artist, album, dur, pos, art, canNext, canPrev, vol, volMax, out, outs, sources}`. `art` is a version number that only changes with a new image (0 = none). `outs`: `[{address, name, connected, active, busy}]`, the first entry is the console (`address: ""`). `sources`: YouTube Music and audiobooks with `installed, session, playing, title`.
- `GET /api/media/art?v=<art>` → cover as JPEG (at most 240 px).
- `POST /api/media/cmd` (token) `{"a": …}`: `toggle`, `play`, `pause`, `next`, `prev`, `back30`, `fwd30`, `volUp`, `volDown`, `vol` (`v` step), `source` (`pkg`; without a session `error: "start"`, then the UI launches the app), `out` (`address`, `""` = console).
- Poll rate of the UI: 3 s while playing, otherwise 5 s, hidden 10 s, immediately after every command.

## Poll rates of the operator UI

- Web UI `GET /api/state`: 400 ms while the belt is in use or a countdown runs, otherwise 1 s, hidden page 2 s; immediately after every command.
- Pill: 400 ms in use, otherwise 1 s, hidden behind the own UI 2 s. Sign of life (token) only while its UI thread is alive.

## Native bridge of the web UI (`TreadNative`)

`token()`, `stopDirect()` (STOP only, own thread), `beat()` (heartbeat), `launch(pkg)` (allow-listed apps only; clears helper apps from the background), `installed()`, `icon(pkg)`, `listGpx()`, `readGpx(path)`, `openBluetooth()`, `openSettings()`, `setPref(k, v)`.

## Measuring and testing

- Core tests: `app/tools/coretest/test.sh` (scenarios against a simulated belt, including the real main loop).
- UI: `app/tools/ui-audit.mjs` in demo mode (`?demo=1`, scenarios via `szenario=…`).
- Access protection: `app/tools/security-test.sh` on the device.
- Performance on the device: create `files/webdebug` (root), then `app/tools/perf-messung.mjs`, `perf-profil.mjs`, `perf-trace.mjs` through the Chrome DevTools protocol; delete the file afterwards.
