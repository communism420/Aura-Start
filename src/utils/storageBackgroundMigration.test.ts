import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { loadBackgroundImage } from "./backgroundImageStorage";
import { createEmptyData } from "./sampleData";
import { loadAuraData, saveAuraData, updateAuraData } from "./storage";
import { commitLocalSyncChanges, ensureSyncReplica } from "./syncReplica";
import { loadAuraUiState, saveAuraUiState } from "./uiState";

const IMAGE = "data:image/png;base64,bGVnYWN5LWJhY2tncm91bmQ=";
let stored: Record<string, unknown>;
let write: ReturnType<typeof vi.fn>;

function fixture(): AuraStartData {
  const data = structuredClone(createEmptyData());
  data.updatedAt = "2026-09-12T10:00:00.000Z";
  data.settings.background.preset = "custom";
  delete data.settings.background.customImageId;
  data.settings.sync.deviceId = "existing-installation";
  return data;
}

function mainData(): AuraStartData { return structuredClone(stored[STORAGE_KEY]) as AuraStartData; }
function seed(data = fixture()): void {
  stored[STORAGE_KEY] = structuredClone(data);
  stored[UI_STATE_STORAGE_KEY] = {
    onboardingCompleted: true, demoData: { groupIds: [], linkIds: [] }, lastSearchQuery: "saved search",
    searchFilter: "all", customBackgroundImage: IMAGE, widgetNotes: ""
  };
}

