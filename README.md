# Uchaaran Helper

A shared hackathon workspace for learning Gurbani from one ustaad recording.
The timestamp generator is separate from the experimental learning tools.

| Route | Current state | Source |
| --- | --- | --- |
| `/timestamps` | Audio + Gurmukhi → word timing JSON | `apps/timestamps/` |
| `/follow` | Mobile-frame audio/tap demo with green/red timing feedback | `apps/follow/` |
| `/learn` | Existing timing review, sound review and phrase practice; experimental | `apps/learn/` |
| `/test` | Placeholder; ready for implementation | `apps/test/` |

`/` redirects to `/timestamps`. The generator does not load the word-review or
pronunciation-practice UI. Each route works directly and on refresh.

## Quick start on a teammate's laptop

Install Python 3.12, then:

```sh
git clone https://github.com/Gauravjeetsingh/ucharan-helper.git
cd ucharan-helper
python3 serve.py
```

Windows: use `py -3.12 serve.py` instead. Open
<http://127.0.0.1:8767/timestamps>. No Node, pip install, model download, API key,
external account, or system-specific cache is required to start the app and
load/export the existing sample timings. Use `--port 8768` if 8767 is busy.
Do not use a generic static file server; the Python server supplies the feature
routes and local inference endpoints.

## Enable new timestamp generation

Use Python 3.12 for the pinned ML wheels. On macOS/Linux:

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-timestamps.txt
python -m scripts.download_timestamp_model
python serve.py
```

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-timestamps.txt
python -m scripts.download_timestamp_model
python serve.py
```

If activation is restricted, call `.venv\Scripts\python.exe` directly.
The explicit setup downloads the pinned ~184 MB IndicConformer INT8 model to
ignored `models/timestamps/`. Inference runs on CPU, loads lazily, and never
sends audio to Hugging Face. No PyTorch or pronunciation model is needed.

Choose **Use the Japji Sahib sample**, or upload audio your browser can decode.
Paste the Gurmukhi words in recitation order and press **Generate timestamps**.
The browser converts audio to mono 16 kHz PCM; no FFmpeg installation is needed
for the UI. Maximum duration is 30 minutes (processed in 30-second chunks), maximum input file size 300 MB.
Supply a spoken expansion for ੴ when present; the displayed text stays exact.
Download JSON to keep/share a result; uploaded audio and generated results are
held in memory, not written by the server. Browser codec support varies; use a
PCM WAV if a MOV/other format cannot be decoded.

**Load existing sample timings** is a distinct action: it opens the original
artifact without running the model. It does not pretend to regenerate timings.
Changing input text or audio invalidates a previous downloadable result.

Alignment is known-text CTC Viterbi with free audio edges. Boundaries and the
low-support marker are estimates, not calibrated confidence or pronunciation
scores. Incorrect/missing words can still be forced onto audio; verify before
using generated timing data as reference labels. The sample's original 25
source occurrences and extra opening speech remain preserved in its artifact.
See [docs/DATA.md](docs/DATA.md) for the JSON contracts and model provenance.

## Follow-along mobile demo

Open <http://127.0.0.1:8767/follow>. The desktop page presents a narrow phone
viewport for the hackathon demo; on a phone it fits the available width. The
screen uses the supplied recording and existing 25 source-word timings. No ML
setup or microphone access is required.

Press Play and tap each word as it is recited. A tap from 180 ms before the
word's start to 320 ms after its end is green. An early tap or a word whose
window expires is red. Each occurrence counts once; repeated words retain
separate identities. Attention points follow the mockup: +10 per caught word,
−5 per miss, with a floor of zero. They are not pronunciation scores.

Pause freezes playback and leaves the round intact. Start again resets it.
The audio clock drives progress, expired words, and passage scrolling, including
after background frame gaps. The short WAV is buffered locally as Blob media
before play so seeking/replay work without HTTP-range support. Completion shows
stars, caught/missed counts, missed-word chips, and Play again. Results remain in
memory and are not uploaded or persisted. Timing grace values are demo settings,
not validated attention thresholds; source boundaries still await review.

