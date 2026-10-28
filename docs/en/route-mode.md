# Concept: route mode (GPX 1:1)

As of 27.10.2026. New training mode alongside quick start, interval, zones and plans.

## Goal

A real running route from a GPX file is reproduced on the treadmill. Distance and
incline follow the route; the speed follows a target time or pace that is adjusted
for the terrain. The UI shows the route on a map with a dot
for the current position, green for the part already run, red for the part still ahead, start and finish, and below it the
elevation profile with the same progress. The target pace is shown in large type.

## Flow for the runner

1. **Routes** (new section): library with a small map, distance, elevation gain,
   location. Three sample routes are included: Aarau HM, Arosa Trail, Hallwilersee HM.
2. **Import**: GPX from a USB stick or from «Downloads» (the console's file picker).
   On import, the points are smoothed, the distance is recalculated and, in Switzerland, the
   elevation is fetched from the swisstopo elevation model (GPS elevations are too inaccurate for inclines).
3. **Route page**: large map, elevation profile, key figures. Input of **target time** or
   **pace** (each one calculates the other), distribution **«Nach Gelände»** (By terrain: equal effort,
   default) or **«Gleichmässig»** (Even: constant speed). In addition, incline **1:1** or
   **reduced (50 %)** for steep trails. Preview: pace per kilometer, steepest
   point, note where the treadmill imposes limits (above 15 % or downhill).
4. **Start** via the usual countdown. Run view: map at the top, elevation profile below,
   target pace in large type, actual pace, ahead/behind plan, projected finish time, km
   run/remaining, current incline of route and belt.
5. **Finish**: the belt slows down to 3 km/h and stops after 10 s, summary with
   finish time versus plan.

## Calculation model (in the service, not in the WebView)

Planning lives in `RoutePlan.java` (plain Java, testable on the VM). The service
receives the elevation profile (distance, elevation) and the settings and generates sections from them.

- **Smoothing**: resample the profile every 10 m, smooth the elevation with a moving average over 50 m
  (road) or 30 m (trail).
- **Sections**: incline per 100 m. Adjacent sections that differ by less than 0.5 %
  (after rounding to 0.5 %) are merged so that the
  incline motor does not run constantly. Afterwards, sections shorter than 200 m (trail 150 m) are added to the neighbor with the more similar incline (result: about 30 changes over 21 km).
- **Belt incline**: route incline × factor (1.0 or 0.5), rounded to 0.5 %,
  limited to 0 to 15 %. Downhill becomes 0 % (the belt cannot run downhill).
- **Speed distribution «Nach Gelände»**: effort per section f = 1 + 0.045 × belt incline
  in % (ACSM: oxygen cost of running 0.2·v + 0.9·v·g, so 1 % incline costs about 4.5 % speed). Equal
  effort means v = k / f; k is chosen so that the sum of the section times equals the
  target time. What counts is the belt incline, i.e. what the legs actually
  feel; downhill sections therefore bring no time gain, the flat stretches make up for it.
- **Limits**: speed 0.8 to 20 km/h, rounded to 0.1; after rounding, k is
  adjusted until the plan time deviates from the target time by at most 2 s.
- **Incline lead**: the motor needs time. The new incline is set
  `speed × |Δ incline| / 0.6 %/s` meters earlier (at most 100 m), so that it is in place at the
  start of the section. Calculated with the target speed; within a section the
  incline never jumps back.
- **Speed pull-forward**: on a climb with a slower speed (in[i] > in[i−1] and sp[i] < sp[i−1])
  the slower speed starts together with the incline, earlier by the lead distance (sa[i]); plan time
  and start times are calculated with these boundaries.
- **Speed ramp**: every start (start, resume) runs 15 s at 1.0 km/h; after that, and for every change of more than
  3 km/h (`routeOffset`, plan changes, finish down to 3 km/h), in steps of 3 km/h every 4 s. Manual speed input cancels the ramp.
- **Announcement**: `toChange` (meters to the start of the change including the incline lead) or
  `toFinish`; 10 s in advance a banner and a sound at 3, 2, 1, if the incline changes by 1 % or more or the speed by 1 km/h or more
  compared with the current target; in the last section a finish banner.

## Runtime (Core.runRoute)

- Position = belt distance run since start. The route only advances while the
  belt is running; pauses stop the dot.
- A section change sets the plan's target speed and target incline.
- **Manual speed input**: stored as an offset from the plan («Plan +0.5 km/h») and applies
  to all following sections until it is reset (command `routeOffset`, in the
  UI «Zurück zum Plan» (Back to plan)).
- **Manual incline input**: applies only until the next incline change, then the plan applies again
  (quick select «−1», «Plan», «+1»; hint «Steigung von Hand bis zum nächsten Wechsel» (Manual incline until the next change)).
- **After an interruption** (error acknowledged, PAUSE at 3 km/h) and after a start via the
  device keys, the plan continues relative to the current speed (large negative offset,
  display «Plan pausiert · 3.0 km/h statt 12.4» (Plan paused · 3.0 km/h instead of 12.4)).
- **Ahead/behind**: plan time at the current position minus elapsed time.
  Forecast = elapsed time + remaining plan time (calculated with the current offset).
- **Finish**: at distance ≥ route length, the program ends, speed 3 km/h, incline 0;
  `summary.route.t` is the time to the finish, excluding the cool-down. The 10 s until the automatic
  STOP only start counting once the actual speed is at most 3.3 km/h; anyone who increases the speed above 3.5 km/h during the cool-down
  keeps running freely (STOP ends the run).
- Safety remains unchanged: arm/countdown, STOP with priority, key. Watchdog: without a
  sign of life for more than 60 s, programs regulate neither speed nor incline upward.

## Data and interfaces

- Route files are stored in the service under `files/routes/<id>.json`:
  `{id, name, ort, quelle, d (m), up, down, pts: [[lat, lon, ele, dist], ...] (every ~10 m),
  prof: [[dist, ele], ...] (~400 points)}`. Sample routes are located in
  `assets/www/strecken/` and are copied over on first start.
- `GET /api/routes` (list), `GET /api/routes/<id>`, `POST /api/routes` (token, ≤ 4 MB),
  `DELETE /api/routes/<id>` (token).
- Program `{"type":"route","id":"...","target":6300,"mode":"terrain|even","scale":1.0}`
  (ID only; the service reads profile, type and elevation source itself). The service plans and returns in `prog`:
  `x` (m), `D`, `idx`, `n`, `sec` (current section a, b, s, i, g), `next`, `pace`
  (target s/km), `tPlan`, `delta` (s, positive = behind), `eta`, `offS`, `offI`, `ele`.
  With `?hist=1` additionally `secs` (all sections) and `prof`.
- **No live dependencies** (requirement of 27.10.2026): during operation the treadmill depends on nothing
  external. Tiles are served exclusively by the service from the device: preloaded tiles
  (`files/tiles`), otherwise the sample route package in the APK (`assets/tiles/luft`, aerial imagery, zoom 12 to
  16, 1112 tiles, 28 MB), otherwise a neutral empty tile. The display never triggers
  internet access. Data is loaded online only once, when an own route is imported
  (`POST /api/tiles/prefetch`); without a network the import still works, and the map then shows the
  line on a dark background. Preloaded tiles are never deleted automatically (limit 500 MB).
- swisstopo elevations are available only on import and only as an improvement; without a network the
  GPX elevations apply (`hoehe: "gpx"`), and the service then smooths them over 110 m.
- Map library: Leaflet 1.9 bundled locally in the package (no CDN dependency).

## Pill (overlay on top of apps)

- When expanded, the phase field shows «km 12.4 / 21.1», below it the target pace and
  ahead/behind. The chart strip shows the elevation profile with a position marker
  instead of the time history. 10 s before an incline change of 1 % or more, the usual
  change banner appears («Steigung auf 6.5 % in 50 m» (Incline to 6.5 % in 50 m)).

## Testing

- `RouteSim` on the VM checks planning and plan time (plan time = target time ±2 s, sections,
  limits); the UI audit compares the JS port of the planning against it (RouteSim and PlanDump,
  deviation 0).
- The runtime (section changes, incline lead, speed pull-forward, offset, speed ramp,
  cool-down and free run, watchdog for speed and incline, `toChange`/`toFinish`) is tested by the
  core scenario tests on the VM: `app/tools/coretest/test.sh` (all service scenarios, currently 65).
- Demo scenario and pill simulation «strecke» for photos without belt movement.
- Audit of the web UI with its own check items, review round with route mode.
