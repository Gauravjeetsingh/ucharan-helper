/** Tap timing only. This does not assess recitation or pronunciation. */
export const EARLY_GRACE = 0.18;
export const LATE_GRACE = 0.32;

export class FollowSession {
  constructor(words) {
    if (!words.length || new Set(words.map(w => w.id)).size !== words.length ||
        words.some(w => !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end <= w.start)) {
      throw Error('The recording needs valid, distinct word timings.');
    }
    this.words = words;
    this.byId = new Map(words.map(word => [word.id, word]));
    this.reset();
  }

  reset() {
    this.state = 'ready';
    this.results = new Map();
    this.streak = 0;
    this.lastTap = null;
  }

  play() {
    if (this.state !== 'completed') this.state = 'playing';
  }

  pause() {
    if (this.state === 'playing') this.state = 'paused';
  }

  mark(word, status, reason, time) {
    if (this.results.has(word.id)) return false;
    this.results.set(word.id, {status, reason, time});
    this.streak = status === 'caught' ? this.streak + 1 : 0;
    return true;
  }

  advance(time) {
    if (this.state !== 'playing' || !Number.isFinite(time)) return;
    for (const word of this.words) {
      if (time > word.end + LATE_GRACE) this.mark(word, 'missed', 'not_tapped_in_time', time);
    }
  }

  tap(id, time) {
    if (this.state !== 'playing' || !Number.isFinite(time)) return null;
    const word = this.byId.get(id);
    if (!word || this.results.has(id)) return null;
    this.advance(time);
    if (!this.results.has(id)) {
      const onTime = time >= word.start - EARLY_GRACE && time <= word.end + LATE_GRACE;
      this.mark(word, onTime ? 'caught' : 'missed', onTime ? 'in_time' : 'too_early', time);
    }
    this.lastTap = {id, ...this.results.get(id)};
    return this.lastTap;
  }

  finish(time) {
    if (this.state !== 'playing') return;
    for (const word of this.words) this.mark(word, 'missed', 'not_tapped_in_time', time);
    this.state = 'completed';
  }

  get stats() {
    const caught = [...this.results.values()].filter(result => result.status === 'caught').length;
    const missed = this.results.size - caught;
    return {caught, missed, total: this.words.length, coinsEarned: this.state === 'completed' && caught * 10 >= this.words.length * 7 ? 1 : 0};
  }
}
