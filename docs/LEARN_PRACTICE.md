# Learn · listen and repeat

Top section of `/learn`. Each screen shows a few Gurmukhi words and one ustaad
clip. The student listens, records, and each word turns green (sounds matched),
red (a sound clearly differed) or grey (the app could not tell). Tapping a word
shows how the model heard the ustaad and the student, in Gurmukhi, and why it
was red.

## Source of truth

That screen's ustaad audio, never the scripture spelling. A different screen can
use a different ustaad.

1. The Gurbani CTC model (the `/timestamps` model) decodes the ustaad's clip into
   Gurmukhi pieces as heard, keeping each piece's likely alternatives (e.g. ਤ 77%
   / ਚ 23%). We never demand more certainty from the student than the model had
   about the ustaad.
2. Those pieces are aligned to the student's audio. A piece fails when a sound
   the ustaad didn't make, or silence, is clearly stronger (`min_sound_score` in
   the lesson, default -1.5). Back-to-back vowel pieces count as one vowel, so a
   sung, held ੴ and a spoken one compare fairly. Clear added consonants (the m in
   “ekam kaar”) are reported.
3. The Gurbani model maps sound to spelling, so “nir-pau” and “nir-bhau” are both
   ਨਿਰਭਉ to it. If the optional phone model (older Learn setup) is installed, a
   voicing check runs at ਭ ਧ ਘ ਝ ਢ only: was the ustaad's sound voiceless
   (p t k ch ṭ) or voiced (bh dh gh jh ḍh), and does the student's match? Only
   clear opposites are flagged (`backend/learn/tone.py`).

Colours are uncalibrated model evidence, tuned on a handful of recordings, not a
validated grade.

## Setup

Timestamp model (README “Enable new timestamp generation”). The phone model is
optional and only adds the voicing check.

## Lessons

`data/lessons/<id>.json`: `screens[]` with `audio` (16-bit PCM WAV under
`data/`, any rate, mono or stereo), `start`/`end` seconds and per-word
`id`/`text`/`start`/`end`. `/timestamps` can produce word times. New lessons
must also be added to `LESSONS` in `apps/learn/screens.js`. Lesson files and
clips under `data/lessons/` are served by `backend/learn/screens_api.py`.

**Save my attempt** downloads the student's recording to their computer for
debugging; nothing is kept on the server.

## Files

- `apps/learn/screens.js`, `apps/learn/screens.css`: UI (IDs prefixed `lp-`).
- `backend/learn/screens.py`: comparison. `backend/learn/tone.py`: voicing check.
- `backend/learn/screens_api.py`: HTTP handlers; `server.py` only has two hooks.
- Tests: `tests/test_learn_screens_routes.py` (stdlib),
  `tests/verify_learn_screens.py` (acoustic checks skip without the model).
