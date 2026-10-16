"""Machine controls from SAME teacher audio. Not learner examples/human ratings."""
import json
from pathlib import Path
import wave
import numpy as np
from backend.learn.phone_engine import ROOT, SR, PhoneModel, compare


def save_wav(path,x):
    with wave.open(str(path),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR)
        f.writeframes((np.clip(x,-1,1)*32767).astype('<i2').tobytes())


def main():
    reference=json.loads((ROOT/'reference-phones.json').read_text(encoding='utf-8'))
    phrase=next(p for p in reference['phrases'] if p['id']==reference['default_phrase_id'])
    with wave.open(str(ROOT/'snippet-analysis.wav')) as f:
        samples=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float32)/32768
    out=ROOT.parent.parent/'evaluation/controls';out.mkdir(parents=True,exist_ok=True)
    a,b=round(phrase['context_start']*SR),round(phrase['context_end']*SR)
    identity=samples[a:b].copy();edited=identity.copy()
    second=reference['words'][phrase['word_ids'][1]]
    left=round((second['start']-phrase['context_start'])*SR)
    right=min(len(edited),round((second['end']+.1-phrase['context_start'])*SR))
    # Muting does not create a human pronunciation annotation.
    edited[left:right]=0
    model=PhoneModel();report=[]
    for name,audio in [('source-identity',identity),('source-second-word-muted',edited),('silence',np.zeros_like(identity))]:
        save_wav(out/f'{name}.wav',audio)
        result=compare(model,audio,reference,phrase)
        (out/f'{name}.evidence.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
        report.append(dict(name=name,kind='machine_source_control',human_rating=None,status=result['status'],
                           phone_sequence_agreement_index=result.get('phone_sequence_agreement_index'),
                           note='Not a learner or ustaad-rated correct/incorrect example.'))
    (out/'manifest.json').write_text(json.dumps(dict(phrase_id=phrase['id'],controls=report,human_validation=False),indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':main()
