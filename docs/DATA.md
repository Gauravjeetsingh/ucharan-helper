# Timestamp data and APIs

`POST /api/timestamps/generate` accepts JSON:

```json
{
  "filename": "recording.wav",
  "audio_base64": "<base64 mono 16 kHz signed 16-bit PCM WAV>",
  "text": "ਸਤਿ ਨਾਮੁ",
  "expansions": {"ੴ": "ਇਕੁ ਓ ਅੰਕਾਰ"}
}
```

Limits: 120 seconds, 4,000 text characters, 250 words, 1,800 model tokens and
6 MB encoded request. Audio must have a changing non-silent signal. Generation
is serialized with Learn inference to bound concurrent model memory. A busy
server returns 429; invalid input returns 400; missing dependencies/model 503.
No endpoint downloads model weights automatically or retains uploaded audio.

The generated artifact contains:

- `schema_version: 1` and `source.text` exactly as entered.
- `source.offset_unit`: Python Unicode code points, end-exclusive. JavaScript
  consumers must use `Array.from(text)` for these offsets, not UTF-16 slicing.
- `audio`: original display filename, decoded duration, sample rate, and SHA-256
  of the converted PCM WAV (not the original compressed file).
- `words[]`: unique occurrence `id`, exact display `text`, `source_start/end`,
  separate `alignment_text`, `start/end` in seconds, `reviewed: false`,
  `status: estimated|uncertain` and heuristic `acoustic_support`.
- `alignment`: model/revision, method and explicit limitations.
- `diagnostic_transcript`: unconstrained model hypothesis, for troubleshooting;
  it is not canonical scripture and must not replace the displayed source text.

For the exact demo text (four original verses joined with newlines), generated
occurrences retain the original `v1-w01` etc. IDs plus verse IDs/word indices.
Offsets in a generated artifact always refer to the complete `source.text`.
Other input text receives positional `w001` etc. occurrence IDs.

The original `data/reference/word-timings.json` is a preserved **legacy reference
artifact**, with `verses[].words[]`, verse-local Unicode offsets, original MOV
checksum, and additional opening speech under `coverage.unmatched_audio`.
The distinct "Load existing sample timings" action returns it unchanged. The
generator UI can display/export either shape; consumers should explicitly
choose the shape they need rather than assume equivalent coordinate systems.
Learn intentionally remains tied to the original occurrence IDs and reference
phone extraction. Generating timestamps does not overwrite or rebind Learn.

## Word boundary corrections

The `/timestamps` word editor saves human start/end corrections to
`data/corrections/<audio checksum>.json`. This folder is ignored by Git and is local
to the computer running the server. The checksum is the result's `audio.pcm_sha256`
(generated) or `audio.sha256` (legacy sample). Each file stores
`words[<occurrence id>] = {start, end, corrected_at}` in seconds.

When the same recording loads again, saved corrections are applied over the
generated or reference timings. **Download JSON** then exports the corrected values.
Corrections never modify `data/reference/` or the audio.

- `GET /api/corrections/<checksum>` returns `{words}`.
- `POST /api/corrections/save` with `{audio_key, word_id, start, end}`.
- `POST /api/corrections/delete` with `{audio_key, word_id}`.

These endpoints are local same-origin only and are not blocked by model inference.

## Provenance

Timestamp model: `karansea/indicconformer-stt-pa-ctc-shabad-preview`, revision
`5fd2e89e3a43d31f47b0fb55fdce5ed50a91283f`; publisher lists MIT. Pinned INT8
ONNX and tokenizer SHA-256 values are checked by the explicit downloader.
Model output is 256 Gurmukhi SentencePiece labels plus blank 256. These are not
phoneme probabilities. Output-frame timing is approximated from input duration
and output length; boundaries are initial estimates requiring listening.

Free leading/trailing CTC states allow introductory audio and tails. They do
not establish coverage or correctly detect omitted words inside the passage.
Low acoustic support is marked uncertain, not a verified missing-word label.
No arbitrary equal-duration word segmentation or automatic human-review flag.

The sample recording was supplied by the project owner. Canonical text is the
first four verses of https://api.banidb.com/v2/shabads/1, preserved in
`banidb-shabad-1.json`; existing JSON records its checksum. MIT applies to the
application code, not an invented relicensing of third-party audio/scripture.
