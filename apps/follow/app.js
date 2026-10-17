import {FollowSession, EARLY_GRACE, LATE_GRACE} from './session.mjs';
import {celebratePetals} from '../shared/celebration.mjs';

const $ = id => document.getElementById(id);
const audio = $('paath');
const reader = $('reader');
let source, session, words, clipStart, clipEnd, frame, starting = false, ready = false;
let activeVerse = -1;
let fullLesson, section, pauri = Math.max(1, Math.min(38, Math.trunc(Number(new URLSearchParams(location.search).get('pauri'))) || 1));
let clipOffset = 0, blobUrl;
const now = () => audio.currentTime + clipOffset;
const buttons = new Map();
const COIN_KEY = 'uchaaran-nanak-coins';
let coins = 0;
try {
  const stored = Number(sessionStorage.getItem(COIN_KEY));
  if (Number.isSafeInteger(stored) && stored >= 0) coins = stored;
} catch {}
$('points').value = coins;
let cancelCelebration;

function stopCelebration() {
  cancelCelebration?.(); cancelCelebration = null;
}

function celebrate(earned) {
  stopCelebration();
  cancelCelebration = celebratePetals($('celebration'),document.querySelector('.points'),{
    earned, petalCount:earned ? 72 : 42,
    onCollect:() => { $('points').value = coins; }
  });
}

function stopFrame() { cancelAnimationFrame(frame); }
function message(text) { $('status').textContent = text; }

function renderText() {
  const fragment = document.createDocumentFragment();
  for (const [index, verse] of source.verses.entries()) {
    const block = document.createElement('div');
    block.className = 'verse'; block.dataset.verseIndex = index;
    const line = document.createElement('p'); line.className = 'gurmukhi-line'; line.lang = 'pa';
    const characters = Array.from(fullLesson.source.text);
    let position = verse.source_start;
    for (const word of verse.words) {
      line.append(document.createTextNode(characters.slice(position, word.source_start).join('')));
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'follow-word'; button.textContent = word.text;
      button.dataset.wordId = word.id;
      button.disabled = true;
      button.addEventListener('click', () => {
        if (button.disabled || audio.paused || audio.ended || session.results.has(word.id)) return;
        const time = now();
        // Recheck the media clock in case the passage changed since the last frame.
        updateVerse(time);
        if (word.verse_id !== source.verses[activeVerse]?.verse_id) { render(); return; }
        const tap = session.tap(word.id, time);
        if (tap) {
          message(tap.status === 'caught' ? 'Caught it.' : tap.reason === 'too_early' ? 'A little early. Listen for the next word.' : 'A little late. Keep listening.');
          render();
        }
      });
      buttons.set(word.id, button); line.append(button);
      position = word.source_end;
    }
    line.append(document.createTextNode(characters.slice(position, verse.source_end).join('')));
    block.append(line); fragment.append(block);
  }
  reader.replaceChildren(fragment);
}

function updateVerse(time) {
  // Playback determines the visible passage, including after an early wrong tap.
  const current = words.find(word => time <= word.end + LATE_GRACE) || words.at(-1);
  const index = source.verses.findIndex(verse => verse.verse_id === current.verse_id);
  if (index === activeVerse) return;
  activeVerse = index;
  for (const [i, block] of [...reader.children].entries()) {
    block.classList.toggle('is-active', i === index);
    block.classList.toggle('is-past', i < index);
  }
  const block = reader.children[index];
  reader.scrollTo({top: Math.max(0, block.offsetTop - 26), behavior: 'instant'});
}

function renderResults() {
  const {caught, total, coinsEarned} = session.stats;
  $('result-title').hidden = !coinsEarned;
  $('result-message').hidden = !coinsEarned;
  $('result-title').textContent = `You caught ${caught} of ${total} words`;
  const missed = words.filter(word => session.results.get(word.id)?.status === 'missed');
  $('result-message').textContent = missed.length ? 'Missed words have a red line. Listen for them next time.' : 'You followed every word. ਸ਼ਾਬਾਸ਼!';
  $('coin-reward').textContent = session.stats.coinsEarned
    ? '+1 Nanak Coin · ਸ਼ਾਬਾਸ਼!'
    : 'Catch at least 70% of the words to earn a Nanak Coin.';
  $('missed-words').replaceChildren(...missed.map(word => {
    const chip = document.createElement('span'); chip.className = 'missed-chip';
    chip.textContent = word.text; chip.lang = 'pa'; chip.dataset.wordId = word.id;
    return chip;
  }));
}

function render() {
  const {caught, missed} = session.stats;
  for (const [id, value] of [['caught', caught], ['missed', missed]]) {
    if ($(id).value !== String(value)) $(id).value = value;
  }
  const playing = session.state === 'playing', completed = session.state === 'completed';
  $('practice').hidden = completed; $('results').hidden = !completed;
  // SVG elements do not reflect the HTMLElement.hidden property.
  const retry = completed && !session.stats.coinsEarned;
  $('play-icon').toggleAttribute('hidden', playing || retry);
  $('pause-icon').toggleAttribute('hidden', !playing);
  $('retry-icon').toggleAttribute('hidden', !retry);
  const label = retry ? 'Retry' : completed ? 'Play again' : playing ? 'Pause' : session.state === 'paused' ? 'Continue' : 'Play';
  $('play-label').textContent = label;
  $('play').setAttribute('aria-label', retry ? 'Retry pauri' : completed ? 'Play again' : playing ? 'Pause audio' : 'Play audio');
  $('play').disabled = !ready || starting;
  $('restart').hidden = session.state !== 'paused';
  $('next-pauri').hidden = !completed || pauri === 38;
  if (playing) updateVerse(now());
  for (const word of words) {
    const button = buttons.get(word.id), result = session.results.get(word.id);
    const state = result?.status || 'pending';
    // Animate only the transition; animation frames never change a judgement.
    if (button.dataset.result !== state) {
      button.classList.remove('word-caught','word-missed');
      if (result) button.classList.add(`word-${state}`);
    }
    button.dataset.result = state;
    const active = word.verse_id === source.verses[activeVerse]?.verse_id;
    button.disabled = starting || !playing || !active || !!result;
    button.setAttribute('aria-label', `${word.text} — ${result?.status || (active ? 'tap as you hear it' : 'inactive')}`);
    button.classList.toggle('is-current', active && !result && playing && now() >= word.start - EARLY_GRACE && now() <= word.end + LATE_GRACE);
  }
  const encouragement = session.streak >= 3 ? `ਸ਼ਾਬਾਸ਼! ${session.streak} in a row` : '';
  if ($('encouragement').textContent !== encouragement) $('encouragement').textContent = encouragement;
  if (completed) renderResults();
  $('instruction').textContent = playing ? 'Tap each word as you hear it' : 'Press play and listen closely';
}

