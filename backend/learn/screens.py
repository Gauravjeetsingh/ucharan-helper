"""Learn practice screens (listen and repeat): a student attempt is judged only against that screen's ustaad clip.

Uses the Gurbani CTC model (the same one as /timestamps). The ustaad's clip is
decoded into Gurmukhi pieces as the model hears them (not the scripture text),
and each piece is then checked in the student's audio: does the model hear the
ustaad's sound there, or is a different sound clearly stronger? The ustaad's
audio is therefore the only truth; another screen can use another ustaad.
Pronunciation cards (data/lessons/pronunciation-cards.json) describe, sound by
sound, how the ustaad says each word. A person confirms them; they supply the
feedback wording, can turn a sound into a tip that is never graded, and set the
voicing target for ਭ ਧ ਘ ਝ ਢ where the models mishear the ustaad.
Scores are uncalibrated model evidence, not a certified grade.
"""
import difflib
import json
import wave

import numpy as np

from ..paths import ROOT
from ..timestamps import ctc_path
from .tone import SH

LESSONS = ROOT / 'data/lessons'
SR = 16000
BLANK = 256
# A sound the model gives at least this probability in the ustaad's own audio
# counts as the ustaad's sound too: we never demand more certainty from the
# student than the model had about the ustaad.
CANDIDATE_MIN = .1
# ...but when the ustaad clearly made a consonant and it is essentially absent
# from the student's audio, an alternative doesn't excuse it. The model leans
# towards common words (ਸਚੁ), so even the ustaad's ਸਤਿ shows ਚ at 23%; a student
# saying "sach" drops ਤ to ~0, while a correct "sat" keeps it above ~0.2.
CLEAR_IN_USTAAD, GONE_IN_STUDENT = .5, .05
_CACHE = {}
_CARDS = {}


def cards_path():
    return LESSONS / 'pronunciation-cards.json'


def load_cards(audio):
    """Cards for one ustaad recording, keyed by word id (re-read when the file changes)."""
    path = cards_path()
    if not path.is_file():
        return {}
    stamp = path.stat().st_mtime_ns
    if _CARDS.get('stamp') != stamp:
        _CARDS.update(stamp=stamp, data=json.loads(path.read_text(encoding='utf-8')))
    data = _CARDS['data']
    return data.get('words', {}) if data.get('audio') == audio else {}


def piece_sounds(model, pieces, card):
    """For each ustaad piece, the indices of the card sounds it covers (by Gurmukhi letters)."""
    letters = [(i, c) for i, sound in enumerate(card['sounds']) for c in sound['letters']]
    chars = [(k, c) for k, p in enumerate(pieces) for c in text(model, [p['token']]).replace(' ', '')]
    result = [set() for _ in pieces]
    matcher = difflib.SequenceMatcher(None, [c for _, c in chars], [c for _, c in letters], autojunk=False)
    for op, a0, a1, b0, b1 in matcher.get_opcodes():
        if op == 'equal' or op == 'replace':
            for n in range(a1 - a0):
                result[chars[a0 + n][0]].add(letters[min(b0 + n, b1 - 1)][0])
    return result


def card_variants(model, pieces, card):
    """Card-consistent versions of the ustaad's pieces.

    The model sometimes hears a held vowel the card doesn't have (the ustaad's ਸਚੁ
    decoded as ਸਾ+ਚ+ੁ). The card is the confirmed truth, so the piece without the
    extra signs (▁ਸ for ▁ਸਾ) also counts as the ustaad's sound.
    """
    letters = ''.join(sound['letters'] for sound in card['sounds'])
    out = []
    for p in pieces:
        written = model.tokenizer.id_to_piece(p['token'])
        kept = ''.join(c for c in written if c == '▁' or c in letters or c not in VOWELS)
        token = model.tokenizer.piece_to_id(kept) if kept != written and kept.strip('▁') else None
        out.append(token if token not in (None, model.tokenizer.unk_id()) else None)
    return out


def card_reason(sound, instead):
    said = f"{sound['letters']}: the ustaad says {sound['say']}"
    return f"{said}; yours sounded more like “{instead}”." if instead else f"{said}; it was missing or unclear in yours."


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
            pieces[index].append(dict(token=token, candidates=candidates, region=region,
                                      prob=float(np.exp(lp[frame, token])),
                                      alternatives={c: float(np.exp(lp[frame, c])) for c in candidates if c != token}))
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


