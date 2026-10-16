"""Contract/privacy tests. Synthetic labels are not pronunciation validation."""
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from backend.config import load_env
from backend.learner import definitions as module


def observations():
    return module.sign(dict(schema_version=1, status='ready', human_verified=False,
        audio=dict(sha256='a'*64, duration_seconds=1, sample_rate=16000, channels=1, encoding='pcm_s16le_wav'),
        extractor=dict(model='synthetic-test-model', revision='test', source='learner_audio_only'),
        limitations=['Synthetic test observations, not audio validation.'],
        events=[dict(id=f'sound-{i+1:03}', label=label, start=i*.1, end=i*.1+.04,
                     emission_posterior=.8, alternatives=[]) for i,label in enumerate(['s','aː'])]))


def description():
    return dict(summary='Synthetic description for a contract test.', groups=[dict(heard_word=None,
        grouping_note='Word identity is unknown.', sounds=[dict(event_id='sound-001', description='An s-like sound.',
        english_examples=[dict(word='sun', focus='s', accent_note='Approximate initial s in English.')],
        uncertainty_note='Recognizer guess.'), dict(event_id='sound-002', description='A long-vowel label.',
        english_examples=[], uncertainty_note='Physical duration is not measured.')])])


class DefinitionTests(unittest.TestCase):
    def test_event_identity_and_order_are_preserved(self):
        evidence=observations();result=module.validate_description(description(),evidence)
        sounds=result['groups'][0]['sounds']
        self.assertEqual([s['observed_label'] for s in sounds],['s','aː'])
        self.assertEqual(result['groups'][0]['timing_kind'],'approximate_emission_group')
        self.assertFalse(result['groups'][0]['human_verified'])
        for mutation in ['drop','reverse','invent','duplicate','grade']:
            bad=description();sounds=bad['groups'][0]['sounds']
            if mutation=='drop':sounds.pop()
            if mutation=='reverse':sounds.reverse()
            if mutation=='invent':sounds[0]['event_id']='invented'
            if mutation=='duplicate':sounds.append(copy.deepcopy(sounds[0]))
            if mutation=='grade':bad['score']=100
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):
                module.validate_description(bad,evidence)

    def test_english_example_focus_must_exist(self):
        bad=description();bad['groups'][0]['sounds'][0]['english_examples'][0]['focus']='zzz'
        with self.assertRaises(ValueError):module.validate_description(bad,observations())

    def test_consent_and_evidence_before_provider(self):
        with patch.object(module,'call_claude') as call:
            with self.assertRaises(ValueError):module.describe(dict(evidence=observations()))
            edited=observations();edited['events'][0]['label']='t'
            with self.assertRaises(ValueError):module.describe(dict(evidence=edited,consent_to_external_processing=True))
            call.assert_not_called()
        old=observations()
        with patch.object(module,'SIGNING_KEY',b'another-server-process'),self.assertRaises(ValueError):module.verify(old)

    def test_missing_key_does_not_call_provider(self):
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':''}),patch.object(module,'call_claude') as call:
            with self.assertRaisesRegex(RuntimeError,'ANTHROPIC_API_KEY'):
                module.describe(dict(evidence=observations(),consent_to_external_processing=True))
            call.assert_not_called()

    def test_provider_gets_only_allowlisted_observations(self):
        evidence=observations();preview=module.provider_observations(evidence)
        text=json.dumps(preview)
        for forbidden in ['audio_base64','sha256','integrity','emission_posterior','synthetic-test-model']:
            self.assertNotIn(forbidden,text)
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-only-not-a-real-key'}),patch.object(module,'call_claude',return_value=(description(),'test-claude',{})) as call:
            result=module.describe(dict(evidence=evidence,consent_to_external_processing=True))
        self.assertEqual(call.call_args.args[0],preview)
        self.assertFalse(result['privacy']['audio_uploaded'])
        self.assertFalse(result['provenance']['describer']['heard_audio'])
        self.assertEqual(result['artifact_type'],'learner_pronunciation_definition')
        self.assertNotIn('score',result)

    def test_actual_http_payload_shape_and_truncation(self):
        class Response(io.BytesIO):
            def __enter__(self):return self
            def __exit__(self,*args):self.close()
        response=dict(stop_reason='end_turn',model='test-model',usage={},content=[dict(type='text',text=json.dumps(description()))])
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-only-not-a-real-key','ANTHROPIC_MODEL':'test-model'}),patch.object(module.urllib.request,'urlopen',return_value=Response(json.dumps(response).encode())) as call:
            value,model,_=module.call_claude(module.provider_observations(observations()))
            req=call.call_args.args[0];payload=json.loads(req.data)
            self.assertEqual(req.full_url,'https://api.anthropic.com/v1/messages')
            self.assertEqual(payload['model'],'test-model');self.assertEqual(value,description())
            self.assertNotIn('input_audio',req.data.decode());self.assertNotIn('audio_base64',req.data.decode())
        response['stop_reason']='max_tokens'
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-key'}),patch.object(module.urllib.request,'urlopen',return_value=Response(json.dumps(response).encode())),self.assertRaisesRegex(RuntimeError,'did not finish'):
            module.call_claude({})

    def test_upstream_error_does_not_echo_sensitive_body(self):
        error=urllib.error.HTTPError('https://api.anthropic.com/v1/messages',401,'Unauthorized',{},io.BytesIO(b'secret request data'))
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'secret-key'}),patch.object(module.urllib.request,'urlopen',side_effect=error),self.assertRaises(RuntimeError) as raised:
            module.call_claude({})
        self.assertNotIn('secret',str(raised.exception))
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'secret\nkey'}),patch.object(module.urllib.request,'urlopen') as call,self.assertRaises(RuntimeError) as invalid:
            module.call_claude({})
        self.assertNotIn('secret',str(invalid.exception));call.assert_not_called()

    def test_env_file_is_data_and_process_env_wins(self):
        with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'ANTHROPIC_MODEL':'already-set'}):
            path=Path(folder)/'.env';path.write_text('ANTHROPIC_MODEL=from-file\nANTHROPIC_API_KEY="literal-$(echo test)"\n')
            with patch.dict(os.environ):
                os.environ.pop('ANTHROPIC_API_KEY',None);load_env(path)
                self.assertEqual(os.environ['ANTHROPIC_MODEL'],'already-set')
                self.assertEqual(os.environ['ANTHROPIC_API_KEY'],'literal-$(echo test)')


if __name__=='__main__':unittest.main()
