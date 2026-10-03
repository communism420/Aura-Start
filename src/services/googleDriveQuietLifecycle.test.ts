import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData } from "../utils/storage";
import { installAuraStoreSyncLifecycle, useAuraStore } from "../store/useAuraStore";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), run: vi.fn(), lifecycle: vi.fn((_options: unknown) => () => undefined)
}));
vi.mock("./googleDriveBackgroundSync", async (importOriginal) => ({
  ...await importOriginal<typeof import("./googleDriveBackgroundSync")>(),
  requestGoogleDriveBackgroundSync: mocks.request,
  runGoogleDriveBackgroundSync: mocks.run
}));
vi.mock("./googleDriveSyncLifecycle", () => ({ installGoogleDriveSyncPageLifecycle: mocks.lifecycle }));

let stored: Record<string, unknown>;
let syncStatuses: string[];
let unsubscribe: (() => void) | undefined;
const ISO = "2026-09-12T10:00:00.000Z";

async function seed({ dirty = false, neutral = false } = {}): Promise<AuraStartData> {
  const data = createEmptyData();
  if (!neutral) delete data.settingsCompatibility;
  data.updatedAt = ISO;
  data.settings.theme = "dark";
  data.settings.notes.text = "Existing note";
  data.settings.sync = { ...data.settings.sync, mode: "auto", connected: true, deviceId: "quiet-device",
    connectionId: "quiet-connection", cloudFileId: "quiet-file",
    lastSyncedLocalUpdatedAt: dirty ? "2026-09-12T09:00:00.000Z" : ISO };
  const saved = await saveAuraData(data);
  useAuraStore.setState({ data: saved, status: "ready", syncStatus: "connected", syncMessage: null,
    syncConflict: null, toasts: [], widgetNotes: saved.settings.notes.text });
  syncStatuses = [];
  return saved;
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 25; turn++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  stored = {};
  syncStatuses = [];
  mocks.request.mockResolvedValue({ status: "skipped", reason: "not_dirty" });
  mocks.run.mockResolvedValue({ status: "skipped", reason: "not_dirty" });
  vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { runtime: { id: "quiet-extension" }, storage: { local: {
    get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
    set: async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); },
    remove: async (key: string) => { delete stored[key]; }
  } } });
  useAuraStore.setState({ data: null, status: "idle", syncStatus: "idle", syncMessage: null,
    syncConflict: null, customBackgroundImage: null, widgetNotes: "", toasts: [] });
  unsubscribe = useAuraStore.subscribe((state) => { syncStatuses.push(state.syncStatus); });
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("quiet Google Drive page and store behavior", () => {
  it.each([false, true])("loads existing data without starting a sync or its animation (dirty=%s)", async (dirty) => {
    const initial = await seed({ dirty });
    await useAuraStore.getState().load();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useAuraStore.getState().data?.settings.notes.text).toBe(initial.settings.notes.text);
    expect(useAuraStore.getState().syncStatus).toBe("connected");
    expect(syncStatuses).not.toContain("syncing");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    await useAuraStore.getState().load();
    await flush();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("keeps local search, filters, onboarding and recovery-history writes quiet", async () => {
    const initial = await seed();
    useAuraStore.getState().setSearchQuery("Only this page");
    useAuraStore.getState().setSearchFilter("tag");
    await useAuraStore.getState().completeOnboarding();
    await useAuraStore.getState().createManualRestorePoint("Local recovery");
    const point = useAuraStore.getState().data!.restorePoints[0];
    await useAuraStore.getState().deleteRestorePoint(point.id);
    await useAuraStore.getState().deleteAllRestorePoints();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useAuraStore.getState().data?.updatedAt).toBe(initial.updatedAt);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(syncStatuses).not.toContain("syncing");
  });

  it("does not start sync for unchanged explicit settings, unchanged notes, or connection-only metadata", async () => {
    const initial = await seed();
    await useAuraStore.getState().updateSettings({ theme: "dark" });
    await useAuraStore.getState().updateSettings({ sync: { accountName: "Local account label" } });
    await useAuraStore.getState().setWidgetNotes(initial.settings.notes.text);
    await flush();
    expect(useAuraStore.getState().data?.updatedAt).toBe(initial.updatedAt);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(syncStatuses).not.toContain("syncing");
  });

  it("requests sync for a real shared preference edit and a changed note", async () => {
    await seed();
    await useAuraStore.getState().updateSettings({ timer: { volume: 0 } });
    await flush();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).not.toBe(true);
    await useAuraStore.getState().setWidgetNotes("A real new note");
    await flush();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(useAuraStore.getState().data?.settings.notes.text).toBe("A real new note");
  });

  it("still queues an explicit choice equal to an upgrade default when its causal state changes", async () => {
    await seed({ neutral: true });
    await useAuraStore.getState().updateSettings({ widgets: { timer: false } });
    await flush();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(useAuraStore.getState().data?.settingsCompatibility?.defaulted).not.toContain("widgets.timer");
  });

  it("limits online recovery eligibility to an active connection with pending local changes", async () => {
    const clean = await seed();
    const dispose = installAuraStoreSyncLifecycle();
    const options = mocks.lifecycle.mock.calls[0][0] as {
      canSync: () => boolean; onDataChanged: (data: AuraStartData) => void
    };
    expect(options.canSync()).toBe(false);
    const dirty = structuredClone(clean);
    dirty.settings.sync.lastSyncedLocalUpdatedAt = "2026-09-12T09:00:00.000Z";
    useAuraStore.setState({ data: dirty });
    expect(options.canSync()).toBe(true);
    for (const sync of [
      { ...dirty.settings.sync, connected: false },
      { ...dirty.settings.sync, reconnectRequired: true },
      { ...dirty.settings.sync, mode: "off" as const }
    ]) {
      useAuraStore.setState({ data: { ...dirty, settings: { ...dirty.settings, sync } } });
      expect(options.canSync()).toBe(false);
    }
    dispose();
  });

  it("allows remote checks on clean pages and after transient errors without starting a foreground sync", async () => {
    const clean = await seed();
    const dispose = installAuraStoreSyncLifecycle();
    const options = mocks.lifecycle.mock.calls[0][0] as { canPollRemote: () => boolean; canSync: () => boolean };
    expect(options.canPollRemote()).toBe(true);
    expect(options.canSync()).toBe(false);
    useAuraStore.setState({ syncStatus: "error", syncMessage: "Temporary network failure" });
    expect(options.canPollRemote()).toBe(true);
    const dirty = structuredClone(clean);
    dirty.settings.sync.lastSyncedLocalUpdatedAt = "2026-09-12T09:00:00.000Z";
    useAuraStore.setState({ data: dirty, syncStatus: "syncing" });
    // The background joins an existing transfer instead of queuing another one.
    expect(options.canPollRemote()).toBe(true);
    expect(options.canSync()).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    dispose();
  });

  it("stops fast remote checks until data and an enabled authorized connection are ready", async () => {
    const clean = await seed();
    const dispose = installAuraStoreSyncLifecycle();
    const options = mocks.lifecycle.mock.calls[0][0] as { canPollRemote: () => boolean };
    for (const status of ["idle", "loading", "corrupt", "error"] as const) {
      useAuraStore.setState({ status });
      expect(options.canPollRemote()).toBe(false);
    }
    useAuraStore.setState({ status: "ready", data: null });
    expect(options.canPollRemote()).toBe(false);
    useAuraStore.setState({ data: clean, syncStatus: "connecting" });
    expect(options.canPollRemote()).toBe(false);
    useAuraStore.setState({ syncStatus: "connected" });
    for (const sync of [
      { ...clean.settings.sync, connected: false },
      { ...clean.settings.sync, reconnectRequired: true },
      { ...clean.settings.sync, mode: "off" as const }
    ]) {
      useAuraStore.setState({ data: { ...clean, settings: { ...clean.settings, sync } } });
      expect(options.canPollRemote()).toBe(false);
    }
    useAuraStore.setState({ data: clean });
    expect(options.canPollRemote()).toBe(true);
    dispose();
  });

  it("leaves repeated unchanged remote results free of animation, notices, and data changes", async () => {
    const initial = await seed();
    const saved = structuredClone(stored);
    for (let check = 0; check < 3; check += 1) {
      await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult({
        status: "in_sync", quiet: true, resultId: `quiet-remote-check-${check}`
      });
    }
    expect(useAuraStore.getState().data).toBe(initial);
    expect(stored).toEqual(saved);
    expect(useAuraStore.getState().syncStatus).toBe("connected");
    expect(useAuraStore.getState().syncMessage).toBeNull();
    expect(useAuraStore.getState().toasts).toEqual([]);
    expect(syncStatuses).not.toContain("syncing");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("projects remotely stored notes without initiating another page request or animation", async () => {
    const clean = await seed();
    const dispose = installAuraStoreSyncLifecycle();
    const options = mocks.lifecycle.mock.calls[0][0] as { onDataChanged: (data: AuraStartData) => void };
    const remote = structuredClone(clean);
    remote.settings.notes.text = "Already received by background";
    stored[STORAGE_KEY] = remote;
    options.onDataChanged(remote);
    await flush();
    expect(useAuraStore.getState().widgetNotes).toBe("Already received by background");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(syncStatuses).not.toContain("syncing");
    const loaded = await loadAuraData();
    expect(loaded.status).toBe("ready");
    dispose();
  });
});