DULAINKAR = None  # Token id of ੂ, set on first use.


def judge(model, lp, step, reference, threshold, cards=None):
    """Score each ustaad piece where it best fits in the student's audio.

    Piece score = best-frame log-odds of the ustaad's likely sounds versus the
    strongest other sound, silence included. Negative means a sound the ustaad
    didn't make (or silence) was clearly stronger. Clear extra sounds inside a
    word (e.g. an added "m") are also reported.
    """
    global DULAINKAR
    if DULAINKAR is None:
        DULAINKAR = model.tokenizer.piece_to_id('ੂ')
    for word, card in zip(reference, cards or [None] * len(reference)):
        for piece, variant in zip(word, card_variants(model, word, card) if card else []):
            if variant is not None:
                piece['candidates'] = piece['candidates'] | {variant}
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
        score, instead = float(odds[best]), int(others[best].argmax())
        support = float(np.exp(lp[frames, piece['token']]).max())
        top = int(lp[frames].max(0).argmax())
        piece['student_dulainkar'] = float(np.exp(lp[frames, DULAINKAR]).max()) if DULAINKAR is not None else 0.
        piece['student_alternative'] = top != piece['token'] and top in piece['candidates']
        written = text(model, [piece['token']])
        # Only pieces that start with a consonant: “ੰਗ” is mostly a nasal tail.
        if piece['prob'] >= CLEAR_IN_USTAAD and support < GONE_IN_STUDENT and written and written[0] not in VOWELS:
            score = min(score, threshold - 1)
            loudest = lp[frames].copy()
            loudest[:, piece['token']] = -np.inf
            instead = int(np.unravel_index(loudest.argmax(), loudest.shape)[1])
        scores[owner[k]].append(dict(piece=piece['token'], score=score, candidates=piece['candidates'],
                                     heard_instead=instead))
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
    for k, piece in enumerate(pieces):
        if k + 1 == len(pieces) or owner[k + 1] != owner[k]:
            end = piece_frames[k + 1][0] if k + 1 < len(pieces) else len(lp)
            piece['student_tail_dulainkar'] = float(np.exp(lp[piece_frames[k][0]:max(end, piece_frames[k][0] + 1), DULAINKAR]).max())
            piece['student_tail_region'] = (piece_frames[k][0] * step, end * step)
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
        card = (cards or [None] * len(reference))[i]
        mapped = piece_sounds(model, ref, card) if card else [set() for _ in ref]
        for k, s in enumerate(scores[i]):
            if s not in weak or not mine:
                continue
            instead = s['heard_instead'] != BLANK and text(model, [s['heard_instead']])
            sounds = [card['sounds'][j] for j in sorted(mapped[k])] if card else []
            if sounds and all(x['check'] == 'tip' for x in sounds):
                continue  # The card says this sound is guidance only.
            checked = next((x for x in sounds if x['check'] != 'tip'), None)
            if checked:
                reasons.append(card_reason(checked, instead))
            else:
                reasons.append(f"The ustaad's {name(model, s['piece'])} sounded more like {name(model, s['heard_instead'])} in yours."
                               if instead else f"The ustaad's {name(model, s['piece'])} was missing or unclear in yours.")
        if extra:
            reasons.append(f"You added {', '.join(name(model, t) for t in extra)}, which the ustaad didn't say.")
        words.append(dict(state='wrong' if reasons else 'correct', reason=' '.join(reasons),
                          ustaad_heard=text(model, [p['token'] for p in ref]), student_heard=text(model, mine),
                          weakest=round(min(s['score'] for s in scores[i]), 2),
                          student_start=round(spans[i][0] * step, 3), student_end=round((spans[i][1] + 1) * step, 3)))
    return words


