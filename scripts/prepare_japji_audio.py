"""Convert the supplied MOV to the local WAV used by its checked-in timings.

python -m scripts.prepare_japji_audio (requires ffmpeg or macOS afconvert).
Does not regenerate timings, cards, or models. Converted audio is Git-ignored.
"""
import shutil
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'data/lessons/audio/japji-full-16k.wav'


def prepare():
    source = ROOT / 'data/reference/japjisahib.mov'
    if TARGET.is_file() and TARGET.stat().st_mtime_ns >= source.stat().st_mtime_ns:
        with wave.open(str(TARGET)) as audio:
            if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) == (1, 16000, 2):
                return TARGET
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    pending = TARGET.with_suffix('.partial.wav')
    if shutil.which('ffmpeg'):
        command = ['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(source), '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', str(pending)]
    elif shutil.which('afconvert'):
        command = ['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(source), str(pending)]
    else:
        raise SystemExit('Install ffmpeg to prepare the supplied Japji Sahib recording.')
    subprocess.run(command, check=True)
    with wave.open(str(pending)) as audio:
        if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) != (1, 16000, 2):
            raise RuntimeError('The converted reference must be mono 16 kHz PCM WAV.')
    pending.replace(TARGET)
    return TARGET


if __name__ == '__main__':
    print(prepare())
