import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WIDGET_NOTES_CHARS, STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { applyExplicitSettingsPatch } from "../utils/settingsPatch";

let useAuraStore: typeof import("./useAuraStore")["useAuraStore"];
let storage: typeof import("../utils/storage");
let stored: Record<string, unknown>;
let onMainWrite: ((data: AuraStartData) => Promise<void>) | undefined;

function gate() {
  let enter!: () => void;
  let release!: () => void;
  return { entered: new Promise<void>((resolve) => { enter = resolve; }),
    released: new Promise<void>((resolve) => { release = resolve; }),
    enter: () => enter(), release: () => release() };
}

function fixture(note = ""): AuraStartData {
  const data = createEmptyData();
  data.settings.sync = { ...data.settings.sync, deviceId: "notes-device", mode: "off" };
  data.settings.background.customImageId = null;
  return { ...data, ...applyExplicitSettingsPatch(data, { notes: { text: note } }) };
}

async function seed(note = ""): Promise<AuraStartData> {
  const saved = await storage.saveAuraData(fixture(note));
  useAuraStore.setState({ data: saved, status: "ready", syncStatus: "idle", toasts: [] });
  expect(useAuraStore.getState().widgetNotes).toBe(note);
  return saved;
}

async function durable(): Promise<AuraStartData> {
  const loaded = await storage.loadAuraData();
  if (loaded.status !== "ready") throw new Error("Notes storage is not ready");
  return loaded.data;
}

