# Learner-definition handoff

Branch: `feature/learner-pronunciation-definitions`, based on main. The learner
flow is in `apps/test/` and `backend/learner/`; teacher/reference generation is
outside its scope. No reference pronunciation, reference word IDs or score is
inferred from a learner's recording.

## Two independent steps

`POST /api/test/extract` accepts `{ "audio_base64": "<mono 16 kHz PCM WAV>" }`.
Maximum length is 15 seconds. It returns `evidence` and
`claude_payload_preview`. Status is `ready`, `re_record`, or `uncertain`.
The local acoustic model is the existing pinned
`facebook/wav2vec2-xlsr-53-espeak-cv-ft`; it decodes freely, not against expected
words. This recognizer's Gurbani learner accuracy is unvalidated.

Each observed event has an ID unique within this recording (`sound-001`, etc.),
the raw label, approximate emission `start`/`end`, a model emission posterior
and alternatives. These are **not physical phoneme boundaries or correctness
probabilities**. Input identity is the SHA-256 of the normalized WAV. Audio
metadata and model identity are preserved. Files/expected text are not passed
to Claude.

`POST /api/test/define` accepts the unchanged `evidence` plus
`consent_to_external_processing: true`. A local integrity signature
ensures the evidence was extracted by this server without edits. A server
restart preserves the signature, including when a Claude API key is configured
or changed. Only a random 32-byte signing key is stored in ignored
`.local/learner-evidence.key`; recordings and observations are not stored there.
Evidence created before this fix or on another machine needs one re-extraction
from the recording still in the tab. Do not refresh away an unsaved recording.
The signature is not a portable expert-review or pronunciation certificate.

The server sends only the preview to the Claude Messages API. The checked-in
`backend/learner/describe.prompt.txt` supplies the instructions; its SHA-256 is
recorded in definition provenance. `ANTHROPIC_MODEL` is configurable, default
`claude-sonnet-5-5`; `ANTHROPIC_API_KEY` stays server-side. No model tools,
uploads to a Files API, or hidden retry/repair calls are made. A malformed,
refused, truncated or unavailable response produces an error, never a plausible
fallback definition. The acoustic and provider stages have separate locks so
a slow provider response does not block unrelated local model operations.

`GET /api/test/status` exposes setup booleans, chosen model and data-sharing
description, never the credential. Startup remains stdlib-only; local extraction
imports NumPy/torch/Transformers lazily. Existing routes remain independent.

## Definition JSON

`schema_version: 1`, `artifact_type: "learner_pronunciation_definition"`.
The artifact contains:

- `audio`: checksum, sample rate, channels, encoding, duration; no audio bytes.
- `observations`: original recognizer evidence, unchanged by Claude.
- `definition.summary`: a plain-language summary of observations/uncertainty.
- `definition.groups[]`: `heard_word` (nullable, explicitly a tentative guess),
  `grouping_note`, approximate replay `start`/`end`, `timing_kind`, and `sounds`.
- Each sound: immutable `event_id`/`observed_label`, an English `description`,
  `english_examples[]` with `word`, literal substring `focus`, `accent_note`,
  and `uncertainty_note`. The UI capitalizes the focused letters, e.g. a
  hypothetical `{ "word": "sun", "focus": "s" }` displays **S**un. That
  example documents the format; it is not an annotation of real learner audio.
- `provenance`: extractor identity/revision, Claude's reported model, prompt
  hash, usage, UTC creation timestamp, and `heard_audio: false`.
- `human_verified: false`, `status: "draft"`, privacy disclosures and limitations.

All original events must appear exactly once in the same order, with no new
events. No numeric pronunciation score, expected/corrected sound field, expert
rating or target word occurrence ID is generated. Empty English examples are
allowed and preferred to a misleading equivalence. The server validates
structure/identity but cannot mechanically establish description correctness.

## Connecting the teammate's reference definitions later

Share this contract and the prompt. Keep expected/required reference sounds
separate from observed learner sounds. Reference instructions can say what is
required; this artifact can only say what the recognizer guessed was heard.
Do not use `heard_word` guesses as canonical Gurmukhi or as authoritative source
word IDs. Later association must handle different rates, omitted/extra sounds,
repetitions and uncertain grouping, with access to the original two recordings.
English anchor words are teaching aids, not identity keys for sound comparison.
No third comparison-LLM stage is implemented in this branch.

## Verification and remaining live dependency

`python -m unittest tests.test_learner_definitions tests.test_server` verifies
consent, credential isolation, unchanged evidence, provider payload shape,
malformed/invented/reordered output rejection, safe failure and route access.
`npm run test:definitions` verifies recording, file decode, local/remote stage
separation, opt-in, highlighted English examples, replay, exports, invalidation,
provider failure and mobile layout with **explicit synthetic API stubs**. These
tests are not acoustic validation or evidence that Claude heard audio.

Actual local extraction has also been smoke-tested with the existing source
audio control, not a new learner or a human-rated sample. A real Claude request
cannot be verified until the user configures their local API key. No live
Claude descriptions or expert annotations are fabricated. After setup, record
one real phrase and inspect the downloaded artifact with the ustaad before
using its English examples as teaching instructions.

To check actual local extraction through a running server, with a short 16 kHz
mono PCM WAV of your choice, run `python -m tests.learner_inference my-phrase.wav`.
Use `--url http://127.0.0.1:8770` for a separate development server. This check
does not call Claude, regardless of whether a key is configured.

Official capability references checked for implementation:
[Claude models](https://platform.claude.com/docs/en/models/overview),
[audio-input compatibility limitation](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk),
[Messages API](https://platform.claude.com/docs/en/api/messages).
