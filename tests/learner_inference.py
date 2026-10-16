"""Optional real local-extractor HTTP smoke test. Never calls Claude.

Supply a short mono 16 kHz PCM WAV. A source-audio control verifies plumbing,
not performance on learners. No recording or generated artifact is saved.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio',type=Path)
    parser.add_argument('--url',default='http://127.0.0.1:8767')
    args=parser.parse_args()
    raw=args.audio.read_bytes()
    request=urllib.request.Request(args.url+'/api/test/extract',
        data=json.dumps(dict(audio_base64=base64.b64encode(raw).decode())).encode(),
        headers={'Content-Type':'application/json','Origin':args.url})
    with urllib.request.urlopen(request,timeout=120) as response:result=json.load(response)
    evidence=result['evidence']
    assert evidence['status']=='ready', evidence['status']
    assert evidence['audio']['sha256']==hashlib.sha256(raw).hexdigest()
    assert evidence['extractor']['source']=='learner_audio_only'
    assert len(evidence['events'])>=2
    assert [e['id'] for e in evidence['events']]==[f'sound-{i+1:03}' for i in range(len(evidence['events']))]
    serialized=json.dumps(result['claude_payload_preview'])
    assert 'audio_base64' not in serialized and 'sha256' not in serialized
    denied=urllib.request.Request(args.url+'/api/test/define',
        data=json.dumps(dict(evidence=evidence,consent_to_external_processing=False)).encode(),
        headers={'Content-Type':'application/json','Origin':args.url})
    try:urllib.request.urlopen(denied,timeout=10)
    except urllib.error.HTTPError as error:assert error.code==400
    else:raise AssertionError('Definition endpoint accepted a request without consent.')
    print(json.dumps(dict(result='PASS',stage='real_local_extraction',events=len(evidence['events']),
        cloud_requests=0,human_verified=False,note='Input audio is a plumbing check, not a human-rated pronunciation example.')))


if __name__=='__main__':main()
