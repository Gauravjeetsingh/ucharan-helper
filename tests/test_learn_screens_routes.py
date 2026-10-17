"""Learn practice screen routes: standard library only, no models."""
import json
import io
import wave
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

from backend.server import Handler


class LearnScreenRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def request(self, path, method='GET', body=None, headers=None):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result

    def test_lessons_served_and_confined(self):
        status, body = self.request('/data/lessons/mool-mantar.json')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['id'], 'mool-mantar')
        for path in ['/data/lessons/../reference/word-timings.json', '/data/lessons/%2e%2e/%2e%2e/serve.py',
                     '/data/lessons/missing.json', '/data/lessons/mool-mantar.txt']:
            self.assertEqual(self.request(path)[0], 404, path)

    def test_learn_page_has_practice_and_follow_untouched(self):
        _, learn = self.request('/learn')
        self.assertIn(b'id="lp-record"', learn)
        self.assertNotIn(b'id="record-student"', learn)
        status, lab = self.request('/apps/learn/lab.html')  # older Learn tools kept here
        self.assertEqual(status, 200)
        self.assertIn(b'id="record-student"', lab)
        _, follow = self.request('/follow')
        self.assertNotIn(b'lp-record', follow)

    def test_compare_rejects_bad_requests(self):
        headers = {'Content-Type': 'application/json'}
        self.assertEqual(self.request('/api/learn/screens/compare', 'POST', '[]', headers)[0], 400)
        self.assertEqual(self.request('/api/learn/screens/compare', 'POST', '', headers)[0], 413)
        self.assertEqual(self.request('/api/learn/screens/compare', 'POST', '{}', {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('/api/learn/screens/compare', 'POST', '{}', dict(headers, Origin='https://example.com'))[0], 403)
        body = json.dumps(dict(lesson_id='../x', screen_id='s', audio_base64=''))
        self.assertEqual(self.request('/api/learn/screens/compare', 'POST', body, headers)[0], 400)

    def test_bounded_reference_clip(self):
        status, body = self.request('/api/learn/screens/audio?lesson_id=mool-mantar&screen_id=screen-1')
        self.assertEqual(status, 200)
        with wave.open(io.BytesIO(body)) as audio:
            self.assertLess(audio.getnframes() / audio.getframerate(), 9)
            self.assertGreater(audio.getnframes() / audio.getframerate(), 8)
        for query in ['lesson_id=../x&screen_id=x', 'lesson_id=mool-mantar&screen_id=missing',
                      'lesson_id=mool-mantar', 'lesson_id=mool-mantar&screen_id=x&section_id=y']:
            self.assertEqual(self.request('/api/learn/screens/audio?' + query)[0], 400)


if __name__ == '__main__':
    unittest.main()
