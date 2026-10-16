# Ustaad evaluation — pending human data

No learner recordings or ustaad judgements have been collected. Source-audio
controls in `controls/` are automated smoke tests, never accuracy validation.
The first human milestone is this recording's **ਸਤਿ ਨਾਮੁ** phrase: collect one
acceptable learner attempt and one deliberate error, then have the ustaad
judge both, including the exact word and any sound diagnosis. Do not call the
deliberate error an observed error until the ustaad confirms what was heard.

## Reference review

Use the page's reference-sound panel. Replay word and phrase context. Save
ordinary-language notes and optional space-separated model-label corrections.
The extracted draft and full-clip labels remain in reference-phones.json;
browser corrections are a separate checksum-bound download. Do not mark all
words reviewed automatically. Confirm timing boundaries in the existing editor.
If a target contrast is outside the model inventory, record it in notes: do not
approximate it silently or grade that contrast with this recognizer.

## Collection and annotation

1. Obtain parental choice/consent before retaining or sharing a child's audio.
   Local practice needs no retained file. Download audio only by explicit choice.
2. Assign a pseudonymous speaker ID and an attempt ID. Decide speaker-disjoint
   calibration versus evaluation splits **before** examining model results.
   Never place attempts by the same speaker in both splits.
3. Record acceptable attempts at comfortable, slower, and faster natural rates
   from multiple voices. Keep the actual vowel-length contrasts. Add intended
   substitutions (aspiration, dental/retroflex, vowel quality/length as relevant),
   deletions and insertions. Include noise/clipping and wrong-phrase cases to
   evaluate abstention. These are collection prompts, not gold labels.
4. Ustaad listens blind to model outputs, replaying teacher/student words and
   phrase context. For every existing occurrence ID label word acceptability
   (`acceptable`, `needs_practice`, `unable_to_judge`), heard event (`none`,
   `substitution`, `deletion`, `insertion`, `vowel_length`,
   `localized_difference`, `unable_to_judge`), sound heard/expected in IPA or
   ordinary language, severity (`none`, `minor`, `major`, `unable_to_judge`),
   and ordinal uchaaran rating 1–5. Keep intended mistake separate in notes.
   Annotate intervals manually if precise student boundaries matter. Never use
   teacher timestamps as student gold segments. Extra sounds attach to their
   nearest word with an explicit boundary note.
5. Download worksheet JSON and optionally matching attempt WAV/evidence JSON.
   The waveform checksum joins files. The page marks `blind_rating=false`
   when evidence was opened first. Empty values remain unrated. A second
   independent expert and adjudication are useful for ambiguous cases.

## Calibration and held-out evaluation

Currently no calibrated score or practice threshold exists. The displayed
0–100 number is only phone-sequence agreement, not pronunciation accuracy.
Posteriors and weakest-label evidence are features, not probabilities of
correctness. Avoid arbitrarily mixing ASR confidence or DTW distance into a grade.

With actual calibration labels, first report sample/speaker counts and rating
agreement, then fit the simplest monotonic mapping from acoustic features to
ordinal ratings. Choose any practice/abstention thresholds on calibration data
against a declared false-positive target for acceptable words. Freeze mapping,
model, reviewed draft and thresholds before held-out evaluation. A recognizer
that cannot detect an inventory contrast must abstain for that contrast.

Report speaker-bootstrap confidence intervals for Spearman correlation and
MAE against ratings; weighted kappa if appropriate; word-error and sound-event
precision, recall and F1; false-positive rate on acceptable words; abstention
rate and error among non-abstained attempts. Report by sound, severity, voice,
audio condition and speaking-rate bucket. Measure same-speaker acceptable
attempt consistency across rates and vowel-length error sensitivity separately.
Report deletion/insertion localization quality against manual student spans.
Recheck false alarms on the held-out correct attempts; do not mark the weakest
word wrong solely because it is weakest. Keep final evaluation speakers out of
calibration and any later threshold selection.
