"""Create reviewable word estimates from cached acoustic logits and waveform energy."""
import hashlib, json, re, wave, os
from pathlib import Path
import numpy as np

root = Path(__file__).resolve().parents[1] / "data/reference"
raw = json.loads((root/'banidb-shabad-1.json').read_text(encoding='utf-8'))
evidence = json.loads((root.parent/'evidence/acoustic-evidence.json').read_text(encoding='utf-8'))
vocab_path = Path(os.environ['GURBANI_CTC_MODEL_DIR']) / 'vocab.json'
vocab = json.loads(vocab_path.read_text(encoding='utf-8'))['pan']
logits = np.load(root.parent/'evidence/acoustic-logits.npy')
logp = logits - np.logaddexp.reduce(logits, axis=1)[:,None]
entries = [dict(id='prefix-01',text='ਸਾਹਿਬੁ',acoustic='ਸਾਹਿਬੁ'),dict(id='prefix-02',text='ਜੀਉ',acoustic='ਜੀਉ')]
verses=[]
for verse in raw['verses'][:4]:
    text=verse['verse']['unicode']; words=[]
    for match in re.finditer(r'\S+',text):
        token=match.group()
        if not any('\u0a00' <= c <= '\u0a75' and not '\u0a66' <= c <= '\u0a6f' for c in token): continue
        word=dict(id=f"v{verse['verseId']}-w{len(words)+1:02}",verse_id=verse['verseId'],word_index=len(words)+1,text=token,source_start=match.start(),source_end=match.end())
        words.append(word); entries.append(dict(word,acoustic='ਇਕੁ ਓ ਅੰਕਾਰ' if token=='ੴ' else token))
    verses.append(dict(verse_id=verse['verseId'],shabad_id=verse['shabadId'],text=text,words=words))
# Viterbi over standard CTC blank/label states. Reference punctuation is not speech.
labels=[]; label_ranges=[]
for entry in entries:
    if labels: labels.append(vocab['|'])
    start=len(labels); labels.extend(vocab[c] for c in entry['acoustic'].replace(' ','|')); label_ranges.append((start,len(labels)))
blank=62; states=np.full(len(labels)*2+1,blank,dtype=int);states[1::2]=labels
T,S=len(logp),len(states)
previous=np.full(S,-np.inf);previous[0]=logp[0,blank];previous[1]=logp[0,labels[0]]
back=np.zeros((T,S),dtype=np.int8)
skip=(states!=blank)&(states!=np.roll(states,2));skip[:2]=False
for t in range(1,T):
    options=np.stack((previous,np.r_[-np.inf,previous[:-1]],np.r_[-np.inf,-np.inf,previous[:-2]]))
    options[2,~skip]=-np.inf
    choice=options.argmax(0);back[t]=choice
    previous=options[choice,np.arange(S)]+logp[t,states]
state=S-1 if previous[-1]>previous[-2] else S-2
path=np.zeros(T,dtype=int);path[-1]=state
for t in range(T-1,0,-1):state-=int(back[t,state]);path[t-1]=state
with wave.open(str(root/'snippet-analysis.wav')) as wav:
    samples=np.frombuffer(wav.readframes(wav.getnframes()),dtype=np.int16).astype(float)/32768
hop=160
energy=np.sqrt(np.mean(np.pad(samples,(0,(-len(samples))%hop)).reshape(-1,hop)**2,axis=1))
# Quiet runs help trim pauses while keeping the full vowel decay, rather than CTC spikes alone.
duration=30.754875
cores=[]
for entry,(first,last) in zip(entries,label_ranges):
    frames=np.where((path>=first*2+1)&(path<=(last-1)*2+1))[0]
    cores.append((frames[0]*.02,frames[-1]*.02+.025))
for i,entry in enumerate(entries):
    cs,ce=cores[i]
    left=0 if i==0 else (cores[i-1][1]+cs)/2
    right=duration if i==len(entries)-1 else (ce+cores[i+1][0])/2
    # Search silence from nearby phonetic evidence; no equal-duration assignment.
    lo=max(left,cs-.25);hi=min(right,ce+.6)
    local=energy[int(lo*100):int(hi*100)+1]
    threshold=max(.003,float(np.max(local))*.07)
    active=np.where(local>threshold)[0]
    onset=lo+active[0]/100 if len(active) else cs
    offset=lo+(active[-1]+1)/100 if len(active) else ce
    entry.update(start=round(max(left,min(onset,cs-.04)),3),end=round(min(right,max(offset,ce)),3),status='aligned',reviewed=False,confidence='estimated',boundary_uncertainty_seconds=.15,acoustic_core_start=round(cs,3),acoustic_core_end=round(ce,3))
    if entry['text']=='ੴ':entry['note']='One source symbol, spoken as multiple syllables (ik onkaar). Whole symbol is one clickable source occurrence.'
    elif entry['text']=='ਜਪੁ':entry['note']='Reference spelling preserved. Greedy ASR returned ਜਪਿ; listen to this boundary and pronunciation.'
    elif i==0:entry['note']='Opening word begins at the clip edge and may be cut in. Not part of the four requested source verses.'
    elif entry['id'].startswith('prefix'):entry['note']='Additional opening speech identified by ASR; not authoritative BaniDB verse text. Needs human confirmation.'
    else:entry['note']='Unreviewed CTC alignment plus waveform-energy estimate; boundaries may include reverb or neighbouring phonemes.'
    for verse in verses:
        for word in verse['words']:
            if word['id']==entry['id']:word.update({k:v for k,v in entry.items() if k not in ['acoustic']})
out=dict(schema_version=1,source=dict(url='https://api.banidb.com/v2/shabads/1',response_file='banidb-shabad-1.json',response_sha256=hashlib.sha256((root/'banidb-shabad-1.json').read_bytes()).hexdigest(),selection='verses[0:4]',unicode_field='verse.unicode',offset_unit='Unicode code points; end exclusive'),audio=dict(file='snippet.mov',playback_file='recording.wav',sha256=hashlib.sha256((root/'snippet.mov').read_bytes()).hexdigest(),duration_seconds=duration,playback_note='PCM WAV decoded from snippet.mov without trimming; same timeline, no TTS.'),alignment=dict(method='Offline Gurbani Wav2Vec2 CTC greedy coverage check, then reference-constrained CTC Viterbi alignment with waveform-energy pause trimming.',model=evidence['model'],frame_stride_seconds=.02,review_status='See per-word reviewed flags (false initially). Confidence labels are qualitative, not calibrated probabilities.',limitations='Coverage is model-supported, not confirmed by a human listener. Coarticulation, held vowels, room reverb and CTC spikes can shift boundaries. Approximate uncertainty is ±0.15 s and may be greater. Do not treat these as gold labels.',evidence_file='acoustic-evidence.json'),coverage=dict(summary='Model-supported coverage: all 25 source word occurrences in the four verses. Extra opening speech: ਸਾਹਿਬੁ ਜੀਉ. All boundaries await human review.',first_source_word_start=entries[2]['start'],last_source_word_end=entries[-1]['end'],outside_audio_word_ids=[],unmatched_audio=entries[:2],punctuation='Danda and verse numbers are preserved in verse text and are not assigned spoken-word timings.'),verses=verses)
(root/'word-timings.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
for e in entries:print(e['id'],e['text'],e['start'],e['end'],e['acoustic_core_start'],e['acoustic_core_end'])
