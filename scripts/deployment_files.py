"""Copy only application source and supplied reference data, including local UI edits.

Never copies .git, .local, models, venvs, student audio, generated evidence or caches.
"""
import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def files(root):
    candidates = []
    for folder in ['apps', 'backend', 'scripts', 'data/reference']:
        candidates.extend((root / folder).rglob('*'))
    candidates.extend((root / 'data/lessons').glob('*.json'))
    candidates.extend(root / name for name in ['serve.py', 'README.md', 'AGENTS.md', 'LICENSE',
                      'THIRD_PARTY.md', 'requirements-timestamps.txt', 'requirements-phonetics.txt',
                      'docs/DEPLOYMENT.md', 'docs/DATA.md', 'docs/LEARN_PRACTICE.md'])
    for source in sorted(set(candidates)):
        relative = source.relative_to(root)
        if (source.is_symlink() or not source.is_file()
                or any(part.startswith('.') or part in {'__pycache__', 'node_modules', 'models', 'local-recordings', 'test-results', 'playwright-report'} for part in relative.parts)
                or source.suffix in {'.pyc', '.partial'}
                or any((root / parent).is_symlink() for parent in relative.parents)):
            continue
        yield relative


def copy_source(root, destination):
    if destination.exists():
        raise ValueError('Use a new, empty release path.')
    selected = list(files(root))
    destination.mkdir(parents=True)
    for relative in selected:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / relative, target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    copy_source(ROOT, args.destination)
