"""Download pinned Apache-2.0 model files; uploads no audio. Optional setup only."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import urllib.request
from backend.learn.phone_engine import ROOT, REVISION, WEIGHT_SHA256

DEST = ROOT.parent.parent/'models/phone'
URL = f'https://huggingface.co/facebook/wav2vec2-xlsr-53-espeak-cv-ft/resolve/{REVISION}'


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for name in ['config.json','preprocessor_config.json','vocab.json','README.md']:
        urllib.request.urlretrieve(f'{URL}/{name}', DEST/name)
    target = DEST/'pytorch_model.bin'
    if target.is_file() and hashlib.file_digest(target.open('rb'),'sha256').hexdigest()==WEIGHT_SHA256:
        print('Pinned weights already verified.'); return
    # Independent ranged requests accelerate the 1.26 GB download; verify every size and final hash.
    size=1263535127; chunk=(size+7)//8
    def fetch(index):
        start=index*chunk; end=min(size-1,start+chunk-1); path=DEST/f'part-{index}'
        existing=path.stat().st_size if path.exists() else 0
        if existing==end-start+1: return path
        if existing>end-start+1: raise RuntimeError('Oversize partial download; remove the partial file before retrying.')
        req=urllib.request.Request(f'{URL}/pytorch_model.bin?chunk={index}&offset={existing}',headers={'Range':f'bytes={start+existing}-{end}'})
        with urllib.request.urlopen(req,timeout=120) as response, path.open('ab') as out:
            if response.status!=206: raise RuntimeError('Server did not honor byte range.')
            if not response.headers.get('Content-Range','').startswith(f'bytes {start+existing}-{end}/'):
                raise RuntimeError('Unexpected byte range.')
            while block:=response.read(1024*1024): out.write(block)
        if path.stat().st_size!=end-start+1: raise RuntimeError('Incomplete download; retry setup.')
        print(f'Chunk {index+1}/8 complete',flush=True)
        return path
    with ThreadPoolExecutor(max_workers=8) as pool: parts=list(pool.map(fetch,range(8)))
    pending=DEST/'model.pending'
    with pending.open('wb') as out:
        for part in parts:
            with part.open('rb') as stream:
                while block:=stream.read(1024*1024): out.write(block)
    if hashlib.file_digest(pending.open('rb'),'sha256').hexdigest()!=WEIGHT_SHA256: raise RuntimeError('Weight checksum mismatch.')
    pending.replace(target)
    for part in parts: part.unlink()
    print(f'Verified {target}. No audio uploaded.')


if __name__=='__main__': main()
