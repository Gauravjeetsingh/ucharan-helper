"""Optional real model/API smoke check. Requires a running timestamp-ready server."""
import base64
import json
import os
import urllib.request
from backend.paths import REFERENCE


def main():
    source = json.loads((REFERENCE/'word-timings.json').read_text(encoding='utf-8'))
    body = dict(filename='snippet.mov', text='\n'.join(v['text'] for v in source['verses']),
                audio_base64=base64.b64encode((REFERENCE/'snippet-analysis.wav').read_bytes()).decode(),
                expansions={'ੴ': 'ਇਕੁ ਓ ਅੰਕਾਰ'})
    request = urllib.request.Request(os.environ.get('APP_URL', 'http://127.0.0.1:8767')+'/api/timestamps/generate',
                                     data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
    words = result['words']
    originals = [w for v in source['verses'] for w in v['words']]
    assert len(words) == len(originals) == 25
    previous_end = 0
    for word, original in zip(words, originals, strict=True):
        assert (word['id'], word['verse_id'], word['text']) == (original['id'], original['verse_id'], original['text'])
        assert 0 <= previous_end <= word['start'] < word['end'] <= result['audio']['duration_seconds']
        assert not word['reviewed']
        previous_end = word['end']
    print('PASS: real local ONNX/API generation, 25 original IDs/words, ordered bounded intervals, no review claims.')


if __name__ == '__main__':
    main()
