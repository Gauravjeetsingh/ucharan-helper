"""Feature routes and local inference. Startup requires only the standard library."""
import argparse
import base64
import binascii
import hashlib
import json
import os
import threading
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse
from .paths import ROOT, REFERENCE

MODEL_LOCK = threading.Lock()
MODELS = {}
ROUTES = {f'/{name}': f'apps/{name}/index.html' for name in ['timestamps', 'follow', 'learn', 'test']}
ROUTES.update({'/': 'apps/home/index.html', '/bani/japji-sahib': 'apps/home/index.html'})
PUBLIC = {f'/data/reference/{name}' for name in [
    'word-timings.json', 'banidb-shabad-1.json', 'recording.wav', 'reference-phones.json', 'phone-raw.json']}
ASSETS = {f'/{p.relative_to(ROOT).as_posix()}' for p in (ROOT/'apps').rglob('*')
          if p.is_file() and p.suffix in {'.html', '.js', '.mjs', '.css', '.svg', '.png', '.ttf'}}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def local_request(self):
        local_hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        host, origin = self.headers.get('Host'), self.headers.get('Origin')
        public = getattr(self.server, 'public_origin', None)
        if public and host == urlparse(public).netloc:
            return origin == public or origin is None and self.command in {'GET', 'HEAD'}
        return host in local_hosts and origin in (None, *(f'http://{name}' for name in local_hosts))

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
        # Render probes may use a different Host when custom domains are added.
        # This endpoint exposes no data and does not load any inference models.
        if self.path == '/healthz':
            return self.reply(200, {'ok': True}, head)
        if not self.local_request():
            return self.reply(403, {'error': 'Local same-origin requests only.'}, head)
        path = unquote(urlparse(self.path).path)
        if path == '/index.html':
            self.send_response(302)
            self.send_header('Location', '/')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if path == '/api/learn/screens/audio':
            from .learn.screens_api import audio_clip
            return audio_clip(self, head)
        if path.startswith('/data/lessons/'):
            from .learn.screens_api import serve_lesson_file
            return serve_lesson_file(self, path, head)
        if path.startswith('/api/corrections/'):
            if getattr(self.server, 'deployed_demo', False):
                return self.reply(403, {'error': 'Reference editing is disabled in the hosted demo.'}, head)
            from . import corrections
            try:
                return self.reply(200, {'words': corrections.load(path.rsplit('/', 1)[1])}, head)
            except ValueError as error:
                return self.reply(400, {'error': str(error)}, head)
        if path == '/api/status':
            return self.reply(200, dict(local_only=not getattr(self.server, 'deployed_demo', False), stores_student_audio=False, audio_processing='server-memory',
                timestamp_model_present=all((ROOT/'models/timestamps'/f).is_file() for f in ['model.int8.onnx', 'tokenizer.model']),
                model_present=(ROOT/'models/phone/pytorch_model.bin').is_file()), head)
        if (path.rstrip('/') or '/') in ROUTES:
            self.path = '/' + ROUTES[path.rstrip('/') or '/']
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
        if getattr(self.server, 'deployed_demo', False) and self.path in {
                '/api/learn/screens/cards', '/api/corrections/save', '/api/corrections/delete'}:
            return self.reply(403, {'error': 'Reference editing is disabled in the hosted demo.'})
        if self.path.startswith('/api/learn/screens/'):
            from .learn.screens_api import post
            return post(self, MODEL_LOCK, MODELS)

        if not self.local_request():
            return self.reply(403, {'error': 'Local same-origin requests only.'})
        if self.path not in {'/api/timestamps/generate', '/api/learn/analyze', '/api/corrections/save', '/api/corrections/delete'}:
            return self.reply(404, {'error': 'Not found.'})
        if self.headers.get_content_type() != 'application/json':
            return self.reply(415, {'error': 'Expected JSON.'})
        if self.path.startswith('/api/corrections/'):
            return self.correction()
        if not MODEL_LOCK.acquire(blocking=False):
            return self.reply(429, {'error': 'A local model is busy. Try again shortly.'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            maximum = 80_000_000 if self.path.startswith('/api/timestamps/') else 1_500_000
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

    def correction(self):
        """Save or delete one word's boundary correction on disk; never touches models or reference files."""
        from . import corrections
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 10_000:
                return self.reply(413, {'error': 'Request is too large or empty.'})
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('Expected a JSON object.')
            action = corrections.save if self.path.endswith('/save') else corrections.delete
            self.reply(200, {'words': action(request)})
        except ValueError as error:
            self.reply(400, {'error': str(error)})
        except OSError:
            self.reply(500, {'error': 'Could not write the corrections file on this computer.'})


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1', help='Bind address; defaults to loopback for local use.')
    parser.add_argument('--port', type=int, default=8767)
    args = parser.parse_args(argv)
    from .deployment import public_origin
    origin = public_origin(os.environ.get('UCHAARAN_PUBLIC_ORIGIN'))
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.public_origin = origin
    server.deployed_demo = bool(origin) or os.environ.get('UCHAARAN_DEPLOYED_DEMO') == '1'
    print(f'Open {origin or f"http://127.0.0.1:{args.port}"}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
