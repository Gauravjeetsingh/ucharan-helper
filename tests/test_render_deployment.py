"""Render startup and health checks; no model downloads or cloud calls."""
import os
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from backend.server import Handler, main as serve
from scripts.render_start import main, settings


class RenderStartup(unittest.TestCase):
    def test_assigned_url_port_and_custom_domain_override(self):
        self.assertEqual(settings({'RENDER_EXTERNAL_URL': 'https://paath-demo.onrender.com'}),
                         ('https://paath-demo.onrender.com', 10000))
        self.assertEqual(settings({'RENDER_EXTERNAL_URL': 'https://paath-demo.onrender.com',
                                   'UCHAARAN_PUBLIC_ORIGIN': 'https://paath.example.org', 'PORT': '12000'}),
                         ('https://paath.example.org', 12000))

    def test_rejects_missing_origin_bad_origin_or_bad_port(self):
        for environment in [{}, {'RENDER_EXTERNAL_URL': 'http://paath.onrender.com'},
                            {'RENDER_EXTERNAL_URL': 'https://paath.onrender.com/'},
                            {'RENDER_EXTERNAL_URL': 'https://paath.onrender.com', 'UCHAARAN_PUBLIC_ORIGIN': '*'}]:
            with self.subTest(environment=environment), self.assertRaises(ValueError):
                settings(environment)
        for port in ['', 'abc', '0', '-1', '65536', '10000;command']:
            with self.subTest(port=port), self.assertRaises(ValueError):
                settings({'RENDER_EXTERNAL_URL': 'https://paath.onrender.com', 'PORT': port})

    def test_entrypoint_sets_hosted_policy_and_binds_assigned_port(self):
        with patch.dict(os.environ, {'RENDER_EXTERNAL_URL': 'https://paath.onrender.com', 'PORT': '12345'}, clear=True):
            with patch('backend.server.main') as start:
                main()
                start.assert_called_once_with(['--host', '0.0.0.0', '--port', '12345'])
            self.assertEqual(os.environ['UCHAARAN_PUBLIC_ORIGIN'], 'https://paath.onrender.com')
            self.assertEqual(os.environ['UCHAARAN_DEPLOYED_DEMO'], '1')

    def test_laptop_bind_default_is_preserved_and_host_is_explicit(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch('backend.server.ThreadingHTTPServer') as server, patch('builtins.print'):
                server.return_value.serve_forever.side_effect = KeyboardInterrupt
                serve([])
                server.assert_called_once_with(('127.0.0.1', 8767), Handler)
                self.assertFalse(server.return_value.deployed_demo)
            with patch('backend.server.ThreadingHTTPServer') as server, patch('builtins.print'):
                server.return_value.serve_forever.side_effect = KeyboardInterrupt
                serve(['--host', '0.0.0.0', '--port', '12345'])
                server.assert_called_once_with(('0.0.0.0', 12345), Handler)


class RenderHealth(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.server.public_origin = 'https://paath.onrender.com'
        cls.server.deployed_demo = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, host):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.request(method, path, headers={'Host': host})
        response = connection.getresponse()
        status, body = response.status, response.read()
        connection.close()
        return status, body

    def test_probe_with_different_host_does_not_open_other_routes(self):
        for host in ['paath.onrender.com', 'new-domain.example.org', 'internal-probe']:
            with self.subTest(host=host):
                self.assertEqual(self.request('GET', '/healthz', host), (200, b'{"ok": true}'))
                self.assertEqual(self.request('HEAD', '/healthz', host), (200, b''))
        self.assertEqual(self.request('GET', '/api/status', 'internal-probe')[0], 403)
        self.assertEqual(self.request('GET', '/learn', 'internal-probe')[0], 403)
        self.assertEqual(self.request('POST', '/healthz', 'paath.onrender.com')[0], 403)


if __name__ == '__main__':
    unittest.main()
