#!/usr/bin/env python3
"""Aufruf: adb forward tcp:36866 tcp:36866 && TREADXP_ADB=ip:5555 python3 app/tools/ftms-last.py
Last- und Stabilitaetstest FTMS/DIRCON gegen die Konsole (ueber adb forward 36866): misst CPU, Speicher, Threads und
Dateien des Steuerdienstes vor, waehrend und nach der Last. Belt bleibt unberuehrt (App-Steuerung aus)."""
import socket, struct, subprocess, threading, time, uuid

import os, sys
A = ['adb', '-s', os.environ.get('TREADXP_ADB') or sys.exit('TREADXP_ADB=ip:5555 setzen')]
def sh(c): return subprocess.run(A + ['shell', c], capture_output=True, text=True).stdout.strip()
PID = sh('pidof com.gapsch.treadctl:core') or sh("ps -A | grep 'treadctl:core' | awk '{print $2}'")
def stat():
    s = sh('cat /proc/%s/status' % PID)
    rss = [l for l in s.split('\n') if l.startswith('VmRSS')][0].split()[1]
    thr = [l for l in s.split('\n') if l.startswith('Threads')][0].split()[1]
    fds = sh('ls /proc/%s/fd | wc -l' % PID)
    t = sh('cat /proc/%s/stat' % PID).split()
    return {'rss_kb': int(rss), 'threads': int(thr), 'fds': int(fds), 'cpu_ticks': int(t[13]) + int(t[14])}
def cpu_pct(a, b, secs): return round((b['cpu_ticks'] - a['cpu_ticks']) / 100.0 / secs * 100, 1)

B = '-0000-1000-8000-00805f9b34fb'
def u16(v): return uuid.UUID('%08x' % v + B).bytes
WAHOO_W = uuid.UUID('a026e03e-0a7d-4ab3-97fa-f1500f9feb8b').bytes
def pkt(mid, seq, data=b''): return struct.pack('>BBBBH', 1, mid, seq & 0xff, 0, len(data)) + data

class Client(threading.Thread):
    def __init__(self, secs, flood=False):
        super().__init__(daemon=True); self.secs = secs; self.flood = flood; self.notes = 0; self.err = None
    def run(self):
        try:
            s = socket.create_connection(('127.0.0.1', 36866), timeout=5); seq = 1
            for u in (0x2ACD, 0x2A53, 0x2AD3, 0x2ADA): s.sendall(pkt(5, seq, u16(u) + b'\x01')); seq += 1
            s.sendall(pkt(5, seq, WAHOO_W + b'\x01')); seq += 1
            s.settimeout(0.2); end = time.time() + self.secs; buf = b''; nextw = time.time()
            while time.time() < end:
                if self.flood and time.time() >= nextw:   # 20 Steigungsbefehle je Sekunde (Zwift-Spam), App-Steuerung ist aus
                    s.sendall(pkt(4, seq, WAHOO_W + b'\x11\x2c\x01')); seq += 1; nextw = time.time() + 0.05
                try:
                    c = s.recv(4096)
                    if not c: break
                    buf += c
                    while len(buf) >= 6:
                        n = struct.unpack('>H', buf[4:6])[0]
                        if len(buf) < 6 + n: break
                        if buf[1] == 6: self.notes += 1
                        buf = buf[6 + n:]
                except socket.timeout:
                    pass
            s.close()
        except Exception as e:
            self.err = str(e)

print('Dienst-PID', PID)
s0 = stat(); time.sleep(30); s1 = stat()
print('Ruhe 30 s:          CPU %s %%, RSS %d KB, Threads %d, Dateien %d' % (cpu_pct(s0, s1, 30), s1['rss_kb'], s1['threads'], s1['fds']))

cl = [Client(120, flood=(i == 0)) for i in range(4)]
for c in cl: c.start()
time.sleep(5); s2 = stat(); time.sleep(110); s3 = stat()
for c in cl: c.join()
print('Last 110 s:         CPU %s %%, RSS %d KB, Threads %d, Dateien %d (4 WLAN-Apps, eine schickt 20 Steigungen/s)' % (cpu_pct(s2, s3, 110), s3['rss_kb'], s3['threads'], s3['fds']))
print('Meldungen je App:  ', [c.notes for c in cl], 'Fehler:', [c.err for c in cl if c.err])

# 200 x verbinden, abonnieren, abrupt trennen
t0 = time.time()
for i in range(200):
    try:
        s = socket.create_connection(('127.0.0.1', 36866), timeout=3)
        s.sendall(pkt(5, 1, u16(0x2ACD) + b'\x01')); s.close()
    except Exception as e:
        print('Verbindung', i, e); time.sleep(0.2)
time.sleep(5); s4 = stat()
print('200 Wechsel in %.0f s: RSS %d KB, Threads %d, Dateien %d' % (time.time() - t0, s4['rss_kb'], s4['threads'], s4['fds']))
time.sleep(30); s5 = stat()
print('Nach 30 s Ruhe:     CPU %s %%, RSS %d KB, Threads %d, Dateien %d' % (cpu_pct(s4, s5, 30), s5['rss_kb'], s5['threads'], s5['fds']))
