"""Voicing check for Gurbani's tonal consonants (ਭ ਧ ਘ ਝ ਢ).

The Gurbani model writes "nir-pau" and "nir-bhau" both as ਨਿਰਭਉ: it maps sound
to spelling, so it cannot hear this difference. The acoustic phone model can.
At each tonal consonant the Gurbani model located, we ask the phone model:
was the ustaad's sound voiceless (p t k ch ṭ) or voiced (bh dh gh jh ḍh)? A
word is flagged only when the ustaad is clearly one way and the student
clearly the other. The ustaad's audio sets the target, never the spelling.
Limited to these letters: on other consonants the phone model mislabels
correct learner speech too often (e.g. ਪ heard as b).
"""
import numpy as np

# letter: (voiceless name, voiced name, voiceless phone labels, voiced phone labels)
TONAL = {
    'ਭ': ('p', 'bh', ['p', 'pʰ', 'pː'], ['b', 'bː']),
    'ਧ': ('t', 'dh', ['t', 't̪', 'tʰ'], ['d']),
    'ਘ': ('k', 'gh', ['k', 'kʰ', 'kː'], ['ɡ']),
    'ਝ': ('ch', 'jh', ['tʃ', 'tʃʰ', 'c'], ['dʒ', 'ɟ']),
    'ਢ': ('ṭ', 'ḍh', ['ʈ', 'ʈʰ'], ['ɖ']),
}
CLEAR, ABSENT = .5, .1
PHONE_STEP = .02
_CACHE = {}


def tonal_letter(piece):
    return next((c for c in piece if c in TONAL), None)


def voicing(phone_model, logp, region, letter):
    """Highest voiceless / voiced / breath (“h”) probability around a time region (seconds)."""
    a, b = region
    f0, f1 = max(0, int((a - .04) / PHONE_STEP)), min(len(logp), int((b + .04) / PHONE_STEP) + 1)
    if f1 <= f0:
        return 0., 0., 0.
    probs = np.exp(logp[f0:f1])
    _, _, voiceless, voiced = TONAL[letter]
    best = lambda labels: float(max((probs[:, phone_model.vocab[l]].max() for l in labels if l in phone_model.vocab), default=0.))
    return best(voiceless), best(voiced), best(['h'])


def phone_infer(phone_model, samples, key=None):
    """(events, frame log-probs) from the phone model, cached for ustaad clips."""
    if key is not None and key in _CACHE:
        return _CACHE[key]
    result = phone_model.infer(samples)
    if key is not None:
        _CACHE[key] = result
    return result


# Other sounds the spelling-based Gurbani model can't hear, checked with the phone model.
SH, CLUSTER_VOWELS = 'ʃ', {'a', 'ʌ', 'ə', 'ɐ', 'ɑ', 'e', 'ɛ', 'i', 'ɪ', 'o', 'u', 'ʊ', 'æ', 'aː', 'ɑː'}


def sibilant(phone_model, logp, region):
    """Highest “s” and “sh” probability around a region (seconds)."""
    a, b = region
    probs = np.exp(logp[max(0, int((a - .04) / PHONE_STEP)):min(len(logp), int((b + .04) / PHONE_STEP) + 1)])
    if not len(probs):
        return 0., 0.
    return float(probs[:, phone_model.vocab['s']].max()), float(probs[:, phone_model.vocab[SH]].max())


def check_s(ustaad, student):
    """ਸ: the ustaad's is clearly “s”; flag a student's that is clearly “sh”."""
    (u_s, u_sh), (s_s, s_sh) = ustaad, student
    if u_s >= CLEAR and u_sh < ABSENT and s_sh >= CLEAR and s_s < ABSENT:
        return "ਸ: the ustaad says a clear “s” as in soul; yours sounded like “sh”."
    return None


SHORT_I, LONG_EE = ['ɪ', 'e', 'ɛ', 'ə'], ['i', 'iː']


