# Working on Uchaaran Helper

Read README.md first. This shared hackathon repository has four independent
feature routes. Keep work in the relevant directory so teammates can build
on separate branches without rewriting each other's pages.

## Run

- Python 3.12 recommended. From the repo root: `python3 serve.py`.
- Windows: `py -3.12 serve.py`, or `python serve.py` in an activated venv.
- Open http://127.0.0.1:8767/timestamps. `--port 8768` is supported.
- Startup and existing reference playback use only the Python standard library.
- Timestamp inference: install requirements-timestamps.txt, then run
  `python -m scripts.download_timestamp_model` in the activated venv.
- Learn inference is optional: requirements-phonetics.txt and
  `python -m scripts.download_phone_model`. Other routes must not require it.
- Never hardcode home directories, cached model paths, or browser paths.

## Feature boundaries

- `apps/timestamps/`: generator only: audio/text input, generation, JSON export.
  Do not add word review, microphone practice, IPA review, or scoring here.
- `apps/learn/`: existing word timing review and experimental pronunciation work.
- `apps/follow/`: mobile-frame tap-along demo using the existing word timings.
  Keep judgement on the media clock, preserve paused state and distinct IDs.
- `apps/test/`: placeholder for teammates to implement.
- `apps/shared/`: navigation/shared styles. Scope feature-specific CSS locally.
- `backend/timestamps.py`: known-text CTC timestamp generation.
- `backend/learn/`: audio-derived phone analysis; import/load lazily.
- `backend/server.py`: explicit routes, allowlisted static assets, local API.
- `data/reference/`: shared demo recording and checked-in reference artifacts.
- `scripts/`: setup/reproduction modules: `python -m scripts.<module>`.
- `tests/`: checks. Model weights/generated evidence stay out of Git.

## Product constraints

- Current scope is one ustaad recording. Multiple-ustaad management is future
  work; do not add accounts or reference-management infrastructure.
- Preserve canonical Gurmukhi, verse IDs and repeated-word occurrence IDs.
  Document Unicode offset units. ੴ stays one displayed occurrence across its
  spoken expansion. Never rewrite scripture to accommodate a model.
- IPA targets come from ustaad audio, not text-to-IPA or ASR spelling.
- A transcription match/model confidence is not a pronunciation grade.
- Outputs remain estimates until reviewed. Do not invent human annotations,
  missing word timings, accuracy claims or calibrated scores.
- Do not grade speaking rate directly; retain meaningful sound distinctions.
- Student recordings stay in browser/local-process memory by default. No cloud
  uploads, tracking, automatic child-audio retention or credentials in Git.

## Verification

- Core routes, stdlib only: `python -m unittest tests.test_server`.
- Source integrity: `python -m tests.verify_data`.
- With timestamp deps: `python -m unittest tests.test_timestamps`.
- With phonetic deps: `python -m tests.verify_phonetics`.
- Browser: Node 20+, `npm ci`, `npx playwright install chromium`, start server,
  then `npm run test:browser`. BROWSER_EXECUTABLE is an optional local override.
- Optional existing Learn checks: see README.md.
- Follow timing logic: `npm run test:follow`. With server/browser installed:
  `npm run test:follow:browser` (real playback + desktop/mobile checks).
- Run checks relevant to changes; synthetic fixtures are not acoustic validation.

## Collaboration

Use a feature branch per change and a pull request into main. Prefer small
commits. Coordinate shared API/JSON changes in the PR. Do not commit models,
raw source archives, student audio, private evaluation data, venvs or caches.
