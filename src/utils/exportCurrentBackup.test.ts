import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { createEmptyData } from "./sampleData";
import { applyExplicitSettingsPatch } from "./settingsPatch";

const exporters = vi.hoisted(() => ({ zip: vi.fn(), json: vi.fn() }));
vi.mock("./zipBackup", () => ({ exportZipBackup: exporters.zip }));
vi.mock("./exportJson", async (original) => ({
  ...await original<typeof import("./exportJson")>(), exportSettingsLinksJson: exporters.json
}));

let useAuraStore: typeof import("../store/useAuraStore")["useAuraStore"];
let storage: typeof import("./storage");
let backup: typeof import("./exportCurrentBackup");
let stored: Record<string, unknown>;
let onMainWrite: (() => Promise<void>) | undefined;
let failReads: boolean;
type Format = "zip" | "json";

function gate() {
  let enter!: () => void;
  let release!: () => void;
  return {
    entered: new Promise<void>((resolve) => { enter = resolve; }),
    released: new Promise<void>((resolve) => { release = resolve; }),
    enter: () => enter(), release: () => release()
  };
}

function fixture(note = "Previously saved note"): AuraStartData {
  const empty = createEmptyData();
  empty.settings.sync = { ...empty.settings.sync, deviceId: "current-export-device", mode: "off" };
  empty.settings.background.customImageId = null;
  return { ...empty, ...applyExplicitSettingsPatch(empty, { notes: { text: note } }) };
}

async function seed(): Promise<AuraStartData> {
  const saved = await storage.saveAuraData(fixture());
  useAuraStore.setState({ data: saved, status: "ready", syncStatus: "idle" });
  return saved;
}

async function exportCurrent(format: Format, stale: AuraStartData): Promise<void> {
  if (format === "zip") await backup.exportCurrentZipBackup(stale);
  else await backup.exportCurrentSettingsLinksJson(stale);
}

function expectNoExport(): void {
  expect(exporters.zip).not.toHaveBeenCalled();
  expect(exporters.json).not.toHaveBeenCalled();
}

