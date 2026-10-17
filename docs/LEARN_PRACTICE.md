# Learn · listen and repeat

`/learn` presents a cream phone frame with a five-turn coin streak, pankti
position, a Gurmukhi phrase, and speaker, microphone and next-pankti controls. Recording is available as soon
as the lesson loads. Listening to the ustaad is optional; tapping the microphone
also stops any reference playback before recording.

The browser checks microphone energy locally every 50 ms. After at least 250 ms
of sustained sound, 1.5 seconds of silence ends the recording and starts the
existing local comparison. Initial silence and short clicks do not arm the
stop detector. The stop button still works; a 14.5-second limit also remains.
No detected speech shows a retry message without requesting a comparison.
This simple amplitude threshold (RMS 0.015) estimates a pause, not whether all
words were recited. A long pause within a phrase can end it early; background
noise can postpone stopping until the limit. No live ASR or new model is used.
The waveform follows the playing audio or microphone; it does not give live
pronunciation judgements. During recording, a lavender word highlight guides
the recitation using the ustaad's word timings at 1.08× pace (8% faster). It
starts on the first word when recording starts, holds through gaps until the
next word, and clears after the last word's expected ending. Each retry starts
from the first occurrence. This is a timing prompt, not live speech tracking or
correctness feedback. Its ending never stops or grades the recording; silence
detection and manual stop remain independent.

Words turn green when the model finds a match and red when it finds a possible
sound difference. Red cards below the phrase explain the differences returned
by the comparison API, show what the model heard, and let you replay both
recordings. Tapping a word also replays its ustaad segment. Uncertain words stay
neutral and prompt another attempt. There are no percentages or ustaad tips.
The middle section scrolls while the recording controls stay accessible.

Each completed, judged recording is one turn, including retries. More than 70%
of the expected word occurrences must have the existing `correct` feedback to
fill one of five bars. All expected words form the denominator, including
unclear or missing feedback. A judged turn at 70% or below resets the streak;
unavailable/unclear assessments and technical errors leave it unchanged.
The message counts down (for example, “3 more to go for Nanak Coin”). The fifth
qualifying turn adds one Nanak Coin to the same tab-session counter as Follow.
The fifth turn shows multicolored flower petals falling from the top and a
Nanak Coin rising from the bottom into the top-right counter. On arrival, the counter increases and the five bars clear for a new
streak. Reduced-motion mode collects the coin and clears the bars immediately.
The award and cleared streak are saved before the animation, so refreshing or
navigating mid-flight preserves the reward without awarding it twice.
Navigation, playback and re-rendering never count as turns. Only streak and coin
totals are saved in browser session storage, never recordings or word results.
This rewards existing experimental feedback; it adds no calibrated score.

The app starts at `/`: choose Japji Sahib, then Follow along, Learn, or Read Aloud.
Back returns to these modes; Home returns to all banis. Learn defaults to the
complete bani, in source order, with no dropdown or shuffle. Previous/next
pankti controls navigate 386 short screens, including the opening and salok.

`data/lessons/japji-sahib-full.json` is built from the existing MOV timing
artifact with `python -m scripts.build_japji_practice`; this performs no new
inference. All 2,150 occurrence IDs, Gurmukhi spellings, Unicode code-point
offsets (end exclusive), and word times are preserved. Times remain unreviewed
estimates. The script splits long lines only between existing words to keep
recording requests under 15 seconds.

Prepare the corresponding supplied MOV locally with
`python -m scripts.prepare_japji_audio` (FFmpeg or macOS afconvert). The WAV is
ignored by Git. The source MOV and MP3 have different leading audio; this lesson
uses the MOV because its timing artifact was made from that file. The bounded
`/api/learn/screens/audio` route returns only the requested phrase or pauri, with
its absolute start in `X-Audio-Start`. The browser uses that offset to highlight
the original word times and keeps at most eight decoded phrases in memory.

The existing lab and pronunciation review remain at `/apps/learn/lab.html` and
`/apps/learn/cards.html`. Pronunciation guidance stays off the practice page.

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

Use the timestamp model from the
[README setup](../README.md#enable-learn-feedback-and-timestamp-generation).
The phone model is optional and only adds the voicing check.

## Lessons

`data/lessons/<id>.json`: `screens[]` with `audio` (16-bit PCM WAV under
`data/`, any rate, mono or stereo), `start`/`end` seconds and per-word
`id`/`text`/`start`/`end`. `/timestamps` can produce word times. The practice page
currently opens `japji-sahib-full` only. Lesson files and
clips under `data/lessons/` are served by `backend/learn/screens_api.py`.

**Save my attempt** downloads the student's recording to their computer for
debugging; nothing is kept on the server.

## Files

- `apps/learn/screens.js`, `apps/learn/screens.css`: UI (IDs prefixed `lp-`).
- `backend/learn/screens.py`: comparison. `backend/learn/tone.py`: voicing check.
- `backend/learn/screens_api.py`: lesson files, bounded audio and comparison handlers.
- Streak, endpoint and guide logic: `node --test tests/learn-streak.test.cjs tests/learn-endpoint.test.cjs tests/learn-guide.test.cjs`.
- Tests: `tests/test_learn_screens_routes.py` (stdlib),
  `tests/verify_learn_screens.py` (acoustic checks skip without the model).
  `npm run test:learn:ui` checks browser playback/capture and synthetic
  comparison responses with a running server; it does not validate acoustics.
- `node tests/learn-autostop.cjs` checks automatic silence stopping with synthetic
  microphone energy, immediate recording, manual stopping and cleanup.
