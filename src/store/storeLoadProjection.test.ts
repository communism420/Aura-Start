import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuraStartData } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData, updateAuraData } from "../utils/storage";
import { installAuraStoreSyncLifecycle, useAuraStore } from "./useAuraStore";

const mocks = vi.hoisted(() => ({ image: vi.fn(), request: vi.fn(), run: vi.fn() }));
vi.mock("../utils/backgroundImageStorage", async (original) => ({
  ...await original<typeof import("../utils/backgroundImageStorage")>(), loadBackgroundImage: mocks.image
}));
vi.mock("../services/googleDriveBackgroundSync", async (original) => ({
  ...await original<typeof import("../services/googleDriveBackgroundSync")>(),
  requestGoogleDriveBackgroundSync: mocks.request, runGoogleDriveBackgroundSync: mocks.run
}));

const OLD_IMAGE = "a".repeat(64);
const NEW_IMAGE = "b".repeat(64);
const OLD_BYTES = "data:image/png;base64,b2xk";
const NEW_BYTES = "data:image/png;base64,bmV3";
const ISO = "2026-09-12T10:00:00.000Z";
let stored: Record<string, unknown>;
let listeners: Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>;
let cleanup: (() => void) | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function seed(): Promise<AuraStartData> {
  const data = createEmptyData();
  delete data.settingsCompatibility;
  data.updatedAt = ISO;
  data.settings.notes.text = "Old note";
  data.settings.background = { ...data.settings.background, preset: "custom", customImageId: OLD_IMAGE };
  data.settings.sync = { ...data.settings.sync, mode: "auto", connected: true,
    deviceId: "receiver-device", connectionId: "receiver-connection", cloudFileId: "receiver-file",
    lastSyncedAt: ISO, lastSyncedLocalUpdatedAt: ISO };
  data.groups = [{ id: "group", title: "Synced links", parentId: null, order: 0, collapsed: false,
    links: [{ id: "deleted-link", title: "Delete remotely", url: "https://example.test/", order: 0, createdAt: ISO, updatedAt: ISO }] }];
  const saved = await saveAuraData(data);
  cleanup = installAuraStoreSyncLifecycle();
  return saved;
}

async function durable(): Promise<AuraStartData> {
  const result = await loadAuraData();
  if (result.status !== "ready") throw new Error("Expected saved receiver data");
  return result.data;
}

beforeEach(() => {
  vi.resetAllMocks();
  stored = {};
  listeners = new Set();
  cleanup = undefined;
  mocks.image.mockResolvedValue(OLD_BYTES);
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  vi.stubGlobal("document", {});
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: {
    onChanged: { addListener: (listener: Parameters<typeof listeners.add>[0]) => listeners.add(listener),
      removeListener: (listener: Parameters<typeof listeners.delete>[0]) => listeners.delete(listener) },
    local: {
      get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
      set: async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) {
          const oldValue = stored[key];
          stored[key] = structuredClone(value);
          for (const listener of listeners) listener({ [key]: { oldValue, newValue: value } }, "local");
        }
      },
      remove: async (key: string) => { delete stored[key]; }
    }
  } });
  useAuraStore.setState({ data: null, status: "idle", syncStatus: "idle", syncMessage: null,
    syncConflict: null, customBackgroundImage: null, widgetNotes: "", toasts: [] });
});

afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });

describe("loading a page while newer storage changes arrive", () => {
  it("does not resurrect a deleted link or old notes when the initial image read finishes late", async () => {
    const baseline = await seed();
    const gate = deferred<string>();
    mocks.image.mockReturnValue(gate.promise);
    const loading = useAuraStore.getState().load();
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledWith(OLD_IMAGE));
    const next = structuredClone(baseline);
    next.groups[0].links = [];
    next.settings.notes.text = "Received new note";
    let received: AuraStartData;
    try {
      received = await saveAuraData(next, { baseline });
      expect(useAuraStore.getState().data?.groups[0].links).toHaveLength(0);
    } finally {
      gate.resolve(OLD_BYTES);
      await loading;
    }
    expect(useAuraStore.getState().data).toEqual(received!);
    expect(useAuraStore.getState().data?.syncReplica?.links["deleted-link"].presence.value).toBe(false);
    expect(useAuraStore.getState().widgetNotes).toBe("Received new note");
    expect(await durable()).toEqual(received!);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("preserves a disconnect received during image loading even though content updatedAt did not change", async () => {
    const baseline = await seed();
    const gate = deferred<string>();
    mocks.image.mockReturnValue(gate.promise);
    const loading = useAuraStore.getState().load();
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledWith(OLD_IMAGE));
    let disconnected: AuraStartData | undefined;
    try {
      disconnected = await updateAuraData((current) => ({ ...current, settings: { ...current.settings,
        sync: { ...current.settings.sync, mode: "off", connected: false, connectionId: "disconnected" }
      } }));
      expect(disconnected?.updatedAt).toBe(baseline.updatedAt);
      expect(useAuraStore.getState().syncStatus).toBe("idle");
    } finally {
      gate.resolve(OLD_BYTES);
      await loading;
    }
    expect(useAuraStore.getState().data).toEqual(disconnected);
    expect(useAuraStore.getState().syncStatus).toBe("idle");
    expect(useAuraStore.getState().data?.settings.sync.connected).toBe(false);
  });

  it.each(["replace", "remove"] as const)("does not let an earlier background read undo a received image %s", async (change) => {
    const baseline = await seed();
    const gate = deferred<string>();
    mocks.image.mockImplementation((id: string) => id === OLD_IMAGE ? gate.promise : Promise.resolve(NEW_BYTES));
    const loading = useAuraStore.getState().load();
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledWith(OLD_IMAGE));
    const next = structuredClone(baseline);
    next.settings.background.customImageId = change === "replace" ? NEW_IMAGE : null;
    next.groups[0].links = [];
    try {
      await saveAuraData(next, { baseline });
      await vi.waitFor(() => expect(useAuraStore.getState().customBackgroundImage).toBe(change === "replace" ? NEW_BYTES : null));
    } finally {
      gate.resolve(OLD_BYTES);
      await loading;
    }
    expect(useAuraStore.getState().data?.groups[0].links).toHaveLength(0);
    expect(useAuraStore.getState().customBackgroundImage).toBe(change === "replace" ? NEW_BYTES : null);
    expect(useAuraStore.getState().data?.settings.background.customImageId).toBe(change === "replace" ? NEW_IMAGE : null);
  });

  it("ignores a late failure for an obsolete image after a newer projection has removed it", async () => {
    const baseline = await seed();
    const gate = deferred<string>();
    mocks.image.mockReturnValue(gate.promise);
    const loading = useAuraStore.getState().load();
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledWith(OLD_IMAGE));
    const next = structuredClone(baseline);
    next.settings.background.customImageId = null;
    next.groups[0].links = [];
    await saveAuraData(next, { baseline });
    gate.reject(new Error("Old image read failed"));
    await loading;
    expect(useAuraStore.getState().data?.groups[0].links).toHaveLength(0);
    expect(useAuraStore.getState().customBackgroundImage).toBeNull();
    expect(useAuraStore.getState().toasts).toHaveLength(0);
    expect(useAuraStore.getState().status).toBe("ready");
  });
});
