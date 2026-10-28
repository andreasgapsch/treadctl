#!/usr/bin/env python3
"""Ende-zu-Ende-Pruefung des Boards, bevor es an die Konsole kommt: die VM spielt die Konsole (Zeilen ueber USB),
die Konsole spielt die App (BleProbe verbindet sich per Bluetooth mit dem Board). Steuert nichts am Band.
Aufruf (Board in der VM, Konsole per adb erreichbar):
  TREADXP_ADB=ip:5555 esp32/.venv/bin/python esp32/bridge-test.py [/dev/ttyACM0]"""
import json, os, struct, subprocess, sys, threading, time
import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else '/dev/ttyACM0'
ADB = ['adb', '-s', os.environ.get('TREADXP_ADB') or sys.exit('TREADXP_ADB=ip:5555 setzen')]
NAME = 'TC-Bridge-Test'   # eigener Name, damit die Probe nicht die Konsole selbst sucht

ok = fail = 0
def t(name, cond, info=''):
    global ok, fail
    print(('  OK   ' if cond else '  FEHL ') + name + (' (' + info + ')' if info else ''))
    if cond: ok += 1
    else: fail += 1

def adb(*a): return subprocess.run(ADB + list(a), capture_output=True, text=True).stdout.strip()
TOKEN = adb('shell', 'cat /data/data/com.gapsch.treadctl/files/token')
subprocess.run(ADB + ['forward', 'tcp:8765', 'tcp:8765'], capture_output=True)
def api(path, body=None):
    cmd = ['curl', '-s', '-H', 'Host: 127.0.0.1:8765', '-H', 'X-Token: ' + TOKEN, 'http://127.0.0.1:8765' + path]
    if body is not None: cmd[1:1] = ['-X', 'POST', '-d', json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    try: return json.loads(out)
    except Exception: return {}

ser = serial.Serial(PORT, 115200, timeout=0.2)
rx = []
def reader():
    buf = b''
    while True:
        b = ser.read(256)
        if not b: continue
        buf += b
        while b'\n' in buf:
            l, buf = buf.split(b'\n', 1); l = l.decode(errors='replace').strip()
            if l: rx.append(l)
            if l.startswith('W '):   # Steuerpunkt: wie die Konsole mit «Erfolg» antworten (ohne Band)
                conn, op = l.split()[1], l.split()[2][:2]; ser.write(('I %s 80%s01\n' % (conn, op)).encode())
threading.Thread(target=reader, daemon=True).start()
alive = True
def beat():
    n = 0
    while alive:
        ser.write(b'P\n')
        if n % 2 == 0:   # Laufdaten wie Treadmill Data: 8.5 km/h, 1.2 km, 2.0 %
            td = struct.pack('<HH', 0x058C, 850) + (1200).to_bytes(3, 'little') + struct.pack('<hhHHB', 20, 11, 90, 0xFFFF, 0xFF) + bytes([140]) + struct.pack('<H', 600)
            ser.write(('N 2acd %s\n' % td.hex()).encode())
        n += 1; time.sleep(0.5)

ser.write(b'?\n'); time.sleep(0.5)
ser.write(('H %s\n' % NAME).encode())
ser.write(('V 2ad4 %s\n' % struct.pack('<HHH', 80, 1400, 10).hex()).encode())   # 0.8 bis 14 km/h
time.sleep(1)
t('Board meldet sich', any(l.startswith('R tread-control-esp32') for l in rx), next((l for l in rx if l.startswith('R ')), 'keine Antwort'))
ser.write(b'P\n'); time.sleep(0.5)
t('Board antwortet auf das Lebenszeichen', 'A' in rx, '')
threading.Thread(target=beat, daemon=True).start()

api('/api/probe', {'a': 'scan'}); time.sleep(8)
st = api('/api/probe')
# Android zeigt fuer schon bekannte Geraete den gespeicherten Namen; darum auch das Board mit FTMS-Dienst unter altem Namen
found = [f for f in st.get('found', []) if f.get('name') == NAME] or [f for f in st.get('found', []) if f.get('name') in ('Tread Control', 'KICKR RUN') and '1826' in str(f.get('uuids'))]
t('Konsole findet das Board per Bluetooth', bool(found), (found[0].get('address') + ', ' + str(found[0].get('rssi')) + ' dBm') if found else 'nicht gefunden')
if found:
    api('/api/probe', {'a': 'connect', 'address': found[0]['address']}); time.sleep(6)
    st = api('/api/probe'); svcs = json.dumps(st.get('services', []))
    t('Dienste FTMS und Laufsensor', '1826' in svcs and '1814' in svcs, st.get('state', ''))
    api('/api/probe', {'a': 'read', 'uuid': '00002ad4-0000-1000-8000-00805f9b34fb'}); time.sleep(1.5)
    api('/api/probe', {'a': 'notify', 'uuid': '00002acd-0000-1000-8000-00805f9b34fb'}); time.sleep(4)
    api('/api/probe', {'a': 'notify', 'uuid': '00002ad9-0000-1000-8000-00805f9b34fb'}); time.sleep(1.5)
    api('/api/probe', {'a': 'write', 'uuid': '00002ad9-0000-1000-8000-00805f9b34fb', 'hex': '00'}); time.sleep(3)
    log = '\n'.join(api('/api/probe').get('log', []))
    t('Tempobereich lesbar', 'read 00002ad4' in log and struct.pack('<HHH', 80, 1400, 10).hex() in log, '')
    t('Laufdaten kommen als Meldung', 'notify 00002acd' in log, '')
    t('Steuerpunkt geht an die «Konsole» und die Antwort zurück', any(l.startswith('W ') for l in rx) and 'notify 00002ad9-0000-1000-8000-00805f9b34fb 800001' in log, next((l for l in rx if l.startswith('W ')), 'kein W'))
    api('/api/probe', {'a': 'close'})
alive = False; time.sleep(0.6)
print('\n'.join('  < ' + l for l in rx[:12]))
print('\nErgebnis: %d bestanden, %d fehlgeschlagen' % (ok, fail))
sys.exit(1 if fail else 0)
