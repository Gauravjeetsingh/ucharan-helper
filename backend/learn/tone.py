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
import math

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
# One rule for every check: red only when the student is no longer clearly on the
# ustaad's side (less than 2:1 for the right sound) AND is at least 20x further from
# it than the ustaad was. Relative, so it holds when the model half-hears the ustaad.
SHIFT, SIDE = math.log(20), math.log(2)


def odds(target, other):
    clip = lambda p: min(.99, max(.01, p))
    return math.log(clip(target) / clip(other))


def differs(u_target, u_other, s_target, s_other):
    student = odds(s_target, s_other)
    return student < SIDE and odds(u_target, u_other) - student >= SHIFT
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
    if differs(*ustaad, *student):
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
    if differs(*ustaad, *student):
        return "ਿ: the ustaad ends with a light, short “i”; yours was stretched into a long “ee”."
    return None


def long_u(phone_model, logp, region):
    """Highest full “u/oo” probability at a word-final aunkar."""
    a, b = region
    probs = np.exp(logp[max(0, int((a - .02) / PHONE_STEP)):min(len(logp), int((b + .02) / PHONE_STEP) + 1)])
    return float(max((probs[:, phone_model.vocab[l]].max() for l in ['u', 'uː'] if l in phone_model.vocab), default=0.)) if len(probs) else 0.


def check_aunkar(ustaad, student):
    """A final aunkar stretched into a full “oo” (purkhu for ਪੁਰਖੁ). (light, full-oo) pairs."""
    if differs(*ustaad, *student):
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

    ustaad / student: (voiceless, voiced, breath) probabilities. The target is the
    card's, else whichever way the ustaad leans. Judged with `differs`.
    """
    quiet, voiced_name = TONAL[letter][:2]
    (u_vl, u_vd, _), (s_vl, s_vd, _) = ustaad, student
    if target is None:
        target = 'voiceless' if u_vl > u_vd else 'voiced'
    if target == 'voiceless':
        u_same, u_opp, s_same, s_opp = u_vl, u_vd, s_vl, s_vd
        message = (f"The ustaad says {letter} softly, like “{quiet}” with no voice in it; "
                   f"yours had a voiced “{voiced_name}” sound.")
    else:
        u_same, u_opp, s_same, s_opp = u_vd, u_vl, s_vd, s_vl
        message = f"The ustaad says {letter} with a voiced “{voiced_name}” sound; yours sounded like a plain “{quiet}”."
    # A breath (“h”) cue was tried and rejected: the h of a neighbouring ਹੈ leaks in.
    clear = differs(u_same, u_opp, s_same, s_opp)
    return message if clear else None
