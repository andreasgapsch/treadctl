#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Erzeugt einen simulierten Dienstzustand fuer Abnahmefotos der Pille (ohne Bandbewegung).
Aufruf: pillsim.py <szenario>  -> JSON auf stdout. Szenarien: lauf, intervall, wechsel, pause, zonen, schluessel, strecke, streckewechsel."""
import json, math, sys

def hist(n=240, spd=12.5, incEnd=4.0):
    h = []
    for i in range(n):
        t = i * 2
        s = (8 + i * 0.1 if i < 40 else spd + 0.6 * math.sin(i / 9))
        if i >= n - 3: s = spd                     # Ende = aktuelles Ist
        inc = 1.0 if i < 60 else (3.0 if i < 140 else incEnd)
        hr = int(100 + 60 * (1 - math.exp(-i / 50)) + 4 * math.sin(i / 7))
        h.append([t, round(s, 1), inc, hr])
    return h

segs = [{"d": 480, "s": 8.0, "i": 1.0, "k": "w"}]
for k in range(5):
    segs.append({"d": 240, "s": 13.0, "i": 2.0, "k": "h"})
    if k < 4: segs.append({"d": 120, "s": 8.0, "i": 1.0, "k": "r"})
segs.append({"d": 480, "s": 7.0, "i": 0.0, "k": "w"})

def base(st="LAEUFT"):
    return {"ok": True, "st": st, "err": "", "note": "", "speed": 12.5, "incline": 4.0, "tSpeed": 12.5, "tIncl": 4.0,
            "hr": 162, "hrOk": True, "pulled": 0, "safe": 1, "elapsed": 1455, "dist": 4.83, "kcal": 312, "elev": 186,
            "src": "ui", "hfmax": 184, "top": "", "bar": False, "prog": None, "hist": hist(), "fan": {"l": 62, "a": True}}

def prog(segLeft, idx):
    tot = sum(s["d"] for s in segs); start = sum(s["d"] for s in segs[:idx - 1])
    cur = segs[idx - 1]
    return {"type": "interval", "name": "Schwelle 5 × 4 min", "idx": idx, "n": len(segs), "segLeft": segLeft,
            "segDur": cur["d"], "left": tot - start - (cur["d"] - segLeft), "total": tot, "kind": cur["k"],
            "next": segs[idx] if idx < len(segs) else None, "segs": segs, "t": start + cur["d"] - segLeft, "done": False}

sc = sys.argv[1] if len(sys.argv) > 1 else "lauf"
o = base()
def plan_state(o, idx, segLeft, spd, inc):
    pr = prog(segLeft, idx); t = pr["t"]
    dist = sum(min(sg["d"], max(0, t - sum(x["d"] for x in segs[:k]))) * sg["s"] / 3600 for k, sg in enumerate(segs))
    o.update(tSpeed=spd, speed=spd, tIncl=inc, incline=inc, prog=pr, elapsed=t, dist=round(dist, 2),
             kcal=int(dist * 70), elev=int(dist * 10), hist=hist(max(20, t // 2), spd, inc))
if sc == "intervall":
    plan_state(o, 4, 161, 13.0, 2.0)
elif sc == "wechsel":
    plan_state(o, 4, 7, 13.0, 2.0)
elif sc == "rampe":
    plan_state(o, 4, 236, 13.0, 2.0); o.update(speed=11.6, incline=1.4)
elif sc == "pause":
    plan_state(o, 4, 120, 13.0, 2.0); o.update(st="PAUSE", speed=0.0)
elif sc == "nachfehler":
    plan_state(o, 4, 120, 3.0, 2.0); o.update(st="PAUSE", speed=0.0, note="Nach Unterbrechung: Weiter mit 3.0 km/h (Gehtempo)")
elif sc == "fehler":
    o.update(st="FEHLER", err="Herstellerbus getrennt", speed=0.0)
elif sc == "bereit":
    o.update(st="BEREIT", speed=0.0, tSpeed=3.0, tIncl=0.0, elapsed=0, dist=0, kcal=0, elev=0, hist=[])
elif sc == "schluessel":
    o.update(st="BEREIT", pulled=1, speed=0.0, elapsed=0, dist=0, kcal=0, elev=0, hist=[])
if sc in ("strecke", "streckewechsel"):
    import os
    base_ = os.path.dirname(os.path.abspath(__file__))
    plan = json.load(open(os.path.join(base_, "sim/out/aarau-1h45-gelaende.json")))
    prof = [list(map(float, l.split())) for l in open(os.path.join(base_, "sim/out/homberg-runde.txt"))]
    secs = plan["secs"]; D = plan["D"]
    # Position: kurz vor dem steilen Anstieg bei km 12.4 (Wechsel) bzw. mitten im Lauf
    lead = lambda k: min(100.0, secs[k - 1][2] / 3.6 * abs(secs[k][3] - secs[k - 1][3]) / 0.6)
    kc = next(k for k, q in enumerate(secs) if k > 0 and q[3] - secs[k - 1][3] >= 4 and q[0] > 11000)   # Anstieg bei km 12.4
    x = (secs[kc][0] - lead(kc) - 30) if sc == "streckewechsel" else 11850.0
    i = max(k for k, q in enumerate(secs) if q[0] <= x)
    cur, nx = secs[i], (secs[i + 1] if i + 1 < len(secs) else None)
    sec = lambda q: {"a": q[0], "b": q[1], "s": q[2], "i": q[3], "g": q[4]}
    tl = plan["tl"]; tp = min(tl, key=lambda r: abs(r[1] - x))[5]
    t = tp + 23
    step = max(1, len(prof) // 400)
    o.update(st="LAEUFT", tSpeed=cur[2], speed=cur[2], tIncl=cur[3], incline=cur[3], elapsed=int(t), dist=round(x / 1000, 2),
             kcal=int(x / 1000 * 70), elev=150, hist=[[r[0], r[2], r[3], 150] for r in tl if r[1] <= x][-300:])
    o["prog"] = {"type": "route", "name": "Homberg-Runde", "id": "homberg-runde", "D": D, "x": x, "idx": i + 1, "n": len(secs),
                 "sec": sec(cur), "next": sec(nx) if nx else None, "toNext": round(cur[1] - x), "toFinish": round(D - x),
                 "toChange": round((nx[0] - (lead(i + 1) if nx[3] != cur[3] else 0)) - x) if nx else None, "pace": round(3600 / cur[2]),
                 "tPlan": int(tp), "delta": 23, "eta": 6321, "total": 6298, "target": 6300, "t": int(t), "left": int(6298 - tp),
                 "offS": 0, "offI": 0, "ele": 430, "up": 238, "down": 238, "capped": 7, "mode": "terrain", "scale": 1, "finish": False, "done": False,
                 "prof": [[p[0], p[1]] for p in prof[::step]] + [prof[-1]]}
print(json.dumps(o))
