"""Audio-only phonetic evidence. No scripture/ASR text enters the recognizer.

Phone labels are model symbols, not certified IPA. CTC emission spans are not
physical sound boundaries. All numerical outputs are uncalibrated diagnostics.
"""
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import wave

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROOT = PROJECT_ROOT / "data/reference"
MODEL_ID = 'facebook/wav2vec2-xlsr-53-espeak-cv-ft'
REVISION = '2c733782da5604684829819a5eb744c193fe9398'
WEIGHT_SHA256 = '04366b6c8d24099ef313cf02f0e58d26f5dddfda16edbfc8eb2c713d94a9f551'
SR = 16000


def read_wav(raw):
    with wave.open(io.BytesIO(raw), 'rb') as f:
        if f.getframerate() != SR or f.getnchannels() != 1 or f.getsampwidth() != 2:
            raise ValueError('Use mono 16 kHz 16-bit PCM WAV; the browser converts recordings locally.')
        if not 0 < f.getnframes() <= SR * 15:
            raise ValueError('Record one phrase, at most 15 seconds.')
        frames = f.readframes(f.getnframes())
        if len(frames) != f.getnframes()*2: raise ValueError('Incomplete WAV recording. Re-record or choose a complete file.')
        return np.frombuffer(frames, dtype='<i2').astype(np.float32) / 32768


def quality(x):
    duration = len(x) / SR
    rms = float(np.sqrt(np.mean(x*x))) if len(x) else 0
    ac_rms = float(np.std(x)) if len(x) else 0
    clipping = float(np.mean(np.abs(x) >= .999)) if len(x) else 0
    frames = np.pad(x, (0, (-len(x)) % 320)).reshape(-1, 320)
    energy = np.sqrt(np.mean(frames*frames, axis=1)) if len(frames) else np.array([0])
    active = float(np.mean(energy > max(.008, float(energy.max()) * .12)))
    reasons = []
    if duration < .4: reasons.append('Recording is too short; record the whole phrase.')
    if rms < .004: reasons.append('Recording is very quiet or silent. Move closer and retry.')
    elif ac_rms < .001: reasons.append('Recording has almost no changing audio signal. Check the microphone and retry.')
    if clipping > .01: reasons.append('Recording is clipping. Move farther from the microphone and retry.')
    if active < .12: reasons.append('Too little audible activity; record the whole phrase.')
    return dict(duration_seconds=round(duration, 3), rms_dbfs=round(20*math.log10(max(rms, 1e-9)), 2),
                clipping_fraction=clipping, active_fraction=active, dc_offset=float(np.mean(x)) if len(x) else 0,
                usable=not reasons, reasons=reasons,
                limitation='Heuristic capture checks, not calibrated SNR, speech detection, or pronunciation judgements.')


class PhoneModel:
    def __init__(self, directory=None):
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
        self.torch = torch
        directory = Path(directory or PROJECT_ROOT/'models/phone')
        if not (directory/'pytorch_model.bin').is_file() or (directory/'pytorch_model.bin').stat().st_size != 1263535127:
            raise RuntimeError('Local phone weights are missing. See README.md; no audio was sent externally.')
        torch.set_num_threads(6)
        self.extractor = Wav2Vec2FeatureExtractor.from_pretrained(directory, local_files_only=True)
        # Explicit model + feature extractor avoids tokenizer-side G2P entirely.
        # This 2021 checkpoint predates torch's weight_norm parametrization names.
        # torch 2.2 + transformers 4.37 otherwise silently initializes these two
        # positional-convolution weights. Rename explicitly and fail closed.
        state = torch.load(directory/'pytorch_model.bin', map_location='cpu', weights_only=True)
        prefix = 'wav2vec2.encoder.pos_conv_embed.conv.'
        if hasattr(torch.nn.utils.parametrizations, 'weight_norm'):
            for old, new in [('weight_g', 'parametrizations.weight.original0'), ('weight_v', 'parametrizations.weight.original1')]:
                if prefix+old in state: state[prefix+new] = state.pop(prefix+old)
        self.model, loading = Wav2Vec2ForCTC.from_pretrained(directory, state_dict=state,
                                  local_files_only=True, output_loading_info=True)
        if any(loading.get(key) for key in ['missing_keys','unexpected_keys','mismatched_keys','error_msgs']):
            raise RuntimeError(f'Acoustic checkpoint did not load completely: {loading}')
        self.loading_info = loading
        self.model.eval()
        del state
        self.vocab = json.loads((directory/'vocab.json').read_text(encoding='utf-8'))
        self.inverse = {v: k for k, v in self.vocab.items()}
        self.blank = self.model.config.pad_token_id

    def infer(self, samples, offset=0):
        inputs = self.extractor(samples, sampling_rate=SR, return_tensors='pt')
        with self.torch.inference_mode():
            logits = self.model(**inputs).logits[0].float().numpy()
        logp = logits - np.logaddexp.reduce(logits, axis=1)[:, None]
        ids = logits.argmax(-1)
        runs = []
        for frame, token in enumerate(ids):
            if runs and runs[-1]['token_id'] == int(token): runs[-1]['end_frame'] = frame+1
            else: runs.append(dict(token_id=int(token), start_frame=frame, end_frame=frame+1))
        events = []
        for run in runs:
            if run['token_id'] in (self.blank, 1, 2): continue
            a, b = run['start_frame'], run['end_frame']
            probs = np.exp(logp[a:b]).mean(0)
            alternatives = sorted((i for i in range(len(probs)) if i not in (0, 1, 2)), key=lambda i: -probs[i])[:4]
            events.append(dict(run, label=self.inverse[run['token_id']],
                               start=round(offset+a*.02, 4), end=round(offset+b*.02+.005, 4),
                               posterior=float(probs[run['token_id']]),
                               alternatives=[dict(label=self.inverse[i], posterior=float(probs[i])) for i in alternatives]))
        return events, logp


