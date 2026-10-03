import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuraStartData } from "../types";
import { collectTimerSoundBackup, importTimerSoundBackup, registerTimerSoundBackup } from "./timerSoundBackup";
import { PortableJsonBudget } from "./portableJsonSize";
import { loadTimerSound, storeTimerSound, type TimerSoundAsset } from "./timerSoundStorage";
import { createJsonBackup, createPortableJsonBackup, exportJsonBackup } from "./exportJson";
import { parseJsonBackup } from "./importJson";
import { createEmptyData } from "./sampleData";

const downloads = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./download", () => ({ downloadTextFile: downloads.save }));

function soundAsset(name = "My chime.wav", sample = 100): TimerSoundAsset {
  const bytes = new Uint8Array(44 + 480);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((letter, index) => { bytes[offset + index] = letter.charCodeAt(0); });
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, 480, true);
  for (let offset = 44; offset < bytes.length; offset += 2) view.setInt16(offset, sample, true);
  const dataUrl = `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
  return { name, dataUrl, playbackDataUrl: dataUrl };
}

function backupWithSounds(currentId: string, previousIds: string[] = []): AuraStartData {
  const data = createEmptyData();
  data.settings.timer.customSoundId = currentId;
  data.restorePoints = previousIds.map((id, index) => ({
    id: `point-${index}`, name: `Sound ${index}`, reason: "manual", createdAt: data.updatedAt,
    data: {
      version: 1, updatedAt: data.updatedAt, groups: [],
      settings: { ...structuredClone(data.settings), timer: { ...data.settings.timer, customSoundId: id } }
    }
  }));
  return data;
}

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("portable custom timer sound backups", () => {
  it("stops an oversized aggregate before exporting or silently omitting historical sounds", async () => {
    const id = await storeTimerSound(soundAsset());
    const data = backupWithSounds(id);
    await expect(collectTimerSoundBackup(data, new PortableJsonBudget(100))).rejects.toThrow(/Remove unneeded Restore Points/);
    expect(downloads.save).not.toHaveBeenCalled();
    expect(await loadTimerSound(id)).toEqual(soundAsset());
  });
  it("exports each current or historical sound once and restores original and portable audio on another device", async () => {
    const first = soundAsset();
    const second = soundAsset("Other chime.wav", 500);
    const firstId = await storeTimerSound(first);
    const secondId = await storeTimerSound(second);
    const data = backupWithSounds(firstId, [firstId, secondId, secondId]);
    const json = await createPortableJsonBackup(data);
    expect(JSON.parse(json).timerSounds).toEqual({ [firstId]: first, [secondId]: second });
    expect(data).not.toHaveProperty("timerSounds");

    vi.stubGlobal("indexedDB", new IDBFactory());
    const imported = parseJsonBackup(json);
    expect(imported).not.toHaveProperty("timerSounds");
    expect(JSON.stringify(imported)).not.toContain("data:audio/");
    await importTimerSoundBackup(imported);
    expect(await loadTimerSound(firstId)).toEqual(first);
    expect(await loadTimerSound(secondId)).toEqual(second);
    expect(imported.restorePoints[1].data.settings.timer.customSoundId).toBe(secondId);
  });

  it("keeps old backups working when they contain no timer settings or sounds", async () => {
    const data = createEmptyData();
    delete (data.settings as unknown as Record<string, unknown>).timer;
    delete data.settingsCompatibility;
    const imported = parseJsonBackup(createJsonBackup(data));
    expect(imported.settings.timer.customSoundId).toBeNull();
    await expect(importTimerSoundBackup(imported)).resolves.toBeUndefined();
    expect(JSON.parse(await createPortableJsonBackup(imported))).not.toHaveProperty("timerSounds");
  });

  it("accepts a reference already stored locally without requiring a portable bundle", async () => {
    const sound = soundAsset();
    const id = await storeTimerSound(sound);
    const imported = parseJsonBackup(createJsonBackup(backupWithSounds(id)));
    await expect(importTimerSoundBackup(imported)).resolves.toBeUndefined();
    expect(await loadTimerSound(id)).toEqual(sound);
  });

  it("refuses missing active or historical sounds before allowing publication or export", async () => {
    const sound = soundAsset();
    const id = await storeTimerSound(sound);
    for (const data of [backupWithSounds("a".repeat(64)), backupWithSounds(id, ["b".repeat(64)])]) {
      const before = structuredClone(data);
      await expect(importTimerSoundBackup(data)).rejects.toThrow(/not included and is unavailable/);
      await expect(exportJsonBackup(data)).rejects.toThrow(/not exported/);
      expect(data).toEqual(before);
    }
    expect(downloads.save).not.toHaveBeenCalled();
  });

  it("rejects malformed, orphaned, or non-audio bundles when parsing", async () => {
    const sound = soundAsset();
    const id = await storeTimerSound(sound);
    const data = backupWithSounds(id);
    for (const timerSounds of [null, [], { invalid: sound }, { ["f".repeat(64)]: sound },
      { [id]: { ...sound, dataUrl: "https://example.com/alarm.mp3" } },
      { [id]: { ...sound, playbackDataUrl: "data:text/html;base64,YQ==" } }]) {
      expect(() => parseJsonBackup(JSON.stringify({ ...data, timerSounds }))).toThrow(/timer sound/i);
    }
  });

  it("verifies both file and playback hashes before caching an imported sound", async () => {
    const data = backupWithSounds("a".repeat(64));
    registerTimerSoundBackup(data, { ["a".repeat(64)]: soundAsset() });
    await expect(importTimerSoundBackup(data)).rejects.toThrow(/match|identifier/i);
    expect(await loadTimerSound("a".repeat(64))).toBeNull();
  });

  it("copies pending audio properties so caller changes cannot replace validated input", async () => {
    const sound = soundAsset();
    const id = await storeTimerSound(sound);
    vi.stubGlobal("indexedDB", new IDBFactory());
    const data = backupWithSounds(id);
    const timerSounds = { [id]: { ...sound } };
    registerTimerSoundBackup(data, timerSounds);
    timerSounds[id].playbackDataUrl = soundAsset("Changed.wav", 200).playbackDataUrl;
    await importTimerSoundBackup(data);
    expect(await loadTimerSound(id)).toEqual(sound);
  });

  it("exports audio even while the timer widget is disabled", async () => {
    const sound = soundAsset();
    const id = await storeTimerSound(sound);
    const data = backupWithSounds(id);
    data.settings.widgets.timer = false;
    await exportJsonBackup(data);
    expect(downloads.save).toHaveBeenCalledOnce();
    expect(JSON.parse(downloads.save.mock.calls[0][1]).timerSounds).toEqual({ [id]: sound });
  });
});
