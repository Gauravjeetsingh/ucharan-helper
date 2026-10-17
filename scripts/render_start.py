"""Render container entry point; normal laptop/droplet launches use serve.py.

Uses Render's assigned HTTPS URL unless UCHAARAN_PUBLIC_ORIGIN overrides it.
No model downloads or changes to reference data happen at startup.
"""
import os

from backend.deployment import public_origin


def settings(environ):
    origin = public_origin(environ.get('UCHAARAN_PUBLIC_ORIGIN') or environ.get('RENDER_EXTERNAL_URL'))
    if not origin:
        raise ValueError('Set RENDER_EXTERNAL_URL or UCHAARAN_PUBLIC_ORIGIN to the service HTTPS URL.')
    try:
        port = int(environ.get('PORT', '10000'))
    except ValueError as error:
        raise ValueError('PORT must be an integer between 1 and 65535.') from error
    if not 1 <= port <= 65535:
        raise ValueError('PORT must be an integer between 1 and 65535.')
    return origin, port


def main():
    try:
        origin, port = settings(os.environ)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    os.environ['UCHAARAN_PUBLIC_ORIGIN'] = origin
    os.environ['UCHAARAN_DEPLOYED_DEMO'] = '1'
    from backend.server import main as serve
    serve(['--host', '0.0.0.0', '--port', str(port)])


if __name__ == '__main__':
    main()