def edit_align(reference, observed):
    """Global unit-cost phone edit alignment. Insertions/deletions remain visible.

    Deterministic diagonal-first ties; ambiguous repeated labels need listening.
    No expected-label forced alignment or use of teacher times on student audio.
    """
    n, m = len(reference), len(observed)
    d = np.zeros((n+1, m+1), dtype=int)
    d[:, 0] = np.arange(n+1); d[0, :] = np.arange(m+1)
    for i in range(1, n+1):
        for j in range(1, m+1):
            d[i, j] = min(d[i-1, j-1] + (reference[i-1] != observed[j-1]), d[i-1, j]+1, d[i, j-1]+1)
    ops = []; i, j = n, m
    while i or j:
        if i and j and d[i, j] == d[i-1, j-1] + (reference[i-1] != observed[j-1]):
            ops.append(dict(kind='match' if reference[i-1] == observed[j-1] else 'substitution', ref=i-1, student=j-1)); i-=1; j-=1
        elif i and d[i, j] == d[i-1, j]+1:
            ops.append(dict(kind='deletion', ref=i-1, student=None)); i-=1
        else:
            ops.append(dict(kind='insertion', ref=None, student=j-1)); j-=1
    return list(reversed(ops)), int(d[n, m])


def validate_review(review, reference, phrase):
    """Only corrections attached to this exact extraction can change targets."""
    if review is None: return {}
    if not isinstance(review, dict) or review.get('reference_sha256') != reference['reference_sha256']:
        raise ValueError('Sound review belongs to a different extraction.')
    corrections = review.get('words', {})
    if not isinstance(corrections, dict) or set(corrections) - set(reference['words']):
        raise ValueError('Unknown sound-review occurrence ID.')
    inventory = set(reference['inventory']) - {'<s>', '</s>', '<pad>', '<unk>'}
    for key, item in corrections.items():
        if not isinstance(item, dict) or not isinstance(item.get('reviewed'), bool): raise ValueError('Invalid review flag.')
        if not isinstance(item.get('notes', ''), str) or len(item.get('notes', '')) > 4000: raise ValueError('Invalid review notes.')
        value = item.get('corrected_labels', None)
        if value is not None and (not isinstance(value, list) or not value or len(value) > 80 or any(not isinstance(v, str) or v not in inventory for v in value)):
            raise ValueError('Correction uses an unsupported phone label. Keep it as an ordinary-language note for review.')
    return corrections


