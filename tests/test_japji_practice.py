"""All full-bani screens derive from existing occurrences, never invented times."""
import json
import unittest
from scripts.build_japji_practice import SOURCE, TARGET, build


class FullBaniTests(unittest.TestCase):
    def test_complete_reproducible_source(self):
        source = json.loads(SOURCE.read_text(encoding='utf-8'))
        result = build(source)
        self.assertEqual(json.loads(TARGET.read_text(encoding='utf-8')), result)
        actual = [w for screen in result['screens'] for w in screen['words']]
        self.assertEqual(len(actual), len(source['words']))
        for old, new in zip(source['words'], actual):
            for key in old:
                self.assertEqual(new[key], old[key], (old['id'], key))
            self.assertEqual(result['source']['text'][new['source_start']:new['source_end']], new['text'])
        self.assertEqual([s['pauri'] for s in result['sections'] if s['pauri']], list(range(1, 39)))
        self.assertEqual(result['sections'][-1]['id'], 'salok')
        self.assertEqual('\n'.join(v['text'] for v in result['verses']), source['source']['text'].rstrip('\n'))
        self.assertTrue(all(s['end'] - s['start'] <= 15 for s in result['screens']))