def final_sihari(phone_model, logp, region):
    """Highest short-“i” and long-“ee” probability at a word-final sihari."""
    a, b = region
    probs = np.exp(logp[max(0, int((a - .02) / PHONE_STEP)):min(len(logp), int((b + .02) / PHONE_STEP) + 1)])
    best = lambda labels: float(max((probs[:, phone_model.vocab[l]].max() for l in labels if l in phone_model.vocab), default=0.))
    return (best(SHORT_I), best(LONG_EE)) if len(probs) else (0., 0.)


def check_sihari(ustaad, student):
    """A final sihari stretched into a long “ee” (aadee for ਆਦਿ) that the ustaad didn't have."""
    (u_short, u_long), (s_short, s_long) = ustaad, student
    if u_long < .3 and s_long >= CLEAR and s_long > s_short:
        return "ਿ: the ustaad ends with a light, short “i”; yours was stretched into a long “ee”."
    return None


def long_u(phone_model, logp, region):
    """Highest full “u/oo” probability at a word-final aunkar."""
    a, b = region
    probs = np.exp(logp[max(0, int((a - .02) / PHONE_STEP)):min(len(logp), int((b + .02) / PHONE_STEP) + 1)])
    return float(max((probs[:, phone_model.vocab[l]].max() for l in ['u', 'uː'] if l in phone_model.vocab), default=0.)) if len(probs) else 0.


def check_aunkar(ustaad_dulainkar, student_dulainkar, student_long_u):
    """A final aunkar stretched into a full “oo” (purkhu for ਪੁਰਖੁ): both models must hear it."""
    if ustaad_dulainkar < .05 and student_dulainkar >= .3 and student_long_u >= .3:
        return "ੁ: the ustaad ends with a very light “u”; yours was stretched into a full “oo”."
    return None


def vowel_inside_cluster(events, region):
    """True if the phone labels show p/b, then a vowel, then r inside the region (“par” for ਪ੍ਰ)."""
    a, b = region
    labels = [e['label'] for e in events if a - .06 <= e['start'] <= b + .06]
    for i, label in enumerate(labels):
        if label in {'p', 'b', 'pʰ'}:
            rest = labels[i + 1:]
            if 'r' in rest and any(l in CLUSTER_VOWELS for l in rest[:rest.index('r')]):
                return True
    return False


def check(phone_model, letter, ustaad, student, target=None):
    """Return a reason string when the student's voicing clearly differs from the target.

    ustaad / student: (voiceless, voiced, breath) probabilities. Without a card
    the target is whatever the ustaad clearly was. With a confirmed card target:
    if the model hears the ustaad the same way, the student must not clearly be
    the opposite. If the model can't clearly hear the ustaad as the target
    (e.g. ਭੀ heard as “b”), voicing isn't graded.
    """
    quiet, voiced_name = TONAL[letter][:2]
    (u_vl, u_vd, _), (s_vl, s_vd, _) = ustaad, student
    if target is None:
        if u_vl >= CLEAR and u_vd < ABSENT:
            target = 'voiceless'
        elif u_vd >= CLEAR and u_vl < ABSENT:
            target = 'voiced'
        else:
            return None
    if target == 'voiceless':
        u_same, u_opp, s_same, s_opp = u_vl, u_vd, s_vl, s_vd
        message = (f"The ustaad says {letter} softly, like “{quiet}” with no voice in it; "
                   f"yours had a voiced “{voiced_name}” sound.")
    else:
        u_same, u_opp, s_same, s_opp = u_vd, u_vl, s_vd, s_vl
        message = f"The ustaad says {letter} with a voiced “{voiced_name}” sound; yours sounded like a plain “{quiet}”."
    # A breath (“h”) cue was tried and rejected: the h of a neighbouring ਹੈ leaks in.
    if u_same >= CLEAR and u_opp < .3:
        clear = s_opp >= CLEAR and (u_opp < ABSENT or s_opp > s_same)
    else:
        # The model half-hears the ustaad's target (ਭੀ: p .39 / b .56). Flag only a
        # student whose target sound vanishes while the opposite is near-certain
        # (“bhi”: p .02 / b .95), like a vanished consonant in screens.py.
        clear = u_same >= .3 and s_same < .05 and s_opp >= .9
    return message if clear else None
