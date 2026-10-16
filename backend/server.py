"""Feature routes and local inference. Startup requires only the standard library."""
import argparse
import base64
import binascii
import hashlib
import json
import threading
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse
from .paths import ROOT, REFERENCE

MODEL_LOCK = threading.Lock()
MODELS = {}
ROUTES = {f'/{name}': f'apps/{name}/index.html' for name in ['timestamps', 'follow', 'learn', 'test']}
PUBLIC = {f'/data/reference/{name}' for name in [
    'word-timings.json', 'banidb-shabad-1.json', 'recording.wav', 'reference-phones.json', 'phone-raw.json']}
ASSETS = {f'/{p.relative_to(ROOT).as_posix()}' for p in (ROOT/'apps').rglob('*')
          if p.is_file() and p.suffix in {'.html', '.js', '.mjs', '.css'}}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def local_request(self):
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        return self.headers.get('Host') in allowed and self.headers.get('Origin') in (
            None, *(f'http://{host}' for host in allowed))

    def reply(self, code, payload, head=False):
        raw = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if not head:
            self.wfile.write(raw)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'")
        super().end_headers()

    def get(self, head=False):
        if not self.local_request():
            return self.reply(403, {'error': 'Local same-origin requests only.'}, head)
        path = unquote(urlparse(self.path).path)
        if path in {'/', '/index.html'}:
            self.send_response(302)
            self.send_header('Location', '/timestamps')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if path.startswith('/data/lessons/'):
            from .learn.screens_api import serve_lesson_file
            return serve_lesson_file(self, path, head)

        if path == '/api/status':
            return self.reply(200, dict(local_only=True, stores_student_audio=False,
                timestamp_model_present=all((ROOT/'models/timestamps'/f).is_file() for f in ['model.int8.onnx', 'tokenizer.model']),
                model_present=(ROOT/'models/phone/pytorch_model.bin').is_file()), head)
        if path.rstrip('/') in ROUTES:
            self.path = '/' + ROUTES[path.rstrip('/')]
        elif path not in PUBLIC | ASSETS:
            return self.reply(404, {'error': 'Not found.'}, head)
        if head:
            super().do_HEAD()
        else:
            super().do_GET()

    def do_GET(self):
        self.get()

    def do_HEAD(self):
        self.get(True)

    def do_POST(self):
        if self.path == '/api/learn/screens/compare':
            from .learn.screens_api import post
            return post(self, MODEL_LOCK, MODELS)

        if not self.local_request():
            return self.reply(403, {'error': 'Local same-origin requests only.'})
        if self.path not in {'/api/timestamps/generate', '/api/learn/analyze'}:
            return self.reply(404, {'error': 'Not found.'})
        if self.headers.get_content_type() != 'application/json':
            return self.reply(415, {'error': 'Expected JSON.'})
        if not MODEL_LOCK.acquire(blocking=False):
            return self.reply(429, {'error': 'A local model is busy. Try again shortly.'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            maximum = 6_000_000 if self.path.startswith('/api/timestamps/') else 1_500_000
            if not 0 < length <= maximum:
                return self.reply(413, {'error': 'Request is too large or empty.'})
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('Expected a JSON object.')
            if self.path.startswith('/api/timestamps/'):
                from .timestamps import TimestampModel, read_audio, source_words
                source_words(request.get('text'))
                read_audio(request.get('audio_base64', ''))
                if 'timestamps' not in MODELS:
                    MODELS['timestamps'] = TimestampModel()
                result = MODELS['timestamps'].generate(request)
            else:
                from .learn.phone_engine import PhoneModel, compare, read_wav, quality
                reference = json.loads((REFERENCE/'reference-phones.json').read_text(encoding='utf-8'))
                phrase = next((p for p in reference['phrases'] if p['id'] == request.get('phrase_id')), None)
                if phrase is None:
                    raise ValueError('Unknown phrase.')
                raw = base64.b64decode(request['audio_base64'], validate=True)
                samples = read_wav(raw)
                if quality(samples)['usable'] and 'phone' not in MODELS:
                    MODELS['phone'] = PhoneModel()
                result = compare(MODELS.get('phone'), samples, reference, phrase, request.get('review'))
                result['audio_sha256'] = hashlib.sha256(raw).hexdigest()
            self.reply(200, result)
        except (ValueError, KeyError, TypeError, binascii.Error, wave.Error) as error:
            self.reply(400, {'error': str(error)})
        except ImportError:
            self.reply(503, {'error': 'Optional model dependencies are missing. Follow README.md for this feature.'})
        except RuntimeError as error:
            self.reply(503, {'error': str(error)})
        except Exception as error:
            print(f'Local inference failed: {type(error).__name__}', flush=True)
            self.reply(503, {'error': 'Local analysis failed. Check model setup in README.md.'})
        finally:
            MODEL_LOCK.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8767)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Open http://127.0.0.1:{args.port}/timestamps', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
