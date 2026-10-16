"""Portable core routes and access checks: no optional packages/model downloads."""
import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from backend.server import Handler


class RouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.port = cls.server.server_port
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def request(self, path, method='GET', body=None, headers=None):
        connection = HTTPConnection('127.0.0.1', self.port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_routes_and_root_redirect(self):
        status, headers, _ = self.request('/')
        self.assertEqual(status, 302)
        self.assertEqual(headers['Location'], '/timestamps')
        for route in ['timestamps', 'follow', 'learn', 'test']:
            for suffix in ['', '/']:
                with self.subTest(route=route, suffix=suffix):
                    status, headers, body = self.request('/'+route+suffix)
                    self.assertEqual(status, 200)
                    self.assertIn(b'<!doctype html>', body.lower())
                    self.assertIn('Content-Security-Policy', headers)
                    self.assertIn(b'href="/apps/shared/favicon.svg"', body)
        status, headers, body = self.request('/apps/shared/favicon.svg')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-type'], 'image/svg+xml')
        self.assertIn('ੴ'.encode(), body)

    def test_generator_does_not_load_review(self):
        _, _, body = self.request('/timestamps')
        self.assertNotIn(b'/apps/learn/', body)
        self.assertNotIn(b'id="sound-review"', body)
        self.assertNotIn(b'id="reviewed"', body)
        self.assertIn(b'id="generate"', body)

    def test_public_reference_and_hidden_files(self):
        self.assertEqual(self.request('/data/reference/word-timings.json')[0], 200)
        for path in ['/models/phone/config.json', '/.git/config', '/README.md', '/backend/server.py', '/apps/shared/../../serve.py']:
            self.assertEqual(self.request(path)[0], 404)

    def test_head_status_and_wrong_origin(self):
        status, _, body = self.request('/learn', 'HEAD')
        self.assertEqual(status, 200)
        self.assertEqual(body, b'')
        self.assertTrue(json.loads(self.request('/api/status')[2])['local_only'])
        self.assertEqual(self.request('/api/status', headers={'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.request('/api/status', headers={'Host': 'example.com'})[0], 403)

    def test_corrections_save_load_delete(self):
        import tempfile
        from pathlib import Path
        from backend import corrections
        headers = {'Content-Type': 'application/json'}
        key = 'a' * 64
        with tempfile.TemporaryDirectory() as directory:
            original, corrections.CORRECTIONS = corrections.CORRECTIONS, Path(directory)
            reference = (Path(__file__).resolve().parents[1]/'data/reference/word-timings.json').read_bytes()
            try:
                body = json.dumps({'audio_key': key, 'word_id': 'v1-w03', 'start': 7.13, 'end': 8.58})
                status, _, raw = self.request('/api/corrections/save', 'POST', body, headers)
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(raw)['words']['v1-w03']['end'], 8.58)
                saved = json.loads((Path(directory)/f'{key}.json').read_text(encoding='utf-8'))
                self.assertEqual(saved['words']['v1-w03']['start'], 7.13)
                self.assertEqual(json.loads(self.request(f'/api/corrections/{key}')[2])['words']['v1-w03']['start'], 7.13)
                status, _, raw = self.request('/api/corrections/delete', 'POST', json.dumps({'audio_key': key, 'word_id': 'v1-w03'}), headers)
                self.assertEqual((status, json.loads(raw)['words']), (200, {}))
                self.assertFalse((Path(directory)/f'{key}.json').exists())
                for bad in [{'audio_key': '../x', 'word_id': 'w1', 'start': 1, 'end': 2},
                            {'audio_key': key, 'word_id': '../w', 'start': 1, 'end': 2},
                            {'audio_key': key, 'word_id': 'w1', 'start': 2, 'end': 1},
                            {'audio_key': key, 'word_id': 'w1', 'start': True, 'end': 2}]:
                    self.assertEqual(self.request('/api/corrections/save', 'POST', json.dumps(bad), headers)[0], 400)
                self.assertEqual(self.request('/api/corrections/not-a-checksum')[0], 400)
                self.assertEqual(self.request('/api/corrections/save', 'POST', '{}', {**headers, 'Origin': 'https://example.com'})[0], 403)
            finally:
                corrections.CORRECTIONS = original
            self.assertEqual((Path(__file__).resolve().parents[1]/'data/reference/word-timings.json').read_bytes(), reference)

    def test_bad_api_requests(self):
        headers = {'Content-Type': 'application/json'}
        self.assertEqual(self.request('/api/timestamps/generate', 'POST', '[]', headers)[0], 400)
        self.assertEqual(self.request('/api/timestamps/generate', 'POST', '', headers)[0], 413)
        self.assertEqual(self.request('/api/unknown', 'POST', '{}', headers)[0], 404)


if __name__ == '__main__':
    unittest.main()
