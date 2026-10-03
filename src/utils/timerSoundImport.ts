import {
  isCanonicalTimerWav,
  MAX_TIMER_PLAYBACK_BYTES,
  MAX_TIMER_SOUND_BYTES,
  MAX_TIMER_SOUND_SECONDS,
  normalizeTimerSoundAsset,
  TIMER_SOUND_SAMPLE_RATE,
  timerSoundBytesToDataUrl,
  type TimerSoundAsset
} from "./timerSoundStorage";

// File pickers are hints only: actual decoding decides whether a file is audio.
export const TIMER_SOUND_ACCEPT = "audio/*,.wav,.wave,.mp3,.mp2,.mp1,.ogg,.oga,.opus,.flac,.aac,.m4a,.m4b,.mp4,.webm,.weba,.aif,.aiff,.aifc,.au,.snd,.caf,.alac,.wma,.asf,.ape,.wv,.tta,.ac3,.eac3,.dts,.amr,.awb,.3ga,.3gp,.mka,.mpc,.spx,.gsm,.voc,.ra,.dsf,.dff,.tak";
export type TimerSoundImportErrorCode = "empty" | "too-large" | "unsupported" | "timeout" | "aborted";
export class TimerSoundImportError extends Error {
  constructor(public readonly code: TimerSoundImportErrorCode) {
    super({
      empty: "Choose a non-empty audio file.",
      "too-large": "Choose an audio file no larger than 20 MiB.",
      unsupported: "This file is damaged, protected, or uses an unsupported audio codec.",
      timeout: "The audio file took too long to prepare. Try a shorter file.",
      aborted: "Timer sound selection was cancelled."
    }[code]);
    this.name = "TimerSoundImportError";
  }
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TimerSoundImportError("aborted");
}

async function bounded<T>(operation: Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  checkAborted(signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new TimerSoundImportError("timeout")), milliseconds);
      abort = () => reject(new TimerSoundImportError("aborted"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    })]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

function wavHeader(sampleBytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(44 + sampleBytes.byteLength);
  const view = new DataView(output.buffer);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) output[offset + index] = value.charCodeAt(index); };
  text(0, "RIFF"); view.setUint32(4, output.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, TIMER_SOUND_SAMPLE_RATE, true); view.setUint32(28, TIMER_SOUND_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, sampleBytes.byteLength, true);
  output.set(sampleBytes, 44);
  return output;
}

/** Drop decoder metadata chunks; sync always carries an identical portable format. */
export function canonicalizeTimerWav(bytes: Uint8Array): Uint8Array {
  if (isCanonicalTimerWav(bytes)) return bytes.slice();
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_TIMER_PLAYBACK_BYTES + 65_536) throw new TimerSoundImportError("unsupported");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const label = (offset: number, expected: string) => Array.from(expected).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (!label(0, "RIFF") || !label(8, "WAVE") || view.getUint32(4, true) !== bytes.byteLength - 8) throw new TimerSoundImportError("unsupported");
  let validFormat = false;
  let samples: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size > bytes.byteLength - start) throw new TimerSoundImportError("unsupported");
    if (label(offset, "fmt ")) {
      validFormat = size >= 16 && view.getUint16(start, true) === 1 && view.getUint16(start + 2, true) === 1
        && view.getUint32(start + 4, true) === TIMER_SOUND_SAMPLE_RATE && view.getUint32(start + 8, true) === TIMER_SOUND_SAMPLE_RATE * 2
        && view.getUint16(start + 12, true) === 2 && view.getUint16(start + 14, true) === 16;
    } else if (label(offset, "data")) {
      if (samples || size < 2 || size % 2 || size > MAX_TIMER_PLAYBACK_BYTES - 44) throw new TimerSoundImportError("unsupported");
      samples = bytes.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!validFormat || !samples) throw new TimerSoundImportError("unsupported");
  return wavHeader(samples);
}

export function encodeTimerAudioBuffer(buffer: Pick<AudioBuffer, "duration" | "sampleRate" | "numberOfChannels" | "length" | "getChannelData">): Uint8Array {
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 8_000
    || buffer.sampleRate > 384_000 || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 || buffer.numberOfChannels > 8
    || !Number.isInteger(buffer.length) || buffer.length < 1) throw new TimerSoundImportError("unsupported");
  const length = Math.min(Math.floor(Math.min(buffer.duration, MAX_TIMER_SOUND_SECONDS) * TIMER_SOUND_SAMPLE_RATE), Math.floor(buffer.length / buffer.sampleRate * TIMER_SOUND_SAMPLE_RATE));
  if (length < 1) throw new TimerSoundImportError("unsupported");
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  if (channels.some((channel) => channel.length < buffer.length)) throw new TimerSoundImportError("unsupported");
  const pcm = new Uint8Array(length * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < length; index++) {
    const source = index * buffer.sampleRate / TIMER_SOUND_SAMPLE_RATE;
    const before = Math.floor(source);
    const after = Math.min(before + 1, buffer.length - 1);
    let value = 0;
    for (const channel of channels) value += channel[before] + (channel[after] - channel[before]) * (source - before);
    value /= channels.length;
    value = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    view.setInt16(index * 2, Math.round(value * (value < 0 ? 32_768 : 32_767)), true);
  }
  return wavHeader(pcm);
}