function finish() {
  if (session.state !== 'playing') return;
  session.finish(now()); stopFrame(); audio.pause();
  const earned = session.stats.coinsEarned;
  if (earned) {
    coins += earned;
    try { sessionStorage.setItem(COIN_KEY, String(coins)); } catch {}
  }
  $('progress').value = 1; render(); celebrate(earned);
  message(earned ? 'Pauri complete. You earned one Nanak Coin!' : 'Pauri complete. Keep listening and try again.');
  try {
    const previous = JSON.parse(sessionStorage.getItem('uchaaran-followed-pauris') || '[]');
    sessionStorage.setItem('uchaaran-followed-pauris', JSON.stringify([...new Set([...previous, pauri])]));
  } catch {}
}

function tick() {
  if (session?.state !== 'playing') return;
  session.advance(now());
  $('progress').value = Math.max(0, Math.min(1, (now()-clipStart)/(clipEnd-clipStart)));
  if (now() >= clipEnd || audio.ended) { finish(); return; }
  render();
}

function loop() { tick(); if (session.state === 'playing') frame = requestAnimationFrame(loop); }

function reset() {
  stopCelebration(); stopFrame(); session.reset(); audio.pause(); audio.currentTime = Math.max(0, clipStart - clipOffset);
  activeVerse = -1; $('progress').value = 0;
  // Reveal the reader before scrolling: hidden elements retain old scroll offsets.
  render(); reader.scrollTop = 0; updateVerse(clipStart);
  message('Press play, listen, and tap along.');
}

async function play() {
  if (!ready || starting) return;
  if (session.state === 'completed') reset();
  if (session.state === 'ready') audio.currentTime = Math.max(0, clipStart - clipOffset);
  starting = true; session.play(); render();
  try {
    await audio.play(); message('Tap each word as you hear it.');
    stopFrame(); frame = requestAnimationFrame(loop);
  } catch {
    session.pause(); message('Audio could not start. Press play to try again.');
  } finally { starting = false; render(); }
}

$('play').addEventListener('click', () => {
  if (session.state === 'playing') {
    session.advance(now()); session.pause(); audio.pause(); stopFrame(); render();
    message('Paused. Continue when you’re ready.');
  } else play();
});
$('restart').addEventListener('click', reset);
audio.addEventListener('timeupdate', tick);
audio.addEventListener('ended', () => { if (session) finish(); });
audio.addEventListener('pause', () => {
  if (session?.state === 'playing' && !audio.ended) {
    session.pause(); stopFrame(); render(); message('Paused. Continue when you’re ready.');
  }
});
window.addEventListener('pagehide', () => { stopCelebration(); stopFrame(); audio.pause(); if(blobUrl) URL.revokeObjectURL(blobUrl); });
$('next-pauri').onclick = () => { pauri++; history.replaceState(null,'',`/follow?pauri=${pauri}`); loadSection().catch(error=>message(error.message)); };

async function loadSection() {
    ready = false; stopCelebration(); stopFrame(); audio.pause(); buttons.clear();
    section = fullLesson.sections.find(s => s.id === `pauri-${pauri}`);
    source = {verses:fullLesson.verses.filter(v => section.verse_ids.includes(v.verse_id))};
    $('pauri-label').textContent = `PAURI ${pauri} OF 38`;
    words = source.verses.flatMap(verse => verse.words);
    session = new FollowSession(words); renderText(); render(); message('Loading the paath…');
    const recording = await fetch(`/api/learn/screens/audio?lesson_id=japji-sahib-full&section_id=${section.id}`);
    if (!recording.ok) { const error = await recording.json().catch(()=>({})); throw Error(error.error || 'The recording could not load.'); }
    clipOffset = Number(recording.headers.get('X-Audio-Start'));
    audio.dataset.referenceStart = clipOffset;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(await recording.blob()); audio.src = blobUrl;
    audio.load();
    if (audio.readyState < 1) await new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', resolve, {once: true});
      audio.addEventListener('error', () => reject(Error('The recording could not load. Refresh to try again.')), {once: true});
    });
    if (!Number.isFinite(audio.duration) || words.at(-1).end - clipOffset > audio.duration + .01) throw Error('The audio does not cover the reference timings.');
    clipStart = section.start;
    clipEnd = Math.min(clipOffset + audio.duration, section.end);
    ready = true; reset();
}
async function init() {
  try {
    const response = await fetch('/data/lessons/japji-sahib-full.json');
    if (!response.ok) throw Error('The reference timings could not load.');
    fullLesson = await response.json();
    await loadSection();
  } catch (error) { message(error.message); $('play-label').textContent = 'Unable to load'; }
}

init();
