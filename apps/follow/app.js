import {FollowSession, EARLY_GRACE, LATE_GRACE} from './session.mjs';

const $ = id => document.getElementById(id);
const audio = $('paath');
const reader = $('reader');
let source, session, words, clipStart, clipEnd, frame, starting = false, ready = false;
let activeVerse = -1;
const buttons = new Map();

function stopFrame() { cancelAnimationFrame(frame); }
function message(text) { $('status').textContent = text; }

function renderText() {
  const fragment = document.createDocumentFragment();
  for (const [index, verse] of source.verses.entries()) {
    const block = document.createElement('div');
    block.className = 'verse'; block.dataset.verseIndex = index;
    const line = document.createElement('p'); line.className = 'gurmukhi-line'; line.lang = 'pa';
    const characters = Array.from(verse.text);
    let position = 0;
    for (const word of verse.words) {
      line.append(document.createTextNode(characters.slice(position, word.source_start).join('')));
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'follow-word'; button.textContent = word.text;
      button.dataset.wordId = word.id;
      button.disabled = true;
      button.addEventListener('click', () => {
        if (audio.paused || audio.ended) return;
        const tap = session.tap(word.id, audio.currentTime);
        if (tap) {
          message(tap.status === 'caught' ? 'Caught it.' : tap.reason === 'too_early' ? 'A little early. Listen for the next word.' : 'A little late. Keep listening.');
          render();
        }
      });
      buttons.set(word.id, button); line.append(button);
      position = word.source_end;
    }
    line.append(document.createTextNode(characters.slice(position).join('')));
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
  const {caught, total} = session.stats;
  $('result-title').textContent = `You caught ${caught} of ${total} words`;
  const missed = words.filter(word => session.results.get(word.id)?.status === 'missed');
  $('result-message').textContent = missed.length ? 'Missed words have a red line. Listen for them next time.' : 'You followed every word. ਸ਼ਾਬਾਸ਼!';
  const stars = caught === 0 ? 0 : caught / total >= .9 ? 3 : caught / total >= .7 ? 2 : 1;
  $('stars').replaceChildren(...Array.from({length: 3}, (_, i) => {
    const star = document.createElement('span'); star.textContent = i < stars ? '★' : '☆';
    star.setAttribute('aria-hidden', 'true'); return star;
  }));
  $('stars').setAttribute('aria-label', `${stars} of 3 stars`);
  $('missed-words').replaceChildren(...missed.map(word => {
    const chip = document.createElement('span'); chip.className = 'missed-chip';
    chip.textContent = word.text; chip.lang = 'pa'; chip.dataset.wordId = word.id;
    return chip;
  }));
}

function render() {
  const {caught, missed, points} = session.stats;
  for (const [id, value] of [['caught', caught], ['missed', missed], ['points', points]]) {
    if ($(id).value !== String(value)) $(id).value = value;
  }
  const playing = session.state === 'playing', completed = session.state === 'completed';
  $('practice').hidden = completed; $('results').hidden = !completed;
  $('play-icon').hidden = playing; $('pause-icon').hidden = !playing;
  const label = completed ? 'Play again' : playing ? 'Pause' : session.state === 'paused' ? 'Continue' : 'Play';
  $('play-label').textContent = label;
  $('play').setAttribute('aria-label', completed ? 'Play again' : playing ? 'Pause audio' : 'Play audio');
  $('play').disabled = !ready || starting;
  $('restart').hidden = session.state !== 'paused';
  for (const word of words) {
    const button = buttons.get(word.id), result = session.results.get(word.id);
    button.dataset.result = result?.status || 'pending';
    button.disabled = !playing || starting || !!result;
    button.setAttribute('aria-label', `${word.text} — ${result?.status || 'tap as you hear it'}`);
    button.classList.toggle('is-current', !result && playing && audio.currentTime >= word.start - EARLY_GRACE && audio.currentTime <= word.end + LATE_GRACE);
  }
  const encouragement = session.streak >= 3 ? `ਸ਼ਾਬਾਸ਼! ${session.streak} in a row` : '';
  if ($('encouragement').textContent !== encouragement) $('encouragement').textContent = encouragement;
  if (completed) renderResults();
}

function finish() {
  if (session.state !== 'playing') return;
  session.finish(audio.currentTime); stopFrame(); audio.pause();
  $('progress').value = 1; render(); message('Round complete. Play again whenever you’re ready.');
}

function tick() {
  if (session?.state !== 'playing') return;
  session.advance(audio.currentTime);
  $('progress').value = Math.max(0, Math.min(1, (audio.currentTime-clipStart)/(clipEnd-clipStart)));
  if (audio.currentTime >= clipEnd || audio.ended) { finish(); return; }
  updateVerse(audio.currentTime); render();
}

function loop() { tick(); if (session.state === 'playing') frame = requestAnimationFrame(loop); }

function reset() {
  stopFrame(); session.reset(); audio.pause(); audio.currentTime = clipStart;
  activeVerse = -1; $('progress').value = 0;
  // Reveal the reader before scrolling: hidden elements retain old scroll offsets.
  render(); reader.scrollTop = 0; updateVerse(clipStart);
  message('Press play, listen, and tap along.');
}

async function play() {
  if (!ready || starting) return;
  if (session.state === 'completed') reset();
  if (session.state === 'ready') audio.currentTime = clipStart;
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
    session.advance(audio.currentTime); session.pause(); audio.pause(); stopFrame(); render();
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
window.addEventListener('pagehide', () => { stopFrame(); audio.pause(); });

async function init() {
  try {
    const response = await fetch('/data/reference/word-timings.json');
    if (!response.ok) throw Error('The reference timings could not load.');
    source = await response.json();
    words = source.verses.flatMap(verse => verse.words);
    session = new FollowSession(words); renderText();
    // Buffer the short clip before play: Blob media supports reliable seeking
    // even when the development file server does not implement HTTP ranges.
    const recording = await fetch('/data/reference/recording.wav');
    if (!recording.ok) throw Error('The recording could not load. Refresh to try again.');
    audio.src = URL.createObjectURL(await recording.blob());
    audio.load();
    if (audio.readyState < 1) await new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', resolve, {once: true});
      audio.addEventListener('error', () => reject(Error('The recording could not load. Refresh to try again.')), {once: true});
      if (audio.error) reject(Error('The recording could not load. Refresh to try again.'));
    });
    if (!Number.isFinite(audio.duration) || words.at(-1).end > audio.duration) throw Error('The audio does not cover the reference timings.');
    clipStart = Math.max(0, words[0].start - .45);
    clipEnd = Math.min(audio.duration, words.at(-1).end + LATE_GRACE + .03);
    ready = true; reset();
  } catch (error) { message(error.message); $('play-label').textContent = 'Unable to load'; }
}

init();
