"""HTTP glue for Learn practice screens, kept out of server.py to avoid merge conflicts.

server.py calls serve_lesson_file() for /data/lessons/* and post() for
/api/learn/screens/compare. Same local-only, size and lock rules as the server.
"""
import base64
import binascii
import json
import re
import wave
from http.server import SimpleHTTPRequestHandler

from ..paths import ROOT

LESSONS = (ROOT / 'data/lessons').resolve()


def load_lesson(lesson_id):
    if not isinstance(lesson_id, str) or not re.fullmatch(r'[a-z0-9-]{1,64}', lesson_id):
        raise ValueError('Unknown lesson.')
    path = LESSONS / f'{lesson_id}.json'
    if not path.is_file():
        raise ValueError('Unknown lesson.')
    return json.loads(path.read_text(encoding='utf-8'))


def serve_lesson_file(handler, path, head=False):
    """Serve lesson JSON and lesson WAV clips from data/lessons only."""
    target = (ROOT / path.lstrip('/')).resolve()
    if LESSONS not in target.parents or target.suffix not in {'.json', '.wav'} or not target.is_file():
        return handler.reply(404, {'error': 'Not found.'}, head)
    handler.path = path
    return SimpleHTTPRequestHandler.do_HEAD(handler) if head else SimpleHTTPRequestHandler.do_GET(handler)


def post(handler, lock, models):
    if not handler.local_request():
        return handler.reply(403, {'error': 'Local same-origin requests only.'})
    if handler.headers.get_content_type() != 'application/json':
        return handler.reply(415, {'error': 'Expected JSON.'})
    if not lock.acquire(blocking=False):
        return handler.reply(429, {'error': 'A local model is busy. Try again shortly.'})
    try:
        length = int(handler.headers.get('Content-Length', 0))
        if not 0 < length <= 1_500_000:
            return handler.reply(413, {'error': 'Request is too large or empty.'})
        request = json.loads(handler.rfile.read(length))
        if not isinstance(request, dict):
            raise ValueError('Expected a JSON object.')
        lesson = load_lesson(request.get('lesson_id'))
        screen = next((s for s in lesson['screens'] if s['id'] == request.get('screen_id')), None)
        if screen is None:
            raise ValueError('Unknown screen.')
        from .screens import compare_screen
        from .phone_engine import read_wav
        from ..timestamps import TimestampModel
        samples = read_wav(base64.b64decode(request['audio_base64'], validate=True))
        if 'timestamps' not in models:
            models['timestamps'] = TimestampModel()
        if 'phone' not in models and not models.get('phone_unavailable'):
            # Optional: enables the ਭ ਧ ਘ ਝ ਢ voicing check; practice works without it.
            try:
                from .phone_engine import PhoneModel
                models['phone'] = PhoneModel()
            except (ImportError, RuntimeError):
                models['phone_unavailable'] = True
        handler.reply(200, compare_screen(models['timestamps'], samples, lesson, screen, models.get('phone')))
    except (ValueError, KeyError, TypeError, binascii.Error, wave.Error) as error:
        handler.reply(400, {'error': str(error)})
    except ImportError:
        handler.reply(503, {'error': 'Install the timestamp model dependencies (README.md) to check recordings.'})
    except RuntimeError as error:
        handler.reply(503, {'error': str(error)})
    except Exception as error:
        print(f'Learn practice failed: {type(error).__name__}', flush=True)
        handler.reply(503, {'error': 'Local analysis failed. Check model setup in README.md.'})
    finally:
        lock.release()