def check_tones(model, phone_model, samples, screen, reference, judged, cards):
    """Phone-model checks the spelling-based Gurbani model can't make (see tone.py):
    ਭ ਧ ਘ ਝ ਢ voicing, ਸ vs “sh”, a vowel pushed into ਪ੍ਰ (“par”), and a final
    sihari / aunkar stretched into a long “ee” / “oo”."""
    from . import tone
    key = (screen['audio'], screen['start'], screen['end'])
    ustaad_events, ustaad_lp = tone.phone_infer(phone_model, read_clip(screen['audio'], screen['start'], screen['end']), key)
    student_events, student_lp = tone.phone_infer(phone_model, samples)
    flag = lambda result, reason: result.update(state='wrong', reason=' '.join(filter(None, [result.get('reason'), reason])))
    for word, result, card in zip(reference, judged, cards):
        if result['state'] == 'unclear':
            continue
        mapped = piece_sounds(model, word, card) if card else [set() for _ in word]
        for piece, sounds in zip(word, mapped):
            if 'student_region' not in piece:
                continue
            written = text(model, [piece['token']])
            card_sounds = [card['sounds'][j] for j in sorted(sounds)] if card else []
            graded = lambda letters: not any(letters in x['letters'] and x['check'] == 'tip' for x in card_sounds)
            if 'ਸ' in written and graded('ਸ') and SH in phone_model.vocab:
                reason = tone.check_s(tone.sibilant(phone_model, ustaad_lp, piece['region']),
                                      tone.sibilant(phone_model, student_lp, piece['student_region']))
                if reason:
                    flag(result, reason)
            if '੍ਰ' in written and graded('੍ਰ'):
                # Two independent signals: the Gurbani model prefers “ਪਰ”, and the phone
                # model hears a vowel between p and r that the ustaad didn't have.
                if (piece.get('student_alternative') and tone.vowel_inside_cluster(student_events, piece['student_region'])
                        and not tone.vowel_inside_cluster(ustaad_events, piece['region'])):
                    flag(result, "੍ਰ: the ustaad joins the r straight onto the consonant (“pra”); yours had a vowel in between (“par”).")
            ends_in_sihari = written == 'ਿ' or bool(card and card['sounds'][-1]['letters'] == 'ਿ')
            if piece is word[-1] and ends_in_sihari and graded('ਿ'):
                student_region = piece['student_region'] if written == 'ਿ' else piece['student_tail_region']
                reason = tone.check_sihari(tone.final_sihari(phone_model, ustaad_lp, piece['region']),
                                           tone.final_sihari(phone_model, student_lp, student_region))
                if reason:
                    flag(result, reason)
            # Final aunkar: also when the model didn't hear the ustaad's (very light) one at all,
            # as long as the card says the word ends in ੁ.
            ends_in_aunkar = written == 'ੁ' or bool(card and card['sounds'][-1]['letters'] == 'ੁ')
            if piece is word[-1] and ends_in_aunkar and graded('ੁ'):
                ustaad_oo = max(piece['alternatives'].get(DULAINKAR, 0.),
                                tone.long_u(phone_model, ustaad_lp, piece['region']) - .05)
                reason = tone.check_aunkar(ustaad_oo, piece.get('student_tail_dulainkar', 0.),
                                           tone.long_u(phone_model, student_lp, piece['student_tail_region']))
                if reason:
                    flag(result, reason)
            letter = tone.tonal_letter(written)
            if not letter:
                continue
            sound = next((card['sounds'][j] for j in sorted(sounds) if card['sounds'][j].get('voicing')), None)
            if sound and sound['check'] == 'tip':
                continue
            reason = tone.check(phone_model, letter, tone.voicing(phone_model, ustaad_lp, piece['region'], letter),
                                tone.voicing(phone_model, student_lp, piece['student_region'], letter),
                                sound['voicing'] if sound else None)
            if reason:
                flag(result, reason)


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
    by_id = load_cards(screen['audio'])
    cards = [by_id.get(w['id']) for w in words]
    judged = judge(model, lp, step, reference, float(lesson.get('min_sound_score', -1.5)), cards)
    if sum(w['state'] == 'wrong' for w in judged) == len(judged) and len(judged) > 1:
        return unclear('That sounded very different from the ustaad. Listen again and recite these words.')
    if phone_model is not None:
        check_tones(model, phone_model, samples, screen, reference, judged, cards)
    for word, result, card in zip(words, judged, cards):
        result.update(id=word['id'], text=word['text'], tone_checked=phone_model is not None)
        if card:
            result['card'] = dict(status=card['status'], sounds=card['sounds'])
            result['ustaad_says'] = card.get('spoken') or card['text']
    right = sum(w['state'] == 'correct' for w in judged)
    return dict(base, status='judged', words=judged, message=f'{right} of {len(judged)} words matched the ustaad.')
