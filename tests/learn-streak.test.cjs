const {test} = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../apps/learn/streak.mjs');
const words = Array.from({length:10}, (_,i) => ({id:String(i), text:'ਸਚੁ'}));
const result = (correct, status='judged') => ({status, words:words.map((w,i) => ({id:w.id, state:i < correct ? 'correct' : 'wrong'}))});

test('Learn requires strictly more than 70% and counts expected occurrence IDs', async () => {
  const {LearnStreak} = await load();
  const streak = new LearnStreak();
  streak.record(result(8),words); assert.equal(streak.count,1);
  streak.record(result(7),words); assert.equal(streak.count,0);
  const repeated = {status:'judged', words:Array.from({length:20},()=>({id:'0',state:'correct'}))};
  streak.record(repeated,words); assert.equal(streak.count,0);
  streak.record({status:'judged',words:words.slice(0,7).map(w=>({...w,state:'correct'}))}, words);
  assert.equal(streak.count,0,'Missing feedback stays in the denominator');
});

test('five consecutive qualifying turns award once, then start a new cycle', async () => {
  const {LearnStreak} = await load();
  const streak = new LearnStreak();
  for (let i=1;i<=5;i++) {
    assert.equal(streak.record(result(8),words),i===5);
    assert.equal(streak.count,i);
  }
  assert.equal(streak.record(result(10),words),false);
  assert.equal(streak.count,1);
  streak.record(result(3),words); assert.equal(streak.count,0);
  for(let i=1;i<=5;i++) assert.equal(streak.record(result(10),words),i===5);
});

test('unavailable assessments do not add or erase turns; stored counts are bounded', async () => {
  const {LearnStreak} = await load();
  const streak = new LearnStreak(2);
  assert.equal(streak.record(result(0,'unclear'),words),false); assert.equal(streak.count,2);
  assert.equal(streak.record({status:'judged',words:[]},[]),false); assert.equal(streak.count,2);
  for(const value of [-1,6,1.2,'2',NaN]) assert.equal(new LearnStreak(value).count,0);
  assert.equal(new LearnStreak(5).count,5);
});
