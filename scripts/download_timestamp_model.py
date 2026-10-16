"""Explicit setup: downloads pinned timestamp weights, never uploads recordings."""
import hashlib
import urllib.request
from backend.timestamps import MODEL_DIR, MODEL_ID, REVISION

CHECKSUMS = {
    'model.int8.onnx': '5f9e41d867dee2883796e290eef85abc11cbd32fe0f10c1f763a638d824634f9',
    'tokenizer.model': '63a2e8f1221ba60a7b315a14c8da49ff4873d6b5e46e9145dc4f7a4fe4742834',
}


def verified(path, name):
    return path.is_file() and (name not in CHECKSUMS or
        hashlib.file_digest(path.open('rb'), 'sha256').hexdigest() == CHECKSUMS[name])


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name in ['model.int8.onnx', 'tokenizer.model', 'edge-vocab.json', 'README.md']:
        destination = MODEL_DIR / name
        if verified(destination, name):
            print(f'Already present: {name}', flush=True)
            continue
        print(f'Downloading {name} from pinned revision {REVISION}…', flush=True)
        pending = destination.with_suffix(destination.suffix + '.partial')
        urllib.request.urlretrieve(f'https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{name}', pending)
        if not verified(pending, name):
            raise RuntimeError(f'Checksum mismatch for {name}; retry the download.')
        pending.replace(destination)
    print('Timestamp model ready.', flush=True)


if __name__ == '__main__':
    main()
