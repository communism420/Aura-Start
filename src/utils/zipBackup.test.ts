import { IDBFactory } from "fake-indexeddb";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";
import { STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { importBackgroundImageBackup } from "./backgroundImageBackup";
import { loadBackgroundImage, storeBackgroundImage } from "./backgroundImageStorage";
import { createEmptyData } from "./sampleData";
import { ensureSyncReplica, normalizeSyncReplica } from "./syncReplica";
import { importTimerSoundBackup } from "./timerSoundBackup";
import { getTimerSoundId, loadTimerSound, storeTimerSound, timerSoundBytesFromDataUrl, timerSoundBytesToDataUrl, type TimerSoundAsset } from "./timerSoundStorage";
import { createZipBackup, exportZipBackup, parseZipBackup } from "./zipBackup";

const downloads = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./download", () => ({ downloadBlobFile: downloads.save }));
const audio = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("./timerSoundImport", () => ({ prepareTimerSound: audio.prepare }));

const BASE64_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
const PERCENT_IMAGE = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Ctext%3E%D0%90%3C/text%3E%3C/svg%3E";
type ImageEntry = { path: string; mimeType: string; dataUrlHeader: string; dataUrlEncoding: string; sourceDataUrlPath?: string };
type SoundEntry = { name: string; path: string; mimeType: string; playbackPath: string; sourceDataUrlPath?: string; sha256?: string };
type Manifest = { format: string; version: number; appVersion: string; dataFile: string;
  backgroundImages: Record<string, ImageEntry>; timerSounds: Record<string, SoundEntry> };
let stored: Record<string, unknown>;

function sound(name = "Мой сигнал 2026.mp3", sample = 1000): TimerSoundAsset {
  const playback = new Uint8Array(46);
  const view = new DataView(playback.buffer);
  const label = (offset: number, value: string) => [...value].forEach((character, index) => { playback[offset + index] = character.charCodeAt(0); });
  label(0, "RIFF"); view.setUint32(4, 38, true); label(8, "WAVE");
  label(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, "data"); view.setUint32(40, 2, true); view.setInt16(44, sample, true);
  return {
    name, dataUrl: `data:audio/mpeg;base64,${btoa(String.fromCharCode(73, 68, 51, 4, 0, 0, 0, 0, sample % 256))}`,
    playbackDataUrl: `data:audio/wav;base64,${btoa(String.fromCharCode(...playback))}`
  };
}

async function mediaFixture() {
  const currentSound = sound();
  const historicalSound = sound("Historical chime.mp3", 2000);
  const imageId = await storeBackgroundImage(BASE64_IMAGE);
  const previousImageId = await storeBackgroundImage(PERCENT_IMAGE);
  const soundId = await storeTimerSound(currentSound);
  const previousSoundId = await storeTimerSound(historicalSound);
  const data = createEmptyData();
  data.settings.notes.text = "Заметки с переносами\n**Сохранить всё** ✓";
  data.settings.background = { ...data.settings.background, customImageId: imageId, preset: "custom", dim: 0 };
  data.settings.timer = { ...data.settings.timer, customSoundId: soundId, volume: 0, durationSeconds: 37 };
  data.groups = [{ id: "bookmarks", title: "Saved links", parentId: null, collapsed: false, order: 0,
    links: [{ id: "link", title: "Example", url: "https://example.com/", description: "Description", tags: ["work"],
      order: 0, createdAt: data.updatedAt, updatedAt: data.updatedAt }] }];
  data.restorePoints = [[imageId, soundId], [previousImageId, previousSoundId], [previousImageId, previousSoundId]].map(([backgroundId, timerId], index) => ({
    id: `point-${index}`, name: `Snapshot ${index}`, reason: "manual", createdAt: data.updatedAt,
    data: { version: 1, updatedAt: data.updatedAt, groups: structuredClone(data.groups),
      settings: { ...structuredClone(data.settings),
        background: { ...data.settings.background, customImageId: backgroundId },
        timer: { ...data.settings.timer, customSoundId: timerId } } }
  }));
  data.syncReplica = ensureSyncReplica(data);
  return { data, imageId, previousImageId, soundId, previousSoundId, currentSound, historicalSound };
}

function readManifest(files: Record<string, Uint8Array>): Manifest {
  return JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
}

/** Frozen v1 writer fixture, independent of the current v2 exporter. */
async function createLegacyZipBackup(data: AuraStartData): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = { "aura-start.json": strToU8(JSON.stringify(data)) };
  const manifest: Manifest & { createdAt: string } = { format: "aura-start-full-backup", version: 1, appVersion: "2.1.0",
    dataFile: "aura-start.json", createdAt: data.updatedAt, backgroundImages: {}, timerSounds: {} };
  for (const snapshot of [data, ...data.restorePoints.map((point) => point.data)]) {
    const imageId = snapshot.settings.background.customImageId;
    if (imageId && !manifest.backgroundImages[imageId]) {
      const image = await loadBackgroundImage(imageId);
      if (!image) throw new Error("Missing image fixture");
      const comma = image.indexOf(","), header = image.slice(0, comma), base64 = /;base64$/i.test(header);
      const entry = { path: `images/${imageId}.image`, mimeType: header.slice(5).split(";")[0],
        dataUrlHeader: header, dataUrlEncoding: base64 ? "base64" : "percent", sourceDataUrlPath: `images/${imageId}.data-url.txt` };
      files[entry.path] = base64 ? timerSoundBytesFromDataUrl(image) : strToU8(decodeURIComponent(image.slice(comma + 1)));
      files[entry.sourceDataUrlPath] = strToU8(image);
      manifest.backgroundImages[imageId] = entry;
    }
    const soundId = snapshot.settings.timer.customSoundId;
    if (soundId && !manifest.timerSounds[soundId]) {
      const original = await loadTimerSound(soundId);
      if (!original) throw new Error("Missing sound fixture");
      const entry = { name: original.name, path: `audio/${soundId}/original.audio`, mimeType: original.dataUrl.slice(5).split(";")[0],
        playbackPath: `audio/${soundId}/playback.wav`, sourceDataUrlPath: `audio/${soundId}/original.data-url.txt` };
      files[entry.path] = timerSoundBytesFromDataUrl(original.dataUrl);
      files[entry.playbackPath] = timerSoundBytesFromDataUrl(original.playbackDataUrl);
      files[entry.sourceDataUrlPath] = strToU8(original.dataUrl);
      manifest.timerSounds[soundId] = entry;
    }
  }
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(files, { level: 0 });
}

