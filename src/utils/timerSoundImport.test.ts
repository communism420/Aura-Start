import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizeTimerWav, encodeTimerAudioBuffer, prepareTimerSound, TIMER_SOUND_ACCEPT } from "./timerSoundImport";
import { isCanonicalTimerWav, MAX_TIMER_PLAYBACK_BYTES, timerSoundBytesFromDataUrl } from "./timerSoundStorage";

const codec = vi.hoisted(() => ({ load: vi.fn(), writeFile: vi.fn(), exec: vi.fn(), readFile: vi.fn(), terminate: vi.fn() }));
vi.mock("@ffmpeg/ffmpeg", () => ({ FFmpeg: class { load = codec.load; writeFile = codec.writeFile; exec = codec.exec; readFile = codec.readFile; terminate = codec.terminate; } }));
vi.mock("@ffmpeg/ffmpeg/worker?worker&url", () => ({ default: "/assets/timer-audio-worker.js" }));

const SAMPLE_WAV = encodeTimerAudioBuffer({
  duration: 2 / 24_000, sampleRate: 24_000, numberOfChannels: 1, length: 2,
  getChannelData: () => new Float32Array([0.25, -0.25])
});

beforeEach(() => {
  vi.clearAllMocks();
  codec.load.mockResolvedValue(true); codec.writeFile.mockResolvedValue(true); codec.exec.mockResolvedValue(0); codec.readFile.mockResolvedValue(SAMPLE_WAV);
  vi.stubGlobal("location", { href: "chrome-extension://aura/newtab.html" });
  vi.stubGlobal("OfflineAudioContext", undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("custom timer audio preparation", () => {
  it("keeps an already portable WAV byte-for-byte without loading a decoder", async () => {
    const file = new File([new Uint8Array(SAMPLE_WAV)], "signal.wav", { type: "audio/wav" });
    const asset = await prepareTimerSound(file);
    expect(timerSoundBytesFromDataUrl(asset.dataUrl)).toEqual(SAMPLE_WAV);
    expect(asset.playbackDataUrl).toBe(asset.dataUrl);
    expect(codec.load).not.toHaveBeenCalled();
  });

  it("preserves original non-native audio and converts a portable alarm using only local assets", async () => {
    const original = new Uint8Array([1, 2, 3, 4]);
    const asset = await prepareTimerSound(new File([original], "My sound.wma", { type: "audio/x-ms-wma" }));
    expect(asset.name).toBe("My sound.wma");
    expect(timerSoundBytesFromDataUrl(asset.dataUrl)).toEqual(original);
    expect(isCanonicalTimerWav(timerSoundBytesFromDataUrl(asset.playbackDataUrl))).toBe(true);
    expect(codec.load).toHaveBeenCalledWith({
      classWorkerURL: "/assets/timer-audio-worker.js",
      coreURL: "chrome-extension://aura/vendor/ffmpeg/ffmpeg-core.js",
      wasmURL: "chrome-extension://aura/vendor/ffmpeg/ffmpeg-core.wasm"
    });
    const args = codec.exec.mock.calls[0][0];
    expect(args.slice(args.indexOf("-protocol_whitelist"), args.indexOf("-protocol_whitelist") + 2)).toEqual(["-protocol_whitelist", "file"]);
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "60"]);
    expect(args).toContain("0:a:0");
    expect(codec.terminate).toHaveBeenCalledTimes(1);
  });

  it("accepts uncommon file extensions and sanitizes names without changing original bytes", async () => {
    for (const extension of ["wav", "mp3", "ogg", "flac", "aac", "m4a", "aiff", "caf", "wma", "ape", "wv", "tta", "amr", "dsf"]) {
      expect(TIMER_SOUND_ACCEPT).toContain(`.${extension}`);
      const asset = await prepareTimerSound(new File([new Uint8Array([1])], `../signal.${extension}`));
      expect(asset.name).toBe(`.._signal.${extension}`);
      expect(asset.dataUrl).toBe("data:application/octet-stream;base64,AQ==");
    }
  });

  it("rejects empty and oversized files before allocating decoder memory", async () => {
    await expect(prepareTimerSound(new File([], "empty.wav"))).rejects.toMatchObject({ code: "empty" });
    const arrayBuffer = vi.fn();
    await expect(prepareTimerSound({ size: 20 * 1024 * 1024 + 1, arrayBuffer } as unknown as File)).rejects.toMatchObject({ code: "too-large" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(codec.load).not.toHaveBeenCalled();
  });

  it("uses native decoding only for a short file and releases metadata resources", async () => {
    const decodeAudioData = vi.fn().mockResolvedValue({
      duration: 2 / 24_000, sampleRate: 24_000, numberOfChannels: 1, length: 2,
      getChannelData: () => new Float32Array([0.25, -0.25])
    });
    const audio = {
      duration: 1, onloadedmetadata: null as null | (() => void), onerror: null,
      preload: "", removeAttribute: vi.fn(), load: vi.fn(),
      set src(_value: string) { queueMicrotask(() => this.onloadedmetadata?.()); }
    };
    vi.stubGlobal("document", { createElement: () => audio });
    vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = decodeAudioData; });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const asset = await prepareTimerSound(new File([new Uint8Array([1, 2])], "short.mp3", { type: "audio/mpeg" }));
    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(codec.load).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledOnce();
    expect(timerSoundBytesFromDataUrl(asset.playbackDataUrl)).toEqual(SAMPLE_WAV);
  });

  it("sends long compressed recordings to bounded FFmpeg instead of expanding their entire duration natively", async () => {
    const decodeAudioData = vi.fn();
    const audio = {
      duration: 60 * 60, onloadedmetadata: null as null | (() => void), onerror: null,
      preload: "", removeAttribute: vi.fn(), load: vi.fn(),
      set src(_value: string) { queueMicrotask(() => this.onloadedmetadata?.()); }
    };
    vi.stubGlobal("document", { createElement: () => audio });
    vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = decodeAudioData; });
    await prepareTimerSound(new File([new Uint8Array([1, 2])], "long.mp3", { type: "audio/mpeg" }));
    expect(decodeAudioData).not.toHaveBeenCalled();
    expect(codec.load).toHaveBeenCalledOnce();
  });

  it("does not accept damaged, unsupported, or invalid decoder output", async () => {
    codec.exec.mockResolvedValueOnce(1);
    await expect(prepareTimerSound(new File([new Uint8Array([1])], "broken.mp3"))).rejects.toMatchObject({ code: "unsupported" });
    codec.readFile.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    await expect(prepareTimerSound(new File([new Uint8Array([1])], "broken.wav"))).rejects.toMatchObject({ code: "unsupported" });
    expect(codec.terminate).toHaveBeenCalledTimes(2);
  });

  it("cancels an active import and releases the worker instead of publishing late output", async () => {
    const controller = new AbortController();
    codec.exec.mockImplementationOnce(() => new Promise<number>(() => {}));
    const pending = prepareTimerSound(new File([new Uint8Array([1])], "signal.flac"), { signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ code: "aborted" });
    await vi.waitFor(() => expect(codec.exec).toHaveBeenCalled());
    controller.abort();
    await rejection;
    expect(codec.terminate).toHaveBeenCalled();
    expect(codec.readFile).not.toHaveBeenCalled();
  });

  it("times out a hung worker and releases its WASM memory", async () => {
    vi.useFakeTimers();
    codec.load.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    const pending = prepareTimerSound(new File([new Uint8Array([1])], "signal.flac"));
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.waitFor(() => expect(codec.load).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(45_001);
    await rejection;
    expect(codec.terminate).toHaveBeenCalledTimes(1);
  });

  it("mixes channels, clamps samples and uses at most the first sixty seconds", () => {
    const bytes = encodeTimerAudioBuffer({
      duration: 70, sampleRate: 24_000, numberOfChannels: 2, length: 70 * 24_000,
      getChannelData: (channel) => new Float32Array(70 * 24_000).fill(channel === 0 ? 4 : 0)
    });
    expect(bytes.byteLength).toBe(MAX_TIMER_PLAYBACK_BYTES);
    expect(isCanonicalTimerWav(bytes)).toBe(true);
    expect(new DataView(bytes.buffer).getInt16(44, true)).toBe(32_767);
  });

  it("canonicalizes metadata chunks while rejecting malformed and wrong-rate WAV", () => {
    const withMetadata = new Uint8Array(SAMPLE_WAV.length + 12);
    withMetadata.set(SAMPLE_WAV.subarray(0, 36));
    withMetadata.set(new TextEncoder().encode("LIST"), 36);
    new DataView(withMetadata.buffer).setUint32(40, 4, true);
    withMetadata.set(new TextEncoder().encode("INFO"), 44);
    withMetadata.set(SAMPLE_WAV.subarray(36), 48);
    new DataView(withMetadata.buffer).setUint32(4, withMetadata.length - 8, true);
    expect(canonicalizeTimerWav(withMetadata)).toEqual(SAMPLE_WAV);
    new DataView(withMetadata.buffer).setUint32(40, 0xffffffff, true);
    expect(() => canonicalizeTimerWav(withMetadata)).toThrow();
    const wrongRate = SAMPLE_WAV.slice(); new DataView(wrongRate.buffer).setUint32(24, 44_100, true);
    expect(() => canonicalizeTimerWav(wrongRate)).toThrow();
  });
});
