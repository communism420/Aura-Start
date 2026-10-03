import { loadTimerSound } from "./timerSoundStorage";

export type TimerPlaybackResult = { played: boolean; fallback: boolean; cancelled?: boolean };

function decodeDataUrl(dataUrl: string): ArrayBuffer {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
  return bytes.buffer;
}

/** A context is unlocked by Start/Resume; a blocked browser always gets a visible retry. */
export class TimerPlayback {
  private context: AudioContext | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private gains = new Set<GainNode>();
  private generation = 0;

  async prepare(): Promise<boolean> {
    try {
      if (!this.context || this.context.state === "closed") this.context = new AudioContext();
      if (this.context.state !== "running") {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // Some browsers leave resume() pending until the next user gesture.
          await Promise.race([this.context.resume(), new Promise<void>((resolve) => { timeout = setTimeout(resolve, 300); })]);
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      }
      return this.context.state === "running";
    } catch {
      return false;
    }
  }

  private connect(source: AudioScheduledSourceNode, gain: GainNode, context: AudioContext): void {
    this.sources.add(source);
    this.gains.add(gain);
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      this.sources.delete(source);
      this.gains.delete(gain);
      source.disconnect();
      gain.disconnect();
    };
  }

  async play(soundId: string | null, volume: number): Promise<TimerPlaybackResult> {
    this.stop();
    const generation = this.generation;
    const level = Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) / 100 : 0.8;
    if (level === 0) return { played: true, fallback: false };
    const ready = await this.prepare();
    if (generation !== this.generation) return { played: false, fallback: false, cancelled: true };
    if (!ready) return { played: false, fallback: false };
    const context = this.context!;
    let fallback = false;
    if (soundId) {
      try {
        const sound = await loadTimerSound(soundId);
        if (!sound) throw new Error("Timer sound is missing.");
        if (generation !== this.generation) return { played: false, fallback: false, cancelled: true };
        const buffer = await context.decodeAudioData(decodeDataUrl(sound.playbackDataUrl));
        if (generation !== this.generation || context.state === "closed") return { played: false, fallback: false, cancelled: true };
        if (context.state !== "running") return { played: false, fallback: false };
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = level;
        this.connect(source, gain, context);
        source.start(0, 0, Math.min(buffer.duration, 60));
        return { played: true, fallback: false };
      } catch {
        fallback = true;
      }
    }
    if (generation !== this.generation || context.state === "closed") return { played: false, fallback, cancelled: true };
    if (context.state !== "running") return { played: false, fallback };
    try {
      // A soft three-note chime, repeated four times; no external sound or request.
      for (let repeat = 0; repeat < 4; repeat += 1) {
        [523.25, 659.25, 783.99].forEach((frequency, note) => {
          const source = context.createOscillator();
          const gain = context.createGain();
          const startAt = context.currentTime + 0.02 + repeat * 1.2 + note * 0.18;
          source.type = "sine";
          source.frequency.value = frequency;
          gain.gain.setValueAtTime(0, startAt);
          gain.gain.linearRampToValueAtTime(level * 0.16, startAt + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.7);
          this.connect(source, gain, context);
          source.start(startAt);
          source.stop(startAt + 0.72);
        });
      }
      return { played: true, fallback };
    } catch {
      this.stop();
      return { played: false, fallback };
    }
  }

  stop(): void {
    this.generation += 1;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already finished. */ }
      source.disconnect();
    }
    for (const gain of this.gains) gain.disconnect();
    this.sources.clear();
    this.gains.clear();
  }

  dispose(): void {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }
}
