import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { validateAuraData } from "../utils/importJson";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData } from "../utils/storage";
import { useAuraStore } from "./useAuraStore";

let stored: Record<string, unknown>;

async function seed(): Promise<AuraStartData> {
  const data = createEmptyData();
  data.settings = { ...data.settings, theme: "dark", showSearch: false, compactMode: true,
    background: { preset: "forest", blur: 8, dim: 0, position: "left" },
    widgets: { clock: true, notes: true, pomodoro: true, timer: false }, pomodoro: { focusMinutes: 50, breakMinutes: 12 },
    captureOpenTabs: true,
    sync: { ...data.settings.sync, mode: "off", deviceId: "local-settings-device", connectionId: "keep-local-connection" }
  };
  const saved = await saveAuraData(data);
  useAuraStore.setState({ data: saved, status: "ready", syncStatus: "idle", toasts: [] });
  return saved;
}

async function durable(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error("Expected valid local settings");
  return loaded.data;
}

beforeEach(() => {
  stored = {};
  useAuraStore.setState({ data: null, status: "idle", customBackgroundImage: null, toasts: [] });
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {},
    set: async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); },
    remove: async (key: string) => { delete stored[key]; }
  } } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("settings actions across upgrades", () => {
  it("updates only the selected nested preference and keeps zero/false and local metadata", async () => {
    const before = await seed();
    await useAuraStore.getState().updateSettings({ background: { blur: 0 }, widgets: { notes: false }, pomodoro: { breakMinutes: 8 } });
    const after = await durable();
    expect(after.settings.background).toEqual({ ...before.settings.background, blur: 0 });
    expect(after.settings.widgets).toEqual({ ...before.settings.widgets, notes: false });
    expect(after.settings.pomodoro).toEqual({ focusMinutes: 50, breakMinutes: 8 });
    expect(after.settings.sync).toEqual(before.settings.sync);
    expect(after.settings.captureOpenTabs).toBe(true);
    expect(after.settings.showSearch).toBe(false);
  });

  it("preserves a setting received after an older page rendered its controls", async () => {
    const before = await seed();
    const newer = structuredClone(before);
    newer.settings.background.position = "right";
    newer.settings.widgets.clock = false;
    await saveAuraData(newer, { baseline: before });
    // Store still represents the old page, while durable data has advanced.
    await useAuraStore.getState().updateSettings({ background: { blur: 3 } });
    const after = await durable();
    expect(after.settings.background).toMatchObject({ position: "right", blur: 3, dim: 0 });
    expect(after.settings.widgets.clock).toBe(false);
  });

  it("restores fields present in an old point without resetting settings absent from that release", async () => {
    const before = await seed();
    const oldPoint = { version: 1, updatedAt: before.updatedAt, settings: { theme: "light", background: { blur: 2 } }, groups: [] };
    const withPoint = validateAuraData({ ...before, restorePoints: [{
      id: "old-settings-point", name: "Old release", reason: "manual", createdAt: before.updatedAt, data: oldPoint
    }] });
    const saved = await saveAuraData(withPoint, { baseline: before });
    useAuraStore.setState({ data: saved });
    await useAuraStore.getState().restoreRestorePoint("old-settings-point");
    const after = await durable();
    expect(after.settings.theme).toBe("light");
    expect(after.settings.background).toEqual({ ...before.settings.background, blur: 2 });
    expect(after.settings.widgets).toEqual(before.settings.widgets);
    expect(after.settings.pomodoro).toEqual(before.settings.pomodoro);
    expect(after.settings.showSearch).toBe(false);
    expect(after.settings.sync).toEqual(before.settings.sync);
    expect(after.restorePoints.some((point) => point.reason === "before_restore")).toBe(true);
  });

  it("imports an old backup without replacing later settings with auto-filled defaults", async () => {
    const before = await seed();
    const old = validateAuraData({ version: 1, updatedAt: before.updatedAt,
      settings: { compactMode: false, pomodoro: { focusMinutes: 30 } },
      groups: [{ id: "imported", title: "Imported group", parentId: null, order: 0, collapsed: false, links: [] }]
    });
    await useAuraStore.getState().importBackup(old, "replace");
    const after = await durable();
    expect(after.settings.compactMode).toBe(false);
    expect(after.settings.pomodoro).toEqual({ focusMinutes: 30, breakMinutes: 12 });
    expect(after.settings.theme).toBe("dark");
    expect(after.settings.background).toEqual(before.settings.background);
    expect(after.settings.sync).toEqual(before.settings.sync);
    expect(after.groups[0].id).toBe("imported");
  });

  it("does not share mutable nested defaults between newly created installations", () => {
    const first = createEmptyData();
    const second = createEmptyData();
    first.settings.background.blur = 17;
    first.settings.widgets.clock = true;
    expect(second.settings.background.blur).toBe(0);
    expect(second.settings.widgets.clock).toBe(false);
  });

  it("records an explicit supported choice even when it matches the fallback for a future enum", async () => {
    const before = await seed();
    const future = validateAuraData({ ...before, syncReplica: undefined,
      settings: { ...before.settings, theme: "sepia" }
    });
    stored[STORAGE_KEY] = future;
    useAuraStore.setState({ data: future });
    expect(future.settings.theme).toBe("system");
    expect(future.settingsCompatibility?.preserved.theme).toBe("sepia");
    await useAuraStore.getState().updateSettings({ theme: "system" });
    const after = await durable();
    expect(after.settings.theme).toBe("system");
    expect(after.settingsCompatibility?.preserved).not.toHaveProperty("theme");
    expect(after.syncReplica?.settings.theme.value).toBe("system");
    expect(after.syncReplica?.settings.theme.stamp.counter).toBeGreaterThan(0);
  });

  it("promotes a deliberately selected default instead of leaving it as an automatic fallback", async () => {
    const fresh = await saveAuraData(createEmptyData());
    useAuraStore.setState({ data: fresh, status: "ready" });
    expect(fresh.settingsCompatibility?.defaulted).toContain("widgets.clock");
    await useAuraStore.getState().updateSettings({ widgets: { clock: false } });
    const after = await durable();
    expect(after.settingsCompatibility?.defaulted).not.toContain("widgets.clock");
    expect(after.syncReplica?.settings["widgets.clock"].value).toBe(false);
    expect(after.syncReplica?.settings["widgets.clock"].stamp.counter).toBeGreaterThan(0);
  });

  it("restores an existing default captured by a new Restore Point", async () => {
    const fresh = await saveAuraData(createEmptyData());
    useAuraStore.setState({ data: fresh, status: "ready" });
    await useAuraStore.getState().createManualRestorePoint("Before widget changes");
    const point = (await durable()).restorePoints[0];
    await useAuraStore.getState().updateSettings({ widgets: { clock: true } });
    await useAuraStore.getState().restoreRestorePoint(point.id);
    expect((await durable()).settings.widgets.clock).toBe(false);
  });
});
