import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WIDGET_NOTES_CHARS, STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { validateAuraData } from "./importJson";
import { createEmptyData } from "./sampleData";
import { applyExplicitSettingsPatch } from "./settingsPatch";
import { isSettingWireValue, normalizeSharedSettings, restoreCompatibleSettings } from "./settingsSchema";
import { loadAuraData, saveAuraData, updateAuraData } from "./storage";
import { commitLocalSyncChanges, mergeSyncData } from "./syncReplica";
import { loadAuraUiState, saveAuraUiState } from "./uiState";

let stored: Record<string, unknown>;
let write: ReturnType<typeof vi.fn>;

function legacy(deviceId = "old-device"): AuraStartData {
  const data = structuredClone(createEmptyData());
  delete (data.settings as Partial<typeof data.settings>).notes;
  delete data.settingsCompatibility;
  delete data.syncReplica;
  data.updatedAt = "2026-09-12T10:00:00.000Z";
  data.settings.sync.deviceId = deviceId;
  return data;
}

function seed(notes = "# План\n- Купить молоко\n\n  пробелы  ", data = legacy()): void {
  stored[STORAGE_KEY] = structuredClone(data);
  stored[UI_STATE_STORAGE_KEY] = {
    widgetNotes: notes, customBackgroundImage: null, onboardingCompleted: true,
    lastSearchQuery: "unchanged query", searchFilter: "all", demoData: { groupIds: ["demo"], linkIds: [] }
  };
}

function main(): AuraStartData { return structuredClone(stored[STORAGE_KEY]) as AuraStartData; }
async function ready(): Promise<AuraStartData> {
  const result = await loadAuraData();
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Fixture failed to load");
  expect(result.notesMigrationError).toBeUndefined();
  return result.data;
}

