"""Reproduce unconstrained audio-to-phone draft using existing occurrence IDs."""
import hashlib
import json
from pathlib import Path
import wave
import numpy as np
from backend.learn.phone_engine import ROOT, MODEL_ID, REVISION, WEIGHT_SHA256, PhoneModel, SR


def main():
    model = PhoneModel()
    weights = ROOT.parent.parent/'models/phone/pytorch_model.bin'
    digest = hashlib.file_digest(weights.open('rb'), 'sha256').hexdigest()
    if digest != WEIGHT_SHA256: raise ValueError('Pinned model checksum mismatch.')
    timing_bytes = (ROOT/'word-timings.json').read_bytes()
    timing = json.loads(timing_bytes)
    with wave.open(str(ROOT/'snippet-analysis.wav')) as f:
        assert f.getframerate() == SR and f.getnchannels() == 1 and f.getsampwidth() == 2
        samples = np.frombuffer(f.readframes(f.getnframes()), dtype='<i2').astype(np.float32)/32768
    # Full clip provides phrase context for mapping; no spelling input.
    full, logp = model.infer(samples)
    np.savez_compressed(ROOT.parent/'evidence/phone-logprobs.npz', log_probs=logp)
    raw = dict(model=MODEL_ID, revision=REVISION, frame_stride_seconds=.02,
               note='Unconstrained greedy CTC acoustic labels, not an ASR transcript converted to IPA.',
               audio_sha256=hashlib.sha256((ROOT/'snippet-analysis.wav').read_bytes()).hexdigest(),
               labels=[e['label'] for e in full], events=full)
    (ROOT/'phone-raw.json').write_text(json.dumps(raw, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    words = {}; phrases = []; context_arrays = {}
    # Short semantic groups within the one supplied recording.
    groups = [[('v1-w01',)], [('v1-w02','v1-w03'), ('v1-w04','v1-w05'), ('v1-w06','v1-w07'),
              ('v1-w08','v1-w09'), ('v1-w10','v1-w11'), ('v1-w12','v1-w13')],
              [('v2-w01',)], [('v3-w01','v3-w02'), ('v3-w03','v3-w04')],
              [('v4-w01','v4-w02','v4-w03'), ('v4-w04','v4-w05','v4-w06','v4-w07')]]
    flat = {w['id']: w for v in timing['verses'] for w in v['words']}
    for ids in [ids for group in groups for ids in group]:
        selected = [flat[i] for i in ids]
        start = max(0, selected[0]['start']-.3); end = min(len(samples)/SR, selected[-1]['end']+.3)
        # Recognize with context, then map emission centers; do not crop each word.
        context_events, context_logp = model.infer(samples[round(start*SR):round(end*SR)], offset=start)
        pid = 'phrase-' + ids[0]
        context_arrays[pid] = context_logp
        phrases.append(dict(id=pid, text=' '.join(w['text'] for w in selected), word_ids=list(ids),
                            start=selected[0]['start'], end=selected[-1]['end'], context_start=start, context_end=end,
                            context_events=context_events))
        for w in selected:
            def inside(e): return w['start'] <= (e['start']+e['end'])/2 < w['end']
            events = [e for e in context_events if inside(e)]
            full_labels = [e['label'] for e in full if inside(e)]
            labels = [e['label'] for e in events]
            boundary = any(min(abs((e['start']+e['end'])/2-w['start']),abs((e['start']+e['end'])/2-w['end'])) < .15 for e in events)
            words[w['id']] = dict(text=w['text'], start=w['start'], end=w['end'], extracted_labels=labels,
                                  full_context_labels=full_labels, events=events, reviewed=False,
                                  uncertainty=dict(context_disagreement=labels != full_labels, near_word_boundary=boundary,
                                                   human_verified=False, boundary_timings_reviewed=w['reviewed']),
                                  note='Audio-derived draft. Word mapping reuses unreviewed timing estimates. Label identity and physical sound boundaries need listening.')
    np.savez_compressed(ROOT.parent/'evidence/phone-context-logprobs.npz', **context_arrays)
    inventory = list(model.vocab)
    probes = {'short_long_vowels':['i','iː','u','uː','a','aː'],
              'dental_retroflex':['t̪','d̪','ʈ','ɖ','ɳ','ɽ'],
              'aspiration':['k','kʰ','p','pʰ','tʰ','t̪ʰ','ʈʰ','bʰ','dʰ','ɡʰ'],
              'nasal_vowels':['ɑ̃','ɔ̃','ũ','ĩ','ã'], 'nasals':['m','n','ŋ','ɳ'],
              'gemination':['pː','tː','kː'], 'tone_or_breathy_quality':['˥','˩','a̤','ə̤']}
    audit = {name:dict(present=[p for p in labels if p in inventory],missing=[p for p in labels if p not in inventory]) for name,labels in probes.items()}
    result = dict(schema_version=1, model=dict(id=MODEL_ID, revision=REVISION, weights_sha256=digest,
                    license='Apache-2.0', input='16 kHz mono', loading_info=model.loading_info,
                    checkpoint_compatibility='Original weight_g/weight_v renamed to torch parametrizations; all keys required to load.',
                    provenance='Direct acoustic phonetic CTC head; no G2P or ASR-spelling target.'),
                  timing_sha256=hashlib.sha256(timing_bytes).hexdigest(), audio_sha256=raw['audio_sha256'],
                  inventory=inventory, inventory_audit=audit, words=words, phrases=phrases,
                  default_phrase_id='phrase-v1-w02', human_verified=False,
                  limitations=['Inventory presence does not demonstrate recognition accuracy.',
                               'Several eSpeak-derived labels are not standard IPA; preserve raw model symbols.',
                               'Tone/breathy quality and some contrast combinations have no dedicated label.',
                               'CTC emissions are not sound-duration measurements. No vowel length timing diagnosis.',
                               'Context-dependent predictions and estimated word boundaries limit localization.'])
    # Stable content identity protects browser reviews from stale extraction.
    result['reference_sha256'] = hashlib.sha256(json.dumps(result,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    (ROOT/'reference-phones.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
    print(json.dumps(dict(words=len(words), phrases=len(phrases), context_disagreements=sum(w['uncertainty']['context_disagreement'] for w in words.values()),labels=raw['labels']),ensure_ascii=False))


if __name__ == '__main__': main()
