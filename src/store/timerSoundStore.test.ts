import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { validateAuraData } from "../utils/importJson";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData } from "../utils/storage";
import { commitLocalSyncChanges, mergeSyncData } from "../utils/syncReplica";
import { loadTimerSound, type TimerSoundAsset } from "../utils/timerSoundStorage";
import { useAuraStore } from "./useAuraStore";

const sounds = vi.hoisted(() => ({ prepare: vi.fn(), save: vi.fn() }));
vi.mock("../utils/timerSoundImport", () => ({ prepareTimerSound: sounds.prepare }));
vi.mock("../utils/timerSoundStorage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../utils/timerSoundStorage")>(),
  storeTimerSound: sounds.save
}));

let stored: Record<string, unknown>;
let rejectMainWrite: boolean;
let mainWriteGate: Promise<void> | undefined;
let mainWriteStarted: boolean;
let realStore: typeof import("../utils/timerSoundStorage").storeTimerSound;

function soundAsset(name: string, sample: number): TimerSoundAsset {
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

const FIRST = soundAsset("First.wav", 100);
const SECOND = soundAsset("Second.wav", 200);
const fileFor = (sound: TimerSoundAsset) => new File([sound.name], sound.name, { type: "audio/wav" });

async function seed(): Promise<AuraStartData> {
  const data = createEmptyData();
  data.settings.sync.deviceId = "timer-device";
  const saved = await saveAuraData(data);
  useAuraStore.setState({ data: saved, status: "ready", syncStatus: "idle" });
  return saved;
}

async function durable(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error("Expected valid settings");
  return loaded.data;
}

beforeEach(async () => {
  vi.clearAllMocks();
  realStore = (await vi.importActual<typeof import("../utils/timerSoundStorage")>("../utils/timerSoundStorage")).storeTimerSound;
  sounds.prepare.mockImplementation(async (file: File) => file.name === FIRST.name ? FIRST : SECOND);
  sounds.save.mockImplementation(realStore);
  stored = {};
  rejectMainWrite = false;
  mainWriteGate = undefined;
  mainWriteStarted = false;
  useAuraStore.setState({ data: null, status: "idle", customBackgroundImage: null, toasts: [] });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
    set: async (items: Record<string, unknown>) => {
      if (rejectMainWrite && STORAGE_KEY in items) throw new Error("Storage quota exceeded");
      if (mainWriteGate && STORAGE_KEY in items) {
        mainWriteStarted = true;
        await mainWriteGate;
      }
      Object.assign(stored, structuredClone(items));
    },
    remove: async (key: string) => { delete stored[key]; }
  } } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("custom timer sound store integration", () => {
  it("stores verified audio before its causal reference and keeps recoverable references without audio bytes", async () => {
    await seed();
    await useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    const first = await durable();
    const firstId = first.settings.timer.customSoundId!;
    expect(await loadTimerSound(firstId)).toEqual(FIRST);
    expect(first.syncReplica?.settings["timer.customSoundId"].value).toBe(firstId);
    expect(first.syncReplica?.settings["timer.customSoundId"].stamp.counter).toBeGreaterThan(0);
    expect(first.settingsCompatibility?.defaulted).not.toContain("timer.customSoundId");

    await useAuraStore.getState().setCustomTimerSound(fileFor(SECOND));
    const second = await durable();
    expect(second.settings.timer.customSoundId).not.toBe(firstId);
    expect(await loadTimerSound(second.settings.timer.customSoundId)).toEqual(SECOND);
    expect(second.restorePoints[0].data.settings.timer.customSoundId).toBe(firstId);
    expect(JSON.stringify(stored)).not.toContain("data:audio/");
    await useAuraStore.getState().restoreRestorePoint(second.restorePoints[0].id);
    expect((await durable()).settings.timer.customSoundId).toBe(firstId);
    expect(await loadTimerSound(firstId)).toEqual(FIRST);
  });

  it("records custom sound removal as a causal setting change that can be restored", async () => {
    await seed();
    await useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    const before = await durable();
    await useAuraStore.getState().setCustomTimerSound(null);
    const removed = await durable();
    expect(removed.settings.timer.customSoundId).toBeNull();
    expect(removed.syncReplica?.settings["timer.customSoundId"].stamp.counter)
      .toBeGreaterThan(before.syncReplica!.settings["timer.customSoundId"].stamp.counter);
    expect(removed.restorePoints[0].data.settings.timer.customSoundId).toBe(before.settings.timer.customSoundId);
    await useAuraStore.getState().restoreRestorePoint(removed.restorePoints[0].id);
    expect((await durable()).settings.timer.customSoundId).toBe(before.settings.timer.customSoundId);
  });

  it.each(["decode", "asset", "settings"] as const)("preserves the selected sound and settings when the %s operation fails", async (failure) => {
    await seed();
    await useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    const before = await durable();
    if (failure === "decode") sounds.prepare.mockRejectedValueOnce(new Error("Unsupported audio"));
    if (failure === "asset") sounds.save.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    if (failure === "settings") rejectMainWrite = true;
    await expect(useAuraStore.getState().setCustomTimerSound(fileFor(SECOND))).rejects.toThrow();
    rejectMainWrite = false;
    expect(await durable()).toEqual(before);
    expect(useAuraStore.getState().data).toEqual(before);
    expect(await loadTimerSound(before.settings.timer.customSoundId)).toEqual(FIRST);
  });

  it.each(["replacement", "removal"] as const)("ignores an earlier decode after a newer %s request", async (kind) => {
    await seed();
    let resolveFirst!: (asset: TimerSoundAsset) => void;
    let firstSignal!: AbortSignal;
    sounds.prepare.mockImplementation((file: File, options: { signal: AbortSignal }) => file.name === FIRST.name
      ? new Promise<TimerSoundAsset>((resolve) => { resolveFirst = resolve; firstSignal = options.signal; })
      : Promise.resolve(SECOND));
    const pending = useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    await useAuraStore.getState().setCustomTimerSound(kind === "replacement" ? fileFor(SECOND) : null);
    expect(firstSignal.aborted).toBe(true);
    resolveFirst(FIRST);
    await pending;
    const data = await durable();
    expect(await loadTimerSound(data.settings.timer.customSoundId)).toEqual(kind === "replacement" ? SECOND : null);
    expect(sounds.save.mock.calls.some(([asset]) => asset.name === FIRST.name)).toBe(false);
  });

  it("ignores a superseded decode rejection without failing the newer selection", async () => {
    await seed();
    let rejectFirst!: (error: Error) => void;
    sounds.prepare.mockImplementation((file: File) => file.name === FIRST.name
      ? new Promise<TimerSoundAsset>((_resolve, reject) => { rejectFirst = reject; }) : Promise.resolve(SECOND));
    const pending = useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    await useAuraStore.getState().setCustomTimerSound(fileFor(SECOND));
    rejectFirst(new Error("Old decode failed"));
    await expect(pending).resolves.toBeUndefined();
    expect(await loadTimerSound((await durable()).settings.timer.customSoundId)).toEqual(SECOND);
  });

  it("choosing built-in during the first upload promotes a neutral null to an explicit cloud preference", async () => {
    const before = await seed();
    expect(before.settingsCompatibility?.defaulted).toContain("timer.customSoundId");
    let resolveSound!: (asset: TimerSoundAsset) => void;
    sounds.prepare.mockImplementation(() => new Promise<TimerSoundAsset>((resolve) => { resolveSound = resolve; }));
    const pending = useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    await useAuraStore.getState().setCustomTimerSound(null);
    resolveSound(FIRST);
    await pending;
    const selected = await durable();
    expect(selected.settings.timer.customSoundId).toBeNull();
    expect(selected.settingsCompatibility?.defaulted).not.toContain("timer.customSoundId");
    expect(selected.syncReplica?.settings["timer.customSoundId"].stamp.counter).toBeGreaterThan(0);
    expect(sounds.save).not.toHaveBeenCalled();
  });

  it("ignores an old asset write which completes after a newer selection", async () => {
    await seed();
    let releaseFirst!: () => void;
    let firstStarted = false;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    sounds.save.mockImplementation(async (asset: TimerSoundAsset) => {
      if (asset.name === FIRST.name) { firstStarted = true; await gate; }
      return await realStore(asset);
    });
    const pending = useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    await vi.waitFor(() => expect(firstStarted).toBe(true));
    await useAuraStore.getState().setCustomTimerSound(fileFor(SECOND));
    releaseFirst();
    await pending;
    expect(await loadTimerSound((await durable()).settings.timer.customSoundId)).toEqual(SECOND);
  });

  it("honors removal while an earlier settings write is already underway", async () => {
    await seed();
    let releaseWrite!: () => void;
    mainWriteGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const pending = useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    await vi.waitFor(() => expect(mainWriteStarted).toBe(true));
    const removal = useAuraStore.getState().setCustomTimerSound(null);
    releaseWrite();
    await Promise.all([pending, removal]);
    expect((await durable()).settings.timer.customSoundId).toBeNull();
    expect(useAuraStore.getState().data?.settings.timer.customSoundId).toBeNull();
  });

  it("uses durable settings after decoding so concurrent timer volume and other preferences survive", async () => {
    const before = await seed();
    let resolveSound!: (asset: TimerSoundAsset) => void;
    sounds.prepare.mockImplementation(() => new Promise<TimerSoundAsset>((resolve) => { resolveSound = resolve; }));
    const pending = useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    const otherPage = structuredClone(before);
    otherPage.settings.timer.volume = 0;
    otherPage.settings.timer.durationSeconds = 42;
    otherPage.settings.widgets.timer = true;
    otherPage.settings.background.dim = 0;
    otherPage.settings.showSearch = false;
    await saveAuraData(otherPage, { baseline: before });
    resolveSound(FIRST);
    await pending;
    const after = await durable();
    expect(after.settings.timer).toMatchObject({ volume: 0, durationSeconds: 42 });
    expect(after.settings.widgets.timer).toBe(true);
    expect(after.settings.showSearch).toBe(false);
    expect(after.restorePoints[0].data.settings.timer).toEqual(otherPage.settings.timer);
    expect(after.settings.sync).toEqual(before.settings.sync);
  });

  it("retains timer settings when restoring or importing snapshots from before the timer existed", async () => {
    await seed();
    await useAuraStore.getState().setCustomTimerSound(fileFor(FIRST));
    await useAuraStore.getState().updateSettings({ timer: { durationSeconds: 42, volume: 0 }, widgets: { timer: true } });
    const before = await durable();
    const old = validateAuraData({ version: 1, updatedAt: before.updatedAt,
      settings: { theme: "light", widgets: { clock: true } }, groups: [] });
    const withPoint = await saveAuraData({ ...before, restorePoints: [{
      id: "old-release", name: "Before timer", reason: "manual", createdAt: before.updatedAt,
      data: { version: old.version, updatedAt: old.updatedAt, groups: old.groups,
        settings: old.settings, settingsCompatibility: old.settingsCompatibility }
    }] }, { baseline: before });
    useAuraStore.setState({ data: withPoint });
    await useAuraStore.getState().restoreRestorePoint("old-release");
    expect((await durable()).settings.timer).toEqual(before.settings.timer);
    expect((await durable()).settings.widgets.timer).toBe(true);
    await useAuraStore.getState().importBackup(old, "replace");
    const imported = await durable();
    expect(imported.settings.timer).toEqual(before.settings.timer);
    expect(imported.settings.widgets.timer).toBe(true);
    expect(imported.settings.theme).toBe("light");
    expect(imported.settings.widgets.clock).toBe(true);
  });

  it("inserts neutral timer defaults into old data while explicit cloud timer choices still win", async () => {
    const legacy = validateAuraData({ version: 1, updatedAt: "2026-09-12T10:00:00.000Z",
      settings: { theme: "dark", showSearch: false, pomodoro: { focusMinutes: 50, breakMinutes: 0 },
        background: { dim: 0 }, sync: { deviceId: "old-device" } }, groups: [] });
    expect(legacy.settings.timer).toEqual(DEFAULT_SETTINGS.timer);
    expect(legacy.settings.widgets.timer).toBe(false);
    expect(legacy.settings.theme).toBe("dark");
    expect(legacy.settings.showSearch).toBe(false);
    expect(legacy.settings.background.dim).toBe(0);
    expect(legacy.settingsCompatibility?.defaulted).toContain("timer.volume");

    const next = structuredClone(legacy);
    next.settings.sync.deviceId = "timer-device";
    next.settings.timer.durationSeconds = 123;
    next.settings.timer.volume = 0;
    next.settings.widgets.timer = true;
    const chosen = commitLocalSyncChanges(legacy, next);
    for (const merged of [mergeSyncData(legacy, chosen), mergeSyncData(chosen, legacy)]) {
      expect(merged.settings.timer).toMatchObject({ durationSeconds: 123, volume: 0, customSoundId: null });
      expect(merged.settings.widgets.timer).toBe(true);
      expect(merged.settings.theme).toBe("dark");
      expect(merged.settings.showSearch).toBe(false);
    }
  });
});
