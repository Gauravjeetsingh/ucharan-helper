const {test} = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../apps/learn/endpoint.mjs');

test('initial silence and brief clicks do not end a recording', async () => {
  const {RecordingEndpoint} = await load();
  const detector = new RecordingEndpoint(0);
  assert.equal(detector.update(0,0),null);
  assert.equal(detector.update(2,0),null);
  detector.update(2.1,.1); detector.update(2.2,.1);
  assert.equal(detector.update(2.3,0),null);
  assert.equal(detector.update(4,0),null);
  assert.equal(detector.speechDetected,false);
});

test('speech followed by 1.5 seconds of quiet ends once, without waiting for reference duration', async () => {
  const {RecordingEndpoint} = await load();
  const detector = new RecordingEndpoint(0);
  detector.update(0,.1); detector.update(.3,.1);
  assert.equal(detector.speechDetected,true);
  assert.equal(detector.update(1.79,0),null);
  assert.equal(detector.update(1.8,0),'silence');
  assert.equal(detector.update(2,.1),'silence');
});

test('a brief pause inside speech restarts the silence window', async () => {
  const {RecordingEndpoint} = await load();
  const detector = new RecordingEndpoint(0);
  detector.update(0,.1); detector.update(.3,.1);
  assert.equal(detector.update(1.3,0),null);
  detector.update(1.4,.1);
  assert.equal(detector.update(2.8,0),null);
  assert.equal(detector.update(2.91,0),'silence');
});

test('the recording limit handles silence or continuous background noise', async () => {
  const {RecordingEndpoint, MAX_RECORDING_SECONDS} = await load();
  const silent = new RecordingEndpoint(0);
  assert.equal(silent.update(MAX_RECORDING_SECONDS,0),'no-speech');
  const noisy = new RecordingEndpoint(0);
  noisy.update(0,.1); noisy.update(.3,.1);
  assert.equal(noisy.update(MAX_RECORDING_SECONDS,.1),'limit');
});
