// Review page for pronunciation cards: listen to the ustaad, correct each sound, confirm.
const $ = id => document.getElementById(id);
let cards, ctx, ustaad, playing;
const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };

async function play(start, end) {
  ctx ||= new AudioContext(); await ctx.resume();
  ustaad ||= await ctx.decodeAudioData(await (await fetch(cards.audio)).arrayBuffer());
  if (playing) { try { playing.stop(); } catch {} }
  playing = ctx.createBufferSource(); playing.buffer = ustaad; playing.connect(ctx.destination);
  playing.start(0, Math.max(0, start), end - start);
}

function summary() {
  const all = Object.values(cards.words);
  const confirmed = all.filter(c => c.status === 'confirmed').length;
  const flagged = all.filter(c => c.status !== 'confirmed' && c.measured?.flags?.length).length;
  $('cards-summary').textContent = `${confirmed} of ${all.length} words confirmed · ${flagged} unconfirmed with a model disagreement to check.`;
}

function measuredLine(m) {
  if (!m) return el('p', {className: 'hint', textContent: 'Not measured yet (run python -m scripts.measure_cards).'});
  const parts = m.pieces.map(p => {
    const alts = Object.entries(p.alternatives).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ');
    return `${p.piece} ${Math.round(p.prob * 100)}%${alts ? ` (also ${alts})` : ''}`;
  });
  const line = el('p', {className: 'hint measured'}, 'Models heard: ', el('span', {className: 'gurmukhi-sm', textContent: m.heard || '(nothing)'}), ` · ${parts.join(' · ')}`);
  if (m.phone_labels) line.append(` · sound labels: ${m.phone_labels.join(' ')}`);
  return line;
}

function render(wid, timing) {
  const card = cards.words[wid];
  const box = el('article', {className: `card word-card ${card.status}`});
  box.dataset.wordId = wid;
  const listen = el('button', {textContent: '▶ Listen'});
  listen.onclick = () => play(timing.start - .08, timing.end + .08).catch(e => { status.textContent = e.message; });
  box.append(el('div', {className: 'word-head'},
    el('span', {className: 'gurmukhi-lg', textContent: card.text}), listen,
    el('span', {className: `badge ${card.status}`, textContent: card.status === 'confirmed' ? `✓ confirmed${card.reviewed_by ? ' by ' + card.reviewed_by : ''}` : 'draft'})));
  box.append(measuredLine(card.measured));
  for (const flag of card.measured?.flags || []) box.append(el('p', {className: 'flag'}, el('span', {className: 'flag-dot'}), flag));
  const table = el('div', {className: 'sounds'});
  card.sounds.forEach((sound, i) => {
    const row = el('div', {className: 'sound-row'});
    row.dataset.index = i;
    const say = el('input', {value: sound.say, maxLength: 300}); say.dataset.field = 'say'; say.setAttribute('aria-label', `How the ustaad says ${sound.letters}`);
    const not = el('input', {value: sound.not || '', maxLength: 300, placeholder: 'not like… (optional)'}); not.dataset.field = 'not'; not.setAttribute('aria-label', `What ${sound.letters} is not`);
    const check = el('select', {}, el('option', {value: 'check', textContent: 'Check'}), el('option', {value: 'tip', textContent: 'Tip only'}));
    check.value = sound.check; check.dataset.field = 'check'; check.setAttribute('aria-label', `Check mode for ${sound.letters}`);
    row.append(el('span', {className: 'letters gurmukhi-sm', textContent: sound.letters}), say, not, check);
    if (sound.voicing) {
      const voicing = el('select', {}, el('option', {value: 'voiceless', textContent: 'soft (p/t/k, tone)'}), el('option', {value: 'voiced', textContent: 'voiced (bh/dh/gh)'}));
      voicing.value = sound.voicing; voicing.dataset.field = 'voicing'; voicing.setAttribute('aria-label', `Voicing for ${sound.letters}`);
      row.append(voicing);
    }
    table.append(row);
  });
  box.append(table);
  const note = el('input', {value: card.note || '', maxLength: 1000, placeholder: 'Note (optional)'}); note.className = 'note';
  const status = el('span', {className: 'hint', role: 'status'});
  const save = confirmed => async () => {
    const sounds = [...table.querySelectorAll('.sound-row')].map(row => Object.fromEntries([...row.querySelectorAll('[data-field]')].map(n => [n.dataset.field, n.value])));
    status.textContent = 'Saving…';
    try {
      const response = await fetch('/api/learn/screens/cards', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({word_id: wid, sounds, status: confirmed ? 'confirmed' : 'draft', note: note.value, reviewed_by: $('cards-reviewer').value})});
      const value = await response.json();
      if (!response.ok) throw Error(value.error || 'Could not save.');
      cards.words[wid] = {...card, ...value.card};
      box.replaceWith(render(wid, timing)); summary();
    } catch (e) { status.textContent = e.message; }
  };
  const draft = el('button', {textContent: 'Save draft'}); draft.onclick = save(false);
  const confirm = el('button', {className: 'primary', textContent: card.status === 'confirmed' ? '✓ Save and keep confirmed' : '✓ Confirm'}); confirm.onclick = save(true);
  box.append(note, el('div', {className: 'actions'}, confirm, draft, status));
  return box;
}

async function init() {
  const [c, t] = await Promise.all([fetch('/data/lessons/pronunciation-cards.json'), fetch('/data/reference/word-timings.json')]);
  if (!c.ok) throw Error('pronunciation-cards.json not found.');
  cards = await c.json();
  const timings = Object.fromEntries((await t.json()).verses.flatMap(v => v.words).map(w => [w.id, w]));
  try { $('cards-reviewer').value = localStorage.getItem('uchaaran-card-reviewer') || ''; } catch {}
  $('cards-reviewer').onchange = () => { try { localStorage.setItem('uchaaran-card-reviewer', $('cards-reviewer').value); } catch {} };
  $('cards-list').replaceChildren(...Object.keys(cards.words).map(wid => render(wid, timings[wid])));
  summary();
}
init().catch(e => { $('cards-summary').textContent = `Could not load cards: ${e.message}`; });
