# Acoustic extraction findings — experimental

Actually run with `facebook/wav2vec2-xlsr-53-espeak-cv-ft` at revision `2c733782da5604684829819a5eb744c193fe9398`.
Input was the supplied ustaad audio only. No spelling or ASR transcript was passed to the phonetic recognizer.

Recognized 127 full-clip phone emissions, 31 distinct labels, 25 source word occurrences, and 12 short phrases.
Full-clip versus short-context labels differ on 19 occurrences. This is instability evidence, not an error rate.

## First practice phrase

**ਸਤਿ ਨਾਮੁ** (`phrase-v1-w02`).

| Word occurrence | Draft labels from audio |
| --- | --- |
| ਸਤਿ · v1-w02 | s ɑ t e |
| ਨਾਮੁ · v1-w03 | n aː m ə |

All labels and their word assignment await listening. These are model symbols, including eSpeak-style nonstandard labels, not a certified IPA transcription.

## Inventory audit

| Contrast probe | Present literally | Missing literally |
| --- | --- | --- |
| short_long_vowels | i, iː, u, uː, a, aː | — |
| dental_retroflex | t̪, ʈ, ɖ, ɳ, ɽ | d̪ |
| aspiration | k, kʰ, p, pʰ, tʰ, ʈʰ, bʰ, dʰ, ɡʰ | t̪ʰ |
| nasal_vowels | ɑ̃, ɔ̃, ũ, ĩ, ã | — |
| nasals | m, n, ŋ, ɳ | — |
| gemination | pː, tː, kː | — |
| tone_or_breathy_quality | — | ˥, ˩, a̤, ə̤ |

This audit checks label presence only. It does not prove that the recognizer distinguishes these sounds in this clip or in learner speech. Nonstandard symbols are preserved without inventing equivalent IPA labels. Tone/breathy quality and unsupported combinations cannot receive sound-specific diagnoses.

## Machine controls actually run

| Source control | Result state | Phone-label agreement index |
| --- | --- | --- |
| source-identity | experimental | 100.0 |
| source-second-word-muted | experimental | 37.5 |
| silence | re_record | withheld |

These controls reuse the same ustaad audio. Identity is an implementation control; muting a source word is a signal alteration; silence tests abstention. They are not separate learners or ustaad-rated correct/incorrect attempts. Numbers above are not pronunciation accuracy.

## Reviewable occurrence drafts

| Occurrence | Gurmukhi | Short-context draft | Context disagreement |
| --- | --- | --- | --- |
| v1-w01 | ੴ | j i k ʌ uː ʌ ŋ k aː r ʉ | True |
| v1-w02 | ਸਤਿ | s ɑ t e | False |
| v1-w03 | ਨਾਮੁ | n aː m ə | True |
| v1-w04 | ਕਰਤਾ | ɡ a r t aː | True |
| v1-w05 | ਪੁਰਖੁ | p o r k y | False |
| v1-w06 | ਨਿਰਭਉ | n i r p a h o | True |
| v1-w07 | ਨਿਰਵੈਰੁ | n e r ʌ v aː r y | True |
| v1-w08 | ਅਕਾਲ | a k aː l ə | False |
| v1-w09 | ਮੂਰਤਿ | m uː r ʌ t e | True |
| v1-w10 | ਅਜੂਨੀ | a d uː n i | True |
| v1-w11 | ਸੈਭੰ | z h æ m a ŋ | True |
| v1-w12 | ਗੁਰ | ɡ u r | False |
| v1-w13 | ਪ੍ਰਸਾਦਿ | p r a s aː d e | True |
| v2-w01 | ਜਪੁ | dʒ aː p ʌ | True |
| v3-w01 | ਆਦਿ | aː d ɪ | False |
| v3-w02 | ਸਚੁ | s ɑ dʒ ɯ | True |
| v3-w03 | ਜੁਗਾਦਿ | d u ɡ aː d e | True |
| v3-w04 | ਸਚੁ | s a dʒ ø | True |
| v4-w01 | ਹੈ | h æ | True |
| v4-w02 | ਭੀ | b iː | True |
| v4-w03 | ਸਚੁ | s ɑː t dʒ ɚ | True |
| v4-w04 | ਨਾਨਕ | n aː n ʌ k ʌ | True |
| v4-w05 | ਹੋਸੀ | h u s i | False |
| v4-w06 | ਭੀ | b iː | True |
| v4-w07 | ਸਚੁ | s ɑ dʒ ɪ | True |

## Remaining human dependency

No reference sound labels, exact student sound errors, learner acceptability ratings or practice thresholds have been validated by an ustaad. The user chose to prepare the review workflow and supply ratings later. The next human milestone is one acceptable learner attempt and one deliberate mistake on the first phrase, judged against this recording. See evaluation/PROTOCOL.md for speaker-disjoint collection, calibration and evaluation. Until then, feedback is a listening hypothesis and the score is only experimental model-label agreement.

Reproduce: `python -m scripts.extract_phones`, `python -m scripts.make_controls`, then `python -m scripts.report_findings`, using the ML Python environment in README.md. Raw full-clip and phrase-context frame log probabilities are in ignored data/evidence/phone-logprobs.npz and data/evidence/phone-context-logprobs.npz. Neither file contains a learner recording.
