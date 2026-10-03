import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerPlayback } from "./timerPlayback";

const { loadSound } = vi.hoisted(() => ({ loadSound: vi.fn() }));
vi.mock("./timerSoundStorage", () => ({ loadTimerSound: loadSound }));

class FakeSource {
  onended: (() => void) | null = null;
  buffer: unknown;
  type = "sine";
  frequency = { value: 0 };
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain {
  gain = { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeContext {
  static instances: FakeContext[] = [];
  state: AudioContextState = "suspended";
  currentTime = 5;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  decodeAudioData = vi.fn(async () => ({ duration: 15 }));
  constructor() { FakeContext.instances.push(this); }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  createOscillator() { const source = new FakeSource(); this.sources.push(source); return source; }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
}

describe("countdown playback", () => {
  beforeEach(() => {
    FakeContext.instances = [];
    loadSound.mockReset();
    vi.stubGlobal("AudioContext", FakeContext);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("plays the canonical custom sound at the chosen volume and releases ended nodes", async () => {
    loadSound.mockResolvedValue({ name: "alarm.flac", dataUrl: "data:audio/flac;base64,AQID", playbackDataUrl: "data:audio/wav;base64,AQID" });
    const playback = new TimerPlayback();
    expect(await playback.play("sound-id", 35)).toEqual({ played: true, fallback: false });
    const context = FakeContext.instances[0];
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(context.gains[0].gain.value).toBe(0.35);
    expect(context.sources[0].start).toHaveBeenCalledWith(0, 0, 15);
    context.sources[0].onended?.();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(context.gains[0].disconnect).toHaveBeenCalledOnce();
    playback.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("falls back to a bounded built-in chime when a custom asset cannot load", async () => {
    loadSound.mockRejectedValue(new Error("missing"));
    const playback = new TimerPlayback();
    expect(await playback.play("missing", 80)).toEqual({ played: true, fallback: true });
    const context = FakeContext.instances[0];
    expect(context.sources).toHaveLength(12);
    expect(Math.max(...context.sources.flatMap((source) => source.stop.mock.calls.map((call) => Number(call[0]))))).toBeLessThan(10);
    playback.stop();
    expect(context.sources.every((source) => source.disconnect.mock.calls.length === 1)).toBe(true);
    playback.dispose();
  });

  it("stopping while a custom sound loads prevents late playback and fallback", async () => {
    let resolveSound!: (value: unknown) => void;
    loadSound.mockReturnValue(new Promise((resolve) => { resolveSound = resolve; }));
    const playback = new TimerPlayback();
    const result = playback.play("delayed", 80);
    await vi.waitFor(() => expect(loadSound).toHaveBeenCalled());
    playback.stop();
    resolveSound({ playbackDataUrl: "data:audio/wav;base64,AQID" });
    expect(await result).toEqual({ played: false, fallback: false, cancelled: true });
    expect(FakeContext.instances[0].sources).toHaveLength(0);
    playback.dispose();
  });

  it("returns a visible-retry outcome when browser resume remains blocked", async () => {
    vi.useFakeTimers();
    const playback = new TimerPlayback();
    // Construct the context before replacing its resume behavior.
    await playback.prepare();
    const context = FakeContext.instances[0];
    context.state = "suspended";
    context.resume.mockImplementation(() => new Promise(() => undefined));
    const playing = playback.play(null, 80);
    await vi.advanceTimersByTimeAsync(300);
    expect(await playing).toEqual({ played: false, fallback: false });
    expect(context.sources).toHaveLength(0);
    playback.dispose();
  });

  it.each(["stop", "dispose"] as const)("%s during a blocked resume cancels the stale retry notice", async (action) => {
    vi.useFakeTimers();
    const playback = new TimerPlayback();
    await playback.prepare();
    const context = FakeContext.instances[0];
    context.state = "suspended";
    context.resume.mockImplementation(() => new Promise(() => undefined));
    const playing = playback.play(null, 80);
    playback[action]();
    await vi.advanceTimersByTimeAsync(300);
    expect(await playing).toEqual({ played: false, fallback: false, cancelled: true });
    expect(context.sources).toHaveLength(0);
    playback.dispose();
  });

  it("keeps an explicit muted volume without scheduling any audible nodes", async () => {
    const playback = new TimerPlayback();
    expect(await playback.play(null, 0)).toEqual({ played: true, fallback: false });
    expect(FakeContext.instances).toHaveLength(0);
    playback.dispose();
  });

  it("muting an already playing alarm stops it without requiring another audio activation", async () => {
    const playback = new TimerPlayback();
    await playback.play(null, 80);
    const context = FakeContext.instances[0];
    expect(context.sources).toHaveLength(12);
    context.state = "suspended";
    context.resume.mockClear();
    expect(await playback.play(null, 0)).toEqual({ played: true, fallback: false });
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.sources.every((source) => source.disconnect.mock.calls.length === 1)).toBe(true);
    playback.dispose();
  });
});
