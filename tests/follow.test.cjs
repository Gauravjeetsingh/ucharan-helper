const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = () => import('../apps/follow/session.mjs');
const words = [
  {id:'one',text:'ਸਚੁ',start:1,end:2},
  {id:'two',text:'ਸਚੁ',start:3,end:4},
  {id:'three',text:'ਹੈ',start:5,end:6}
];

test('a tap is judged against its own audio interval, with inclusive grace', async () => {
  const {FollowSession, EARLY_GRACE, LATE_GRACE} = await load();
  for (const time of [1-EARLY_GRACE,1,1.5,2,2+LATE_GRACE]) {
    const session = new FollowSession(words); session.play();
    assert.equal(session.tap('one',time).status,'caught');
  }
  const early = new FollowSession(words); early.play();
  assert.equal(early.tap('two',1.5).reason,'too_early');
  assert.equal(early.stats.missed,1);
  const late = new FollowSession(words); late.play();
  assert.equal(late.tap('one',2+LATE_GRACE+.01).status,'missed');
});

test('ready and paused time do not mark words; double taps cannot score twice', async () => {
  const {FollowSession} = await load();
  const session = new FollowSession(words);
  assert.equal(session.tap('one',1.5),null);
  session.advance(10); assert.equal(session.stats.missed,0);
  session.play(); session.tap('one',1.5); session.tap('one',1.6);
  assert.equal(session.stats.caught,1);
  session.pause(); session.advance(10);
  assert.equal(session.tap('two',3.5),null); assert.equal(session.stats.missed,0);
  session.play(); session.advance(4.5); assert.equal(session.stats.missed,1);
});

test('unanswered words expire once, including after background-frame gaps', async () => {
  const {FollowSession} = await load();
  const session = new FollowSession(words); session.play();
  session.advance(4.5); session.advance(4.6);
  assert.equal(session.stats.missed,2); assert.equal(session.stats.points,0);
  session.tap('three',5.5); assert.equal(session.stats.points,0);
  session.finish(6.4); assert.equal(session.state,'completed');
  assert.equal(session.stats.caught+session.stats.missed,words.length);
});

test('repeated text uses distinct occurrences and restarting clears all state', async () => {
  const {FollowSession} = await load();
  const session = new FollowSession(words); session.play();
  session.tap('one',1.5); session.tap('two',3.5);
  assert.equal(session.stats.caught,2); assert.equal(session.streak,2);
  session.tap('three',3.6);
  assert.equal(session.streak,0); assert.equal(session.stats.points,15);
  session.finish(6.4); session.reset();
  assert.deepEqual(session.stats,{caught:0,missed:0,total:3,points:0});
  assert.equal(session.state,'ready'); assert.equal(session.lastTap,null);
});

test('the supplied 25-word clip completes with exact source identities', async () => {
  const {FollowSession} = await load();
  const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/reference/word-timings.json'),'utf8'));
  const sample=source.verses.flatMap(v=>v.words), session=new FollowSession(sample);
  session.play();
  for(const word of sample) session.tap(word.id,(word.start+word.end)/2);
  session.finish(sample.at(-1).end+.4);
  assert.deepEqual(session.stats,{caught:25,missed:0,total:25,points:250});
  assert.equal(session.results.size,25);
});
