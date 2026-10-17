"""Build the full Japji Sahib practice lesson from data/reference/japjisahib.mp3.

1. Convert the mp3 to 16 kHz mono WAV (afconvert on macOS, else ffmpeg); ignored by git.
2. Run the Gurbani CTC model over the whole recording in chunks and decode it.
3. Match what it heard against the BaniDB text to find each line in the audio.
4. Refine word times per line with the /timestamps aligner.
5. Write data/lessons/japji-sahib.json (one screen per line) and draft cards.

Word times are unreviewed estimates. Needs the timestamp model.

    python -m scripts.make_japji_lesson [--screens N]   (default 32)
"""
import argparse
import base64
import difflib
import io
import json
import shutil
import subprocess
import wave

import numpy as np

from backend.learn.cards_draft import draft_card
from backend.learn.screens import LESSONS, greedy, log_probs
from backend.paths import ROOT, REFERENCE
from backend.timestamps import TimestampModel, source_words

MP3 = REFERENCE / 'japjisahib.mp3'
WAV = LESSONS / 'audio/japjisahib-16k.wav'
AUDIO_URL = '/data/lessons/audio/japjisahib-16k.wav'
BANI = REFERENCE / 'banidb-bani-2.json'
SPOKEN = {'ੴ': 'ਇਕ ਓਅੰਕਾਰ'}
CHUNK, PAD, SR = 30., 3., 16000


def convert():
    if WAV.is_file():
        return
    WAV.parent.mkdir(parents=True, exist_ok=True)
    if shutil.which('afconvert'):
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(MP3), str(WAV)], check=True)
    elif shutil.which('ffmpeg'):
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(MP3), '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', str(WAV)], check=True)
    else:
        raise SystemExit('Install ffmpeg (or use macOS afconvert) to convert the mp3.')


def load_audio():
    with wave.open(str(WAV)) as f:
        return np.frombuffer(f.readframes(f.getnframes()), dtype='<i2').astype(np.float32) / 32768


CACHE = LESSONS / 'audio/japjisahib-heard.json'


def heard_with_times(model, x):
    """Greedy-decoded characters of the whole recording, each with a time (seconds)."""
    chars = []
    for c in np.arange(0, len(x) / SR, CHUNK):
        a, b = max(0., c - PAD), min(len(x) / SR, c + CHUNK + PAD)
        lp, step = log_probs(model, x[int(a * SR):int(b * SR)])
        for frame, token in greedy(lp):
            t = a + frame * step
            if c <= t < c + CHUNK:
                chars += [(ch, t) for ch in model.tokenizer.id_to_piece(token).replace('▁', '')]
        print(f'decoded {min(c + CHUNK, len(x) / SR):.0f}/{len(x) / SR:.0f} s', flush=True)
    return chars


