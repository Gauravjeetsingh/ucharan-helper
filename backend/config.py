"""Small opt-in .env loader for local server credentials; no shell execution."""
import os
from pathlib import Path


def load_env(path):
    path = Path(path)
    if not path.exists(): return
    allowed = {'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'}
    for number, raw in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'): continue
        key, separator, value = line.partition('=')
        key = key.strip()
        if not separator or key not in allowed:
            raise ValueError(f'Invalid .env setting on line {number}. Only ANTHROPIC_API_KEY and ANTHROPIC_MODEL are read.')
        value = value.strip()
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]: raise ValueError(f'Unclosed .env quote on line {number}.')
            value = value[1:-1]
        # Process variables win; neither expansion nor command substitution occurs.
        os.environ.setdefault(key, value)