beforeEach(async () => {
  vi.resetModules();
  exporters.zip.mockReset().mockResolvedValue(undefined);
  exporters.json.mockReset();
  stored = {};
  failReads = false;
  onMainWrite = undefined;
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => {
      if (failReads) throw new Error("Storage is unavailable");
      return Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {};
    },
    set: async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, STORAGE_KEY)) await onMainWrite?.();
      Object.assign(stored, structuredClone(items));
    },
    remove: async (key: string) => { delete stored[key]; }
  } } });
  storage = await import("./storage");
  ({ useAuraStore } = await import("../store/useAuraStore"));
  backup = await import("./exportCurrentBackup");
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("current backup export waits for canonical durable settings", () => {
  it.each(["zip", "json"] as const)("waits for already queued note and settings writes before %s export", async (format) => {
    const stale = await seed();
    const firstWrite = gate();
    let first = true;
    onMainWrite = async () => {
      if (first) { first = false; firstWrite.enter(); await firstWrite.released; }
    };
    const typed = useAuraStore.getState().setWidgetNotes("Intermediate text");
    await firstWrite.entered;
    const newest = useAuraStore.getState().setWidgetNotes("Newest notes\nСохранить ✓");
    const settings = useAuraStore.getState().updateSettings({ timer: { volume: 0, durationSeconds: 21 }, showSearch: false });
    const exported = exportCurrent(format, stale);
    expectNoExport();
    firstWrite.release();
    await Promise.all([typed, newest, settings, exported]);
    expect(exporters[format]).toHaveBeenCalledOnce();
    const captured = exporters[format].mock.calls[0][0] as AuraStartData;
    expect(captured.settings).toMatchObject({ notes: { text: "Newest notes\nСохранить ✓" },
      timer: { volume: 0, durationSeconds: 21 }, showSearch: false });
    expect(captured).toEqual(stored[STORAGE_KEY]);
    expect(captured.settings.notes.text).not.toBe(stale.settings.notes.text);
  });

  it.each(["zip", "json"] as const)("uses newer remote preferences instead of the stale rendered snapshot for %s", async (format) => {
    const stale = await seed();
    const latest = await storage.saveAuraData({ ...stale, ...applyExplicitSettingsPatch(stale, {
      notes: { text: "Remote current notes" }, background: { dim: 0 }, theme: "dark", showDescriptions: false
    }) }, { baseline: stale });
    expect(useAuraStore.getState().data).toEqual(stale);
    await exportCurrent(format, stale);
    expect(exporters[format]).toHaveBeenCalledWith(latest);
    expect(stale.settings.notes.text).toBe("Previously saved note");
  });

  it.each((["zip", "json"] as const).flatMap((format) =>
    (["missing", "corrupt", "unavailable"] as const).map((state) => ({ format, state }))))("rejects $format export if canonical storage is $state", async ({ format, state }) => {
    const stale = await seed();
    if (state === "missing") delete stored[STORAGE_KEY];
    else if (state === "corrupt") stored[STORAGE_KEY] = { invalid: true };
    else failReads = true;
    await expect(exportCurrent(format, stale)).rejects.toThrow();
    expectNoExport();
    expect(useAuraStore.getState().data).toEqual(stale);
  });

  it.each(["background", "notes"] as const)("does not export a full archive while legacy %s migration has failed", async (kind) => {
    const old = fixture();
    delete old.syncReplica;
    delete old.settingsCompatibility;
    if (kind === "background") {
      delete old.settings.background.customImageId;
      old.settings.background.preset = "custom";
      stored[UI_STATE_STORAGE_KEY] = { customBackgroundImage: "data:image/png;base64,YQ==" };
      vi.stubGlobal("indexedDB", undefined);
    } else {
      delete (old.settings as unknown as Record<string, unknown>).notes;
      stored[UI_STATE_STORAGE_KEY] = { widgetNotes: "Unmigrated notes" };
      onMainWrite = async () => { throw new Error("Storage quota exceeded"); };
    }
    stored[STORAGE_KEY] = old;
    const before = structuredClone(stored);
    await expect(exportCurrent("zip", fixture())).rejects.toThrow();
    expectNoExport();
    expect(stored).toEqual(before);
  });

  it("finishes successful legacy image and note migration before capturing the full archive", async () => {
    const old = fixture();
    delete old.settings.background.customImageId;
    delete (old.settings as unknown as Record<string, unknown>).notes;
    delete old.settingsCompatibility;
    old.settings.background.preset = "custom";
    stored[STORAGE_KEY] = old;
    stored[UI_STATE_STORAGE_KEY] = { customBackgroundImage: "data:image/png;base64,YQ==", widgetNotes: "Legacy note included" };
    await exportCurrent("zip", old);
    expect(exporters.zip).toHaveBeenCalledOnce();
    const captured = exporters.zip.mock.calls[0][0] as AuraStartData;
    expect(captured.settings.notes.text).toBe("Legacy note included");
    expect(captured.settings.background.customImageId).toMatch(/^[a-f0-9]{64}$/);
    expect(captured.restorePoints.some((point) => point.context?.source === "legacy_notes_migration")).toBe(true);
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: null, widgetNotes: "" });
  });

  it.each(["zip", "json"] as const)("blocks %s after a queued note write fails, then succeeds after retrying the draft", async (format) => {
    const stale = await seed();
    const pendingWrite = gate();
    onMainWrite = async () => { pendingWrite.enter(); await pendingWrite.released; throw new Error("Storage quota exceeded"); };
    const saving = useAuraStore.getState().setWidgetNotes("Draft that must not be omitted");
    await pendingWrite.entered;
    const exporting = exportCurrent(format, stale);
    const rejected = expect(exporting).rejects.toThrow();
    pendingWrite.release();
    await saving;
    await rejected;
    expectNoExport();
    expect(useAuraStore.getState().widgetNotes).toBe("Draft that must not be omitted");
    expect((stored[STORAGE_KEY] as AuraStartData).settings.notes.text).toBe("Previously saved note");
    onMainWrite = undefined;
    const retry = useAuraStore.getState().toasts.find((toast) => toast.onAction)?.onAction;
    expect(retry).toBeTypeOf("function");
    await retry!();
    await exportCurrent(format, stale);
    expect(exporters[format]).toHaveBeenCalledOnce();
    expect((exporters[format].mock.calls[0][0] as AuraStartData).settings.notes.text).toBe("Draft that must not be omitted");
  });

  it.each(["zip", "json"] as const)("propagates %s encoder or download errors without changing saved settings", async (format) => {
    const data = await seed();
    if (format === "zip") exporters.zip.mockRejectedValue(new Error("ZIP media could not be collected"));
    else exporters.json.mockImplementation(() => { throw new Error("JSON download failed"); });
    const before = structuredClone(stored);
    await expect(exportCurrent(format, data)).rejects.toThrow();
    expect(stored).toEqual(before);
  });
});
