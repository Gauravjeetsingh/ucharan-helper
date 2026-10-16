"""Learn practice screens (listen and repeat). Lesson checks need numpy only; acoustic checks need the timestamp model.

Acoustic checks are machine controls on the ustaad's own audio, not learner validation.
"""
import json
import unittest

import numpy as np

from backend.learn.screens import LESSONS, ROOT, SR, read_clip


class LessonTests(unittest.TestCase):
    def test_lessons_reference_real_words_and_audio(self):
        timing = json.loads((ROOT / 'data/reference/word-timings.json').read_text(encoding='utf-8'))
        known = {w['id']: w for v in timing['verses'] for w in v['words']}
        for path in LESSONS.glob('*.json'):
            lesson = json.loads(path.read_text(encoding='utf-8'))
            if path.name == 'pronunciation-cards.json':
                continue
            for screen in lesson['screens']:
                self.assertTrue(screen['audio'].startswith('/data/') and screen['audio'].endswith('.wav'))
                self.assertLess(screen['end'] - screen['start'], 15)
                for word in screen['words']:
                    if word['id'] in known and screen['audio'] == '/data/reference/recording.wav':
                        self.assertEqual(word['text'], known[word['id']]['text'])
                clip = read_clip(screen['audio'], screen['start'], screen['end'])
                self.assertAlmostEqual(len(clip) / SR, screen['end'] - screen['start'], delta=.05)


class ToneRuleTests(unittest.TestCase):
    """The ustaad's voicing is the target; only clear opposites are flagged."""
    def test_rules(self):
        from backend.learn.tone import check
        self.assertIn('softly', check(None, 'ਭ', (.97, .01, 0), (.74, .61, 0)))   # ustaad p, student bh
        self.assertIsNone(check(None, 'ਭ', (.97, .01, 0), (.9, .2, 0)))          # student also p
        self.assertIsNone(check(None, 'ਭ', (.6, .3, 0), (.1, .9, 0)))            # ustaad unclear: no judgement
        self.assertIn('voiced', check(None, 'ਧ', (.02, .9, 0), (.8, .05, 0)))     # ustaad voiced, student plain
        # Card target: graded only where the model clearly hears the ustaad that way.
        self.assertIn('softly', check(None, 'ਭ', (.97, .01, 0), (.6, .7, 0), 'voiceless'))
        self.assertIsNone(check(None, 'ਭ', (.1, .88, 0), (.05, .95, .5), 'voiceless'))  # model hears ustaad as b: no grade
        self.assertIn('softly', check(None, 'ਭ', (.39, .56, 0), (.02, .95, 0), 'voiceless'))  # ਭੀ: ustaad half p, student bhi
        self.assertIsNone(check(None, 'ਭ', (.39, .56, 0), (.12, .86, 0), 'voiceless'))       # noisy ustaad copy: no flag


class AcousticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from backend.timestamps import TimestampModel
            cls.model = TimestampModel()
        except (ImportError, RuntimeError) as error:
            raise unittest.SkipTest(f'Gurbani model unavailable: {error}')
        cls.lesson = json.loads((LESSONS / 'mool-mantar.json').read_text(encoding='utf-8'))

    def run_screen(self, screen, samples):
        from backend.learn.screens import compare_screen
        return compare_screen(self.model, samples, self.lesson, screen)

    def clip(self, screen):
        return read_clip(screen['audio'], screen['start'], screen['end'])

    def test_ustaad_against_own_clip_is_never_red(self):
        for screen in self.lesson['screens']:
            result = self.run_screen(screen, self.clip(screen))
            with self.subTest(screen=screen['id']):
                self.assertEqual(result['status'], 'judged', result['message'])
                self.assertNotIn('wrong', [w['state'] for w in result['words']], result['words'])

    def test_muted_word_turns_red_with_reason(self):
        for screen in self.lesson['screens'][:2]:
            clip, word = self.clip(screen).copy(), screen['words'][1]
            clip[int((word['start'] - screen['start']) * SR):int((word['end'] - screen['start']) * SR)] = 0
            result = self.run_screen(screen, clip)['words'][1]
            with self.subTest(screen=screen['id']):
                self.assertEqual(result['state'], 'wrong', result)
                self.assertTrue(result['reason'])

    def test_other_phrase_is_not_green(self):
        first, second = self.lesson['screens'][:2]
        result = self.run_screen(first, self.clip(second))
        self.assertLessEqual(sum(w['state'] == 'correct' for w in result['words']), 1, result)

    def test_silence_is_unclear(self):
        result = self.run_screen(self.lesson['screens'][0], np.zeros(SR * 3, dtype=np.float32))
        self.assertEqual(result['status'], 'unclear')


if __name__ == '__main__':
    unittest.main()
