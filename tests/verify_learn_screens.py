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
            if path.name.startswith('pronunciation-cards'):
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
        from backend.learn.tone import check, check_aunkar, check_s, check_sihari
        bh = lambda u, st, target=None: check(None, 'ਭ', (*u, 0), (*st, 0), target)
        self.assertIn('softly', bh((.97, .01), (.74, .61)))                     # nir-bhau
        self.assertIsNone(bh((.97, .01), (.9, .2)))                             # nir-pau
        self.assertIn('softly', bh((.39, .56), (.02, .95), 'voiceless'))        # ਭੀ half-heard ustaad, "bhi"
        self.assertIn('softly', bh((.17, .80), (.0, .98), 'voiceless'))
        self.assertIsNone(bh((.23, .73), (.12, .86), 'voiceless'))              # noisy ustaad copy
        self.assertTrue(check_s((.96, .0), (.0, .86)))                          # parshaad
        self.assertIsNone(check_s((.96, .0), (.93, .0)))
        self.assertTrue(check_sihari((.40, .03), (.02, .73)))                   # aadee
        self.assertIsNone(check_sihari((.47, .04), (.0, .0)))                   # faint ending: no grade
        self.assertTrue(check_aunkar((.63, .02), (.27, .46)))                   # purkhu
        self.assertIsNone(check_aunkar((.63, .02), (.86, .01)))


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

    def test_noisy_recording_is_unclear(self):
        screen = self.lesson['screens'][0]
        clip = self.clip(screen)
        noisy = clip + np.random.default_rng(0).normal(0, np.abs(clip).max() * .5, len(clip))
        noisy = (noisy * .5 / np.abs(noisy).max()).astype(np.float32)
        result = self.run_screen(screen, noisy)
        self.assertEqual(result['status'], 'unclear')
        self.assertIn('background noise', result['message'])

    def test_quiet_recording_is_boosted_not_failed(self):
        screen = self.lesson['screens'][0]
        result = self.run_screen(screen, self.clip(screen) * .05)
        self.assertNotIn('wrong', [w['state'] for w in result['words']], result)

    def test_silence_is_unclear(self):
        result = self.run_screen(self.lesson['screens'][0], np.zeros(SR * 3, dtype=np.float32))
        self.assertEqual(result['status'], 'unclear')


if __name__ == '__main__':
    unittest.main()
