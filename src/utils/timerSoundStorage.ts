const DATABASE_NAME = "aura-start-timer-sounds";
const SOUND_STORE = "sounds";
export const MAX_TIMER_SOUND_BYTES = 20 * 1024 * 1024;
export const TIMER_SOUND_SAMPLE_RATE = 24_000;
export const MAX_TIMER_SOUND_SECONDS = 60;
export const MAX_TIMER_PLAYBACK_BYTES = 44 + TIMER_SOUND_SAMPLE_RATE * MAX_TIMER_SOUND_SECONDS * 2;

/** Keep the original file and an independently playable, portable alarm clip. */
export interface TimerSoundAsset {
  name: string;
  dataUrl: string;
  playbackDataUrl: string;
}

export function isTimerSoundId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validDataUrl(value: unknown, maxBytes: number, playback = false): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 + 160) return false;
  const comma = value.indexOf(",");
  if (comma < 0 || comma > 150) return false;
  const header = value.slice(0, comma);
  if (playback ? header !== "data:audio/wav;base64" : !/^data:(?:audio\/[a-z0-9.+-]+|application\/octet-stream|video\/(?:mp4|webm));base64$/.test(header)) return false;
  const encoded = value.slice(comma + 1);
  if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return encoded.length / 4 * 3 - padding <= maxBytes;
}

/** The playback copy has one deliberately small, browser-independent wire format. */
export function isCanonicalTimerWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 46 || bytes.byteLength > MAX_TIMER_PLAYBACK_BYTES || bytes.byteLength % 2 !== 0) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const label = (offset: number, expected: string) => Array.from(expected).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  return label(0, "RIFF") && view.getUint32(4, true) === bytes.byteLength - 8 && label(8, "WAVE")
    && label(12, "fmt ") && view.getUint32(16, true) === 16 && view.getUint16(20, true) === 1
    && view.getUint16(22, true) === 1 && view.getUint32(24, true) === TIMER_SOUND_SAMPLE_RATE
    && view.getUint32(28, true) === TIMER_SOUND_SAMPLE_RATE * 2 && view.getUint16(32, true) === 2
    && view.getUint16(34, true) === 16 && label(36, "data") && view.getUint32(40, true) === bytes.byteLength - 44;
}

export function timerSoundBytesFromDataUrl(value: string): Uint8Array {
  const binary = atob(value.slice(value.indexOf(",") + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function timerSoundBytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 16_384) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16_384)));
  }
  return `data:${mimeType};base64,${btoa(chunks.join(""))}`;
}

export function normalizeTimerSoundAsset(value: unknown): TimerSoundAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).some((key) => !["name", "dataUrl", "playbackDataUrl", "id"].includes(key) || !("value" in descriptors[key]))) return null;
  const name: unknown = descriptors.name?.value;
  const dataUrl: unknown = descriptors.dataUrl?.value;
  const playbackDataUrl: unknown = descriptors.playbackDataUrl?.value;
  if (typeof name !== "string" || !name.trim() || name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(name)) return null;
  if (!validDataUrl(dataUrl, MAX_TIMER_SOUND_BYTES) || !validDataUrl(playbackDataUrl, MAX_TIMER_PLAYBACK_BYTES, true)) return null;
  try {
    if (!isCanonicalTimerWav(timerSoundBytesFromDataUrl(playbackDataUrl))) return null;
  } catch { return null; }
  return { name, dataUrl, playbackDataUrl };
}

async function soundId(asset: TimerSoundAsset): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure timer sound storage is unavailable.");
  // Explicit field ordering makes identifiers independent of JSON property ordering.
  const content = JSON.stringify([asset.name, asset.dataUrl, asset.playbackDataUrl]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Calculate an identifier without publishing the asset to IndexedDB. */
export async function getTimerSoundId(value: TimerSoundAsset): Promise<string> {
  const asset = normalizeTimerSoundAsset(value);
  if (!asset) throw new Error("The timer sound format or size is invalid.");
  return await soundId(asset);
}

export async function validateTimerSoundAsset(value: unknown, expectedId?: string): Promise<TimerSoundAsset> {
  const asset = normalizeTimerSoundAsset(value);
  if (!asset) throw new Error("The timer sound format or size is invalid.");
  if (expectedId !== undefined && (!isTimerSoundId(expectedId) || await soundId(asset) !== expectedId)) {
    throw new Error("The downloaded timer sound does not match its identifier.");
  }
  return asset;
}

function openSoundDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("Timer sound storage is unavailable.")); return; }
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SOUND_STORE)) request.result.createObjectStore(SOUND_STORE);
    };
    request.onerror = () => { settled = true; reject(request.error ?? new Error("Timer sound storage could not be opened.")); };
    request.onblocked = () => { settled = true; reject(new Error("Close older Aura Start pages and retry saving the timer sound.")); };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

/** A reference is published only after all bytes have durably committed. */
export async function storeTimerSound(value: TimerSoundAsset, expectedId?: string): Promise<string> {
  const asset = normalizeTimerSoundAsset(value);
  if (!asset) throw new Error("The timer sound format or size is invalid.");
  const id = await soundId(asset);
  if (expectedId !== undefined && (!isTimerSoundId(expectedId) || id !== expectedId)) throw new Error("The downloaded timer sound does not match its identifier.");
  const database = await openSoundDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SOUND_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("The timer sound could not be saved."));
      transaction.onerror = () => reject(transaction.error ?? new Error("The timer sound could not be saved."));
      transaction.objectStore(SOUND_STORE).put(asset, id);
    });
  } finally { database.close(); }
  return id;
}

export async function loadTimerSound(id?: string | null): Promise<TimerSoundAsset | null> {
  if (id === undefined || id === null) return null;
  if (!isTimerSoundId(id)) throw new Error("The timer sound identifier is invalid.");
  const database = await openSoundDatabase();
  let value: unknown;
  try {
    value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(SOUND_STORE, "readonly");
      const request = transaction.objectStore(SOUND_STORE).get(id);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error("The timer sound could not be loaded."));
      transaction.onerror = () => reject(transaction.error ?? new Error("The timer sound could not be loaded."));
    });
  } finally { database.close(); }
  if (value === undefined) return null;
  const asset = normalizeTimerSoundAsset(value);
  if (!asset || await soundId(asset) !== id) throw new Error("The saved timer sound is damaged.");
  return asset;
}
