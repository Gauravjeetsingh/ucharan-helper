"""Offline acoustic evidence; uses an existing local Gurbani CTC model, no uploads."""
import glob, json, wave, os
from pathlib import Path
import numpy as np
import torch
from transformers import Wav2Vec2ForCTC, Wav2Vec2FeatureExtractor

root = Path(__file__).resolve().parents[1] / "data/reference"
model_path = os.environ['GURBANI_CTC_MODEL_DIR']
with wave.open(str(root/'snippet-analysis.wav')) as f:
    samples = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768
torch.set_num_threads(6)
extractor = Wav2Vec2FeatureExtractor.from_pretrained(model_path, local_files_only=True)
model = Wav2Vec2ForCTC.from_pretrained(model_path, local_files_only=True).eval()
inputs = extractor(samples, sampling_rate=16000, return_tensors='pt')
with torch.inference_mode():
    logits = model(**inputs).logits[0].float().numpy()
np.save(root.parent/'evidence/acoustic-logits.npy', logits)
vocab = json.load(open(model_path+'/vocab.json'))['pan']
inverse = {v:k for k,v in vocab.items()}
ids = logits.argmax(-1)
groups = []
for i, token in enumerate(ids):
    if groups and groups[-1]['token_id'] == int(token):
        groups[-1]['end_frame'] = i+1
    else:
        groups.append(dict(token_id=int(token), token=inverse.get(int(token), '?'), start_frame=i, end_frame=i+1))
tokens = [dict(g, start=round(g['start_frame']*.02,3), end=round(g['end_frame']*.02+.005,3)) for g in groups if g['token_id'] != model.config.pad_token_id]
out = dict(model=model_path.split('models--')[1].split('/')[0].replace('--','/'), frame_stride_seconds=.02, receptive_field_seconds=.025, transcript=''.join(t['token'] for t in tokens).replace('|',' '), tokens=tokens)
(root.parent/'evidence/acoustic-evidence.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
print(out['transcript'], flush=True)
for t in tokens:
    print(t['start'],t['end'],t['token'], flush=True)
