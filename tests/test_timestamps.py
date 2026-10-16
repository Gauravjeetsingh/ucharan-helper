import base64
import io
import unittest
import wave
import numpy as np
from backend.timestamps import ctc_path, source_words, read_audio, SR


class AlignmentTests(unittest.TestCase):
    def test_occurrences_punctuation_and_symbol(self):
        words = source_words('ੴ ਸਚੁ ॥ ਸਚੁ ॥੧॥')
        self.assertEqual([w['text'] for w in words], ['ੴ', 'ਸਚੁ', 'ਸਚੁ'])
        self.assertNotEqual(words[1]['id'], words[2]['id'])
        for word in words:
            self.assertEqual('ੴ ਸਚੁ ॥ ਸਚੁ ॥੧॥'[word['source_start']:word['source_end']], word['text'])

    def test_prefix_suffix_and_repeated_labels(self):
        # Actual acoustic emissions: other, a, blank, a, b, other.
        probabilities = np.full((6, 4), .001)
        for i, token in enumerate([3, 1, 0, 1, 2, 3]):
            probabilities[i, token] = .997
        path = ctc_path(np.log(probabilities), [1, 1, 2], 0)
        self.assertEqual(path[1], 1)
        self.assertEqual(path[2], 2)
        self.assertEqual(path[3], 3)
        self.assertEqual(path[4], 5)
        self.assertEqual(path[5], 7)

    def test_insufficient_frames(self):
        with self.assertRaises(ValueError):
            ctc_path(np.log(np.full((2, 3), 1/3)), [1, 1], 0)

    def test_reject_silence_and_nonmatching_format(self):
        for rate in [SR, 8000]:
            raw = io.BytesIO()
            with wave.open(raw, 'wb') as audio:
                audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate)
                audio.writeframes(b'\0\0' * rate)
            with self.assertRaises(ValueError):
                read_audio(base64.b64encode(raw.getvalue()).decode())


if __name__ == '__main__':
    unittest.main()