## Optional Learn development

The main `/learn` page uses a phone layout: listen, record, then see green/red
words with explanations below. It shows no percentage score or ustaad tip.
Phrase comparison uses the timestamp model above; see
[docs/LEARN_PRACTICE.md](docs/LEARN_PRACTICE.md) for the flow and its limitations.
The Lesson menu links to the existing timing and sound lab described below.

Existing work lives separately under `/learn`. Static playback, timing edits,
reference sound review and notes work without the phone model. For local student
comparison, in the activated Python 3.12 environment:

```sh
python -m pip install -r requirements-phonetics.txt
python -m scripts.download_phone_model
python serve.py
```

This downloads a separate ~1.26 GB phonetic model. First inference can take a
minute on CPU. Start with **ਸਤਿ ਨਾਮੁ**. Audio-derived sound labels and feedback
are experimental; no ustaad-validated pronunciation grade is presented.
Student audio stays in tab/process memory. Compare sends it only to the local
loopback server; nothing is automatically retained or uploaded externally.
Human corrections and timing edits save separately in browser storage and can
be exported. The original checked-in reference artifact is not overwritten.

Reference reproduction tools (run from the repository root):

```sh
python -m scripts.extract_phones
python -m scripts.make_controls
python -m scripts.report_findings
python -m scripts.evaluate_ratings
```

The first three require the phonetic environment/model. Existing estimated word
timings are reused. Regenerating reference phones changes their identity;
export existing reviews first. Historical alignment scripts accept an explicit
`GURBANI_CTC_MODEL_DIR` for the original local Gurbani Wav2Vec2 checkpoint;
the new timestamp generator has its own portable model downloader instead.
See [docs/PHONETIC_FINDINGS.md](docs/PHONETIC_FINDINGS.md) and
[evaluation/PROTOCOL.md](evaluation/PROTOCOL.md) for limitations and pending
human validation. Synthetic teacher controls are not real learner ratings.

## Repository layout

```text
apps/                   independent route pages
  timestamps/           generation only
  learn/                previous review + practice prototype
  follow/               mobile tap-along demo
  test/                 placeholder
  shared/               navigation and styles
backend/                local server + timestamp inference
  learn/                optional phonetic engine
scripts/                portable setup/reproduction modules
data/reference/         shared demo inputs and reference JSON
models/                 ignored local weights
local-recordings/       ignored original audio archive
data/evidence/         ignored generated logits/evidence arrays
tests/                 Python and browser checks
docs/                  data contracts and findings
```

## Checks

Standard-library checks (no model downloads):

```sh
python -m unittest tests.test_server
python -m tests.verify_data
```

With timestamp dependencies: `python -m unittest tests.test_timestamps`.
With phonetic dependencies: `python -m tests.verify_phonetics`.
With a timestamp-ready server running, `python -m tests.timestamp_inference`
checks real generation on the supplied recording (no mocked acoustic model).

Optional browser tests require Node 20+; start the app in another terminal:

```sh
npm ci
npx playwright install chromium
npm run test:browser
npm run test:timing-review
npm run test:follow
npm run test:follow:browser
npm run test:learn:ui
```

Use `APP_URL=http://127.0.0.1:8768` for the route smoke test if needed. For the
optional full Learn inference check, generate controls with
`python -m scripts.make_controls`, run a second server with
`python serve.py --port 8768`, then `npm run test:learn`. A portable Playwright
browser is used by default; `BROWSER_EXECUTABLE` is an optional override.

## Working together

Create a branch for each feature (`git switch -c feature/follow`, for example),
keep route-specific changes in its folder, push the branch, and open a pull
request into main. Share this repository with teammates through GitHub's
collaborator settings. [AGENTS.md](AGENTS.md) contains the local setup commands,
feature boundaries, checks, and project constraints for their coding agents.

Models, venvs, node_modules, original audio archives, generated arrays, private
ratings and child recordings are excluded from Git. The shared sample contains
only the supplied ustaad recording. Application code is MIT; see
[THIRD_PARTY.md](THIRD_PARTY.md) for separate model/data provenance.
