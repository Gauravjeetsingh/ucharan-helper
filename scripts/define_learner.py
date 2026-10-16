"""CLI for an existing short mono 16 kHz PCM WAV; no reference text input."""
import argparse
import json
from pathlib import Path

from backend.config import load_env
from backend.paths import ROOT
from backend.learner.definitions import describe, extract


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio',type=Path)
    parser.add_argument('--send-observations-to-claude',action='store_true',
        help='Explicitly send local sound observations (never the audio) to Claude to generate definitions.')
    parser.add_argument('--output',type=Path,help='Optional explicit JSON file; otherwise print JSON to stdout.')
    parser.add_argument('--env',type=Path,default=ROOT/'.env')
    args=parser.parse_args();load_env(args.env)
    evidence,_=extract(args.audio.read_bytes())
    result=describe(dict(evidence=evidence,consent_to_external_processing=True)) if args.send_observations_to_claude else evidence
    text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:args.output.write_text(text,encoding='utf-8')
    else:print(text,end='')


if __name__=='__main__':main()
