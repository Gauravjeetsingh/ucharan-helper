"""Build complete practice screens from checked-in MOV timings; no inference.

Run python -m scripts.build_japji_practice. Offsets remain Unicode code points,
end exclusive. Each original occurrence ID, spelling and time is preserved.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/lessons/japjisahib.json'
TARGET = ROOT / 'data/lessons/japji-sahib-full.json'
AUDIO = '/data/lessons/audio/japji-full-16k.wav'


def build(data):
    text, words = data['source']['text'], data['words']
    verses, sections, screens = [], [], []
    section_id, section_title, pauri = 'opening', 'Opening', 0
    position = 0
    for line_index, line in enumerate(text.splitlines(keepends=True)):
        value = line.rstrip('\r\n')
        if value.startswith('ਸੋਚੈ '):
            pauri, section_id, section_title = 1, 'pauri-1', 'Pauri 1'
        elif value == 'ਸਲੋਕੁ ॥':
            section_id, section_title = 'salok', 'Salok'
        owned = [dict(w, verse_id=f'line-{line_index + 1:03}') for w in words
                 if position <= w['source_start'] < position + len(value)]
        verse = dict(verse_id=f'line-{line_index + 1:03}', text=value,
                     source_start=position, source_end=position + len(value),
                     section_id=section_id, words=owned)
        verses.append(verse)
        if not sections or sections[-1]['id'] != section_id:
            sections.append(dict(id=section_id, title=section_title, pauri=pauri if section_id.startswith('pauri-') else None, verse_ids=[]))
        sections[-1]['verse_ids'].append(verse['verse_id'])
        # Keep recording requests below 15 s, splitting only between real words.
        parts, part = [], []
        for word in owned:
            if part and word['end'] - part[0]['start'] > 13:
                parts.append(part)
                part = []
            part.append(word)
        if part:
            parts.append(part)
        for n, part in enumerate(parts):
            screens.append(dict(id=verse['verse_id'] + (f'-{n + 1}' if len(parts) > 1 else ''),
                                ustaad='Japji Sahib recording', audio=AUDIO,
                                section_id=section_id, start=round(max(0, part[0]['start'] - .1), 4),
                                end=round(part[-1]['end'] + .15, 4), words=part))
        # Numbered line endings close each pauri; opening also contains ॥੧॥.
        if section_id.startswith('pauri-') and re.search(r'॥[੦-੯]+॥\s*$', value):
            pauri += 1
            section_id, section_title = f'pauri-{pauri}', f'Pauri {pauri}'
        position += len(line)
    for section in sections:
        owned = [w for v in verses if v['verse_id'] in section['verse_ids'] for w in v['words']]
        section.update(start=round(max(0, owned[0]['start'] - .15), 4), end=round(owned[-1]['end'] + .32, 4))
    assert [w['id'] for s in screens for w in s['words']] == [w['id'] for w in words]
    assert len([s for s in sections if s['pauri']]) == 38
    assert all(0 < s['end'] - s['start'] <= 15 for s in screens)
    return dict(schema_version=1, id='japji-sahib-full', title='Japji Sahib', min_sound_score=-1.5,
                source=data['source'], timing_source='data/lessons/japjisahib.json', audio=AUDIO,
                note='Complete bani. Existing unreviewed MOV timings; no new inference or human review.',
                sections=sections, verses=verses, screens=screens)


if __name__ == '__main__':
    result = build(json.loads(SOURCE.read_text(encoding='utf-8')))
    TARGET.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f"Built {len(result['screens'])} screens, {len(result['sections'])} sections.")
