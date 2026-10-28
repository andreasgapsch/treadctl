#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Offline-Kachelpaket fuer die Beispielstrecken: laedt swisstopo-Kacheln (Luftbild SWISSIMAGE) entlang
der Strecken fuer Zoom 12 bis 16 (Punkt plus Nachbarn) und legt sie nach assets/tiles/luft/z/x/y.jpg.
Damit braucht die Karte im Betrieb kein Internet. Aufruf: kacheln-paket.py [id ...]"""
import json, math, os, sys, time, urllib.request
BASE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(BASE, '..', 'assets', 'www', 'strecken')
OUT = os.path.join(BASE, '..', 'assets', 'tiles', 'luft')
URL = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/%d/%d/%d.jpeg'

def tx(lon, z): return int((lon + 180) / 360 * (1 << z))
def ty(lat, z):
    r = math.radians(lat); return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * (1 << z))

ids = sys.argv[1:] or [f[:-5] for f in os.listdir(WWW) if f.endswith('.json')]
want = set()
for i in ids:
    o = json.load(open(os.path.join(WWW, i + '.json')))
    pts = o['pts'][::5]
    for z in range(12, 17):
        for p in pts:
            x, y = tx(p[1], z), ty(p[0], z)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1): want.add((z, x + dx, y + dy))
print('Kacheln:', len(want))
n = got = 0; size = 0
for z, x, y in sorted(want):
    f = os.path.join(OUT, str(z), str(x), '%d.jpg' % y)
    if not os.path.exists(f):
        os.makedirs(os.path.dirname(f), exist_ok=True)
        for k in range(3):
            try:
                b = urllib.request.urlopen(urllib.request.Request(URL % (z, x, y), headers={'User-Agent': 'TreadCtl/4 (Laufband privat)'}), timeout=20).read()
                open(f, 'wb').write(b); got += 1; break
            except Exception as e:
                time.sleep(1 + k)
        time.sleep(0.03)
    if os.path.exists(f): size += os.path.getsize(f)
    n += 1
print('fertig: %d Kacheln, %d neu geladen, %.1f MB' % (n, got, size / 1e6))