def wav_b64(samples):
    out = io.BytesIO()
    with wave.open(out, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
    return base64.b64encode(out.getvalue()).decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--screens', type=int, default=32, help='keep only the first N screens')
    args = parser.parse_args()
    convert()
    x = load_audio()
    model = TimestampModel()
    lines = [v['verse']['verse']['unicode'] for v in json.loads(BANI.read_text(encoding='utf-8'))['verses']]
    words = [(li, w) for li, line in enumerate(lines) for w in source_words(line)]
    # Spoken character stream of the text, each char tagged with its line.
    text_chars = [(c, li) for li, w in words for c in SPOKEN.get(w['alignment_text'], w['alignment_text']).replace(' ', '')]
    if CACHE.is_file():  # Decoding 27 minutes is slow; reuse it while iterating.
        heard = [tuple(h) for h in json.loads(CACHE.read_text(encoding='utf-8'))]
    else:
        heard = heard_with_times(model, x)
        CACHE.write_text(json.dumps(heard, ensure_ascii=False), encoding='utf-8')
    matcher = difflib.SequenceMatcher(None, [c for c, _ in text_chars], [c for c, _ in heard], autojunk=False)
    times = {}
    for block in matcher.get_matching_blocks():
        for n in range(block.size):
            times.setdefault(text_chars[block.a + n][1], []).append(heard[block.b + n][1])
    def align(group, a, b):
        """Word times for consecutive lines `group` aligned together inside [a, b] seconds."""
        text = '\n'.join(lines[li] for li in group)
        expansions = {k: v for k, v in SPOKEN.items() if k in text}
        try:
            result = model.generate(dict(text=text, audio_base64=wav_b64(x[int(a * SR):int(b * SR)]), expansions=expansions))
        except ValueError:
            return {}
        out, n = {}, 0
        for li in group:
            count = len(source_words(lines[li]))
            out[li] = [dict(id=f'jp{li + 1:03d}-w{i + 1:02d}', text=w['text'], start=round(a + w['start'], 3), end=round(a + w['end'], 3))
                       for i, w in enumerate(result['words'][n:n + count])]
            n += count
        return out

    placed = {}
    for li in range(len(lines)):
        found = times.get(li, [])
        if len(found) >= 2:
            placed.update(align([li], max(0., min(found) - .6), min(len(x) / SR, max(found) + .9)))
    # Repeated refrains (ਨਾਨਕ ਭਗਤਾ ਸਦਾ ਵਿਗਾਸੁ…) can match the wrong repeat. Keep the
    # longest run of placements that is in recitation order; drop the rest.
    order = sorted(li for li in placed if placed[li])
    best = [[li] for li in order]
    for i, li in enumerate(order):
        for j in range(i):
            if placed[order[j]][-1]['end'] <= placed[li][0]['start'] + .5 and len(best[j]) + 1 > len(best[i]):
                best[i] = best[j] + [li]
    keep = set(max(best, key=len)) if best else set()
    placed = {li: ws for li, ws in placed.items() if li in keep}
    # Second pass: align each run of missing lines together in the gap between its neighbours.
    li = 0
    while li < len(lines):
        if li in placed:
            li += 1
            continue
        group = [li]
        while group[-1] + 1 < len(lines) and group[-1] + 1 not in placed:
            group.append(group[-1] + 1)
        a = max([placed[j][-1]['end'] for j in placed if j < li] or [0.])
        b = min([placed[j][0]['start'] for j in placed if j > group[-1]] or [len(x) / SR])
        if 0 < b - a <= 115:
            placed.update({k: v for k, v in align(group, max(0., a - .2), b + .2).items() if v})
        li = group[-1] + 1
    screens, missing = [], []
    for li, line in enumerate(lines):
        ws = placed.get(li)
        if not ws:
            missing.append(line)
            continue
        # Lines longer than a 14 s recording are split into parts.
        parts, part = [], []
        for w in ws:
            if part and w['end'] - part[0]['start'] > 13:
                parts.append(part); part = []
            part.append(w)
        parts.append(part)
        for n, part in enumerate(parts):
            screens.append(dict(id=f'line-{li + 1:03d}' + (f'-{n + 1}' if len(parts) > 1 else ''), ustaad='Japji Sahib recording',
                                audio=AUDIO_URL, start=round(max(0., part[0]['start'] - .1), 3), end=round(part[-1]['end'] + .15, 3), words=part))
    screens = screens[:args.screens]
    lesson = dict(schema_version=1, id='japji-sahib', title='Japji Sahib · first lines', min_sound_score=-1.5,
                  cards='/data/lessons/pronunciation-cards-japji.json',
                  note='One screen per line, from data/reference/japjisahib.mp3 and BaniDB bani 2. Word times are unreviewed estimates.',
                  screens=screens)
    (LESSONS / 'japji-sahib.json').write_text(json.dumps(lesson, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    cards = dict(schema_version=1, audio=AUDIO_URL,
                 about='Auto-drafted from Gurmukhi letters (backend/learn/cards_draft.py); not yet reviewed. Confirm on the cards page.',
                 words={w['id']: draft_card(w['text'], SPOKEN.get(w['text'])) for s in screens for w in s['words']})
    (LESSONS / 'pronunciation-cards-japji.json').write_text(json.dumps(cards, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(screens)} screens, {len(cards["words"])} cards; {len(missing)} lines skipped:')
    for line in missing:
        print('  -', line)


if __name__ == '__main__':
    main()