beforeEach(async () => {
  vi.resetModules();
  stored = {};
  onMainWrite = undefined;
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {},
    set: async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, STORAGE_KEY)) await onMainWrite?.(items[STORAGE_KEY] as AuraStartData);
      Object.assign(stored, structuredClone(items));
    },
    remove: async (key: string) => { delete stored[key]; }
  } } });
  storage = await import("../utils/storage");
  ({ useAuraStore } = await import("./useAuraStore"));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("notes widget actions against real settings storage", () => {
  it("persists a rapid type then clear while the earlier write is still in flight", async () => {
    await seed();
    const firstWrite = gate();
    onMainWrite = async (data) => {
      if (data.settings.notes.text === "First typed text") { firstWrite.enter(); await firstWrite.released; }
    };
    const first = useAuraStore.getState().setWidgetNotes("First typed text");
    await firstWrite.entered;
    const cleared = useAuraStore.getState().setWidgetNotes("");
    expect(useAuraStore.getState().widgetNotes).toBe("");
    firstWrite.release();
    await Promise.all([first, cleared]);
    const after = await durable();
    expect(after.settings.notes.text).toBe("");
    expect(after.syncReplica?.settings["notes.text"].value).toBe("");
    expect(after.syncReplica?.settings["notes.text"].stamp.counter).toBeGreaterThan(1);
    expect(useAuraStore.getState().widgetNotes).toBe("");
  });

  it("keeps later typing visible while an earlier acknowledgement and remote projection arrive", async () => {
    const initial = await seed();
    const firstWrite = gate();
    const secondWrite = gate();
    onMainWrite = async (data) => {
      const paused = data.settings.notes.text === "A" ? firstWrite : secondWrite;
      paused.enter(); await paused.released;
    };
    const first = useAuraStore.getState().setWidgetNotes("A");
    await firstWrite.entered;
    const second = useAuraStore.getState().setWidgetNotes("AB");
    firstWrite.release();
    await first;
    await secondWrite.entered;
    expect(useAuraStore.getState().widgetNotes).toBe("AB");
    useAuraStore.setState({ data: { ...initial, ...applyExplicitSettingsPatch(initial, { notes: { text: "Remote text" } }) } });
    expect(useAuraStore.getState().widgetNotes).toBe("AB");
    secondWrite.release();
    await second;
    expect((await durable()).settings.notes.text).toBe("AB");
    expect(useAuraStore.getState().widgetNotes).toBe("AB");
  });

  it("preserves an unseen durable note before committing a stale visible edit", async () => {
    const initial = await seed("Text visible before sync");
    const remote = await storage.saveAuraData({ ...initial,
      ...applyExplicitSettingsPatch(initial, { notes: { text: "Remote note received meanwhile" } }) }, { baseline: initial });
    expect(useAuraStore.getState().widgetNotes).toBe("Text visible before sync");
    await useAuraStore.getState().setWidgetNotes("Local typing from that old view");
    const after = await durable();
    expect(after.settings.notes.text).toBe("Local typing from that old view");
    expect(after.restorePoints.some((point) => point.context?.source === "concurrent_notes_edit"
      && point.data.settings.notes.text === remote.settings.notes.text)).toBe(true);
  });

  it("keeps the draft and prior durable note on quota failure, then retries against newer remote data", async () => {
    const initial = await seed("Previously saved");
    onMainWrite = async () => { throw new Error("Storage quota exceeded"); };
    await useAuraStore.getState().setWidgetNotes("Unsaved draft");
    expect((await durable()).settings.notes.text).toBe("Previously saved");
    expect(useAuraStore.getState().widgetNotes).toBe("Unsaved draft");
    const retry = useAuraStore.getState().toasts.find((toast) => toast.type === "error" && toast.onAction)?.onAction;
    expect(retry).toBeTypeOf("function");

    onMainWrite = undefined;
    const remote = await storage.saveAuraData({ ...initial,
      ...applyExplicitSettingsPatch(initial, { notes: { text: "Remote received during failure" } }) }, { baseline: initial });
    useAuraStore.setState({ data: remote });
    expect(useAuraStore.getState().widgetNotes).toBe("Unsaved draft");
    await retry!();
    const after = await durable();
    expect(after.settings.notes.text).toBe("Unsaved draft");
    expect(useAuraStore.getState().widgetNotes).toBe("Unsaved draft");
    expect(after.restorePoints.some((point) => point.data.settings.notes.text === "Remote received during failure")).toBe(true);
  });

  it("projects downloaded notes into an idle widget without reopening the page", async () => {
    const initial = await seed("Before sync");
    await storage.saveAuraData({ ...initial,
      ...applyExplicitSettingsPatch(initial, { notes: { text: "Shared note\n✓ Теперь здесь" } }) }, { baseline: initial });
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult({ status: "downloaded", quiet: true });
    expect(useAuraStore.getState().widgetNotes).toBe("Shared note\n✓ Теперь здесь");
  });

  it("loads an existing shared note instead of obsolete UI text and keeps that legacy text recoverable", async () => {
    stored[STORAGE_KEY] = fixture("Existing shared note");
    stored[UI_STATE_STORAGE_KEY] = { widgetNotes: "Older UI-only note" };
    await useAuraStore.getState().load();
    expect(useAuraStore.getState().widgetNotes).toBe("Existing shared note");
    const after = await durable();
    expect(after.settings.notes.text).toBe("Existing shared note");
    expect(after.restorePoints.some((point) => point.context?.source === "legacy_notes_migration"
      && point.data.settings.notes.text === "Older UI-only note")).toBe(true);
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "" });
  });

  it("migrates a pre-settings note on load and handles a missing main document", async () => {
    for (const mainMissing of [false, true]) {
      stored = { [UI_STATE_STORAGE_KEY]: { widgetNotes: "Legacy migration\n**text**" } };
      if (!mainMissing) {
        const old = fixture();
        delete (old.settings as unknown as Record<string, unknown>).notes;
        delete old.settingsCompatibility;
        stored[STORAGE_KEY] = old;
      }
      await useAuraStore.getState().load();
      expect(useAuraStore.getState().widgetNotes).toBe("Legacy migration\n**text**");
      expect((await durable()).settings.notes.text).toBe("Legacy migration\n**text**");
    }
  });

  it("keeps the legacy note visible across unrelated data projections while migration cannot persist", async () => {
    const old = fixture();
    delete (old.settings as unknown as Record<string, unknown>).notes;
    delete old.settingsCompatibility;
    stored[STORAGE_KEY] = old;
    stored[UI_STATE_STORAGE_KEY] = { widgetNotes: "Only recoverable legacy text" };
    onMainWrite = async () => { throw new Error("Storage quota exceeded"); };
    await useAuraStore.getState().load();
    expect(useAuraStore.getState().widgetNotes).toBe("Only recoverable legacy text");
    const current = useAuraStore.getState().data!;
    useAuraStore.setState({ data: { ...current, settings: { ...current.settings, showSearch: !current.settings.showSearch } } });
    expect(useAuraStore.getState().widgetNotes).toBe("Only recoverable legacy text");
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ widgetNotes: "Only recoverable legacy text" });
  });

  it("resumes shared note projection after the previously blocked legacy migration becomes durable", async () => {
    const old = fixture();
    delete (old.settings as unknown as Record<string, unknown>).notes;
    delete old.settingsCompatibility;
    stored[STORAGE_KEY] = old;
    stored[UI_STATE_STORAGE_KEY] = { widgetNotes: "Legacy text awaiting storage" };
    onMainWrite = async () => { throw new Error("Storage quota exceeded"); };
    await useAuraStore.getState().load();
    expect(useAuraStore.getState().widgetNotes).toBe("Legacy text awaiting storage");
    onMainWrite = undefined;
    const migrated = await durable();
    useAuraStore.setState({ data: migrated });
    const received = await storage.saveAuraData({ ...migrated,
      ...applyExplicitSettingsPatch(migrated, { notes: { text: "New shared text after recovery" } }) }, { baseline: migrated });
    useAuraStore.setState({ data: received });
    expect(useAuraStore.getState().widgetNotes).toBe("New shared text after recovery");
    expect(received.restorePoints.some((point) => point.data.settings.notes.text === "Legacy text awaiting storage")).toBe(true);
  });

  it("restores and imports notes while an older backup missing the field preserves current text", async () => {
    await seed("Restore this note");
    await useAuraStore.getState().createManualRestorePoint("Saved notes");
    const point = (await durable()).restorePoints[0];
    await useAuraStore.getState().setWidgetNotes("Later note");
    await useAuraStore.getState().restoreRestorePoint(point.id);
    expect((await durable()).settings.notes.text).toBe("Restore this note");
    expect(useAuraStore.getState().widgetNotes).toBe("Restore this note");
    await useAuraStore.getState().importBackup(fixture("Imported notes"), "replace");
    expect((await durable()).settings.notes.text).toBe("Imported notes");
    expect(useAuraStore.getState().widgetNotes).toBe("Imported notes");

    const older = fixture();
    delete (older.settings as unknown as Record<string, unknown>).notes;
    delete older.settingsCompatibility;
    await useAuraStore.getState().importBackup(older, "replace");
    expect((await durable()).settings.notes.text).toBe("Imported notes");
    expect(useAuraStore.getState().widgetNotes).toBe("Imported notes");
  });

  it("caps text once and keeps exactly the same Unicode text in the widget and shared register", async () => {
    await seed();
    const text = `  Заголовок\n${"Ж".repeat(MAX_WIDGET_NOTES_CHARS)}  `;
    await useAuraStore.getState().setWidgetNotes(text);
    const expected = text.slice(0, MAX_WIDGET_NOTES_CHARS);
    expect(useAuraStore.getState().widgetNotes).toBe(expected);
    const after = await durable();
    expect(after.settings.notes.text).toBe(expected);
    expect(after.syncReplica?.settings["notes.text"].value).toBe(expected);
    expect(stored[UI_STATE_STORAGE_KEY]).toBeUndefined();
  });
});
