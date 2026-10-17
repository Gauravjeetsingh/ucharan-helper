/** Local energy-based endpointing; this does not detect words or assess pronunciation. */
export const SILENCE_SECONDS = 1.5;
export const MAX_RECORDING_SECONDS = 14.5;
const VOICE_THRESHOLD = .015;
const VOICE_START_SECONDS = .25;

export class RecordingEndpoint {
  constructor(startedAt) {
    this.startedAt = startedAt;
    this.voiceStartedAt = null;
    this.lastVoiceAt = null;
    this.speechDetected = false;
    this.reason = null;
  }

  update(time, rms) {
    if (this.reason || !Number.isFinite(time) || !Number.isFinite(rms)) return this.reason;
    if (rms >= VOICE_THRESHOLD) {
      this.voiceStartedAt ??= time;
      this.lastVoiceAt = time;
      if (time - this.voiceStartedAt >= VOICE_START_SECONDS) this.speechDetected = true;
    } else {
      this.voiceStartedAt = null;
      if (this.speechDetected && time - this.lastVoiceAt >= SILENCE_SECONDS) this.reason = 'silence';
    }
    if (!this.reason && time - this.startedAt >= MAX_RECORDING_SECONDS) {
      this.reason = this.speechDetected ? 'limit' : 'no-speech';
    }
    return this.reason;
  }
}
