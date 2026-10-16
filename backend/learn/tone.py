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
    """Highest voiceless / voiced probability around a time region (seconds)."""
    a, b = region
    f0, f1 = max(0, int((a - .04) / PHONE_STEP)), min(len(logp), int((b + .04) / PHONE_STEP) + 1)
    if f1 <= f0:
        return 0., 0.
    probs = np.exp(logp[f0:f1])
    _, _, voiceless, voiced = TONAL[letter]
    best = lambda labels: float(max(probs[:, phone_model.vocab[l]].max() for l in labels if l in phone_model.vocab))
    return best(voiceless), best(voiced)


def phone_logp(phone_model, samples, key=None):
    if key is not None and key in _CACHE:
        return _CACHE[key]
    _, logp = phone_model.infer(samples)
    if key is not None:
        _CACHE[key] = logp
    return logp


def check(phone_model, letter, ustaad, student):
    """Return a reason string when the student's voicing clearly differs from the ustaad's."""
    quiet, voiced_name = TONAL[letter][:2]
    (u_vl, u_vd), (s_vl, s_vd) = ustaad, student
    if u_vl >= CLEAR and u_vd < ABSENT and s_vd >= CLEAR:
        return (f"The ustaad says {letter} softly, like “{quiet}” with no voice in it; "
                f"yours had a voiced “{voiced_name}” sound.")
    if u_vd >= CLEAR and u_vl < ABSENT and s_vl >= CLEAR:
        return f"The ustaad says {letter} with a voiced “{voiced_name}” sound; yours sounded like a plain “{quiet}”."
    return None