async function nativeDuration(file: File, signal?: AbortSignal): Promise<number> {
  if (!globalThis.document || !globalThis.URL?.createObjectURL) return Infinity;
  const audio = document.createElement("audio");
  const objectUrl = URL.createObjectURL(file);
  try {
    return await bounded(new Promise<number>((resolve) => {
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => resolve(Infinity);
      audio.preload = "metadata";
      audio.src = objectUrl;
    }), 3_000, signal);
  } finally {
    audio.onloadedmetadata = null;
    audio.onerror = null;
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeNative(file: File, bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array | null> {
  // decodeAudioData expands the whole file. Large/long inputs go to the bounded
  // streaming decoder instead of allocating an unbounded native AudioBuffer.
  if (file.size > 2 * 1024 * 1024 || typeof OfflineAudioContext === "undefined") return null;
  try {
    const duration = await nativeDuration(file, signal);
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_TIMER_SOUND_SECONDS) return null;
    checkAborted(signal);
    const context = new OfflineAudioContext(1, 1, TIMER_SOUND_SAMPLE_RATE);
    const decoded = await bounded(context.decodeAudioData(bytes.slice().buffer), 15_000, signal);
    checkAborted(signal);
    return encodeTimerAudioBuffer(decoded);
  } catch (error) {
    if (error instanceof TimerSoundImportError && error.code === "aborted") throw error;
    return null;
  }
}

async function decodeBundled(bytes: Uint8Array, fileName: string, signal?: AbortSignal): Promise<Uint8Array> {
  checkAborted(signal);
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { default: classWorkerURL } = await import("@ffmpeg/ffmpeg/worker?worker&url");
  checkAborted(signal);
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await bounded((async () => {
      const extensionUrl = (path: string) => typeof globalThis.chrome !== "undefined" && typeof chrome.runtime?.getURL === "function"
        ? chrome.runtime.getURL(path)
        : new URL(path, globalThis.location.href).href;
      await ffmpeg.load({
        classWorkerURL,
        coreURL: extensionUrl("vendor/ffmpeg/ffmpeg-core.js"),
        wasmURL: extensionUrl("vendor/ffmpeg/ffmpeg-core.wasm")
      });
      checkAborted(signal);
      const extension = fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? "audio";
      const inputName = `input.${extension}`;
      await ffmpeg.writeFile(inputName, bytes.slice());
      // Restrict the decoder to its in-memory input. Playlists cannot initiate
      // remote requests, and only the first audio stream is decoded.
      const exitCode = await ffmpeg.exec([
        "-v", "error", "-protocol_whitelist", "file", "-i", inputName,
        "-map", "0:a:0", "-t", String(MAX_TIMER_SOUND_SECONDS), "-vn", "-sn", "-dn",
        "-ac", "1", "-ar", String(TIMER_SOUND_SAMPLE_RATE), "-c:a", "pcm_s16le",
        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "output.wav"
      ], 30_000);
      checkAborted(signal);
      if (exitCode !== 0) throw new TimerSoundImportError("unsupported");
      const output = await ffmpeg.readFile("output.wav");
      checkAborted(signal);
      if (!(output instanceof Uint8Array)) throw new TimerSoundImportError("unsupported");
      return canonicalizeTimerWav(output);
    })(), 45_000, signal);
  } catch (error) {
    checkAborted(signal);
    if (error instanceof TimerSoundImportError) throw error;
    throw new TimerSoundImportError("unsupported");
  } finally {
    signal?.removeEventListener("abort", abort);
    // Release WASM memory on success, cancellation, timeout and decoder errors.
    ffmpeg.terminate();
  }
}

export async function prepareTimerSound(file: File, options: { signal?: AbortSignal } = {}): Promise<TimerSoundAsset> {
  const { signal } = options;
  checkAborted(signal);
  if (!file.size) throw new TimerSoundImportError("empty");
  if (!Number.isFinite(file.size) || file.size > MAX_TIMER_SOUND_BYTES) throw new TimerSoundImportError("too-large");
  const bytes = new Uint8Array(await bounded(file.arrayBuffer(), 15_000, signal));
  checkAborted(signal);
  if (!bytes.byteLength) throw new TimerSoundImportError("empty");
  if (bytes.byteLength > MAX_TIMER_SOUND_BYTES || bytes.byteLength !== file.size) throw new TimerSoundImportError("too-large");
  const playback = isCanonicalTimerWav(bytes) ? bytes.slice() : await decodeNative(file, bytes, signal) ?? await decodeBundled(bytes, file.name, signal);
  checkAborted(signal);
  const mimeType = /^(?:audio\/[a-z0-9.+-]+|video\/(?:mp4|webm))$/.test(file.type.toLowerCase()) ? file.type.toLowerCase() : "application/octet-stream";
  const asset = normalizeTimerSoundAsset({
    name: file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 255) || "timer-sound",
    dataUrl: timerSoundBytesToDataUrl(bytes, mimeType),
    playbackDataUrl: timerSoundBytesToDataUrl(playback, "audio/wav")
  });
  if (!asset) throw new TimerSoundImportError("unsupported");
  return asset;
}
