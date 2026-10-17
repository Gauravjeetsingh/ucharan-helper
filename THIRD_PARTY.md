# Dependencies and model provenance

The home page bundles Fredoka from the Google Fonts project for the “Kids mode”
label. Copyright 2016 The Fredoka Project Authors. The font is distributed under
the SIL Open Font License 1.1; its original license is included at
`apps/home/fonts/OFL.txt`. No external font request is made at runtime.

The home heading bundles Baloo Paaji Regular from [Ek Type's Baloo 1.443
release](https://github.com/EkType/Baloo/releases/tag/1.443), under the SIL Open
Font License 1.1. Its license is included at `apps/home/fonts/BalooPaaji-OFL.txt`.
The font is served locally with the app.

Project additions are MIT licensed (LICENSE). The optional acoustic recognizer
is [facebook/wav2vec2-xlsr-53-espeak-cv-ft](https://huggingface.co/facebook/wav2vec2-xlsr-53-espeak-cv-ft),
revision `2c733782da5604684829819a5eb744c193fe9398`, Apache-2.0 per the
publisher's model card. Its card is preserved alongside downloaded weights.
The phonetic inventory is the model's original vocabulary, including nonstandard
eSpeak symbols. No eSpeak executable or GPL phonemizer package is used or needed;
the code never phonemizes text. Keep upstream notices when redistributing model
files. Model weights are excluded from source control.

Optional local runtime: PyTorch (BSD-style), NumPy (BSD-3-Clause), Hugging Face
Transformers (Apache-2.0), with their transitive dependency notices. They are
separate dependencies, compatible with this MIT application. No model or runtime
license is replaced by the application's MIT license. The existing Gurbani ASR
evidence remains alignment evidence only, not a phoneme head.

Compared model cards: [IndicConformer preview](https://huggingface.co/karansea/indicconformer-stt-pa-ctc-shabad-preview)
has 257 Gurmukhi SentencePiece/blank outputs, and
[Surt-small-v3](https://huggingface.co/surindersinghssj/surt-small-v3) is Gurmukhi
Whisper ASR. Neither provides the direct acoustic phone target used here.
The IndicConformer model is used by the separate timestamp generator. Surt is not required.


## Timestamp generator

`karansea/indicconformer-stt-pa-ctc-shabad-preview`, revision
`5fd2e89e3a43d31f47b0fb55fdce5ed50a91283f`, is MIT per the publisher. Its
INT8 ONNX model/tokenizer are explicitly downloaded, checksum-checked, and kept
out of source control. Preserve the upstream model card included by the downloader.
Runtime dependencies: ONNX Runtime (MIT), SentencePiece (Apache-2.0), NumPy
(BSD-3-Clause), and optional Playwright browser checks (Apache-2.0).

The sample ustaad recording was supplied by the project owner; canonical text
comes from BaniDB, with the response/checksum preserved in data/reference. The
MIT license covers project code and does not relicense third-party recordings
or source text. See docs/DATA.md for exact artifact/model provenance.
