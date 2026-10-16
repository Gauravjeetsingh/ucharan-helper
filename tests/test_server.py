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

    def test_bad_api_requests(self):
        headers = {'Content-Type': 'application/json'}
        self.assertEqual(self.request('/api/timestamps/generate', 'POST', '[]', headers)[0], 400)
        self.assertEqual(self.request('/api/timestamps/generate', 'POST', '', headers)[0], 413)
        self.assertEqual(self.request('/api/unknown', 'POST', '{}', headers)[0], 404)


if __name__ == '__main__':
    unittest.main()
