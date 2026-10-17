# Uchaaran Helper

A mobile-first Sundar Gutka Kids mode demo for practising Japji Sahib with one
ustaad recording. Follow along by tapping words, or listen and repeat short
panktis in Learn. The desktop view uses a phone-sized frame.

| Route | Feature | Source |
| --- | --- | --- |
| `/` | Sundar Gutka home and bani selection | `apps/home/` |
| `/bani/japji-sahib` | Follow along, Learn and Read Aloud menu | `apps/home/` |
| `/follow` | Tap along through 38 pauris | `apps/follow/` |
| `/learn` | Listen, record and get experimental word feedback | `apps/learn/` |
| `/test` | Read Aloud — coming soon; no recording controls | `apps/test/` |
| `/timestamps` | Separate audio/text timestamp tool with JSON export | `apps/timestamps/` |

Learn covers the full bani in 386 short screens, including the opening and
closing salok. Back returns to the mode menu; Home returns to bani selection.
Parent settings, multiple-ustaad management and Read Aloud practice are future
work.

## Run locally

Use Python 3.12 for the pinned model dependencies. Install FFmpeg for reference
audio preparation; macOS can also use its built-in `afconvert`.

Clone the repository, or extract the submission ZIP and open its project folder:

```sh
git clone https://github.com/Gauravjeetsingh/ucharan-helper.git
cd ucharan-helper
```

From the project root on macOS/Linux:

```sh
python3 -m scripts.prepare_japji_audio
python3 serve.py
```

On Windows:

```powershell
py -3.12 -m scripts.prepare_japji_audio
py -3.12 serve.py
```

Open **http://127.0.0.1:8767/**. Use `--port 8768` to choose another port.
Run the app with `serve.py`; its Python backend supplies the feature routes,
audio clips and comparison endpoints.

Audio preparation converts the supplied MOV to an ignored local WAV. It runs
once and reuses that file on later runs. Follow along and reference playback
need no model. The server and existing timestamp sample also work without
installing Python packages. Learn's recording feedback and new timestamp
generation need the model setup below.

## Enable Learn feedback and timestamp generation

Create a Python 3.12 virtual environment. On macOS/Linux:

```sh
python3.12 -m venv .venv
source .venv/bin/activate
```

On Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
```

Then, in the activated environment on either platform:

```sh
python -m pip install -r requirements-timestamps.txt
python -m scripts.download_timestamp_model
python -m scripts.prepare_japji_audio
python serve.py
```

This downloads the pinned, checksum-checked IndicConformer INT8 model (~184 MB)
to `models/timestamps/`. Inference runs on CPU and loads lazily. The main Learn
flow and timestamp generator share this model. No API key or PyTorch is needed
for this setup. If PowerShell activation is restricted, call
`.venv\Scripts\python.exe` in place of `python`.

An optional audio-derived phone model adds further sound checks and supports
the older phonetic lab. To enable it in the same environment:

```sh
python -m pip install -r requirements-phonetics.txt
python -m scripts.download_phone_model
```

It downloads a separate ~1.26 GB model and requires more memory. Restart the
server after adding it. The main Learn flow works without this optional model.

## Follow along

Press Play and tap each word as the paath recites it. On-time taps turn green;
early taps and missed words turn red. Only unjudged words in the active verse
are clickable during playback. Tapping a red word does not replay audio.
Pause preserves the round; Start again resets it.

Completing a pauri with **at least 70%** of words caught earns **one Nanak Coin**.
Words do not earn individual coins. Completion shows falling flower petals; an
earned coin rises from the bottom into the counter. Below the threshold, the
action is Retry. Reduced-motion mode collects rewards without the animation.

The audio clock determines tap results. Timing windows are demo settings, and
the supplied word boundaries remain estimates awaiting review.

## Learn

Optionally listen to the ustaad, then record the displayed phrase. Recording is
available immediately and can interrupt reference playback. Word highlights
follow the reference timings at a gently faster pace to guide recitation;
they do not track the learner's spoken words or grade speaking speed.

After sustained sound is detected, **1.5 seconds of silence** ends recording
automatically. Manual stop remains available, with a **14.5-second limit**.
This detects a pause, not whether every word was completed; a long pause can
end an attempt early. No detected speech prompts a retry without comparison.

The comparison shows matched words in green, possible differences in red, and
unassessed words in neutral. Feedback lets the learner replay the ustaad and
their own recording. There is no displayed percentage pronunciation grade.

Five consecutive judged turns with **more than 70%** of expected words matched
earn **one Nanak Coin**. Five bars and a countdown show progress. A judged turn
at 70% or below resets the streak; unavailable assessments and technical errors
preserve it. The fifth qualifying turn shows falling petals and a rising coin,
then clears the bars. Follow along and Learn share the tab's coin counter.

Feedback is experimental and uncalibrated. It compares model evidence from the
ustaad and learner audio; transcription agreement alone does not establish
correct uchaaran. See [Learn implementation and limitations](docs/LEARN_PRACTICE.md).

## Timestamp and reference tools

At `/timestamps`, choose the supplied sample or upload audio, then paste or
upload the corresponding Gurmukhi text and generate word timings. Audio is
converted in the browser to mono 16 kHz PCM. Inputs can be up to 30 minutes and
300 MB, subject to browser codec support. Supply a spoken expansion for ੴ;
the displayed scripture stays unchanged.

**Load existing sample timings** opens the checked-in artifact without running
inference. New estimates can be inspected, adjusted and exported as JSON.
Local boundary corrections save under the ignored `data/corrections/` folder.
Generated boundaries and acoustic support indicators require review; they are
not pronunciation scores. [Data contracts and provenance](docs/DATA.md) describe
the preserved text, occurrence IDs, offsets and timing formats.

Additional authoring tools remain at `/apps/learn/cards.html` for pronunciation
cards and `/apps/learn/lab.html` for the older reference/phonetic lab. These are
separate from the learner-facing practice screens.

## Privacy and submission files

Student audio stays in browser/server-process memory by default. In a local
session, comparison sends it to the Python server on that computer. If the app
is accessed remotely, comparison runs on that server and Learn shows a notice.
The app does not automatically save recordings or send them to model publishers.
**Save my attempt** is an explicit download to the learner's computer.

Coins, Learn streaks and completed-pauri IDs use browser session storage.
Follow along does not upload student audio. Reference-authoring tools can save
local notes and corrections separately.

For source submissions, keep the code, supplied reference assets, README and
licenses. Exclude `.local/`, environment secrets, `.git/`, student recordings,
private evaluations, generated evidence, model weights, virtual environments,
`node_modules/` and caches. Models and prepared audio are reproduced with the
setup commands above.

## Project layout

```text
apps/home/          bani selection and mode menu
apps/follow/        tap-along practice
apps/learn/         Learn practice and separate authoring tools
apps/test/          Read Aloud placeholder
apps/timestamps/    timestamp generation and export
apps/shared/        shared styles, navigation and reward animations
backend/            HTTP routes and lazy-loaded inference
data/reference/     supplied ustaad audio and reference artifacts
data/lessons/       checked-in lessons and pronunciation cards
scripts/            setup and reproduction modules
tests/              Python and browser checks
docs/               implementation details and provenance
```

## Checks

Core checks require only the Python standard library:

```sh
python -m unittest tests.test_server tests.test_learn_screens_routes tests.test_japji_practice
python -m tests.verify_data
```

With timestamp dependencies installed: `python -m unittest tests.test_timestamps`.
With the optional phone model setup: `python -m tests.verify_phonetics`.

Browser checks require Node 20+ and the app running in another terminal:

```sh
npm ci
npx playwright install chromium
npm run test:browser
npm run test:follow
node --test tests/learn-streak.test.cjs tests/learn-endpoint.test.cjs tests/learn-guide.test.cjs
npm run test:follow:browser
npm run test:learn:ui
node tests/learn-autostop.cjs
npm run test:unified
```

Use `APP_URL` for another server address in the current practice suites.
`BROWSER_EXECUTABLE` optionally selects a locally installed browser. Browser
comparison fixtures test UI behavior, not acoustic accuracy. A timestamp-ready
server can run `python -m tests.timestamp_inference` for actual model generation
on the supplied sample.

## Contributing and license

Use a feature branch and a pull request into `main`. Keep feature-specific work
in its route directory. [AGENTS.md](AGENTS.md) describes boundaries and local
commands for teammates and coding agents.

Application code is MIT licensed. Supplied recordings, source text, model
weights and fonts retain their own provenance and licenses; see
[THIRD_PARTY.md](THIRD_PARTY.md).
