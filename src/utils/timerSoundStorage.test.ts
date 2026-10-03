import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCanonicalTimerWav, isTimerSoundId, loadTimerSound, normalizeTimerSoundAsset,
  storeTimerSound, timerSoundBytesToDataUrl, validateTimerSoundAsset, type TimerSoundAsset
} from "./timerSoundStorage";

function tinyWav(): Uint8Array {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) bytes.set(new TextEncoder().encode(value), offset);
  view.setUint32(4, 40, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, 4, true); view.setInt16(44, 1_000, true); view.setInt16(46, -1_000, true);
  return bytes;
}
const WAV = timerSoundBytesToDataUrl(tinyWav(), "audio/wav");
const ASSET: TimerSoundAsset = { name: "Мой сигнал.wav", dataUrl: WAV, playbackDataUrl: WAV };

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function inspect<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<globalThis.IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("aura-start-timer-sounds", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("sounds", "readwrite");
      const request = operation(transaction.objectStore("sounds"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

describe("portable content-addressed timer sounds", () => {
  it("stores the exact original and playback bytes durably and deduplicates repeated imports", async () => {
    const id = await storeTimerSound(ASSET);
    expect(isTimerSoundId(id)).toBe(true);
    expect(await loadTimerSound(id)).toEqual(ASSET);
    expect(await storeTimerSound({ playbackDataUrl: WAV, dataUrl: WAV, name: ASSET.name }, id)).toBe(id);
    expect(await inspect((store) => store.count())).toBe(1);
    expect(await storeTimerSound({ ...ASSET, name: "renamed.wav" })).not.toBe(id);
  });

  it("accepts broad audio originals but requires bounded, canonical PCM playback", () => {
    for (const mime of ["audio/mpeg", "audio/ogg", "audio/flac", "audio/x-ms-wma", "audio/x-ape", "application/octet-stream", "video/mp4"]) {
      expect(normalizeTimerSoundAsset({ ...ASSET, dataUrl: `data:${mime};base64,YQ==` })).not.toBeNull();
    }
    for (const dataUrl of ["https://example.org/signal.wav", "data:text/html;base64,YQ==", "data:audio/wav;base64,", "data:audio/wav;base64,a===", "data:audio/wav;base64,abc", "data:audio/wav;base64,!!!!"]) {
      expect(normalizeTimerSoundAsset({ ...ASSET, dataUrl })).toBeNull();
    }
    for (const playbackDataUrl of ["data:audio/mp3;base64,YQ==", "data:audio/wav;base64,YQ=="]) {
      expect(normalizeTimerSoundAsset({ ...ASSET, playbackDataUrl })).toBeNull();
    }
    const wrongRate = tinyWav(); new DataView(wrongRate.buffer).setUint32(24, 44_100, true);
    expect(isCanonicalTimerWav(wrongRate)).toBe(false);
    const wrongLength = tinyWav(); new DataView(wrongLength.buffer).setUint32(40, 2, true);
    expect(isCanonicalTimerWav(wrongLength)).toBe(false);
    expect(normalizeTimerSoundAsset({ ...ASSET, name: "../../sound.mp3" })).toBeNull();
    expect(normalizeTimerSoundAsset({ ...ASSET, name: "a".repeat(256) })).toBeNull();
    expect(normalizeTimerSoundAsset({ ...ASSET, name: "bad\u0000name" })).toBeNull();
  });

  it("does not invoke accessors on untrusted backup values", () => {
    const getter = vi.fn(() => ASSET.name);
    const value = { ...ASSET };
    Object.defineProperty(value, "name", { get: getter });
    expect(normalizeTimerSoundAsset(value)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(normalizeTimerSoundAsset(Object.assign(Object.create({ polluted: true }), ASSET))).toBeNull();
  });

  it("checks downloaded identity before any database write", async () => {
    const open = vi.spyOn(indexedDB, "open");
    await expect(storeTimerSound(ASSET, "0".repeat(64))).rejects.toThrow(/does not match/);
    await expect(validateTimerSoundAsset(ASSET, "invalid")).rejects.toThrow(/does not match/);
    expect(await validateTimerSoundAsset(ASSET)).toEqual(ASSET);
    expect(open).not.toHaveBeenCalled();
  });

  it("distinguishes absent sounds from corruption of original, clip or name", async () => {
    expect(await loadTimerSound(null)).toBeNull();
    expect(await loadTimerSound()).toBeNull();
    expect(await loadTimerSound("0".repeat(64))).toBeNull();
    await expect(loadTimerSound("invalid")).rejects.toThrow(/identifier/);
    for (const changed of [{ name: "changed.wav" }, { dataUrl: "data:audio/wav;base64,YQ==" }, { playbackDataUrl: "data:audio/wav;base64,YQ==" }]) {
      const id = await storeTimerSound(ASSET);
      await inspect((store) => store.put({ ...ASSET, ...changed }, id));
      await expect(loadTimerSound(id)).rejects.toThrow(/damaged/);
    }
  });

  it("does not publish an identifier if its write transaction aborts", async () => {
    await loadTimerSound("0".repeat(64));
    const original = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(function (this: IDBDatabase, ...args) {
      const transaction = original.apply(this, args);
      const objectStore = transaction.objectStore.bind(transaction);
      vi.spyOn(transaction, "objectStore").mockImplementation((name) => {
        const store = objectStore(name);
        const put = store.put.bind(store);
        vi.spyOn(store, "put").mockImplementation((...putArgs) => { const request = put(...putArgs); transaction.abort(); return request; });
        return store;
      });
      return transaction;
    });
    await expect(storeTimerSound(ASSET)).rejects.toThrow(/could not be saved/);
    expect(await inspect((store) => store.count())).toBe(0);
  });

  it("reports unavailable storage without consuming source bytes", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(storeTimerSound(ASSET)).rejects.toThrow(/storage is unavailable/);
    expect(ASSET.playbackDataUrl).toBe(WAV);
  });
});