beforeEach(() => {
  stored = {};
  write = vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", {
    storage: {
      local: {
        get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
        set: write,
        remove: async (key: string) => { delete stored[key]; }
      }
    }
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("safe 2.0.5 custom background migration", () => {
  it("migrates before a first data load, preserving the exact image and unrelated local state", async () => {
    seed();
    const original = mainData();
    const loaded = await loadAuraData();
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.backgroundMigrationError).toBeUndefined();
    const id = loaded.data.settings.background.customImageId;
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(await loadBackgroundImage(id)).toBe(IMAGE);
    expect(loaded.data.settings.sync).toEqual(original.settings.sync);
    expect(loaded.data.settings.background.preset).toBe("custom");
    expect(loaded.data.syncReplica?.settings["background.customImageId"].stamp).toEqual({ counter: 1, deviceId: "existing-installation" });
    expect(loaded.data.syncReplica?.settings["background.preset"].stamp).toEqual({ counter: 1, deviceId: "existing-installation" });
    expect(loaded.data.updatedAt).not.toBe(original.updatedAt);
    expect(JSON.stringify(stored[STORAGE_KEY])).not.toContain("data:image");
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: null, widgetNotes: "", lastSearchQuery: "saved search" });
    expect(mainData()).toEqual(loaded.data);
  });

  it("reads an earlier 2.1.0 replica without an image register and stamps migration after existing changes", async () => {
    const original = fixture();
    const edited = structuredClone(original);
    edited.settings.theme = "dark";
    const prior = commitLocalSyncChanges(original, edited);
    delete prior.settings.background.customImageId;
    delete prior.syncReplica!.settings["background.customImageId"];
    seed(prior);
    const loaded = await loadAuraData();
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.data.syncReplica?.clock).toBe(2);
    expect(loaded.data.settings.theme).toBe("dark");
    expect(await loadBackgroundImage(loaded.data.settings.background.customImageId)).toBe(IMAGE);
  });

  it("serializes simultaneous first loads and never re-migrates after success", async () => {
    seed();
    const [first, second] = await Promise.all([loadAuraData(), loadAuraData()]);
    expect(first).toEqual(second);
    expect(mainData().syncReplica?.clock).toBe(1);
    const mainWrites = write.mock.calls.filter(([items]) => Object.hasOwn(items, STORAGE_KEY));
    expect(mainWrites).toHaveLength(1);
    await loadAuraData();
    expect(write.mock.calls.filter(([items]) => Object.hasOwn(items, STORAGE_KEY))).toHaveLength(1);
  });

  it("retains legacy bytes and blocks replacing the unresolved image when persistence fails, then retries safely", async () => {
    seed();
    const original = JSON.stringify(stored);
    vi.stubGlobal("indexedDB", undefined);
    const loaded = await loadAuraData();
    expect(loaded).toMatchObject({ status: "ready", backgroundMigrationError: expect.stringContaining("storage is unavailable") });
    for (const customImageId of [null, "a".repeat(64)]) {
      const next = fixture();
      next.settings.background.customImageId = customImageId;
      await expect(saveAuraData(next)).rejects.toThrow(/storage is unavailable/);
    }
    await expect(updateAuraData((data) => ({
      ...data, settings: { ...data.settings, background: { ...data.settings.background, customImageId: null } }
    }))).rejects.toThrow(/storage is unavailable/);
    expect(JSON.stringify(stored)).toBe(original);
    const ui = await loadAuraUiState();
    await saveAuraUiState({ ...ui, customBackgroundImage: null, lastSearchQuery: "new query" });
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: IMAGE, lastSearchQuery: "new query" });
    vi.stubGlobal("indexedDB", new IDBFactory());
    const retried = await loadAuraData();
    expect(retried.status).toBe("ready");
    if (retried.status !== "ready") return;
    expect(retried.backgroundMigrationError).toBeUndefined();
    expect(await loadBackgroundImage(retried.data.settings.background.customImageId)).toBe(IMAGE);
  });

  it("allows local bookmark and settings edits while retaining a retryable image migration", async () => {
    seed();
    vi.stubGlobal("indexedDB", undefined);
    const baseline = mainData();
    const next = structuredClone(baseline);
    next.groups.push({ id: "local-group", title: "Work kept locally", parentId: null, collapsed: false, order: 0, links: [] });
    next.settings.theme = "dark";
    next.settings.background.preset = "forest";
    const saved = await saveAuraData(next, { baseline });
    expect(saved.groups[0].title).toBe("Work kept locally");
    expect(saved.settings.theme).toBe("dark");
    expect(saved.settings.background.customImageId).toBeUndefined();
    expect(saved.syncReplica?.settings["background.customImageId"]).toMatchObject({ value: null, stamp: { counter: 0 } });
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: IMAGE });
    const deferred = await loadAuraData();
    expect(deferred).toMatchObject({ status: "ready", backgroundMigrationError: expect.stringContaining("storage is unavailable") });

    vi.stubGlobal("indexedDB", new IDBFactory());
    const migrated = await loadAuraData();
    expect(migrated.status).toBe("ready");
    if (migrated.status !== "ready") return;
    expect(migrated.backgroundMigrationError).toBeUndefined();
    expect(migrated.data.groups[0].title).toBe("Work kept locally");
    expect(migrated.data.settings.theme).toBe("dark");
    expect(migrated.data.settings.background.preset).toBe("forest");
    expect(await loadBackgroundImage(migrated.data.settings.background.customImageId)).toBe(IMAGE);
    expect(migrated.data.syncReplica?.clock).toBe(2);
  });

  it("allows disconnect metadata updates but prevents remote shared changes while migration is deferred", async () => {
    const data = fixture();
    data.settings.sync = { ...data.settings.sync, mode: "auto", connected: true, connectionId: "connected-session" };
    seed(data);
    vi.stubGlobal("indexedDB", undefined);
    const disconnected = await updateAuraData((current) => ({
      ...current,
      settings: { ...current.settings, sync: { ...current.settings.sync, mode: "off", connected: false, connectionId: "disconnected-session" } }
    }));
    expect(disconnected?.settings.sync).toMatchObject({ mode: "off", connected: false, connectionId: "disconnected-session" });
    expect(disconnected?.settings.background.customImageId).toBeUndefined();
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: IMAGE });
    const before = JSON.stringify(stored);
    await expect(updateAuraData((current) => ({
      ...current,
      settings: { ...current.settings, background: { ...current.settings.background, preset: "none" } }
    }))).rejects.toThrow(/storage is unavailable/);
    await expect(updateAuraData((current) => {
      current.settings.theme = "dark";
      return current;
    })).rejects.toThrow(/storage is unavailable/);
    expect(JSON.stringify(stored)).toBe(before);

    vi.stubGlobal("indexedDB", new IDBFactory());
    const migrated = await loadAuraData();
    expect(migrated.status).toBe("ready");
    if (migrated.status !== "ready") return;
    expect(migrated.data.settings.sync).toMatchObject({ mode: "off", connected: false });
    expect(await loadBackgroundImage(migrated.data.settings.background.customImageId)).toBe(IMAGE);
  });

  it("keeps the only legacy copy until the main reference has been saved successfully", async () => {
    seed();
    const original = mainData();
    write.mockImplementationOnce(async () => { throw new Error("Main storage quota exceeded"); });
    const failed = await loadAuraData();
    expect(failed).toMatchObject({ status: "ready", backgroundMigrationError: "Main storage quota exceeded" });
    expect(mainData()).toEqual(original);
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: IMAGE });
    const success = await loadAuraData();
    expect(success.status).toBe("ready");
    expect(mainData().syncReplica?.clock).toBe(1);
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: null });
  });

  it("retries failed legacy cleanup without changing the committed image or clock", async () => {
    seed();
    write.mockImplementation(async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, UI_STATE_STORAGE_KEY)) throw new Error("UI write failed");
      Object.assign(stored, structuredClone(items));
    });
    const loaded = await loadAuraData();
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.backgroundMigrationError).toBeUndefined();
    expect(await loadBackgroundImage(loaded.data.settings.background.customImageId)).toBe(IMAGE);
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: IMAGE });
    const committed = mainData();
    write.mockImplementation(async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); });
    await loadAuraData();
    expect(mainData()).toEqual(committed);
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: null });
  });

  it("does not resurrect legacy bytes after explicit removal or a synchronized replacement", async () => {
    for (const customImageId of [null, "a".repeat(64)]) {
      const data = fixture();
      data.settings.background.customImageId = customImageId;
      data.syncReplica = ensureSyncReplica(data);
      seed(data);
      const open = vi.spyOn(indexedDB, "open");
      await loadAuraData();
      expect(mainData().settings.background.customImageId).toBe(customImageId);
      expect(open).not.toHaveBeenCalled();
      expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: null });
      const ui = await loadAuraUiState();
      await saveAuraUiState({ ...ui, customBackgroundImage: IMAGE, widgetNotes: "Updated notes" });
      expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: null, widgetNotes: "" });
      open.mockRestore();
    }
  });

  it("does not mint a deletion stamp when the old installation has no custom image", async () => {
    seed();
    (stored[UI_STATE_STORAGE_KEY] as Record<string, unknown>).customBackgroundImage = null;
    const original = mainData();
    const loaded = await loadAuraData();
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.data.settings).toEqual(original.settings);
    expect(loaded.data.updatedAt).toBe(original.updatedAt);
    expect(loaded.data.syncReplica?.settings["background.customImageId"]).toMatchObject({
      value: null, stamp: { counter: 0 }
    });
    expect(await loadAuraData()).toEqual(loaded);
    expect(mainData().settings.background.customImageId).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("retains a noncustom selected preset when migrating an image saved for later use", async () => {
    const data = fixture();
    data.settings.background.preset = "forest";
    seed(data);
    const loaded = await loadAuraData();
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.data.settings.background.preset).toBe("forest");
    expect(loaded.data.syncReplica?.settings["background.preset"].stamp.counter).toBe(0);
    expect(await loadBackgroundImage(loaded.data.settings.background.customImageId)).toBe(IMAGE);
  });

  it("does not discard a recoverable legacy image when the main reference is malformed", async () => {
    seed();
    (stored[STORAGE_KEY] as AuraStartData).settings.background.customImageId = "damaged-reference";
    const ui = await loadAuraUiState();
    await saveAuraUiState({ ...ui, customBackgroundImage: null });
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: IMAGE });
  });

  it("also migrates the browser preview's localStorage while keeping bytes out of its quota", async () => {
    seed();
    const values = new Map(Object.entries(stored).map(([key, value]) => [key, JSON.stringify(value)]));
    vi.stubGlobal("browser", undefined);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    });
    const loaded = await loadAuraData();
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.fallback).toBe(true);
    expect(await loadBackgroundImage(loaded.data.settings.background.customImageId)).toBe(IMAGE);
    expect(values.get(STORAGE_KEY)).not.toContain("data:image");
    expect(JSON.parse(values.get(UI_STATE_STORAGE_KEY)!)).toMatchObject({ customBackgroundImage: null });
  });
});
