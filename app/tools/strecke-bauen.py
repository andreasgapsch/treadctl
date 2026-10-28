#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GPX -> Streckendatei fuer den Streckenmodus (assets/www/strecken/<id>.json).
Abtasten alle 10 m, Hoehe in der Schweiz aus swisstopo (profile.json, LV95), sonst aus der GPX.
Aufruf: strecke-bauen.py <gpx> <id> --name "..." --ort "..." [--art strasse|trail] [--quelle "..."] [--offiziell] [--hinweis "..."]"""
import argparse, json, math, sys, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

def hav(a, b):
    R = 6371008.8
    p1, p2 = math.radians(a[0]), math.radians(b[0]); dp = p2 - p1; dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def lv95(lat, lon):
    p = (lat * 3600 - 169028.66) / 10000; l = (lon * 3600 - 26782.5) / 10000
    e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3
    n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3
    return e, n

def in_ch(lat, lon): return 45.8 <= lat <= 47.9 and 5.9 <= lon <= 10.6

def read_gpx(path):
    t = ET.parse(path).getroot(); out = []
    for el in t.iter():
        tag = el.tag.split('}')[-1]
        if tag in ('trkpt', 'rtept'):
            ele = None
            for c in el:
                if c.tag.split('}')[-1] == 'ele':
                    try: ele = float(c.text)
                    except Exception: pass
            out.append((float(el.get('lat')), float(el.get('lon')), ele))
    if not out:  # KML/TCX nicht hier
        sys.exit('keine Punkte')
    return out

def resample(pts, step=10.0):
    cum = [0.0]
    for i in range(1, len(pts)): cum.append(cum[-1] + hav(pts[i - 1], pts[i]))
    D = cum[-1]; res = []; j = 0; x = 0.0
    while True:
        while j < len(pts) - 2 and cum[j + 1] < x: j += 1
        seg = cum[j + 1] - cum[j]; t = (x - cum[j]) / seg if seg > 0 else 0; t = max(0, min(1, t))
        a, b = pts[j], pts[j + 1]
        ele = None if a[2] is None or b[2] is None else a[2] + t * (b[2] - a[2])
        res.append([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), ele, x])
        if x >= D: break
        x = min(D, x + step)
    return res, D

def swisstopo(res):
    out = []
    for k in range(0, len(res), 3000):
        chunk = res[k:k + 3000]
        coords = [[round(c, 2) for c in lv95(p[0], p[1])] for p in chunk]
        data = urllib.parse.urlencode({'geom': json.dumps({'type': 'LineString', 'coordinates': coords}), 'sr': 2056,
                                       'nb_points': len(coords), 'distinct_points': 'true'}).encode()
        r = json.load(urllib.request.urlopen(urllib.request.Request('https://api3.geo.admin.ch/rest/services/profile.json', data=data), timeout=60))
        # Antwort kann zusaetzliche Punkte enthalten: ueber die Distanz entlang der Linie zuordnen
        rd = [x['dist'] for x in r]; ra = [x['alts'].get('COMB', x['alts'].get('DTM2')) for x in r]
        cd = [0.0]
        for i in range(1, len(coords)): cd.append(cd[-1] + math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]))
        j = 0
        for x in cd:
            while j < len(rd) - 2 and rd[j + 1] < x: j += 1
            t = (x - rd[j]) / (rd[j + 1] - rd[j]) if rd[j + 1] > rd[j] else 0; t = max(0, min(1, t))
            out.append(ra[j] + t * (ra[j + 1] - ra[j]))
    return out

ap = argparse.ArgumentParser()
ap.add_argument('gpx'); ap.add_argument('id'); ap.add_argument('--name', required=True); ap.add_argument('--ort', default='')
ap.add_argument('--art', default='strasse'); ap.add_argument('--quelle', default=''); ap.add_argument('--offiziell', action='store_true')
ap.add_argument('--hinweis', default=''); ap.add_argument('--datum', default=''); ap.add_argument('--out', default=None)
a = ap.parse_args()

pts = read_gpx(a.gpx)
res, D = resample(pts)
src = 'gpx'
if all(in_ch(p[0], p[1]) for p in res[::20]):
    alts = swisstopo(res); src = 'swisstopo swissALTI3D'
    for p, h in zip(res, alts): p[2] = h
elif any(p[2] is None for p in res):
    sys.exit('Höhen fehlen und Strecke liegt nicht in der Schweiz')
# Hoehenmeter mit derselben Glaettung wie der Dienst (Mittel ueber 50 bzw. 30 m)
w = 1 if a.art == 'trail' else 2
es = [sum(res[q][2] for q in range(max(0, i - w), min(len(res), i + w + 1))) / (min(len(res), i + w + 1) - max(0, i - w)) for i in range(len(res))]
up = sum(max(0, es[i] - es[i - 1]) for i in range(1, len(es))); down = sum(max(0, es[i - 1] - es[i]) for i in range(1, len(es)))
lats = [p[0] for p in res]; lons = [p[1] for p in res]
o = {
    'id': a.id, 'name': a.name, 'ort': a.ort, 'art': a.art, 'quelle': a.quelle, 'offiziell': a.offiziell, 'hinweis': a.hinweis,
    'datum': a.datum, 'hoehe': src, 'd': round(D), 'up': round(up), 'down': round(down),
    'bbox': [round(min(lats), 5), round(min(lons), 5), round(max(lats), 5), round(max(lons), 5)],
    'pts': [[round(p[0], 6), round(p[1], 6), round(p[2], 1), round(p[3], 1)] for p in res],
    'prof': [[round(p[3], 1), round(p[2], 1)] for p in res],
}
out = a.out or './app/assets/www/strecken/%s.json' % a.id
import os; os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(o, open(out, 'w'), separators=(',', ':'), ensure_ascii=False)
print('%s: %.2f km, +%d / -%d m, %d Punkte, Höhe %s, Höhe min %.0f max %.0f -> %s' % (a.name, D / 1000, up, down, len(res), src, min(es), max(es), out))
