# Learn · listen and repeat

`/learn` presents a cream phone frame with lesson progress, a Gurmukhi phrase,
and speaker, microphone and next-pankti controls. Listen to the whole ustaad
clip to enable the microphone, then record and tap stop to compare locally.
The waveform follows the playing audio or microphone; it does not give live
pronunciation judgements.

Words turn green when the model finds a match and red when it finds a possible
sound difference. Red cards below the phrase explain the differences returned
by the comparison API, show what the model heard, and let you replay both
recordings. Tapping a word also replays its ustaad segment. Uncertain words stay
neutral and prompt another attempt. There are no percentages or ustaad tips.
The middle section scrolls while the recording controls stay accessible.

Choose a lesson, shuffle, or return to the previous pankti from the Lesson
menu above the frame. Existing source text, occurrence IDs, audio and timings
are preserved. The older timing and sound lab and the pronunciation-card review
pages remain linked in that menu. The full-recording Japji Sahib lesson is also
available there. Review-page styles live in `cards.css` so they do not change
the practice layout. Pronunciation-card guidance stays on the review pages;
comparison reasons and the card's spoken form can still appear in feedback.

## Source of truth

That screen's ustaad audio, never the scripture spelling. A different screen can
use a different ustaad.

1. The Gurbani CTC model (the `/timestamps` model) decodes the ustaad's clip into
   Gurmukhi pieces as heard, keeping each piece's likely alternatives (e.g. ਤ 77%
   / ਚ 23%). We never demand more certainty from the student than the model had
   about the ustaad. Exception: if the ustaad clearly made a consonant (≥50%)
   and it is essentially gone from the student's audio (<5%), an alternative
   doesn't excuse it. The model leans towards common words, so even the
   ustaad's ਸਤਿ shows ਚ at 23%; “sach” drops ਤ to ~0, a correct “sat” keeps ~0.2+.
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
  `npm run test:learn:ui` checks browser playback/capture and synthetic
  comparison responses with a running server; it does not validate acoustics.
