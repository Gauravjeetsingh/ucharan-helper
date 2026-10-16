"""Human word-boundary corrections, saved locally beside (never inside) reference data.

One JSON file per recording: data/corrections/<64-hex audio checksum>.json.
The checksum is the result's audio.pcm_sha256 (generated) or audio.sha256 (legacy
sample artifact). Audio bytes and data/reference/ files are never modified.
Times are seconds on the recording timeline. Standard library only.
"""
import json
import math
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from .paths import ROOT

CORRECTIONS = ROOT / 'data/corrections'
LOCK = threading.Lock()
AUDIO_KEY = re.compile(r'[0-9a-f]{64}')
WORD_ID = re.compile(r'[A-Za-z0-9_-]{1,40}')
MAX_SECONDS = 7200
MAX_WORDS = 1000


def _path(audio_key):
    if not isinstance(audio_key, str) or not AUDIO_KEY.fullmatch(audio_key):
        raise ValueError('Invalid recording checksum.')
    return CORRECTIONS / f'{audio_key}.json'


def _word_id(word_id):
    if not isinstance(word_id, str) or not WORD_ID.fullmatch(word_id):
        raise ValueError('Invalid word occurrence ID.')
    return word_id


def _seconds(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{name} must be a number of seconds.')
    return round(float(value), 4)


def load(audio_key):
    path = _path(audio_key)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    words = data.get('words') if isinstance(data, dict) else None
    return words if isinstance(words, dict) else {}


def _write(audio_key, words):
    path = _path(audio_key)
    if not words:
        path.unlink(missing_ok=True)
        return
    CORRECTIONS.mkdir(parents=True, exist_ok=True)
    payload = dict(schema_version=1, audio_key=audio_key, time_unit='seconds',
                   note='Human boundary corrections applied over generated or reference timings. '
                        'The reference artifact and audio are unchanged.',
                   words=dict(sorted(words.items())))
    # Write to a temporary file first, then rename, so a crash never leaves a half-written file.
    handle, temporary = tempfile.mkstemp(dir=CORRECTIONS, suffix='.partial')
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(temporary, path)
    except BaseException:
        os.unlink(temporary)
        raise


def save(request):
    audio_key, word_id = request.get('audio_key'), _word_id(request.get('word_id'))
    start, end = _seconds(request.get('start'), 'Start'), _seconds(request.get('end'), 'End')
    if not 0 <= start < end <= MAX_SECONDS:
        raise ValueError('Use 0 ≤ start < end, in seconds.')
    with LOCK:
        words = load(audio_key)
        if word_id not in words and len(words) >= MAX_WORDS:
            raise ValueError('Too many corrections for one recording.')
        words[word_id] = dict(start=start, end=end, corrected_at=datetime.now(timezone.utc).isoformat(timespec='seconds'))
        _write(audio_key, words)
    return words


def delete(request):
    audio_key, word_id = request.get('audio_key'), _word_id(request.get('word_id'))
    with LOCK:
        words = load(audio_key)
        words.pop(word_id, None)
        _write(audio_key, words)
    return words
