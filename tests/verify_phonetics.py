"""Meaningful guards for indels, length contrasts, audio rejection, and provenance."""
import json
import unittest
import numpy as np
from backend.learn.phone_engine import ROOT, SR, compare, edit_align, quality, validate_review


class EvidenceTests(unittest.TestCase):
    def test_indels_not_forced(self):
        ops, distance=edit_align(['s','a','t','n','aː','m'],['s','a','n','aː','m','k'])
        self.assertEqual(distance,2)
        self.assertEqual([o['kind'] for o in ops],['match','match','deletion','match','match','match','insertion'])

    def test_vowel_length_not_normalized_away(self):
        ops,distance=edit_align(['n','aː','m'],['n','a','m'])
        self.assertEqual(distance,1);self.assertEqual(ops[1]['kind'],'substitution')

    def test_capture_gate(self):
        self.assertFalse(quality(np.zeros(SR,dtype=np.float32))['usable'])
        self.assertFalse(quality(np.ones(SR,dtype=np.float32))['usable'])
        self.assertFalse(quality(np.full(SR,.1,dtype=np.float32))['usable'])
        self.assertFalse(quality(np.zeros(100,dtype=np.float32))['usable'])
        # Ordinary nonclipped signal is not rejected merely for differing duration.
        for duration in [1,2,3]:
            x=(.1*np.sin(np.arange(SR*duration)*2*np.pi*220/SR)).astype(np.float32)
            self.assertTrue(quality(x)['usable'])

    def test_review_bound_to_extraction_and_inventory(self):
        reference=dict(reference_sha256='abc',words={'v1-w02':{}},inventory=['s','a','t'])
        valid=dict(reference_sha256='abc',words={'v1-w02':dict(corrected_labels=['s','a'],notes='listen here',reviewed=True)})
        validate_review(valid,reference,{})
        with self.assertRaises(ValueError):validate_review(dict(valid,reference_sha256='old'),reference,{})
        valid['words']['v1-w02']['corrected_labels']=['a̤']
        with self.assertRaises(ValueError):validate_review(valid,reference,{})

    def test_existing_source_identity(self):
        if not (ROOT/'reference-phones.json').exists():self.skipTest('Extraction not generated yet')
        reference=json.loads((ROOT/'reference-phones.json').read_text(encoding='utf-8'));timing=json.loads((ROOT/'word-timings.json').read_text(encoding='utf-8'))
        words={w['id']:w for v in timing['verses'] for w in v['words']}
        self.assertEqual(set(reference['words']),set(words))
        for wid,word in reference['words'].items():
            self.assertEqual(word['text'],words[wid]['text']);self.assertFalse(word['reviewed'])
            self.assertEqual((word['start'],word['end']),(words[wid]['start'],words[wid]['end']))
            self.assertTrue(all(label in reference['inventory'] for label in word['extracted_labels']))
        self.assertEqual(reference['words']['v1-w01']['text'],'ੴ')
        self.assertFalse(reference['human_verified'])

    def test_acoustic_comparison_and_rate_independence(self):
        # Controlled posteriors test the comparison algorithm, not model accuracy.
        labels=['s','a','t','n','aː','m'];observed=['s','a','n','aː','m','k']
        vocab={label:i+4 for i,label in enumerate(sorted(set(labels+observed)))}
        class Model:
            inverse={3:'<unk>',**{v:k for k,v in vocab.items()}}
            def infer(self,samples):
                probs=np.full((len(observed),len(vocab)+4),.001,dtype=float)
                events=[]
                for i,label in enumerate(observed):
                    probs[i,vocab[label]]=.95;events.append(dict(label=label,start=i*.1,end=i*.1+.04,start_frame=i,end_frame=i+1,posterior=.95))
                probs/=probs.sum(1,keepdims=True)
                return events,np.log(probs)
        model=Model();model.vocab=vocab
        reference=dict(model='test',reference_sha256='abc',words={'one':dict(text='one',extracted_labels=labels[:3]),'two':dict(text='two',extracted_labels=labels[3:])})
        phrase=dict(id='p',word_ids=['one','two'])
        reports=[]
        for duration in [1,2]:
            samples=(.1*np.sin(np.arange(SR*duration)*2*np.pi*220/SR)).astype(np.float32)
            reports.append(compare(model,samples,reference,phrase))
        self.assertEqual(reports[0]['phone_sequence_agreement_index'],reports[1]['phone_sequence_agreement_index'])
        self.assertIsNone(reports[0]['pronunciation_score'])
        deleted=next(o for o in reports[0]['operations'] if o['kind']=='deletion')
        self.assertIsNone(deleted['student_start']);self.assertIsNone(deleted['expected_posterior'])
        self.assertTrue(any(o['kind']=='insertion' for o in reports[0]['operations']))


if __name__=='__main__':unittest.main()
