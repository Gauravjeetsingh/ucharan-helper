"""Known-text CTC alignment. All boundaries are unreviewed acoustic estimates."""
import base64
import hashlib
import io
import json
import re
import wave
from .paths import ROOT, REFERENCE

MODEL_ID = 'karansea/indicconformer-stt-pa-ctc-shabad-preview'
REVISION = '5fd2e89e3a43d31f47b0fb55fdce5ed50a91283f'
MODEL_DIR = ROOT / 'models/timestamps'
SR = 16000
MAX_SECONDS = 1800
MAX_TEXT_CHARS, MAX_WORDS, MAX_TOKENS = 60000, 8000, 12000
# Long audio is run through the model in 30 s chunks with 2 s of context on each side;
# only each chunk's central frames are kept. One output frame covers 640 samples (40 ms).
CHUNK_SAMPLES, CONTEXT_SAMPLES, FRAME_SAMPLES = 30 * SR, 2 * SR, 640


def read_audio(encoded):
    import numpy as np
    raw = base64.b64decode(encoded, validate=True)
    with wave.open(io.BytesIO(raw)) as audio:
        if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) != (1, SR, 2):
            raise ValueError('Audio must be mono 16 kHz 16-bit WAV. The page converts it locally.')
        count = audio.getnframes()
        if not SR // 4 <= count <= SR * MAX_SECONDS:
            raise ValueError(f'Choose between 0.25 and {MAX_SECONDS} seconds of audio.')
        frames = audio.readframes(count)
        if len(frames) != count * 2:
            raise ValueError('Audio file is incomplete.')
    samples = np.frombuffer(frames, dtype='<i2').astype('float32') / 32768
    if float(np.std(samples)) < .0005:
        raise ValueError('Audio is silent or too quiet to align.')
    return samples, hashlib.sha256(raw).hexdigest()


def source_words(text):
    """Keep word occurrences and offsets; numbers and danda are not spoken labels."""
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
        raise ValueError(f'Enter the exact spoken text, at most {MAX_TEXT_CHARS:,} characters.')
    words = []
    for match in re.finditer(r'\S+', text):
        spoken = ''.join(c for c in match.group() if '\u0a00' <= c <= '\u0a75' and not '\u0a66' <= c <= '\u0a6f')
        if not spoken:
            continue
        words.append(dict(id=f'w{len(words)+1:03}', text=match.group(), alignment_text=spoken,
                          source_start=match.start(), source_end=match.end()))
    if not words or len(words) > MAX_WORDS:
        raise ValueError(f'Enter between 1 and {MAX_WORDS:,} Gurmukhi words.')
    return words


def ctc_path(logp, labels, blank):
    """Viterbi with free audio edges and explicit blanks between repeated labels.

    Free edges accommodate introductions/tails, not omissions within the target.
    """
    import numpy as np
    if not labels:
        raise ValueError('The text has no alignable tokens.')
    frames = len(logp)
    minimum = len(labels) + sum(a == b for a, b in zip(labels, labels[1:]))
    if frames < minimum:
        raise ValueError('Too much text for this audio. Use a shorter passage.')
    states = np.full(2 * len(labels) + 2, blank, dtype=int)
    states[1:-1:2] = labels
    size = len(states)
    previous = np.full(size, -np.inf)
    previous[0] = logp[0].max()
    previous[1] = logp[0, labels[0]]
    back = np.zeros((frames, size), dtype=np.int8)
    skip = (states != blank) & (states != np.roll(states, 2))
    skip[:2] = False
    for frame in range(1, frames):
        options = np.stack([previous, np.r_[-np.inf, previous[:-1]],
                            np.r_[-np.inf, -np.inf, previous[:-2]]])
        options[2, ~skip] = -np.inf
        options[2, -1] = previous[-3]
        choice = options.argmax(0)
        back[frame] = choice
        emission = logp[frame, states].copy()
        emission[0] = emission[-1] = logp[frame].max()
        previous = options[choice, np.arange(size)] + emission
    state = size - 3 + int(np.argmax(previous[-3:]))
    if not np.isfinite(previous[state]):
        raise ValueError('Could not find an alignment for the supplied text.')
    path = np.zeros(frames, dtype=int)
    path[-1] = state
    for frame in range(frames - 1, 0, -1):
        state -= int(back[frame, state])
        path[frame - 1] = state
    return path


