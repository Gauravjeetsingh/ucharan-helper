"""Validate the review artifact without third-party dependencies."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "data/reference"
data = json.loads((root/'word-timings.json').read_text(encoding='utf-8'))
raw = json.loads((root/'banidb-shabad-1.json').read_text(encoding='utf-8'))
assert data['source']['response_sha256'] == hashlib.sha256((root/'banidb-shabad-1.json').read_bytes()).hexdigest()
assert data['audio']['sha256'] == hashlib.sha256((root/'snippet.mov').read_bytes()).hexdigest()
seen=set()
words=[]
for verse, source in zip(data['verses'],raw['verses'][:4],strict=True):
    assert verse['verse_id']==source['verseId']
    assert verse['text']==source['verse']['unicode']
    for i,word in enumerate(verse['words'],1):
        assert word['verse_id']==verse['verse_id']
        assert word['word_index']==i
        assert word['id'] not in seen
        seen.add(word['id'])
        assert verse['text'][word['source_start']:word['source_end']]==word['text']
        words.append(word)
assert len(words)==25
all_words=data['coverage']['unmatched_audio']+words
previous_end=0
for word in all_words:
    if word['status']=='outside_audio': assert word['start'] is None and word['end'] is None
    elif word['status']=='aligned':
        assert 0 <= word['start'] < word['end'] <= data['audio']['duration_seconds']
        assert word['start']>=previous_end
        assert word['reviewed'] is False
        previous_end=word['end']
assert len(all_words)==27
print('PASS: exact source Unicode/IDs, 25 source + 2 prefix words, ordered bounded intervals, checksums.')
