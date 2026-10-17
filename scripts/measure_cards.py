"""Record what the models hear in the ustaad's clip for each pronunciation card.

Writes a `measured` block into data/lessons/pronunciation-cards.json and flags
where the measurement disagrees with the card (e.g. the card says ਭ is a soft
“p” but the phone model hears “b”). Reviewers see these on the cards page.
Needs the timestamp model; the phone model adds voicing measurements.

    python -m scripts.measure_cards
"""
import json

from backend.learn import tone
from backend.learn.screens import BLANK, cards_path, read_clip, text, ustaad_pieces
from backend.timestamps import TimestampModel

CONTEXT = .3


def main():
    path = cards_path()
    cards = json.loads(path.read_text(encoding='utf-8'))
    timings = json.loads((path.parents[1] / 'reference/word-timings.json').read_text(encoding='utf-8'))
    words = {w['id']: w for v in timings['verses'] for w in v['words']}
    model = TimestampModel()
    try:
        from backend.learn.phone_engine import PhoneModel
        phone = PhoneModel()
    except (ImportError, RuntimeError):
        phone = None
    order = list(words)
    for wid, card in cards['words'].items():
        w = words[wid]
        # Neighbouring words are included so their sounds aren't credited to this one.
        n = order.index(wid)
        nearby = [words[order[j]] for j in range(max(0, n - 1), min(len(order), n + 2))]
        screen = dict(audio=cards['audio'], start=max(0, nearby[0]['start'] - CONTEXT), end=nearby[-1]['end'] + CONTEXT,
                      words=[dict(id=x['id'], text=x['text'], start=x['start'], end=x['end']) for x in nearby])
        pieces = ustaad_pieces(model, screen)[nearby.index(w)]
        clip = read_clip(screen['audio'], screen['start'], screen['end'])
        measured = dict(heard=text(model, [p['token'] for p in pieces]), pieces=[], flags=[])
        for p in pieces:
            alternatives = {('silence' if c == BLANK else text(model, [c])): round(v, 2)
                            for c, v in sorted(p['alternatives'].items(), key=lambda kv: -kv[1])}
            measured['pieces'].append(dict(piece=text(model, [p['token']]), prob=round(p['prob'], 2),
                                           alternatives=alternatives))
        if phone is not None:
            events, plp = phone.infer(clip)
            a, b = w['start'] - screen['start'], w['end'] - screen['start']
            measured['phone_labels'] = [e['label'] for e in events if a - .05 <= e['start'] <= b + .05]
            for sound in card['sounds']:
                letter = tone.tonal_letter(sound['letters'])
                piece = next((p for p in pieces if letter and letter in text(model, [p['token']])), None)
                if not sound.get('voicing') or piece is None:
                    continue
                vl, vd, h = tone.voicing(phone, plp, piece['region'], letter)
                quiet, voiced_name = tone.TONAL[letter][:2]
                measured.setdefault('voicing', {})[letter] = dict(voiceless=round(vl, 2), voiced=round(vd, 2), breath=round(h, 2))
                heard = 'voiceless' if vl > vd else 'voiced'
                if heard != sound['voicing']:
                    measured['flags'].append(
                        f"Card says {letter} is {'a soft “' + quiet + '”' if sound['voicing'] == 'voiceless' else 'a voiced “' + voiced_name + '”'}, "
                        f"but the phone model hears the ustaad as {'“' + quiet + '”' if heard == 'voiceless' else '“' + voiced_name + '”'} "
                        f"({vl:.2f} vs {vd:.2f}). Please listen and confirm.")
        card['measured'] = measured
        print(wid, card['text'], '| heard:', measured['heard'], '|', '; '.join(measured['flags']) or 'no flags')
    path.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
