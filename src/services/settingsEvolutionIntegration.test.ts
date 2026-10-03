import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DEFAULT_SETTINGS, STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { loadBackgroundImage } from "../utils/backgroundImageStorage";
import { validateAuraData } from "../utils/importJson";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData } from "../utils/storage";
import { ensureSyncReplica, sameSyncContent, sameSyncReplica } from "../utils/syncReplica";
import { hasPendingGoogleDriveLocalChanges, runGoogleDriveBackgroundSync } from "./googleDriveBackgroundSync";
import { GoogleDriveSyncError, type GoogleDriveConditionalDownload, type GoogleDriveFileMetadata } from "./googleDriveSync";

const transport = vi.hoisted(() => ({
  getAuthToken: vi.fn(), listSyncFiles: vi.fn(), downloadConditionalSyncFile: vi.fn(),
  createSharedSyncFile: vi.fn(), updateConditionalSyncFile: vi.fn(), deleteConditionalSyncFile: vi.fn()
}));

vi.mock("./googleDriveSync", async (original) => ({
  ...await original<typeof import("./googleDriveSync")>(), ...transport
}));

const TIME = "2026-09-12T10:00:00.000Z";
type CloudDocument = { metadata: GoogleDriveFileMetadata; raw: AuraStartData };
let activeDevice: string;
let deviceStorage: Map<string, Record<string, unknown>>;
let cloud: Map<string, CloudDocument>;
let revision: number;

function writeCount(): number {
  return transport.createSharedSyncFile.mock.calls.length + transport.updateConditionalSyncFile.mock.calls.length;
}

function fixture(deviceId: string): AuraStartData {
  const data = structuredClone(createEmptyData());
  // Fixtures model explicit preferences saved by 2.0.5 before provenance existed.
  delete data.settingsCompatibility;
  data.updatedAt = TIME;
  data.settings.sync = {
    ...data.settings.sync, deviceId, connectionId: `connection-${deviceId}`,
    // Settings can predate 2.1.0 while this Drive connection is still new.
    mode: "auto", connected: true,
    accountEmail: `${deviceId}@example.invalid`, deleteCloudFileOnDisconnect: false
  };
  data.groups = [{ id: "shared-group", title: "Shared links", parentId: null, collapsed: false, order: 0, links: [] }];
  return data;
}

function install(deviceId: string, data = fixture(deviceId)): void {
  deviceStorage.set(deviceId, { [STORAGE_KEY]: structuredClone(data) });
}

function omitSetting(data: AuraStartData, path: string): void {
  const segments = path.split(".");
  let target = data.settings as unknown as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) target = target[segment] as Record<string, unknown>;
  delete target[segments.at(-1)!];
  if (data.syncReplica) delete data.syncReplica.settings[path];
}

function addCloud(data: AuraStartData, fileId = `file-${data.settings.sync.deviceId}`, shared = false): void {
  const raw = structuredClone(data);
  const deviceId = data.settings.sync.deviceId;
  raw.settings.sync = { ...DEFAULT_SETTINGS.sync, deviceId,
    deleteCloudFileOnDisconnect: data.settings.sync.deleteCloudFileOnDisconnect };
  raw.restorePoints = [];
  cloud.set(fileId, {
    metadata: { id: fileId, name: "aura-start-sync.json", createdTime: TIME, version: String(++revision),
      appProperties: shared ? { auraStartSync: "true", auraStartSharedSync: "1" } : { auraStartSync: "true", auraStartDeviceId: deviceId } },
    raw
  });
}

async function localData(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error(`Device ${activeDevice}: ${loaded.status}${loaded.status === "corrupt" ? `: ${loaded.message}` : ""}`);
  return loaded.data;
}

async function localEdit(mutate: (next: AuraStartData) => void): Promise<AuraStartData> {
  const baseline = await localData();
  const next = structuredClone(baseline);
  mutate(next);
  return await saveAuraData(next, { baseline });
}