def compare(model, samples, reference, phrase, review=None):
    corrections = validate_review(review, reference, phrase)
    q = quality(samples)
    base = dict(schema_version=1, model=reference['model'], reference_sha256=reference['reference_sha256'],
                phrase_id=phrase['id'], quality=q, experimental=True, calibrated=False,
                pronunciation_score=None, practice_threshold=None)
    if not q['usable']:
        return dict(base, status='re_record', message=' '.join(q['reasons']), words=[], events=[], operations=[])
    events, logp = model.infer(samples)
    expected = []; word_targets = {}
    for wid in phrase['word_ids']:
        draft = reference['words'][wid]
        correction = corrections.get(wid, {})
        labels = correction.get('corrected_labels') if correction.get('reviewed') else None
        labels = labels if labels is not None else draft['extracted_labels']
        word_targets[wid] = dict(labels=labels, reviewed=correction.get('reviewed', False),
                                 corrected=correction.get('reviewed', False) and correction.get('corrected_labels') is not None)
        expected.extend(dict(label=l, word_id=wid) for l in labels)
    if not expected or any(not t['labels'] or '<unk>' in t['labels'] for t in word_targets.values()) or len(events) < 2:
        return dict(base, status='uncertain', message='Too little phone evidence. Replay and re-record; no grade assigned.', words=[], events=events, operations=[])
    if float(np.mean([e['posterior'] for e in events])) < .35 or sum(e['label']=='<unk>' for e in events) > len(events)*.1:
        return dict(base, status='uncertain', message='The recognizer has weak sound evidence. Check audio and retry; no grade assigned.', words=[], events=events, operations=[])
    ops, distance = edit_align([e['label'] for e in expected], [e['label'] for e in events])
    coverage = sum(op['kind'] == 'match' for op in ops) / max(len(expected), len(events))
    # Extreme sequence disagreement is not reliable word localization.
    localized = distance / max(len(expected), len(events)) <= .65
    for oi, op in enumerate(ops):
        ri, sj = op['ref'], op['student']
        op['expected'] = expected[ri]['label'] if ri is not None else None
        op['observed'] = events[sj]['label'] if sj is not None else None
        # Insertion ownership is explicitly approximate (nearest reference on edit path).
        owner = ri
        if owner is None:
            neighbours = [o['ref'] for o in ops[oi+1:] if o['ref'] is not None]
            owner = neighbours[0] if neighbours else len(expected)-1
        op['word_id'] = expected[owner]['word_id']
        op['localization'] = 'approximate' if ri is None else 'edit_path'
        op['student_start'] = events[sj]['start'] if sj is not None else None
        op['student_end'] = events[sj]['end'] if sj is not None else None
        op['expected_posterior'] = op['log_odds_expected_vs_best_alternative'] = None
        if ri is not None and sj is not None:
            event = events[sj]; token = model.vocab.get(op['expected'])
            if token is not None:
                probs = np.exp(logp[event['start_frame']:event['end_frame']]).mean(0)
                competitors = probs.copy(); competitors[[0, 1, 2, token]] = 0
                best = int(competitors.argmax())
                op['expected_posterior'] = float(probs[token])
                op['best_alternative'] = model.inverse[best]
                op['log_odds_expected_vs_best_alternative'] = float(np.log(max(probs[token], 1e-9)/max(competitors[best], 1e-9)))
    reports = []
    for wid in phrase['word_ids']:
        subset = [op for op in ops if op['word_id'] == wid]
        spans = [events[op['student']] for op in subset if op['student'] is not None]
        values = [op['expected_posterior'] for op in subset if op['expected_posterior'] is not None]
        counts = {kind: sum(op['kind'] == kind for op in subset) for kind in ['match', 'substitution', 'deletion', 'insertion']}
        edits = counts['substitution'] + counts['deletion'] + counts['insertion']
        denominator = max(len(word_targets[wid]['labels']), len(spans), 1)
        draft = reference['words'][wid]
        reports.append(dict(word_id=wid, text=draft['text'], target=word_targets[wid], counts=counts,
                            phone_label_agreement_index=round(100*max(0, 1-edits/denominator), 1),
                            mean_expected_emission_posterior=float(np.mean(values)) if values else None,
                            weakest_expected_emission_posterior=min(values) if values else None,
                            student_start=max(0, min(e['start'] for e in spans)-.12) if spans else None,
                            student_end=min(len(samples)/SR, max(e['end'] for e in spans)+.12) if spans else None,
                            replay_is_approximate=True, operations=subset,
                            verdict='review_difference' if localized and any(counts[k] for k in ['substitution', 'deletion', 'insertion']) else 'no_grade',
                            uncertainty=['Phone model has not been validated on Gurbani learner speech.',
                                         'Reference sounds/boundaries need listening.' if not word_targets[wid]['reviewed'] else 'Browser reviewer confirmation is not model validation.',
                                         'Repeated sounds can make edit-path localization ambiguous.']))
    return dict(base, status='experimental' if localized else 'uncertain',
                message='Compare possible word differences by listening. No calibrated pronunciation grade.' if localized else 'Phone sequences differ too much for reliable word feedback. Check the phrase and re-record; no grade assigned.',
                phone_sequence_agreement_index=round(100*max(0, 1-distance/max(len(expected), len(events))), 1) if localized else None,
                exact_phone_match_fraction=coverage, edit_distance=distance,
                index_definition='100 × (1 − phone edit distance / max sequence length). Model-label agreement, not pronunciation accuracy.',
                words=reports if localized else [], events=events, operations=ops,
                duration_note='No rate penalty. Long/short vowel labels stay distinct. CTC spikes cannot establish physical vowel length; duration diagnosis is disabled.')
