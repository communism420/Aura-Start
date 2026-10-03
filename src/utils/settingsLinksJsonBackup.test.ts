import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuraStartData } from "../types";
import { importBackgroundImageBackup } from "./backgroundImageBackup";
import { createSettingsLinksJsonBackup } from "./exportJson";
import { parseJsonBackup } from "./importJson";
import { createEmptyData } from "./sampleData";
import { applyExplicitSettingsPatch } from "./settingsPatch";
import { projectSharedSettings, restoreCompatibleSettings } from "./settingsSchema";
import { commitLocalSyncChanges, ensureSyncReplica, mergeSyncData } from "./syncReplica";
import { importTimerSoundBackup } from "./timerSoundBackup";

const IMAGE_ID = "a".repeat(64);
const SOUND_ID = "b".repeat(64);
const HISTORY_IMAGE_ID = "c".repeat(64);
const HISTORY_SOUND_ID = "d".repeat(64);

function fixture(): AuraStartData {
  const empty = createEmptyData();
  const data = { ...empty, ...applyExplicitSettingsPatch(empty, {
    background: { customImageId: IMAGE_ID, preset: "custom", dim: 0, blur: 3 },
    timer: { customSoundId: SOUND_ID, durationSeconds: 17, volume: 0 },
    notes: { text: "Keep all notes\nИ настройки ✓" }, showSearch: false, captureOpenTabs: true,
    sync: { deleteCloudFileOnDisconnect: false }
  }) };
  data.groups = [{ id: "group", title: "Bookmarks", parentId: null, order: 0, collapsed: false,
    links: [{ id: "link", title: "Example", url: "https://example.com/", order: 0,
      createdAt: data.updatedAt, updatedAt: data.updatedAt }] }];
  data.restorePoints = [{ id: "old", name: "Earlier preferences", createdAt: data.updatedAt, reason: "manual",
    data: { version: 1, updatedAt: data.updatedAt, groups: structuredClone(data.groups),
      settings: { ...structuredClone(data.settings),
        background: { ...data.settings.background, customImageId: HISTORY_IMAGE_ID },
        timer: { ...data.settings.timer, customSoundId: HISTORY_SOUND_ID } } } }];
  data.syncReplica = ensureSyncReplica(data);
  data.syncReplica.clock = 900;
  for (const path of ["background.customImageId", "background.preset", "timer.customSoundId"]) {
    data.syncReplica.settings[path].stamp = { counter: 900, deviceId: "source-device" };
  }
  return data;
}

beforeEach(() => {
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("settings and links JSON without custom files", () => {
  it("exports notes, every non-media preference, links and history without reading unavailable media", () => {
    const data = fixture();
    const before = structuredClone(data);
    const json = createSettingsLinksJsonBackup(data);
    const raw = JSON.parse(json);
    expect(raw.settings).toMatchObject({ notes: { text: data.settings.notes.text }, showSearch: false, captureOpenTabs: true,
      timer: { durationSeconds: 17, volume: 0 }, background: { dim: 0, blur: 3 }, sync: { deleteCloudFileOnDisconnect: false } });
    expect(raw.groups).toEqual(data.groups);
    expect(raw.restorePoints).toHaveLength(1);
    expect(raw.restorePoints[0].data.settings.notes.text).toBe(data.settings.notes.text);
    for (const id of [IMAGE_ID, SOUND_ID, HISTORY_IMAGE_ID, HISTORY_SOUND_ID]) expect(json).not.toContain(id);
    expect(raw).not.toHaveProperty("backgroundImages");
    expect(raw).not.toHaveProperty("timerSounds");
    expect(data).toEqual(before);
  });

  it("can be imported on a fresh device without any image or sound database content", async () => {
    const parsed = parseJsonBackup(createSettingsLinksJsonBackup(fixture()));
    await expect(importBackgroundImageBackup(parsed)).resolves.toBeUndefined();
    await expect(importTimerSoundBackup(parsed)).resolves.toBeUndefined();
    expect(parsed.settings.notes.text).toBe("Keep all notes\nИ настройки ✓");
    expect(projectSharedSettings(parsed)["background.customImageId"]).toBeNull();
    expect(parsed.settings.timer.customSoundId).toBeNull();
    expect(parsed.settings.background.preset).not.toBe("custom");
  });

  it("marks omitted current and historical media as neutral rather than propagating file removal", () => {
    const parsed = parseJsonBackup(createSettingsLinksJsonBackup(fixture()));
    for (const snapshot of [parsed, ...parsed.restorePoints.map((point) => point.data)]) {
      expect(snapshot.settingsCompatibility?.defaulted).toEqual(expect.arrayContaining([
        "background.customImageId", "background.preset", "timer.customSoundId"
      ]));
    }
    for (const path of ["background.customImageId", "background.preset", "timer.customSoundId"]) {
      expect(parsed.syncReplica?.settings[path].stamp).toEqual({ counter: 0, deviceId: "settings-default" });
    }
  });

  it("keeps an existing receiver's custom files and chosen preset during restore or replica merge", () => {
    const imported = parseJsonBackup(createSettingsLinksJsonBackup(fixture()));
    const empty = createEmptyData();
    const receiver = commitLocalSyncChanges(empty, { ...empty, ...applyExplicitSettingsPatch(empty, {
      background: { customImageId: HISTORY_IMAGE_ID, preset: "custom" }, timer: { customSoundId: HISTORY_SOUND_ID }
    }) });
    const restored = restoreCompatibleSettings(receiver, imported);
    const merged = mergeSyncData(receiver, imported);
    for (const settings of [restored.settings, merged.settings]) {
      expect(settings.background).toMatchObject({ customImageId: HISTORY_IMAGE_ID, preset: "custom" });
      expect(settings.timer.customSoundId).toBe(HISTORY_SOUND_ID);
      expect(settings.notes.text).toBe(imported.settings.notes.text);
    }
  });

  it("retains deliberate choices of built-in background and default alarm instead of marking them absent", () => {
    const custom = fixture();
    const builtin = commitLocalSyncChanges(custom, { ...custom, ...applyExplicitSettingsPatch(custom, {
      background: { customImageId: null, preset: "dawn" }, timer: { customSoundId: null }
    }) });
    const parsed = parseJsonBackup(createSettingsLinksJsonBackup(builtin));
    expect(parsed.settings.background).toMatchObject({ customImageId: null, preset: "dawn" });
    expect(parsed.settings.timer.customSoundId).toBeNull();
    for (const path of ["background.customImageId", "background.preset", "timer.customSoundId"]) {
      expect(parsed.settingsCompatibility?.defaulted).not.toContain(path);
      expect(parsed.syncReplica?.settings[path]).toEqual(builtin.syncReplica?.settings[path]);
    }
  });
});
