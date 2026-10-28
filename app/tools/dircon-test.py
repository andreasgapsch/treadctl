#!/usr/bin/env python3
"""DIRCON-Gegenstelle zum Pruefen des Dienstes ueber adb (Port 36866 auf die Konsole weitergeleitet, die Verbindung
kommt dann von der Konsole selbst und ist auch ohne lan erlaubt). Nur lesen, sendet keine Steuerbefehle.
Aufruf: adb -s $TREADXP_ADB forward tcp:36866 tcp:36866 && python3 app/tools/dircon-test.py"""
import socket
import struct
import sys
import uuid

BASE = '-0000-1000-8000-00805f9b34fb'
def u16(v): return uuid.UUID('%08x' % v + BASE)

ok = fail = 0
def t(name, cond, info=''):
    global ok, fail
    print(('  OK   ' if cond else '  FEHL ') + name + (' (' + info + ')' if info else ''))
    if cond: ok += 1
    else: fail += 1

s = socket.create_connection(('127.0.0.1', 36866), timeout=5)
seq = 0
def req(mid, data=b''):
    global seq
    seq = (seq + 1) & 0xff
    s.sendall(struct.pack('>BBBBH', 1, mid, seq, 0, len(data)) + data)
    while True:
        h = recv(6); v, m, q, code, n = struct.unpack('>BBBBH', h); body = recv(n)
        if m == 6: notes.append(body); continue   # Meldung zwischendurch
        return m, q, code, body
def recv(n):
    b = b''
    while len(b) < n:
        c = s.recv(n - len(b))
        if not c: raise SystemExit('Verbindung getrennt')
        b += c
    return b
notes = []

m, q, code, body = req(1)
svcs = [uuid.UUID(bytes=body[i:i + 16]) for i in range(0, len(body), 16)]
t('Dienste: FTMS und Laufsensor', code == 0 and q == seq and svcs == [u16(0x1826), u16(0x1814)], ', '.join(str(x)[4:8] for x in svcs))
m, q, code, body = req(2, u16(0x1826).bytes)
ch = {uuid.UUID(bytes=body[16 + i:32 + i]): body[32 + i] for i in range(0, len(body) - 16, 17)}
t('FTMS-Merkmale mit Eigenschaften', code == 0 and ch.get(u16(0x2ACD)) == 4 and ch.get(u16(0x2AD9)) == 10 and ch.get(u16(0x2ACC)) == 1, ', '.join('%s:%d' % (str(k)[4:8], v) for k, v in ch.items()))
m, q, code, body = req(3, u16(0x2AD4).bytes)
mn, mx, st = struct.unpack('<HHH', body[16:22]) if len(body) >= 22 else (0, 0, 0)
t('Tempobereich lesen', code == 0 and mn == 80 and mx >= 800 and st == 10, '%.1f bis %.1f km/h' % (mn / 100, mx / 100))
m, q, code, body = req(2, u16(0x1234).bytes)
t('Unbekannter Dienst -> Code 3', code == 3, str(code))
m, q, code, body = req(5, u16(0x2ACD).bytes + b'\x01')
t('Laufdaten abonnieren', code == 0 and uuid.UUID(bytes=body[:16]) == u16(0x2ACD), str(code))
s.settimeout(3)
try:
    while not any(uuid.UUID(bytes=n[:16]) == u16(0x2ACD) for n in notes):
        h = recv(6); v, m, q, code, n = struct.unpack('>BBBBH', h); notes.append(recv(n))
except socket.timeout:
    pass
td = [n[16:] for n in notes if uuid.UUID(bytes=n[:16]) == u16(0x2ACD)]
if td:
    flags, sp = struct.unpack('<HH', td[0][:4])
    t('Laufdaten als Meldung (Folgenummer 0)', flags & 0x0004 and flags & 0x0008, 'Flags %04x, Tempo %.2f km/h' % (flags, sp / 100))
else:
    t('Laufdaten als Meldung (Folgenummer 0)', False, 'keine Meldung in 3 s')
s.close()
print('\nErgebnis: %d bestanden, %d fehlgeschlagen' % (ok, fail))
sys.exit(1 if fail else 0)
