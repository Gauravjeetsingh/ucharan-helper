"""Audit real worksheet/evidence pairs without fabricating calibration labels."""
import argparse
from collections import Counter
import json
from pathlib import Path
import numpy as np


def rates(rows):
    tp=sum(actual and flag for actual,flag in rows);fp=sum(not actual and flag for actual,flag in rows)
    fn=sum(actual and not flag for actual,flag in rows);tn=sum(not actual and not flag for actual,flag in rows)
    ratio=lambda a,b:a/b if b else None
    return dict(n=len(rows),tp=tp,fp=fp,fn=fn,tn=tn,precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),
                f1=ratio(2*tp,2*tp+fp+fn),false_positive_rate=ratio(fp,fp+tn))


def main():
    parser=argparse.ArgumentParser();parser.add_argument('directory',nargs='?',default='evaluation/private')
    args=parser.parse_args();directory=Path(args.directory);files=sorted(directory.glob('ratings-*.json'))
    speakers={};seen=set();counts=Counter();pairs=[];abstained=0;grouped={};versions=set();blind=Counter()
    for file in files:
        sheet=json.loads(file.read_text(encoding='utf-8'));speaker=sheet['speaker_id'];split=sheet['split'];attempt=sheet['attempt_id']
        if split not in ['calibration','evaluation']:raise ValueError('Unknown split')
        if not speaker or not attempt:raise ValueError('Missing speaker or attempt identity')
        if speaker in speakers and speakers[speaker]!=split:raise ValueError(f'Speaker leakage across splits: {speaker}')
        speakers[speaker]=split
        if attempt in seen:raise ValueError('Duplicate attempt worksheet')
        seen.add(attempt);counts[split]+=1;blind[str(sheet.get('blind_rating'))]+=1
        versions.add(sheet['reference_sha256'])
        evidence_name=sheet.get('model_evidence_file')
        if not evidence_name:continue
        if Path(evidence_name).name!=evidence_name:raise ValueError('Evidence must be beside worksheet')
        path=directory/evidence_name
        if not path.exists():continue
        evidence=json.loads(path.read_text(encoding='utf-8'))
        if evidence.get('attempt_id')!=attempt or evidence.get('reference_sha256')!=sheet['reference_sha256'] or evidence['phrase_id']!=sheet['phrase_id'] or evidence.get('audio_sha256')!=sheet['audio_sha256']:
            raise ValueError('Mismatched evidence/worksheet identity')
        words={w['word_id']:w for w in evidence['words']}
        for rating in sheet['ratings']:
            if rating.get('heard') not in ['acceptable','needs_practice']:continue
            if rating['word_id'] not in words:abstained+=1;continue
            # This evaluates the raw difference flag, not a calibrated practice verdict.
            word=words[rating['word_id']];actual=rating['heard']=='needs_practice'
            flag=any(word['counts'][k]>0 for k in ['substitution','deletion','insertion'])
            pairs.append((actual,flag));grouped.setdefault(speaker,[]).append((actual,flag))
    if len(versions)>1:raise ValueError('Mixed reference extractions; evaluate separately')
    ci={}
    if len(grouped)>=3:
        rng=np.random.default_rng(0);keys=list(grouped);samples=[]
        for _ in range(1000):samples.append(rates([row for key in rng.choice(keys,len(keys),replace=True) for row in grouped[key]]))
        for metric in ['precision','recall','f1','false_positive_rate']:
            values=[s[metric] for s in samples if s[metric] is not None]
            if values:ci[metric]=np.percentile(values,[2.5,97.5]).tolist()
    print(json.dumps(dict(status='pending_human_data' if not files else 'uncalibrated_audit',
        worksheets=len(files),speakers=len(speakers),attempts_by_split=dict(counts),blind_ratings=dict(blind),
        raw_difference_flag_metrics=rates(pairs),speaker_bootstrap_95_ci=ci,abstained_rated_words=abstained,
        calibrated=False,pronunciation_score_mapping=None,practice_threshold=None,
        limitation='Raw model-difference flags only. This does not establish sound diagnosis, ordinal rating agreement, or pronunciation accuracy. See PROTOCOL.md for required held-out evaluation.'),indent=2))


if __name__=='__main__':main()