beforeEach(() => {
  stored = {};
  write = vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
    set: write, remove: async (key: string) => { delete stored[key]; }
  } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("shared notes schema and legacy migration", () => {
  it("moves exact Markdown into the causal shared document before clearing its only old copy", async () => {
    const notes = "# План\n- Купить молоко\n\n  пробелы  ";
    seed(notes);
    const data = await ready();
    expect(data.settings.notes.text).toBe(notes);
    expect(data.syncReplica?.settings["notes.text"]).toEqual({ value: notes, stamp: { counter: 1, deviceId: "old-device" } });
    expect(data.settingsCompatibility?.defaulted).not.toContain("notes.text");
    expect(data.restorePoints).toHaveLength(1);
    expect(data.restorePoints[0].data.settings.notes.text).toBe(notes);
    expect(data.restorePoints[0].context?.source).toBe("legacy_notes_migration");
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "", lastSearchQuery: "unchanged query", onboardingCompleted: true });
    expect(Object.keys(write.mock.calls[0][0])).toContain(STORAGE_KEY);
    expect(Object.keys(write.mock.calls[1][0])).toContain(UI_STATE_STORAGE_KEY);
    expect(main()).toEqual(data);
    expect(validateAuraData(JSON.parse(JSON.stringify(data))).settings.notes.text).toBe(notes);
  });

  it("serializes competing pages and migrates exactly once", async () => {
    seed();
    const [first, second] = await Promise.all([ready(), ready()]);
    expect(first).toEqual(second);
    expect(main().syncReplica?.clock).toBe(1);
    expect(main().restorePoints).toHaveLength(1);
    expect(write.mock.calls.filter(([items]) => Object.hasOwn(items, STORAGE_KEY))).toHaveLength(1);
    expect(await ready()).toEqual(first);
  });

  it.each(["Shared text already selected", ""])("never replaces explicit shared value %j with an old UI copy", async (sharedText) => {
    const initial = validateAuraData(legacy());
    const explicit = commitLocalSyncChanges(initial, { ...initial, ...applyExplicitSettingsPatch(initial, { notes: { text: sharedText } }) });
    seed("Old local note remains recoverable", explicit);
    const migrated = await ready();
    expect(migrated.settings.notes.text).toBe(sharedText);
    expect(migrated.syncReplica).toEqual(explicit.syncReplica);
    expect(migrated.restorePoints[0].data.settings.notes.text).toBe("Old local note remains recoverable");
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "" });
  });

  it("keeps old notes recoverable on each device when their first merged shared values differ", async () => {
    seed("Draft A", legacy("device-a"));
    const a = await ready();
    seed("Draft B", legacy("device-b"));
    const b = await ready();
    const mergedA = mergeSyncData(a, b);
    const mergedB = mergeSyncData(b, a);
    expect(mergedA.settings.notes).toEqual(mergedB.settings.notes);
    expect(mergedA.restorePoints[0].data.settings.notes.text).toBe("Draft A");
    expect(mergedB.restorePoints[0].data.settings.notes.text).toBe("Draft B");
  });

  it("does not let an older cloud file or restore point reset a migrated note", async () => {
    seed("Keep across older files");
    const local = await ready();
    const oldCloud = validateAuraData(legacy("old-cloud"));
    expect(oldCloud.syncReplica?.settings["notes.text"]).toMatchObject({ value: "", stamp: { counter: 0, deviceId: "settings-default" } });
    expect(mergeSyncData(local, oldCloud).settings.notes.text).toBe("Keep across older files");
    expect(mergeSyncData(oldCloud, local).settings.notes.text).toBe("Keep across older files");
    expect(restoreCompatibleSettings(local, oldCloud).settings.notes.text).toBe("Keep across older files");
  });

  it("preserves the last old copy and blocks a remote apply or note edit after a failed durable write", async () => {
    seed("Do not lose this text");
    const original = JSON.stringify(stored);
    write.mockImplementation(async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, STORAGE_KEY)) throw new Error("Notes migration quota exceeded");
      Object.assign(stored, structuredClone(items));
    });
    expect(await loadAuraData()).toMatchObject({ status: "ready", notesMigrationError: "Notes migration quota exceeded" });
    expect(JSON.stringify(stored)).toBe(original);
    const next = validateAuraData(main());
    Object.assign(next, applyExplicitSettingsPatch(next, { notes: { text: "replacement" } }));
    await expect(saveAuraData(next)).rejects.toThrow("Notes migration quota exceeded");
    await expect(updateAuraData((data) => ({ ...data, settings: { ...data.settings, theme: "dark" } }))).rejects.toThrow("Notes migration quota exceeded");
    const ui = await loadAuraUiState();
    await saveAuraUiState({ ...ui, widgetNotes: "", lastSearchQuery: "new query" });
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "Do not lose this text", lastSearchQuery: "new query" });
    write.mockImplementation(async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); });
    expect((await ready()).settings.notes.text).toBe("Do not lose this text");
  });

  it("allows disconnect and unrelated local edits while retaining a retryable legacy note", async () => {
    seed("Pending local note");
    write.mockImplementation(async (items: Record<string, unknown>) => {
      const data = items[STORAGE_KEY] as AuraStartData | undefined;
      if (data?.restorePoints.some((point) => point.context?.source === "legacy_notes_migration")) throw new Error("Recovery snapshot not writable");
      Object.assign(stored, structuredClone(items));
    });
    const disconnected = await updateAuraData((data) => ({ ...data, settings: {
      ...data.settings, sync: { ...data.settings.sync, mode: "off", connected: false, connectionId: "new-session" }
    } }));
    expect(disconnected?.settings.sync.connectionId).toBe("new-session");
    const baseline = validateAuraData(main());
    const next = structuredClone(baseline);
    next.settings.theme = "dark";
    const saved = await saveAuraData(next, { baseline });
    expect(saved.settings.theme).toBe("dark");
    expect(saved.settingsCompatibility?.defaulted).toContain("notes.text");
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "Pending local note" });
    write.mockImplementation(async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); });
    const migrated = await ready();
    expect(migrated.settings.notes.text).toBe("Pending local note");
    expect(migrated.settings.theme).toBe("dark");
  });

  it("retries a failed UI cleanup without restamping notes or duplicating recovery history", async () => {
    seed("Retry once");
    write.mockImplementation(async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, UI_STATE_STORAGE_KEY)) throw new Error("UI cleanup unavailable");
      Object.assign(stored, structuredClone(items));
    });
    const first = await ready();
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "Retry once" });
    write.mockImplementation(async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); });
    expect(await ready()).toEqual(first);
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "" });
    expect(main().restorePoints).toHaveLength(1);
  });

  it("ignores stale legacy UI text after migration and never resurrects it after explicit deletion", async () => {
    seed("Old editor draft");
    const staleUi = await loadAuraUiState();
    const data = await ready();
    const emptied = { ...data, ...applyExplicitSettingsPatch(data, { notes: { text: "" } }) };
    await saveAuraData(emptied, { baseline: data });
    await saveAuraUiState({ ...staleUi, widgetNotes: "Stale open page text", lastSearchQuery: "new search" });
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "", lastSearchQuery: "new search" });
    expect((await ready()).settings.notes.text).toBe("");
  });

  it("keeps empty legacy notes neutral and accepts the original 12000 character boundary", async () => {
    seed("");
    const empty = await ready();
    expect(empty.syncReplica?.settings["notes.text"]).toMatchObject({ value: "", stamp: { counter: 0 } });
    expect(empty.restorePoints).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
    const boundary = "Ж".repeat(MAX_WIDGET_NOTES_CHARS);
    seed(boundary);
    expect((await ready()).settings.notes.text).toBe(boundary);
    expect(isSettingWireValue("notes.text", boundary)).toBe(true);
    expect(isSettingWireValue("notes.text", `${boundary}x`)).toBe(false);
    expect(normalizeSharedSettings({ notes: { text: `${boundary}x` } }).settings.notes.text).toBe(boundary);
  });

  it("migrates browser-preview localStorage with the same durable order", async () => {
    seed("Preview note");
    const values = new Map(Object.entries(stored).map(([key, value]) => [key, JSON.stringify(value)]));
    vi.stubGlobal("browser", undefined);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key)
    });
    expect((await ready()).settings.notes.text).toBe("Preview note");
    expect(JSON.parse(values.get(STORAGE_KEY)!).settings.notes.text).toBe("Preview note");
    expect(JSON.parse(values.get(UI_STATE_STORAGE_KEY)!).widgetNotes).toBe("");
  });
});
