/** A timing prompt from the ustaad reference, independent of student assessment. */
export const RECORDING_GUIDE_RATE = 1.08;

export function recordingGuideWord(words, elapsed) {
  if (!words.length || !Number.isFinite(elapsed) || elapsed < 0) return null;
  const position = words[0].start + elapsed * RECORDING_GUIDE_RATE;
  if (position >= words.at(-1).end) return null;
  // Keep one word highlighted through pauses, until the next occurrence starts.
  let current = words[0];
  for (const word of words) {
    if (word.start > position) break;
    current = word;
  }
  return current.id;
}
