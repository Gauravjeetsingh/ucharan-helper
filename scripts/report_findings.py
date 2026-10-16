"""Write observed extraction/control results, explicitly separate from validation."""
from collections import Counter
import json
from backend.learn.phone_engine import ROOT


def main():
    ref=json.loads((ROOT/'reference-phones.json').read_text(encoding='utf-8'))
    raw=json.loads((ROOT/'phone-raw.json').read_text(encoding='utf-8'))
    controls=json.loads((ROOT.parent.parent/'evaluation/controls/manifest.json').read_text(encoding='utf-8'))
    default=next(p for p in ref['phrases'] if p['id']==ref['default_phrase_id'])
    lines=['# Acoustic extraction findings — experimental', '',
        f"Actually run with `{ref['model']['id']}` at revision `{ref['model']['revision']}`.",
        'Input was the supplied ustaad audio only. No spelling or ASR transcript was passed to the phonetic recognizer.',
        '',f"Recognized {len(raw['events'])} full-clip phone emissions, {len(set(raw['labels']))} distinct labels, {len(ref['words'])} source word occurrences, and {len(ref['phrases'])} short phrases.",
        f"Full-clip versus short-context labels differ on {sum(w['uncertainty']['context_disagreement'] for w in ref['words'].values())} occurrences. This is instability evidence, not an error rate.",
        '', '## First practice phrase', '',f"**{default['text']}** (`{default['id']}`).", '',
        '| Word occurrence | Draft labels from audio |', '| --- | --- |']
    for wid in default['word_ids']:
        word=ref['words'][wid];lines.append(f"| {word['text']} · {wid} | {' '.join(word['extracted_labels'])} |")
    lines+=['','All labels and their word assignment await listening. These are model symbols, including eSpeak-style nonstandard labels, not a certified IPA transcription.',
        '', '## Inventory audit', '', '| Contrast probe | Present literally | Missing literally |', '| --- | --- | --- |']
    for key,item in ref['inventory_audit'].items():lines.append(f"| {key} | {', '.join(item['present']) or '—'} | {', '.join(item['missing']) or '—'} |")
    lines+=['','This audit checks label presence only. It does not prove that the recognizer distinguishes these sounds in this clip or in learner speech. Nonstandard symbols are preserved without inventing equivalent IPA labels. Tone/breathy quality and unsupported combinations cannot receive sound-specific diagnoses.',
        '', '## Machine controls actually run', '', '| Source control | Result state | Phone-label agreement index |', '| --- | --- | --- |']
    for c in controls['controls']:lines.append(f"| {c['name']} | {c['status']} | {c.get('phone_sequence_agreement_index') if c.get('phone_sequence_agreement_index') is not None else 'withheld'} |")
    lines+=['','These controls reuse the same ustaad audio. Identity is an implementation control; muting a source word is a signal alteration; silence tests abstention. They are not separate learners or ustaad-rated correct/incorrect attempts. Numbers above are not pronunciation accuracy.',
        '', '## Reviewable occurrence drafts', '', '| Occurrence | Gurmukhi | Short-context draft | Context disagreement |', '| --- | --- | --- | --- |']
    for wid,w in ref['words'].items():lines.append(f"| {wid} | {w['text']} | {' '.join(w['extracted_labels']) or '(no labels)'} | {w['uncertainty']['context_disagreement']} |")
    lines+=['', '## Remaining human dependency', '',
        'No reference sound labels, exact student sound errors, learner acceptability ratings or practice thresholds have been validated by an ustaad. The user chose to prepare the review workflow and supply ratings later. The next human milestone is one acceptable learner attempt and one deliberate mistake on the first phrase, judged against this recording. See evaluation/PROTOCOL.md for speaker-disjoint collection, calibration and evaluation. Until then, feedback is a listening hypothesis and the score is only experimental model-label agreement.',
        '', 'Reproduce: `python -m scripts.extract_phones`, `python -m scripts.make_controls`, then `python -m scripts.report_findings`, using the ML Python environment in README.md. Raw full-clip and phrase-context frame log probabilities are in ignored data/evidence/phone-logprobs.npz and data/evidence/phone-context-logprobs.npz. Neither file contains a learner recording.', '']
    (ROOT.parent.parent/'docs/PHONETIC_FINDINGS.md').write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines[:18]))


if __name__=='__main__':main()