async function syncDevice(deviceId: string) {
  activeDevice = deviceId;
  const result = await runGoogleDriveBackgroundSync(true);
  expect(result.status).not.toBe("failed");
  expect(result.status).not.toBe("skipped");
  expect(result.status).not.toBe("needs_reconnect");
  return result;
}

async function converge(devices = ["device-a", "device-b"]): Promise<void> {
  for (let round = 0; round < 3; round++) for (const device of devices) await syncDevice(device);
}

beforeEach(() => {
  activeDevice = "device-a";
  deviceStorage = new Map();
  cloud = new Map();
  revision = 0;
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", {
    runtime: {},
    storage: {
      local: {
        get: async (key: string) => {
          const values = deviceStorage.get(activeDevice) ?? {};
          return Object.hasOwn(values, key) ? { [key]: structuredClone(values[key]) } : {};
        },
        set: async (items: Record<string, unknown>) => {
          deviceStorage.set(activeDevice, { ...deviceStorage.get(activeDevice), ...structuredClone(items) });
        },
        remove: async (key: string) => { delete deviceStorage.get(activeDevice)?.[key]; }
      }
    }
  });
  transport.getAuthToken.mockReset().mockResolvedValue("mock-access-token");
  transport.listSyncFiles.mockReset().mockImplementation(async () => [...cloud.values()].map((file) => structuredClone(file.metadata)));
  transport.downloadConditionalSyncFile.mockReset().mockImplementation(async (listed: GoogleDriveFileMetadata) => {
    // Production Drive downloads also validate after parsing the JSON. Keep
    // this boundary real so default hydration cannot erase absence information.
    const file = cloud.get(listed.id);
    if (!file) return undefined;
    const { metadata, raw } = file;
    const data = validateAuraData(JSON.parse(JSON.stringify(raw)));
    return {
      metadata: structuredClone(metadata), etag: `"${metadata.version}"`, data, cloudUpdatedAt: data.updatedAt,
      payload: { schemaVersion: 1, app: "Aura Start", appVersion: "2.1.0", updatedAt: data.updatedAt, deviceId: raw.settings.sync.deviceId, data }
    };
  });
  const assertVersion = (snapshot: GoogleDriveConditionalDownload) => {
    const current = cloud.get(snapshot.metadata.id);
    if (current && `"${current.metadata.version}"` !== snapshot.etag) throw new GoogleDriveSyncError("unknown", "Concurrent change", 412);
    return current;
  };
  transport.createSharedSyncFile.mockReset().mockImplementation(async (data: AuraStartData) => {
    addCloud(data, "file-shared", true);
    return structuredClone(cloud.get("file-shared")!.metadata);
  });
  transport.updateConditionalSyncFile.mockReset().mockImplementation(async (data: AuraStartData, options: { snapshot: GoogleDriveConditionalDownload }) => {
    if (!assertVersion(options.snapshot)) throw new GoogleDriveSyncError("not_found", "Deleted", 404);
    const fileId = options.snapshot.metadata.id;
    addCloud(data, fileId, true);
    return structuredClone(cloud.get(fileId)!.metadata);
  });
  transport.deleteConditionalSyncFile.mockReset().mockImplementation(async (snapshot: GoogleDriveConditionalDownload) => {
    assertVersion(snapshot);
    cloud.delete(snapshot.metadata.id);
  });
  install(activeDevice);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("settings evolution across persisted data and Google Drive", () => {
  it("adds missing defaults to a 2.0.5 document without changing existing false, zero or nested preferences", async () => {
    const old = fixture("device-a");
    old.settings.showDescriptions = false;
    old.settings.background = { preset: "forest", blur: 0, dim: 0, position: "left" };
    old.settings.widgets.notes = true;
    old.settings.pomodoro.focusMinutes = 40;
    for (const path of ["showVersionInHeader", "showSearch", "widgets.pomodoro", "pomodoro.breakMinutes"]) omitSetting(old, path);
    install("device-a", old);

    const loaded = await localData();
    expect(loaded.settings).toMatchObject({
      showDescriptions: false, showVersionInHeader: DEFAULT_SETTINGS.showVersionInHeader, showSearch: DEFAULT_SETTINGS.showSearch,
      background: { preset: "forest", blur: 0, dim: 0, position: "left" },
      widgets: { notes: true, pomodoro: DEFAULT_SETTINGS.widgets.pomodoro },
      pomodoro: { focusMinutes: 40, breakMinutes: DEFAULT_SETTINGS.pomodoro.breakMinutes }
    });
    await syncDevice("device-a");
    const uploaded = validateAuraData(cloud.get("file-shared")!.raw);
    expect(uploaded.settings.background.dim).toBe(0);
    expect(uploaded.settings.showDescriptions).toBe(false);
    expect(uploaded.settings.pomodoro).toEqual(loaded.settings.pomodoro);
    expect(hasPendingGoogleDriveLocalChanges(await localData())).toBe(false);
  });

  it("does not let missing cloud settings overwrite explicit receiver values at legacy clock zero", async () => {
    const local = fixture("device-a");
    local.settings.showSearch = false;
    local.settings.background.dim = 0;
    local.settings.pomodoro.breakMinutes = 1;
    const oldCloud = fixture("device-b");
    for (const path of ["showSearch", "background.dim", "pomodoro.breakMinutes"]) omitSetting(oldCloud, path);
    install("device-a", local);
    addCloud(oldCloud);

    await syncDevice("device-a");
    const after = await localData();
    expect(after.settings.showSearch).toBe(false);
    expect(after.settings.background.dim).toBe(0);
    expect(after.settings.pomodoro.breakMinutes).toBe(1);
    expect(after.syncReplica?.clock).toBe(0);
  });

  it("accepts an older partial replica without assigning missing defaults its unrelated high clock", async () => {
    const local = fixture("device-a");
    local.settings.showSearch = false;
    local.settings.background.dim = 0;
    const oldCloud = fixture("device-b");
    oldCloud.syncReplica = ensureSyncReplica(oldCloud);
    oldCloud.syncReplica.clock = 500;
    oldCloud.groups[0].title = "Cloud folder edit";
    oldCloud.syncReplica.groups["shared-group"].fields.title = {
      stamp: { counter: 500, deviceId: "device-b" }, value: "Cloud folder edit"
    };
    for (const path of ["showSearch", "background.dim"]) omitSetting(oldCloud, path);
    install("device-a", local);
    addCloud(oldCloud);

    await syncDevice("device-a");
    const after = await localData();
    expect(after.groups[0].title).toBe("Cloud folder edit");
    expect(after.settings.showSearch).toBe(false);
    expect(after.settings.background.dim).toBe(0);
    expect(after.syncReplica?.settings.showSearch.stamp.counter).toBe(0);
    expect(after.syncReplica?.settings["background.dim"].stamp.counter).toBe(0);
    expect(after.syncReplica?.clock).toBe(500);
  });

  it("uses cloud preferences to fill fields absent from an older receiving installation", async () => {
    const receiver = fixture("device-a");
    for (const path of ["showSearch", "background.dim", "widgets.notes"]) omitSetting(receiver, path);
    const remote = fixture("device-b");
    remote.settings.showSearch = false;
    remote.settings.background.dim = 0;
    remote.settings.widgets.notes = true;
    install("device-a", receiver);
    addCloud(remote);

    await syncDevice("device-a");
    expect((await localData()).settings).toMatchObject({ showSearch: false, background: { dim: 0 }, widgets: { notes: true } });
  });

  it("converges hydrated defaults once and leaves repeated clean polls free of uploads or restore points", async () => {
    for (const deviceId of ["device-a", "device-b"]) {
      const old = fixture(deviceId);
      for (const path of ["showSearch", "background.dim", "widgets.pomodoro", "pomodoro.breakMinutes"]) omitSetting(old, path);
      install(deviceId, old);
    }
    await converge();
    const writes = writeCount();
    const before = new Map<string, AuraStartData>();
    for (const deviceId of ["device-a", "device-b"]) {
      activeDevice = deviceId;
      before.set(deviceId, await localData());
    }

    for (let poll = 0; poll < 3; poll++) {
      for (const deviceId of ["device-a", "device-b"]) {
        expect(await syncDevice(deviceId)).toMatchObject({ status: "in_sync", quiet: true });
        const after = await localData();
        expect(after.updatedAt).toBe(before.get(deviceId)!.updatedAt);
        expect(after.restorePoints).toEqual(before.get(deviceId)!.restorePoints);
        expect(after.syncReplica?.clock).toBe(0);
        expect(hasPendingGoogleDriveLocalChanges(after)).toBe(false);
      }
    }
    expect(writeCount()).toBe(writes);
    expect(cloud.size).toBe(1);
    expect(sameSyncReplica(before.get("device-a")!, before.get("device-b")!)).toBe(true);
    expect(sameSyncContent(before.get("device-a")!, before.get("device-b")!)).toBe(true);
  });

  it("round-trips safe future nested preferences through local edits, uploads and a second device", async () => {
    const future = fixture("device-a");
    const preferences = { density: "cozy", collapsed: false, offset: 0, columns: { wide: 7 }, pins: ["work", "home"], breaks: [10, 20] };
    Object.assign(future.settings, { futureLayout: preferences });
    Object.assign(future.settings.background, { futureTint: { color: "#123456", strength: 0 } });
    install("device-a", future);
    install("device-b");
    await localEdit((next) => { next.settings.theme = "dark"; });
    await converge();

    for (const deviceId of ["device-a", "device-b"]) {
      activeDevice = deviceId;
      const data = await localData();
      expect(data.settings).toMatchObject({ theme: "dark", futureLayout: preferences, background: { futureTint: { color: "#123456", strength: 0 } } });
      expect(cloud.get("file-shared")!.raw.settings).toMatchObject({ futureLayout: preferences });
    }
    await localEdit((next) => { next.groups[0].title = "Changed on device B"; });
    await converge();
    activeDevice = "device-a";
    expect((await localData()).settings).toMatchObject({ futureLayout: preferences });
    expect((await localData()).groups[0].title).toBe("Changed on device B");
  });

  it("retains a future setting received only in causal metadata across unrelated old-client saves", async () => {
    const future = fixture("device-b");
    future.syncReplica = ensureSyncReplica(future);
    future.syncReplica.clock = 7;
    future.syncReplica.settings["futureLayout.density"] = { stamp: { counter: 7, deviceId: "device-b" }, value: "airy" };
    addCloud(future);

    await syncDevice("device-a");
    await localEdit((next) => { next.settings.showDescriptions = false; });
    await syncDevice("device-a");
    const after = await localData();
    expect(after.syncReplica?.settings["futureLayout.density"]).toEqual(future.syncReplica.settings["futureLayout.density"]);
    expect(after.settings).toMatchObject({ futureLayout: { density: "airy" }, showDescriptions: false });
    expect(cloud.get("file-shared")!.raw.syncReplica?.settings["futureLayout.density"]).toEqual(future.syncReplica.settings["futureLayout.density"]);
  });

  it("preserves a future enum during unrelated saves and replaces it only after an explicit supported choice", async () => {
    const future = fixture("device-b");
    future.syncReplica = ensureSyncReplica(future);
    future.syncReplica.clock = 9;
    Object.assign(future.settings, { theme: "sepia" });
    future.syncReplica.settings.theme = { stamp: { counter: 9, deviceId: "future-device" }, value: "sepia" };
    addCloud(future);

    await syncDevice("device-a");
    const received = await localData();
    expect(received.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(received.syncReplica?.settings.theme.value).toBe("sepia");
    await localEdit((next) => { next.groups[0].title = "Edited by the older client"; });
    await syncDevice("device-a");
    expect((await localData()).syncReplica?.settings.theme).toEqual(future.syncReplica.settings.theme);
    expect(cloud.get("file-shared")!.raw.syncReplica?.settings.theme).toEqual(future.syncReplica.settings.theme);

    await localEdit((next) => { next.settings.theme = "light"; });
    await syncDevice("device-a");
    const chosen = await localData();
    expect(chosen.settings.theme).toBe("light");
    expect(chosen.syncReplica?.settings.theme.value).toBe("light");
    expect(chosen.syncReplica?.settings.theme.stamp.counter).toBeGreaterThan(9);
    expect(cloud.get("file-shared")!.raw.syncReplica?.settings.theme.value).toBe("light");
  });

  it("rebases a stale page edit without deleting newly downloaded nested settings", async () => {
    install("device-b");
    await converge();
    activeDevice = "device-a";
    const staleBaseline = await localData();
    const stalePage = structuredClone(staleBaseline);
    stalePage.settings.background.blur = 4;
    activeDevice = "device-b";
    await localEdit((next) => {
      next.settings.background.dim = 63;
      Object.assign(next.settings.background, { futureTint: { color: "#abcdef", strength: 0.75 } });
      Object.assign(next.settings.widgets, { futureCalendar: false });
    });
    await syncDevice("device-b");
    await syncDevice("device-a");

    const saved = await saveAuraData(stalePage, { baseline: staleBaseline });
    expect(saved.settings.background).toMatchObject({ blur: 4, dim: 63, futureTint: { color: "#abcdef", strength: 0.75 } });
    expect(saved.settings.widgets).toMatchObject({ futureCalendar: false });
    await converge();
    activeDevice = "device-b";
    expect((await localData()).settings.background).toMatchObject({ blur: 4, dim: 63, futureTint: { color: "#abcdef", strength: 0.75 } });
  });

  it("keeps local connection metadata while upgrading settings and migrating a 2.0.5 background and notes", async () => {
    const image = "data:image/png;base64,bGVnYWN5LWJhY2tncm91bmQ=";
    const local = fixture("device-a");
    local.settings.captureOpenTabs = true;
    local.settings.background.preset = "custom";
    local.settings.background.dim = 0;
    omitSetting(local, "showSearch");
    omitSetting(local, "widgets.pomodoro");
    omitSetting(local, "notes.text");
    install("device-a", local);
    deviceStorage.get("device-a")![UI_STATE_STORAGE_KEY] = { customBackgroundImage: image, widgetNotes: "Personal local notes" };
    const remote = fixture("device-b");
    for (const path of ["background.dim", "showSearch", "widgets.pomodoro"]) omitSetting(remote, path);
    addCloud(remote);

    await syncDevice("device-a");
    const after = await localData();
    expect(after.settings.sync).toMatchObject({
      deviceId: "device-a", connectionId: "connection-device-a", mode: "auto", connected: true,
      accountEmail: "device-a@example.invalid", deleteCloudFileOnDisconnect: false
    });
    expect(after.settings.captureOpenTabs).toBe(true);
    expect(after.settings.background).toMatchObject({ preset: "custom", dim: 0 });
    expect(await loadBackgroundImage(after.settings.background.customImageId)).toBe(image);
    expect(after.settings.showSearch).toBe(DEFAULT_SETTINGS.showSearch);
    expect(deviceStorage.get("device-a")![UI_STATE_STORAGE_KEY]).toEqual({ customBackgroundImage: null, widgetNotes: "" });
    expect(after.settings.notes.text).toBe("Personal local notes");
    expect(cloud.get("file-shared")!.raw.settings.notes.text).toBe("Personal local notes");
    expect(cloud.get("file-shared")!.raw.settings.sync).not.toHaveProperty("accountEmail");
    expect(cloud.get("file-shared")!.raw.settings.captureOpenTabs).toBe(true);
  });
});
