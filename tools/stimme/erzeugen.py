#!/usr/bin/env python3
"""Erzeugt die Bausteine der Sprachansagen (Ogg Vorbis) fuer app/assets/stimme/ mit Piper (offline) und der freien
deutschen Stimme «Thorsten» (Datensatz CC0). Die Konsole hat keine Sprachausgabe; die App setzt Ansagen aus diesen
Bausteinen zusammen. Die Dateien liegen nicht im oeffentlichen Repo, sie entstehen beim Bauen mit diesem Skript.

Einrichtung (einmalig):
  python3 -m venv .venv && .venv/bin/pip install piper-tts
  Modell nach modell/: https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/de/de_DE/thorsten/high
Aufruf: .venv/bin/python erzeugen.py   (braucht ffmpeg)"""
import os, subprocess, sys, tempfile, wave
from piper import PiperVoice

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '../../app/assets/stimme')
MODEL = os.path.join(HERE, 'modell/de_DE-thorsten-high.onnx')

# Schluessel -> gesprochener Text (Schluessel stehen so im Java-Code, siehe Announcer)
WORDS = {
    'komma': 'Komma', 'kmh': 'Kilometer pro Stunde', 'prozent': 'Prozent', 'tempo': 'Tempo', 'steigung': 'Steigung',
    'in10': 'In zehn Sekunden.', 'gleich': 'Gleich.', 'belastung': 'Belastung.', 'erholung': 'Erholung.',
    'einlaufen': 'Einlaufen.', 'auslaufen': 'Auslaufen.', 'stufe': 'Stufe', 'kilometer': 'Kilometer', 'in': 'in',
    'minuten': 'Minuten', 'minute': 'Minute', 'stunde': 'Stunde', 'stunden': 'Stunden', 'puls': 'Puls',
    'pause': 'Pause.', 'laufende': 'Lauf beendet.', 'progende': 'Programm beendet. Auslaufen.',
    'ziel': 'Ziel erreicht.', 'schluessel': 'Sicherheitsschlüssel gezogen.', 'letzter': 'Letzter Abschnitt.',
    'vor': 'vor', 'hinter': 'hinter', 'sekunden': 'Sekunden', 'gegner': 'deinem letzten Lauf.', 'und': 'und',
    'bestzeit': 'Neue Bestzeit.', 'probe': 'So klingen die Ansagen.',
}
NUMBERS = range(0, 221)

def main():
    if not os.path.exists(MODEL): sys.exit('Modell fehlt: ' + MODEL)
    os.makedirs(OUT, exist_ok=True)
    voice = PiperVoice.load(MODEL)
    items = [('n%d' % n, str(n)) for n in NUMBERS] + list(WORDS.items())
    with tempfile.TemporaryDirectory() as tmp:
        for k, text in items:
            wav = os.path.join(tmp, k + '.wav')
            with wave.open(wav, 'wb') as w: voice.synthesize_wav(text, w)
            # Stille nur am Anfang und am Ende weg (umgedreht; Pausen zwischen Saetzen bleiben), Lautheit angleichen, mono Ogg Vorbis
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-af',
                            'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5',
                            '-ar', '22050', '-ac', '1', '-c:a', 'libvorbis', '-q:a', '4', os.path.join(OUT, k + '.ogg')], check=True)
    print('%d Bausteine in %s' % (len(items), os.path.normpath(OUT)))

if __name__ == '__main__':
    main()