function rewriteManifest(files: Record<string, Uint8Array>, change: (manifest: Manifest) => void): Uint8Array {
  const manifest = readManifest(files);
  change(manifest);
  return zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(manifest)) }, { level: 0 });
}

function entryRecord(bytes: Uint8Array, name: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let central = 0; central + 46 <= bytes.length; central++) {
    if (view.getUint32(central, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(central + 28, true);
    if (strFromU8(bytes.subarray(central + 46, central + 46 + nameLength)) !== name) continue;
    const local = view.getUint32(central + 42, true);
    const localNameLength = view.getUint16(local + 26, true);
    const data = local + 30 + localNameLength + view.getUint16(local + 28, true);
    return { central, local, data, nameLength };
  }
  throw new Error(`Test ZIP member not found: ${name}`);
}

function renameMember(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const mutated = bytes.slice();
  const entry = entryRecord(mutated, from);
  const name = strToU8(to);
  expect(name.length).toBe(entry.nameLength);
  mutated.set(name, entry.central + 46);
  mutated.set(name, entry.local + 30);
  return mutated;
}

beforeEach(() => {
  vi.clearAllMocks();
  audio.prepare.mockReset();
  audio.prepare.mockImplementation(async (file: File) => ({ ...sound(file.name, 3333),
    dataUrl: timerSoundBytesToDataUrl(new Uint8Array(await file.arrayBuffer()), file.type) }));
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  vi.stubGlobal("chrome", undefined);
  stored = { [STORAGE_KEY]: createEmptyData() };
  vi.stubGlobal("browser", { runtime: { getManifest: () => ({ version: packageJson.extensionVersions.firefox }) }, storage: { local: {
    get: async (key: string) => ({ [key]: structuredClone(stored[key]) }),
    set: async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); },
    remove: async (key: string) => { delete stored[key]; }
  } } });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("full ZIP backup with independent archive decoding", () => {
  it("contains ordinary JSON, all background images and exactly one byte-exact selected original audio file", async () => {
    const { data, imageId, previousImageId, soundId, currentSound } = await mediaFixture();
    const before = structuredClone(data);
    const files = unzipSync(await createZipBackup(data));
    const manifest = readManifest(files);
    expect(manifest).toMatchObject({ format: "aura-start-full-backup", version: 2, appVersion: packageJson.extensionVersions.chromium, dataFile: "aura-start.json" });
    const document = JSON.parse(strFromU8(files[manifest.dataFile]));
    expect(document.settings.notes.text).toBe(data.settings.notes.text);
    expect(document.groups).toEqual(data.groups);
    expect(document.restorePoints).toHaveLength(3);
    expect(document.backgroundImages).toBeUndefined();
    expect(document.timerSounds).toBeUndefined();
    expect(strFromU8(files[manifest.dataFile])).not.toMatch(/data:(?:image|audio)\//);
    expect(Object.keys(manifest.backgroundImages).sort()).toEqual([imageId, previousImageId].sort());
    expect(Object.keys(manifest.timerSounds)).toEqual([soundId]);
    expect(document.restorePoints[0].data.settings.timer.customSoundId).toBe(soundId);
    expect(document.restorePoints[1].data.settings.timer.customSoundId).toBeNull();
    expect(document.restorePoints[1].data.settingsCompatibility.defaulted).toContain("timer.customSoundId");
    const currentImage = manifest.backgroundImages[imageId];
    expect(currentImage.mimeType).toBe("image/png");
    expect(currentImage.path).toMatch(/^images\/backgrounds\/.+\.png$/);
    expect(files[currentImage.path]).toEqual(timerSoundBytesFromDataUrl(BASE64_IMAGE));
    const previousImage = manifest.backgroundImages[previousImageId];
    expect(previousImage.mimeType).toBe("image/svg+xml");
    expect(strFromU8(files[previousImage.path])).toBe(decodeURIComponent(PERCENT_IMAGE.slice(PERCENT_IMAGE.indexOf(",") + 1)));
    expect(previousImage.sourceDataUrlPath).toBeTypeOf("string");
    expect(strFromU8(files[previousImage.sourceDataUrlPath!])).toBe(PERCENT_IMAGE);
    for (const [id, original] of [[soundId, currentSound]] as const) {
      const entry = manifest.timerSounds[id];
      expect(entry.name).toBe(original.name);
      expect(entry.mimeType).toBe("audio/mpeg");
      expect(entry.path).toMatch(/^audio\/timer\/.+\.mp3$/);
      expect(entry.playbackPath).toBeUndefined();
      expect(entry.sourceDataUrlPath).toBeUndefined();
      expect(entry.sha256).toMatch(/^[a-f\d]{64}$/);
      expect(files[entry.path]).toEqual(timerSoundBytesFromDataUrl(original.dataUrl));
    }
    // Three historical references do not multiply shared asset files.
    const referencedPaths = [manifest.dataFile, "manifest.json",
      ...Object.values(manifest.backgroundImages).flatMap((entry) => [entry.path, ...(entry.sourceDataUrlPath ? [entry.sourceDataUrlPath] : [])]),
      ...Object.values(manifest.timerSounds).map((entry) => entry.path)];
    expect(Object.keys(files).sort()).toEqual([...new Set(referencedPaths)].sort());
    expect(data).toEqual(before);
  });

  it("still imports exact v1 original/playback/history assets without running the audio decoder", async () => {
    const fixture = await mediaFixture();
    const bytes = await createLegacyZipBackup(fixture.data);
    vi.stubGlobal("indexedDB", new IDBFactory());
    const mainBefore = structuredClone(stored[STORAGE_KEY]);
    const parsed = await parseZipBackup(bytes);
    expect(stored[STORAGE_KEY]).toEqual(mainBefore);
    expect(audio.prepare).not.toHaveBeenCalled();
    expect(await loadBackgroundImage(fixture.imageId)).toBeNull();
    expect(await loadTimerSound(fixture.soundId)).toBeNull();
    expect(JSON.stringify(parsed)).not.toMatch(/data:(?:image|audio)\//);
    await importBackgroundImageBackup(parsed);
    await importTimerSoundBackup(parsed);
    expect(await loadBackgroundImage(fixture.imageId)).toBe(BASE64_IMAGE);
    expect(await loadBackgroundImage(fixture.previousImageId)).toBe(PERCENT_IMAGE);
    expect(await loadTimerSound(fixture.soundId)).toEqual(fixture.currentSound);
    expect(await loadTimerSound(fixture.previousSoundId)).toEqual(fixture.historicalSound);
    expect(parsed.settings.notes.text).toBe(fixture.data.settings.notes.text);
    expect(parsed.restorePoints[1].data.settings.timer.customSoundId).toBe(fixture.previousSoundId);
    expect(stored[STORAGE_KEY]).toEqual(mainBefore);
  });

  it("rebuilds v2 playback from the selected original and remaps current, matching history and replica IDs before import", async () => {
    const fixture = await mediaFixture();
    const before = structuredClone(fixture.data);
    const bytes = await createZipBackup(fixture.data);
    const originalStamp = fixture.data.syncReplica!.settings["timer.customSoundId"].stamp;
    vi.stubGlobal("indexedDB", new IDBFactory());
    const mainBefore = structuredClone(stored);
    const parsed = await parseZipBackup(bytes);
    const expected = { ...sound(fixture.currentSound.name, 3333), dataUrl: fixture.currentSound.dataUrl };
    const rebuiltId = await getTimerSoundId(expected);
    expect(rebuiltId).not.toBe(fixture.soundId);
    expect(audio.prepare).toHaveBeenCalledOnce();
    const originalFile = audio.prepare.mock.calls[0][0] as File;
    expect(originalFile.name).toBe(fixture.currentSound.name);
    expect(originalFile.type).toBe("audio/mpeg");
    expect(new Uint8Array(await originalFile.arrayBuffer())).toEqual(timerSoundBytesFromDataUrl(fixture.currentSound.dataUrl));
    expect(parsed.settings.timer).toEqual({ ...fixture.data.settings.timer, customSoundId: rebuiltId });
    expect(parsed.restorePoints[0].data.settings.timer.customSoundId).toBe(rebuiltId);
    expect(parsed.restorePoints[1].data.settings.timer.customSoundId).toBeNull();
    expect(parsed.restorePoints[2].data.settingsCompatibility?.defaulted).toContain("timer.customSoundId");
    expect(parsed.syncReplica!.settings["timer.customSoundId"]).toEqual({ value: rebuiltId, stamp: originalStamp });
    expect(normalizeSyncReplica(parsed.syncReplica, parsed)).toEqual(parsed.syncReplica);
    expect(await loadTimerSound(rebuiltId)).toBeNull();
    expect(await loadBackgroundImage(fixture.imageId)).toBeNull();
    expect(stored).toEqual(mainBefore);
    await importBackgroundImageBackup(parsed);
    await importTimerSoundBackup(parsed);
    expect(await loadTimerSound(rebuiltId)).toEqual(expected);
    expect(await loadTimerSound(fixture.soundId)).toBeNull();
    expect(await loadTimerSound(fixture.previousSoundId)).toBeNull();
    expect(await loadBackgroundImage(fixture.previousImageId)).toBe(PERCENT_IMAGE);
    expect(fixture.data).toEqual(before);
  });

  it("exports no audio for the built-in signal even when historical custom sounds are unavailable", async () => {
    const data = createEmptyData();
    data.restorePoints = [{ id: "old", name: "Old sound", reason: "manual", createdAt: data.updatedAt, data: {
      version: 1, updatedAt: data.updatedAt, groups: [], settings: {
        ...structuredClone(data.settings), timer: { ...data.settings.timer, customSoundId: "a".repeat(64) }
      }
    } }];
    const before = structuredClone(data);
    const bytes = await createZipBackup(data);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["aura-start.json", "manifest.json"]);
    expect(readManifest(files).timerSounds).toEqual({});
    const parsed = await parseZipBackup(bytes);
    expect(parsed.settings.timer.customSoundId).toBeNull();
    expect(parsed.restorePoints[0].data.settings.timer.customSoundId).toBeNull();
    expect(parsed.restorePoints[0].data.settingsCompatibility?.defaulted).toContain("timer.customSoundId");
    expect(audio.prepare).not.toHaveBeenCalled();
    expect(data).toEqual(before);
  });

  it("does not read unavailable historical audio when exporting a selected custom sound", async () => {
    const fixture = await mediaFixture();
    fixture.data.restorePoints[1].data.settings.timer.customSoundId = "b".repeat(64);
    const before = structuredClone(fixture.data);
    const files = unzipSync(await createZipBackup(fixture.data));
    expect(Object.keys(readManifest(files).timerSounds)).toEqual([fixture.soundId]);
    expect(Object.keys(files).filter((path) => path.startsWith("audio/"))).toHaveLength(1);
    expect(fixture.data).toEqual(before);
  });

  it("retains original bytes without an audio sidecar when old base64 padding was noncanonical", async () => {
    const original = { ...sound("Legacy.aac"), dataUrl: "data:audio/aac;base64,/x==" };
    const oldId = await storeTimerSound(original);
    const data = createEmptyData();
    data.settings.timer.customSoundId = oldId;
    const bytes = await createZipBackup(data);
    const files = unzipSync(bytes), entry = readManifest(files).timerSounds[oldId];
    expect(Object.keys(files).filter((path) => path.startsWith("audio/"))).toEqual([entry.path]);
    expect(files[entry.path]).toEqual(new Uint8Array([255]));
    vi.stubGlobal("indexedDB", new IDBFactory());
    const parsed = await parseZipBackup(bytes);
    const rebuiltId = parsed.settings.timer.customSoundId!;
    expect(rebuiltId).not.toBe(oldId);
    await importTimerSoundBackup(parsed);
    const rebuilt = await loadTimerSound(rebuiltId);
    expect(rebuilt!.name).toBe(original.name);
    expect(rebuilt!.dataUrl).toBe("data:audio/aac;base64,/w==");
    expect(timerSoundBytesFromDataUrl(rebuilt!.dataUrl)).toEqual(timerSoundBytesFromDataUrl(original.dataUrl));
  });

  it("rejects corrupted v2 originals before running a decoder or caching otherwise valid images", async () => {
    const fixture = await mediaFixture();
    const files = unzipSync(await createZipBackup(fixture.data));
    const entry = readManifest(files).timerSounds[fixture.soundId];
    files[entry.path][0] ^= 1;
    vi.stubGlobal("indexedDB", new IDBFactory());
    const before = structuredClone(stored);
    await expect(parseZipBackup(zipSync(files))).rejects.toThrow(/SHA-256|checksum/i);
    expect(audio.prepare).not.toHaveBeenCalled();
    expect(await loadBackgroundImage(fixture.imageId)).toBeNull();
    expect(stored).toEqual(before);
  });

  it("does not cache any assets or alter settings when rebuilding a v2 signal fails", async () => {
    const fixture = await mediaFixture();
    const bytes = await createZipBackup(fixture.data);
    audio.prepare.mockRejectedValueOnce(new Error("Audio decoder failed"));
    vi.stubGlobal("indexedDB", new IDBFactory());
    const before = structuredClone(stored);
    await expect(parseZipBackup(bytes)).rejects.toThrow("Audio decoder failed");
    expect(await loadBackgroundImage(fixture.imageId)).toBeNull();
    expect(await loadTimerSound(fixture.soundId)).toBeNull();
    expect(stored).toEqual(before);
  });

  it("rejects added playback files or audio manifest entries in v2 before decoding", async () => {
    const fixture = await mediaFixture();
    const files = unzipSync(await createZipBackup(fixture.data));
    await expect(parseZipBackup(zipSync({ ...files, "audio/playback.wav": timerSoundBytesFromDataUrl(fixture.currentSound.playbackDataUrl) }))).rejects.toThrow(/unlisted/i);
    await expect(parseZipBackup(rewriteManifest(files, (manifest) => {
      manifest.timerSounds[fixture.soundId].playbackPath = "audio/playback.wav";
    }))).rejects.toThrow(/manifest/i);
    expect(audio.prepare).not.toHaveBeenCalled();
  });

  it("exports and parses a minimal ZIP without custom media", async () => {
    const data = createEmptyData();
    data.settings.notes.text = "A note without files";
    const zip = await createZipBackup(data);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["aura-start.json", "manifest.json"]);
    const parsed = await parseZipBackup(zip);
    expect(parsed.settings.notes.text).toBe("A note without files");
    expect(readManifest(files).backgroundImages).toEqual({});
    expect(readManifest(files).timerSounds).toEqual({});
    await expect(importBackgroundImageBackup(parsed)).resolves.toBeUndefined();
    await expect(importTimerSoundBackup(parsed)).resolves.toBeUndefined();
  });

  it("downloads a ZIP Blob only after the complete archive is ready", async () => {
    await exportZipBackup(createEmptyData(), "aura-start-test.zip");
    expect(downloads.save).toHaveBeenCalledOnce();
    const [name, blob] = downloads.save.mock.calls[0] as [string, Blob];
    expect(name).toBe("aura-start-test.zip");
    expect(blob.type).toBe("application/zip");
    expect(readManifest(unzipSync(new Uint8Array(await blob.arrayBuffer()))).dataFile).toBe("aura-start.json");
  });

  it("does not download a partial archive when collecting an asset fails", async () => {
    const data = createEmptyData();
    data.settings.timer.customSoundId = "a".repeat(64);
    await expect(exportZipBackup(data)).rejects.toThrow(/unavailable|missing/i);
    expect(downloads.save).not.toHaveBeenCalled();
  });

  it("preserves noncanonical but accepted data-URL encoding so content hashes remain valid", async () => {
    const image = "data:image/PNG;base64,/x==";
    const original = { ...sound("Signal.aac"), dataUrl: "data:audio/aac;base64,/x==" };
    const imageId = await storeBackgroundImage(image);
    const soundId = await storeTimerSound(original);
    const data = createEmptyData();
    data.settings.background = { ...data.settings.background, preset: "custom", customImageId: imageId };
    data.settings.timer.customSoundId = soundId;
    const bytes = await createLegacyZipBackup(data);
    const files = unzipSync(bytes);
    const manifest = readManifest(files);
    expect(files[manifest.backgroundImages[imageId].path]).toEqual(new Uint8Array([255]));
    expect(files[manifest.timerSounds[soundId].path]).toEqual(new Uint8Array([255]));
    vi.stubGlobal("indexedDB", new IDBFactory());
    const parsed = await parseZipBackup(bytes);
    await importBackgroundImageBackup(parsed);
    await importTimerSoundBackup(parsed);
    expect(await loadBackgroundImage(imageId)).toBe(image);
    expect(await loadTimerSound(soundId)).toEqual(original);
  });

  it.each(["current image", "historical image", "current sound"])("refuses incomplete export with a missing %s", async (missing) => {
    const { data } = await mediaFixture();
    const snapshot = missing.startsWith("historical") ? data.restorePoints[1].data : data;
    if (missing.endsWith("image")) snapshot.settings.background.customImageId = "a".repeat(64);
    else snapshot.settings.timer.customSoundId = "b".repeat(64);
    delete data.syncReplica;
    const before = structuredClone(data);
    await expect(createZipBackup(data)).rejects.toThrow(/unavailable|missing/i);
    expect(data).toEqual(before);
  });

  it.each(["manifest.json", "aura-start.json"])("rejects an archive missing %s", async (path) => {
    const files = unzipSync(await createZipBackup(createEmptyData()));
    delete files[path];
    await expect(parseZipBackup(zipSync(files))).rejects.toThrow();
  });

  it.each(["image", "sound", "playback"])("rejects a missing referenced %s file before changing any local state", async (kind) => {
    const fixture = await mediaFixture();
    const files = unzipSync(await createLegacyZipBackup(fixture.data));
    const manifest = readManifest(files);
    const path = kind === "image" ? manifest.backgroundImages[fixture.imageId].path
      : kind === "sound" ? manifest.timerSounds[fixture.soundId].path : manifest.timerSounds[fixture.soundId].playbackPath;
    delete files[path];
    vi.stubGlobal("indexedDB", new IDBFactory());
    const before = structuredClone(stored);
    await expect(parseZipBackup(zipSync(files))).rejects.toThrow();
    expect(stored).toEqual(before);
    expect(await loadBackgroundImage(fixture.imageId)).toBeNull();
    expect(await loadTimerSound(fixture.soundId)).toBeNull();
  });

  it.each(["image", "sound", "playback"])("rejects CRC-valid but hash-invalid %s content without partly caching earlier assets", async (kind) => {
    const fixture = await mediaFixture();
    const files = unzipSync(await createLegacyZipBackup(fixture.data));
    const manifest = readManifest(files);
    const path = kind === "image" ? manifest.backgroundImages[fixture.previousImageId].path
      : kind === "sound" ? manifest.timerSounds[fixture.previousSoundId].path : manifest.timerSounds[fixture.previousSoundId].playbackPath;
    files[path] = files[path].slice();
    files[path][files[path].length - 1] ^= 1;
    vi.stubGlobal("indexedDB", new IDBFactory());
    const before = structuredClone(stored);
    await expect(parseZipBackup(zipSync(files))).rejects.toThrow(/hash|match|invalid|damaged/i);
    expect(stored).toEqual(before);
    expect(await loadBackgroundImage(fixture.imageId)).toBeNull();
    expect(await loadTimerSound(fixture.soundId)).toBeNull();
  });

  it("rejects invalid original filename, MIME and media identifiers in the manifest", async () => {
    const fixture = await mediaFixture();
    const files = unzipSync(await createZipBackup(fixture.data));
    for (const change of [
      (manifest: Manifest) => { manifest.timerSounds[fixture.soundId].name = "../signal.mp3"; },
      (manifest: Manifest) => { manifest.timerSounds[fixture.soundId].mimeType = "text/html"; },
      (manifest: Manifest) => { manifest.backgroundImages[fixture.imageId].mimeType = "text/html"; },
      (manifest: Manifest) => { manifest.timerSounds["a".repeat(64)] = manifest.timerSounds[fixture.soundId]; delete manifest.timerSounds[fixture.soundId]; }
    ]) {
      await expect(parseZipBackup(rewriteManifest(files, change))).rejects.toThrow();
    }
  });

  it("rejects unsupported manifest format or version and unexpected files", async () => {
    const files = unzipSync(await createZipBackup(createEmptyData()));
    await expect(parseZipBackup(rewriteManifest(files, (manifest) => { manifest.version = 999; }))).rejects.toThrow();
    await expect(parseZipBackup(rewriteManifest(files, (manifest) => { manifest.format = "another-app"; }))).rejects.toThrow();
    await expect(parseZipBackup(zipSync({ ...files, "extra-file.txt": strToU8("unreferenced") }))).rejects.toThrow();
  });

  it.each([0, 4, 15])("rejects malformed or truncated ZIP bytes (cut %s)", async (cut) => {
    const zip = await createZipBackup(createEmptyData());
    await expect(parseZipBackup(cut === 0 ? strToU8("not a zip") : zip.slice(0, -cut))).rejects.toThrow();
  });

  it("checks ZIP CRC before accepting a corrupted member", async () => {
    const files = unzipSync(await createZipBackup(createEmptyData()));
    const bytes = zipSync(files, { level: 0 });
    const entry = entryRecord(bytes, "aura-start.json");
    bytes[entry.data + files["aura-start.json"].length - 1] ^= 1;
    await expect(parseZipBackup(bytes)).rejects.toThrow(/CRC|checksum|corrupt|damaged/i);
  });

  it("rejects duplicate archive member names instead of silently overwriting one", async () => {
    const files = unzipSync(await createZipBackup(createEmptyData()));
    const bytes = zipSync({ ...files, "one-file.json": strToU8("one"), "two-file.json": strToU8("two") }, { level: 0 });
    await expect(parseZipBackup(renameMember(bytes, "two-file.json", "one-file.json"))).rejects.toThrow(/duplicate/i);
  });

  it.each(["../outside.txt", "/absolute.txt", "folder\\file.txt"])("rejects unsafe ZIP entry path %s", async (path) => {
    const files = unzipSync(await createZipBackup(createEmptyData()));
    await expect(parseZipBackup(zipSync({ ...files, [path]: strToU8("unsafe") }))).rejects.toThrow(/path|unsafe|invalid/i);
  });

  it("rejects uncompressed size claims exceeding the ZIP budget before allocation", async () => {
    const bytes = zipSync(unzipSync(await createZipBackup(createEmptyData())), { level: 0 });
    const entry = entryRecord(bytes, "aura-start.json");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(entry.central + 24, 257 * 1024 * 1024, true);
    view.setUint32(entry.local + 22, 257 * 1024 * 1024, true);
    await expect(parseZipBackup(bytes)).rejects.toThrow(/large|size|limit|budget|ZIP/i);
  });

  it("rejects oversized manifests and excessive member counts", async () => {
    const files = unzipSync(await createZipBackup(createEmptyData()));
    const manifest = { ...readManifest(files), padding: "x".repeat(256 * 1024) };
    await expect(parseZipBackup(zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(manifest)) }))).rejects.toThrow(/large|size|limit|manifest/i);
    const extra = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`extra-${index}.txt`, new Uint8Array([1])]));
    await expect(parseZipBackup(zipSync({ ...files, ...extra }))).rejects.toThrow(/many|count|limit|files/i);
  });
});
