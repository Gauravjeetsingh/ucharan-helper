const {test} = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../apps/learn/guide.mjs');
const words = [
  {id:'one',text:'ਸਚੁ',start:12,end:13},
  {id:'two',text:'ਸਚੁ',start:14,end:15},
  {id:'three',text:'ਹੈ',start:15,end:16}
];

test('recording prompt follows reference intervals at a gently faster pace', async () => {
  const {recordingGuideWord, RECORDING_GUIDE_RATE} = await load();
  assert.equal(RECORDING_GUIDE_RATE,1.08);
  assert.equal(recordingGuideWord(words,0),'one');
  assert.equal(recordingGuideWord(words,2/RECORDING_GUIDE_RATE-.001),'one');
  assert.equal(recordingGuideWord(words,2/RECORDING_GUIDE_RATE+.001),'two');
  assert.equal(recordingGuideWord(words,3/RECORDING_GUIDE_RATE+.001),'three');
  assert.equal(recordingGuideWord(words,4/RECORDING_GUIDE_RATE+.001),null);
});

test('gaps retain a prompt; repeated text keeps separate occurrences; retry starts over', async () => {
  const {recordingGuideWord} = await load();
  assert.equal(recordingGuideWord(words,1.5),'one');
  assert.equal(recordingGuideWord(words,2),'two');
  assert.equal(recordingGuideWord(words,10),null);
  assert.equal(recordingGuideWord(words,0),'one');
  assert.equal(recordingGuideWord([],0),null);
  assert.equal(recordingGuideWord(words,-1),null);
  assert.equal(recordingGuideWord(words,NaN),null);
});
