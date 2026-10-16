"""Learn practice screens (listen and repeat): a student attempt is judged only against that screen's ustaad clip.

Uses the Gurbani CTC model (the same one as /timestamps). The ustaad's clip is
decoded into Gurmukhi pieces as the model hears them (not the scripture text),
and each piece is then checked in the student's audio: does the model hear the
ustaad's sound there, or is a different sound clearly stronger? The ustaad's
audio is therefore the only truth; another screen can use another ustaad.
Scores are uncalibrated model evidence, not a certified grade.
"""
import wave

import numpy as np

from ..paths import ROOT
from ..timestamps import ctc_path

LESSONS = ROOT / 'data/lessons'
SR = 16000
BLANK = 256
# A sound the model gives at least this probability in the ustaad's own audio
# counts as the ustaad's sound too: we never demand more certainty from the
# student than the model had about the ustaad.
CANDIDATE_MIN = .1
_CACHE = {}


def read_clip(url, start, end):
    """Read [start, end] seconds of a lesson WAV as mono 16 kHz float32."""
    path = (ROOT / url.lstrip('/')).resolve()
    if path.suffix != '.wav' or ROOT not in path.parents or not path.is_file():
        raise ValueError('Lesson audio must be a WAV file inside the project.')
    with wave.open(str(path), 'rb') as f:
        rate, channels, width = f.getframerate(), f.getnchannels(), f.getsampwidth()
        if width != 2:
            raise ValueError('Lesson audio must be 16-bit PCM WAV.')
        f.setpos(max(0, int(start * rate)))
        frames = f.readframes(max(0, int((end - start) * rate)))
    x = np.frombuffer(frames, dtype='<i2').astype(np.float32).reshape(-1, channels).mean(1) / 32768
    if rate != SR:  # Band-limited FFT resample; no extra dependency.
        n = int(round(len(x) * SR / rate))
        spectrum = np.fft.rfft(x)[:n // 2 + 1]
        x = (np.fft.irfft(spectrum, n) * n / len(x)).astype(np.float32)
    return x


def log_probs(model, samples):
    """Frame log-probabilities from the Gurbani CTC model, plus seconds per frame."""
    lp, length = model.session.run(['log_probs', 'out_len'], {
        'audio': samples[None].astype(np.float32), 'audio_len': np.array([len(samples)], dtype=np.int64)})
    lp = lp[0, :int(np.asarray(length).reshape(-1)[0])]
    return lp - np.logaddexp.reduce(lp, axis=1)[:, None], len(samples) / SR / max(len(lp), 1)


def greedy(lp):
    ids = lp.argmax(-1)
    return [(f, int(t)) for f, t in enumerate(ids) if t != BLANK and (f == 0 or t != ids[f - 1])]


def ustaad_pieces(model, screen):
    """Gurmukhi pieces the model hears in the ustaad's clip, grouped by lesson word.

    Each piece keeps its likely alternatives (e.g. ਤ 77% / ਚ 23%). Blank among
    them means the model wasn't sure the sound was there at all, so it's optional.
    """
    key = (screen['audio'], screen['start'], screen['end'], tuple((w['start'], w['end']) for w in screen['words']))
    if key not in _CACHE:
        lp, step = log_probs(model, read_clip(screen['audio'], screen['start'], screen['end']))
        words = screen['words']
        pieces = [[] for _ in words]
        spikes = greedy(lp)
        for n, (frame, token) in enumerate(spikes):
            t = screen['start'] + frame * step
            # Padding around the screen may hold a neighbouring word: ignore it.
            if t < words[0]['start'] - .05 or t > words[-1]['end'] + .05:
                continue
            index = min(range(len(words)), key=lambda i: 0 if words[i]['start'] <= t <= words[i]['end']
                        else min(abs(t - words[i]['start']), abs(t - words[i]['end'])))
            candidates = {int(c) for c in np.flatnonzero(np.exp(lp[frame]) >= CANDIDATE_MIN)} | {token}
            # Where this sound sits in the clip: between the neighbouring sounds (seconds).
            region = ((spikes[n - 1][0] + 1) * step if n else max(0, frame - 2) * step,
                      spikes[n + 1][0] * step if n + 1 < len(spikes) else (frame + 3) * step)
            pieces[index].append(dict(token=token, candidates=candidates, region=region))
        _CACHE[key] = pieces
    return _CACHE[key]


# Names for pieces that are only a vowel sign or nasal mark, so feedback is readable.
SIGNS = {'ਾ': 'kanna (ਾ)', 'ਿ': 'sihari (ਿ)', 'ੀ': 'bihari (ੀ)', 'ੁ': 'aunkar (ੁ)', 'ੂ': 'dulainkar (ੂ)',
         'ੇ': 'lavan (ੇ)', 'ੈ': 'dulavan (ੈ)', 'ੋ': 'hora (ੋ)', 'ੌ': 'kanaura (ੌ)', 'ੰ': 'tippi (ੰ, nasal sound)',
         'ਂ': 'bindi (ਂ, nasal sound)', 'ੱ': 'addak (ੱ, doubled sound)', '੍': 'pairi sign (੍)'}


# Independent vowels, vowel signs and nasal marks.
VOWELS = set('ੳਅੲਆਇਈਉਊਏਐਓਔਾਿੀੁੂੇੈੋੌੰਂ')


def is_vowel(model, token):
    piece = text(model, [token])
    return bool(piece) and set(piece) <= VOWELS


def text(model, tokens):
    return model.tokenizer.decode(list(tokens)).strip()


def name(model, token):
    piece = text(model, [token])
    return SIGNS.get(piece, f'“{piece}”')


def judge(model, lp, step, reference, threshold):
    """Score each ustaad piece where it best fits in the student's audio.

    Piece score = best-frame log-odds of the ustaad's likely sounds versus the
    strongest other sound, silence included. Negative means a sound the ustaad
    didn't make (or silence) was clearly stronger. Clear extra sounds inside a
    word (e.g. an added "m") are also reported.
    """
    pieces = [p for word in reference for p in word]
    owner = [i for i, word in enumerate(reference) for _ in word]
    path = ctc_path(lp, [p['token'] for p in pieces], BLANK)
    spans = [[None, None] for _ in reference]
    scores = [[] for _ in reference]
    piece_frames = [np.where(path == 2 * k + 1)[0] for k in range(len(pieces))]
    for k, piece in enumerate(pieces):
        frames = piece_frames[k]
        piece['student_region'] = ((piece_frames[k - 1][-1] + 1) * step if k else max(0, frames[0] - 2) * step,
                                   piece_frames[k + 1][0] * step if k + 1 < len(pieces) else (frames[-1] + 3) * step)
        candidates = sorted(piece['candidates'])
        others = lp[frames].copy()
        others[:, candidates] = -np.inf
        odds = lp[frames][:, candidates].max(1) - others.max(1)
        best = int(odds.argmax())
        scores[owner[k]].append(dict(piece=piece['token'], score=float(odds[best]), candidates=piece['candidates'],
                                     heard_instead=int(others[best].argmax())))
        span = spans[owner[k]]
        span[0] = frames[0] if span[0] is None else span[0]
        span[1] = frames[-1]
    # A held, sung vowel often decodes as several vowel pieces (ਉ + ਅ + ੰ) where a
    # spoken one gives a single piece. Back-to-back vowel pieces count as one
    # vowel: it matches if any of them clearly does. Consonants are not merged.
    for word in scores:
        run = []
        for s in word + [None]:
            if s is not None and is_vowel(model, s['piece']):
                run.append(s)
                continue
            if len(run) > 1 and max(r['score'] for r in run) >= threshold:
                for r in run:
                    r['score'] = max(r['score'], threshold)
            run = []
    heard = greedy(lp)
    words = []
    for i, ref in enumerate(reference):
        if not ref:
            words.append(dict(state='unclear', reason="The ustaad's sounds for this word weren't clear to the model."))
            continue
        # Student's own decoding over this word's region (half-way to neighbours).
        before = [sp for sp in spans[:i] if sp[0] is not None]
        after = [sp for sp in spans[i + 1:] if sp[0] is not None]
        lo = (before[-1][1] + spans[i][0]) / 2 if before else spans[i][0]
        hi = (spans[i][1] + after[0][0]) / 2 if after else spans[i][1]
        region = [(f, t) for f, t in heard if lo <= f <= hi]
        mine = [t for _, t in region]
        weak = [s for s in scores[i] if s['score'] < threshold]
        explained = set().union(*(s['candidates'] for s in scores[i])) | {s['heard_instead'] for s in scores[i]}
        # An added consonant (the m in "ekam kaar") needs clear evidence; an added
        # vowel sign is subtler and noisier, so it needs near-certain evidence.
        extra = [t for f, t in region if t not in explained and text(model, [t])
                 and np.exp(lp[f, t]) > (.95 if is_vowel(model, t) else .6)]
        reasons = []
        if not mine:
            reasons.append('This word was missing or too quiet in your recording.')
        for s in weak if mine else []:
            instead = s['heard_instead'] != BLANK and text(model, [s['heard_instead']])
            reasons.append(f"The ustaad's {name(model, s['piece'])} sounded more like {name(model, s['heard_instead'])} in yours."
                           if instead else f"The ustaad's {name(model, s['piece'])} was missing or unclear in yours.")
        if extra:
            reasons.append(f"You added {', '.join(name(model, t) for t in extra)}, which the ustaad didn't say.")
        words.append(dict(state='wrong' if reasons else 'correct', reason=' '.join(reasons),
                          ustaad_heard=text(model, [p['token'] for p in ref]), student_heard=text(model, mine),
                          weakest=round(min(s['score'] for s in scores[i]), 2),
                          student_start=round(spans[i][0] * step, 3), student_end=round((spans[i][1] + 1) * step, 3)))
    return words


def check_tones(model, phone_model, samples, screen, reference, judged):
    """Flag ਭ ਧ ਘ ਝ ਢ said with different voicing from the ustaad (see tone.py)."""
    from . import tone
    key = (screen['audio'], screen['start'], screen['end'])
    ustaad_lp = tone.phone_logp(phone_model, read_clip(screen['audio'], screen['start'], screen['end']), key)
    student_lp = tone.phone_logp(phone_model, samples)
    for word, result in zip(reference, judged):
        if result['state'] == 'unclear':
            continue
        for piece in word:
            letter = tone.tonal_letter(text(model, [piece['token']]))
            if not letter or 'student_region' not in piece:
                continue
            reason = tone.check(phone_model, letter, tone.voicing(phone_model, ustaad_lp, piece['region'], letter),
                                tone.voicing(phone_model, student_lp, piece['student_region'], letter))
            if reason:
                result['state'] = 'wrong'
                result['reason'] = ' '.join(filter(None, [result.get('reason'), reason]))


def compare_screen(model, samples, lesson, screen, phone_model=None):
    from .phone_engine import quality
    words = screen['words']
    base = dict(lesson_id=lesson['id'], screen_id=screen['id'], experimental=True, calibrated=False)
    unclear = lambda message: dict(base, status='unclear', message=message,
                                   words=[dict(id=w['id'], text=w['text'], state='unclear') for w in words])
    q = quality(samples)
    if not q['usable']:
        return unclear(' '.join(q['reasons']))
    reference = ustaad_pieces(model, screen)
    if not any(reference):
        return unclear('No sounds were found in the ustaad clip for this screen. Check its word times.')
    lp, step = log_probs(model, samples)
    if len(lp) < sum(map(len, reference)) * 2:
        return unclear('The recording is too short for these words. Record all of them.')
    judged = judge(model, lp, step, reference, float(lesson.get('min_sound_score', -1.5)))
    if sum(w['state'] == 'wrong' for w in judged) == len(judged) and len(judged) > 1:
        return unclear('That sounded very different from the ustaad. Listen again and recite these words.')
    if phone_model is not None:
        check_tones(model, phone_model, samples, screen, reference, judged)
    for word, result in zip(words, judged):
        result.update(id=word['id'], text=word['text'], tone_checked=phone_model is not None)
    right = sum(w['state'] == 'correct' for w in judged)
    return dict(base, status='judged', words=judged, message=f'{right} of {len(judged)} words matched the ustaad.')