class TimestampModel:
    def __init__(self):
        import onnxruntime as ort
        import sentencepiece as spm
        if not all((MODEL_DIR / f).is_file() for f in ['model.int8.onnx', 'tokenizer.model']):
            raise RuntimeError('Timestamp model missing. Run: python -m scripts.download_timestamp_model')
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        self.session = ort.InferenceSession(str(MODEL_DIR / 'model.int8.onnx'),
                                           sess_options=options, providers=['CPUExecutionProvider'])
        self.tokenizer = spm.SentencePieceProcessor(model_file=str(MODEL_DIR / 'tokenizer.model'))

    def run(self, samples):
        import numpy as np
        logp, length = self.session.run(['log_probs', 'out_len'],
            {'audio': samples[None], 'audio_len': np.array([len(samples)], dtype=np.int64)})
        return logp[0, :int(np.asarray(length).reshape(-1)[0])]

    def log_probs(self, samples):
        """Model frames for the whole recording; chunked so long audio fits in memory and time."""
        import numpy as np
        if len(samples) <= CHUNK_SAMPLES + CONTEXT_SAMPLES:
            return self.run(samples)  # short clips: one pass, unchanged behaviour
        parts = []
        for core in range(0, len(samples), CHUNK_SAMPLES):
            left = max(0, core - CONTEXT_SAMPLES)
            right = min(len(samples), core + CHUNK_SAMPLES + CONTEXT_SAMPLES)
            first = (core - left) // FRAME_SAMPLES
            count = -(-(min(core + CHUNK_SAMPLES, len(samples)) - core) // FRAME_SAMPLES)
            parts.append(self.run(samples[left:right])[first:first + count])
        return np.concatenate(parts)

    def generate(self, request):
        import numpy as np
        words = source_words(request.get('text'))
        # Preserve the existing source identities when generating the exact demo text.
        source_info = dict(text=request['text'], offset_unit='Unicode code points; end exclusive')
        reference = json.loads((REFERENCE/'word-timings.json').read_text(encoding='utf-8'))
        canonical = '\n'.join(v['text'] for v in reference['verses'])
        if request['text'] == canonical:
            originals = [w for v in reference['verses'] for w in v['words']]
            for word, original in zip(words, originals, strict=True):
                word.update({key: original[key] for key in ['id', 'verse_id', 'word_index']})
            source_info.update(url=reference['source']['url'], selection=reference['source']['selection'])
        samples, digest = read_audio(request.get('audio_base64', ''))
        expansions = request.get('expansions', {})
        if not isinstance(expansions, dict) or len(expansions) > 100:
            raise ValueError('Invalid spoken-expansion mapping.')
        labels, ranges = [], []
        for word in words:
            spoken = expansions.get(word['alignment_text'], word['alignment_text'])
            if not isinstance(spoken, str) or not spoken.strip() or len(spoken) > 200:
                raise ValueError('Invalid spoken expansion.')
            ids = self.tokenizer.encode(spoken, out_type=int)
            if self.tokenizer.unk_id() in ids:
                raise ValueError(f'The model cannot encode {word["text"]}. Supply a spoken expansion for symbols such as ੴ.')
            ranges.append((len(labels), len(labels) + len(ids)))
            labels.extend(ids)
            word['alignment_text'] = spoken
        if len(labels) > MAX_TOKENS:
            raise ValueError('Passage is too long for one alignment. Split the text and audio into parts.')
        logp = self.log_probs(samples)
        logp = logp - np.logaddexp.reduce(logp, axis=1)[:, None]
        path = ctc_path(logp, labels, 256)
        duration = len(samples) / SR
        step = duration / len(logp)
        cores = []
        for first, last in ranges:
            frames = np.where((path >= first * 2 + 1) & (path <= (last - 1) * 2 + 1))[0]
            support = [float(np.exp(logp[path == 2*i+1, token]).max()) for i, token in enumerate(labels[first:last], first)]
            cores.append((max(0., frames[0]*step), min(duration, (frames[-1]+1)*step), min(support)))
        for i, (word, (start, end, support)) in enumerate(zip(words, cores)):
            left = max(0., start-.08) if not i else max((cores[i-1][1]+start)/2, start-.12)
            right = min(duration, end+.12) if i+1 == len(words) else min((end+cores[i+1][0])/2, end+.18)
            word.update(start=round(left, 4), end=round(right, 4), reviewed=False,
                        status='uncertain' if support < .1 else 'estimated', acoustic_support=round(support, 4))
        ids = logp.argmax(-1).tolist()
        collapsed = [token for i, token in enumerate(ids) if token != 256 and (not i or token != ids[i-1])]
        return dict(schema_version=1, source=source_info,
                    audio=dict(file=str(request.get('filename', 'upload.wav'))[:200], duration_seconds=duration,
                               pcm_sha256=digest, sample_rate=SR), words=words,
                    alignment=dict(model=MODEL_ID, revision=REVISION, method='Known-text CTC Viterbi; free audio edges',
                                   frame_step_seconds=step, reviewed=False,
                                   limitations='Estimated boundaries, not pronunciation scores. Forced text can align despite omissions. Low support is a heuristic, not a calibrated confidence. Verify by listening.'),
                    diagnostic_transcript=self.tokenizer.decode(collapsed))
