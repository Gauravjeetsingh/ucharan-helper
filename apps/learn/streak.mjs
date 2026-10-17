/** Reward existing word feedback; this does not generate a pronunciation grade. */
export const STREAK_LENGTH = 5;

export class LearnStreak {
  constructor(count = 0) {
    this.count = Number.isInteger(count) && count >= 0 && count <= STREAK_LENGTH ? count : 0;
  }

  record(result, words) {
    // Unavailable assessments do not count as a checked turn or erase progress.
    if (result?.status !== 'judged' || !words.length) return false;
    const verdicts = new Map((result.words || []).map(word => [word.id, word.state]));
    const correct = words.filter(word => verdicts.get(word.id) === 'correct').length;
    // Include every expected occurrence, including missing/unclear feedback.
    if (correct * 10 <= words.length * 7) {
      this.count = 0;
      return false;
    }
    this.count = this.count === STREAK_LENGTH ? 1 : this.count + 1;
    return this.count === STREAK_LENGTH;
  }
}
