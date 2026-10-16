"""Local acoustic evidence -> Claude English descriptions. Claude receives no audio.

No source text, expected phones, teacher recording, score, or G2P is used here.
Evidence stays in the browser between stages. A process-local HMAC prevents the
description endpoint from accepting edited evidence as a fresh model extraction.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timezone

from ..paths import ROOT

DEFAULT_MODEL = 'claude-sonnet-5-5'
PROMPT_PATH = Path(__file__).with_name('describe.prompt.txt')
SIGNING_KEY = secrets.token_bytes(32)
MAX_EVENTS = 128


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def configuration():
    return dict(provider='anthropic', model=os.environ.get('ANTHROPIC_MODEL') or DEFAULT_MODEL,
                configured=bool(os.environ.get('ANTHROPIC_API_KEY', '').strip()),
                acoustic_model_present=(ROOT/'models/phone/pytorch_model.bin').is_file(),
                audio_sent_to_provider=False, sends='acoustic sound labels and approximate emission timings',
                stores_student_audio=False)


def sign(evidence):
    return dict(evidence, integrity=hmac.new(SIGNING_KEY, canonical(evidence), hashlib.sha256).hexdigest())


def verify(evidence):
    if not isinstance(evidence, dict): raise ValueError('Extract sounds locally before requesting definitions.')
    raw = {k: v for k, v in evidence.items() if k != 'integrity'}
    signature = evidence.get('integrity')
    if not isinstance(signature, str) or not hmac.compare_digest(signature, hmac.new(SIGNING_KEY, canonical(raw), hashlib.sha256).hexdigest()):
        raise ValueError('Sound evidence changed or the server restarted. Extract sounds locally again.')
    if evidence['status'] != 'ready' or not evidence['events']:
        raise ValueError('This recording has insufficient sound evidence. Re-record before requesting definitions.')
    return evidence


def extract(raw, model=None):
    # Lazy ML imports keep all feature routes usable with standard-library Python.
    from ..learn.phone_engine import MODEL_ID, REVISION, PhoneModel, quality, read_wav
    samples = read_wav(raw)
    capture = quality(samples)
    evidence = dict(schema_version=1, artifact_type='learner_acoustic_observations',
                    audio=dict(sha256=hashlib.sha256(raw).hexdigest(), duration_seconds=len(samples)/16000,
                               sample_rate=16000, channels=1, encoding='pcm_s16le_wav'),
                    extractor=dict(model=MODEL_ID, revision=REVISION, source='learner_audio_only'),
                    quality=capture, human_verified=False, events=[], status='re_record',
                    limitations=['Automatic acoustic guesses, not verified pronunciations.',
                                 'Emission timings are approximate and do not measure physical sound length.',
                                 'No teacher audio, expected scripture text, or target sound sequence was supplied.'])
    if not capture['usable']: return sign(evidence), model
    model = model or PhoneModel()
    events, _ = model.infer(samples)
    evidence['events'] = [dict(id=f'sound-{i+1:03}', label=e['label'], start=e['start'], end=e['end'],
                               emission_posterior=e['posterior'], alternatives=e['alternatives']) for i, e in enumerate(events)]
    if not 2 <= len(events) <= MAX_EVENTS:
        evidence['status'] = 'uncertain'
        evidence['limitations'].append('Too few or too many sound events for a reliable short-phrase description. Try a shorter, clear phrase.')
    elif sum(e['posterior'] for e in events)/len(events) < .35 or any(e['label'].startswith('<') for e in events):
        evidence['status'] = 'uncertain'
        evidence['limitations'].append('Weak or unknown sound labels; descriptions are withheld. Re-record.')
    else: evidence['status'] = 'ready'
    return sign(evidence), model


def provider_observations(evidence):
    """Allowlist text-only evidence; never forward WAV/base64, hashes, notes, or paths."""
    return dict(task='Describe observed learner sounds; do not judge correctness.',
                events=[dict(event_id=e['id'], observed_label=e['label'],
                             approximate_start=e['start'], approximate_end=e['end']) for e in evidence['events']],
                limitations=evidence['limitations'])


def text_field(value, name, limit=600, nullable=False):
    if nullable and value is None: return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f'Claude returned an invalid {name}. No definition was accepted.')
    return value.strip()


def validate_description(value, evidence):
    """Reject invented/dropped/reordered sound events and invalid English examples."""
    if not isinstance(value, dict) or set(value) != {'summary', 'groups'}:
        raise ValueError('Claude returned an unexpected definition format. No definition was accepted.')
    summary = text_field(value['summary'], 'summary', 1200)
    groups = value['groups']
    if not isinstance(groups, list) or not 1 <= len(groups) <= len(evidence['events']):
        raise ValueError('Claude returned invalid sound groups.')
    sequence = []; clean = []
    events = {event['id']: event for event in evidence['events']}
    for group in groups:
        if not isinstance(group, dict) or set(group) != {'heard_word', 'grouping_note', 'sounds'}:
            raise ValueError('Claude returned an unexpected word-group format.')
        heard = text_field(group['heard_word'], 'heard word', 100, nullable=True)
        note = text_field(group['grouping_note'], 'grouping note', 600)
        sounds = group['sounds']
        if not isinstance(sounds, list) or not sounds: raise ValueError('Claude returned an empty sound group.')
        clean_sounds = []
        for sound in sounds:
            required = {'event_id', 'description', 'english_examples', 'uncertainty_note'}
            if not isinstance(sound, dict) or set(sound) != required: raise ValueError('Claude returned an unexpected sound format.')
            event_id = sound['event_id']
            if not isinstance(event_id, str) or event_id not in events: raise ValueError('Claude invented a sound event. No definition was accepted.')
            sequence.append(event_id)
            description = text_field(sound['description'], 'sound description', 600)
            uncertainty = text_field(sound['uncertainty_note'], 'uncertainty note', 600)
            examples = sound['english_examples']
            if not isinstance(examples, list) or len(examples) > 2: raise ValueError('Claude returned invalid English examples.')
            clean_examples = []
            for example in examples:
                if not isinstance(example, dict) or set(example) != {'word', 'focus', 'accent_note'}:
                    raise ValueError('Claude returned an invalid English example.')
                word = text_field(example['word'], 'English example word', 60)
                focus = text_field(example['focus'], 'English example sound', 30)
                if focus.lower() not in word.lower(): raise ValueError('English highlight was not part of its example word.')
                clean_examples.append(dict(word=word, focus=focus, accent_note=text_field(example['accent_note'], 'accent note', 300)))
            event = events[event_id]
            clean_sounds.append(dict(event_id=event_id, observed_label=event['label'], description=description,
                                     english_examples=clean_examples, uncertainty_note=uncertainty))
        clean.append(dict(heard_word=heard, grouping_note=note, sounds=clean_sounds,
                          # An estimated replay window, never a claimed gold word boundary.
                          start=max(0, events[sounds[0]['event_id']]['start']-.12),
                          end=min(evidence['audio']['duration_seconds'], events[sounds[-1]['event_id']]['end']+.12),
                          timing_kind='approximate_emission_group', human_verified=False))
    if sequence != [e['id'] for e in evidence['events']]:
        raise ValueError('Claude dropped, repeated, or reordered extracted sounds. No definition was accepted.')
    return dict(summary=summary, groups=clean)


def call_claude(observations):
    config = configuration()
    if not config['configured']:
        raise RuntimeError('Set ANTHROPIC_API_KEY in the local .env file, then restart the server. Never paste the key into this page.')
    api_key = os.environ['ANTHROPIC_API_KEY'].strip()
    if not api_key.isascii() or any(ord(char) < 33 or ord(char) > 126 for char in api_key) or len(api_key) > 4096:
        raise RuntimeError('The local Claude API key contains invalid characters. Check .env; the key is never shown in an error.')
    payload = dict(model=config['model'], max_tokens=8192, system=PROMPT_PATH.read_text(encoding='utf-8'),
                   messages=[dict(role='user', content=json.dumps(observations, ensure_ascii=False))])
    request = urllib.request.Request('https://api.anthropic.com/v1/messages',
                  data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), method='POST',
                  headers={'Content-Type': 'application/json', 'x-api-key': api_key,
                           'anthropic-version': '2023-06-01'})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read(1_000_001)
        if len(raw) > 1_000_000: raise RuntimeError('Claude response was too large. Try a shorter phrase.')
        value = json.loads(raw)
    except urllib.error.HTTPError as error:
        # Upstream bodies may contain request data. Do not log or echo them.
        messages = {401: 'Claude rejected the local API key.', 403: 'This Claude model is not available to this API key.',
                    404: 'Claude model not found. Check ANTHROPIC_MODEL in .env.', 429: 'Claude is rate limited or out of available credits. Try later.'}
        raise RuntimeError(messages.get(error.code, f'Claude request failed (HTTP {error.code}). No definition was accepted.')) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError('Could not reach Claude. Check the network and try again; no automatic retry was made.') from None
    except (ValueError, UnicodeError):
        raise RuntimeError('Claude returned an unreadable response. No definition was accepted.') from None
    if not isinstance(value, dict) or value.get('stop_reason') != 'end_turn':
        raise RuntimeError('Claude did not finish the definition. Try a shorter phrase; no partial definition was accepted.')
    blocks = value.get('content', [])
    if not isinstance(blocks, list) or any(not isinstance(b, dict) for b in blocks):
        raise RuntimeError('Claude returned an unexpected response. No definition was accepted.')
    text = '\n'.join(b.get('text', '') for b in blocks if b.get('type') == 'text').strip()
    if text.startswith('```') and text.endswith('```'):
        text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    try: parsed = json.loads(text)
    except (ValueError, TypeError):
        raise RuntimeError('Claude returned invalid JSON. No definition was accepted; you can try again.') from None
    return parsed, value.get('model', config['model']), value.get('usage', {})


def describe(request):
    if request.get('consent_to_external_processing') is not True:
        raise ValueError('Choose whether to send the extracted sound observations to Claude first. Audio stays local.')
    evidence = verify(request.get('evidence'))
    if not configuration()['configured']:
        raise RuntimeError('Set ANTHROPIC_API_KEY in the local .env file, then restart the server. Local extraction works without it.')
    observations = provider_observations(evidence)
    value, model, usage = call_claude(observations)
    definition = validate_description(value, evidence)
    return dict(schema_version=1, artifact_type='learner_pronunciation_definition', status='draft',
                human_verified=False, audio=evidence['audio'], observations=evidence,
                definition=definition,
                provenance=dict(extractor=evidence['extractor'], describer=dict(provider='anthropic', model=model,
                    input='local_acoustic_observations_only', heard_audio=False,
                    prompt_sha256=hashlib.sha256(PROMPT_PATH.read_bytes()).hexdigest(), usage=usage),
                    created_at=datetime.now(timezone.utc).isoformat()),
                privacy=dict(audio_uploaded=False, observations_sent_to='Anthropic Claude API', local_files_written=False),
                limitations=evidence['limitations']+[
                    'Claude describes local recognizer guesses; it did not hear the recording and cannot correct acoustic mistakes.',
                    'English sound examples and inferred word groups are approximate and have not been human-verified.',
                    'This is a description of observed sounds, not a reference pronunciation, comparison, or grade.'])
