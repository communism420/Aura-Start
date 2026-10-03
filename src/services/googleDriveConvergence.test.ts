import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DEFAULT_SETTINGS, STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import type { AuraStartData, AuraStartLink } from "../types";
import { loadBackgroundImage, storeBackgroundImage } from "../utils/backgroundImageStorage";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData, updateAuraData } from "../utils/storage";
import { commitLocalSyncChanges, ensureSyncReplica, sameSyncContent, sameSyncReplica } from "../utils/syncReplica";
import {
  hasPendingGoogleDriveLocalChanges,
  runGoogleDriveBackgroundSync
} from "./googleDriveBackgroundSync";
import { GoogleDriveSyncError, type GoogleDriveConditionalDownload } from "./googleDriveSync";

const transport = vi.hoisted(() => ({
  getAuthToken: vi.fn(),
  listSyncFiles: vi.fn(),
  downloadConditionalSyncFile: vi.fn(),
  createSharedSyncFile: vi.fn(),
  updateConditionalSyncFile: vi.fn(),
  deleteConditionalSyncFile: vi.fn()
}));

vi.mock("./googleDriveSync", async (original) => ({
  ...await original<typeof import("./googleDriveSync")>(),
  ...transport
}));

const TIME = "2026-09-12T10:00:00.000Z";
let activeDevice: string;
let deviceStorage: Map<string, Record<string, unknown>>;
let cloud: Map<string, GoogleDriveConditionalDownload>;
let revision: number;
const uploads = vi.fn();
let onDownload: (() => Promise<void>) | undefined;
let onUpload: ((data: AuraStartData) => Promise<void>) | undefined;

function link(id: string): AuraStartLink {
  return { id, title: id, url: `https://example.com/${id}`, order: 0, createdAt: TIME, updatedAt: TIME };
}

function deviceData(deviceId: string): AuraStartData {
  const data = createEmptyData();
  data.updatedAt = TIME;
  data.settings.sync = {
    ...data.settings.sync,
    deviceId,
    connectionId: `connection-${deviceId}`,
    mode: "auto",
    // Start before the first upload; acknowledged fixtures must seed Drive.
    connected: true
  };
  data.groups = [{
    id: "shared-group", title: "Original group", parentId: null, collapsed: false, order: 0,
    links: [link("edited-link"), { ...link("deleted-link"), order: 1 }]
  }];
  data.syncReplica = ensureSyncReplica(data);
  return data;
}

function installDevice(deviceId: string, data = deviceData(deviceId)): void {
  deviceStorage.set(deviceId, { [STORAGE_KEY]: structuredClone(data) });
}

function cloudSnapshot(data: AuraStartData, fileId: string, owner = data.settings.sync.deviceId, shared = false): GoogleDriveConditionalDownload {
  const sanitized = structuredClone(data);
  sanitized.settings.sync = { ...DEFAULT_SETTINGS.sync, deviceId: owner,
    deleteCloudFileOnDisconnect: data.settings.sync.deleteCloudFileOnDisconnect };
  sanitized.restorePoints = [];
  const metadata: GoogleDriveConditionalDownload["metadata"] = {
    id: fileId,
    name: "aura-start-sync.json",
    createdTime: cloud.get(fileId)?.metadata.createdTime ?? new Date(Date.parse(TIME) + revision).toISOString(),
    version: String(++revision),
    appProperties: shared ? { auraStartSync: "true", auraStartSharedSync: "1" }
      : { auraStartSync: "true", auraStartDeviceId: owner }
  };
  return {
    metadata,
    etag: `"${revision}"`,
    data: sanitized,
    cloudUpdatedAt: sanitized.updatedAt,
    payload: {
      schemaVersion: 1, app: "Aura Start", appVersion: "2.1.0", updatedAt: sanitized.updatedAt,
      deviceId: owner, data: sanitized
    }
  };
}

async function localData(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error(`Local device ${activeDevice} is not ready`);
  return loaded.data;
}

function sharedCloud(): GoogleDriveConditionalDownload {
  expect(cloud.size).toBe(1);
  const file = [...cloud.values()][0];
  expect(file.metadata.appProperties?.auraStartSharedSync).toBe("1");
  expect(file.metadata.appProperties).not.toHaveProperty("auraStartDeviceId");
  return file;
}

async function localEdit(mutate: (next: AuraStartData) => void): Promise<AuraStartData> {
  const baseline = await localData();
  const next = structuredClone(baseline);
  mutate(next);
  return await saveAuraData(next, { baseline });
}

async function syncDevice(deviceId: string) {
  activeDevice = deviceId;
  return await runGoogleDriveBackgroundSync(true);
}

function editRemote(source: AuraStartData, deviceId: string, mutate: (next: AuraStartData) => void): AuraStartData {
  const current = structuredClone(source);
  current.settings.sync.deviceId = deviceId;
  const next = structuredClone(current);
  mutate(next);
  return commitLocalSyncChanges(current, next);
}

beforeEach(() => {
  activeDevice = "device-a";
  deviceStorage = new Map();
  cloud = new Map();
  revision = 0;
  uploads.mockReset();
  onDownload = undefined;
  onUpload = undefined;
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  vi.stubGlobal("indexedDB", new IDBFactory());
  // Use the production browser adapter, validation, storage lock and replica
  // implementation. Only remote authentication/transport are mocked.
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
  transport.downloadConditionalSyncFile.mockReset().mockImplementation(async (metadata: { id: string }) => {
    const downloaded = structuredClone(cloud.get(metadata.id));
    await onDownload?.();
    return downloaded;
  });
  const write = async (data: AuraStartData, deviceId: string, snapshot?: GoogleDriveConditionalDownload) => {
    uploads(data, { deviceId, fileId: snapshot?.metadata.id, expectedExistingFile: Boolean(snapshot) });
    await onUpload?.(structuredClone(data));
    if (snapshot && cloud.get(snapshot.metadata.id)?.etag !== snapshot.etag) {
      throw new GoogleDriveSyncError("unknown", "Concurrent update", 412);
    }
    const fileId = snapshot?.metadata.id ?? "file-shared";
    const uploaded = cloudSnapshot(data, fileId, deviceId, true);
    cloud.set(fileId, uploaded);
    return structuredClone(uploaded.metadata);
  };
  transport.createSharedSyncFile.mockReset().mockImplementation(async (data: AuraStartData, deviceId: string) => await write(data, deviceId));
  transport.updateConditionalSyncFile.mockReset().mockImplementation(async (data: AuraStartData,
    options: { deviceId: string; snapshot: GoogleDriveConditionalDownload }) => await write(data, options.deviceId, options.snapshot));
  transport.deleteConditionalSyncFile.mockReset().mockImplementation(async (snapshot: GoogleDriveConditionalDownload) => {
    const current = cloud.get(snapshot.metadata.id);
    if (current && current.etag !== snapshot.etag) throw new GoogleDriveSyncError("unknown", "Concurrent update", 412);
    cloud.delete(snapshot.metadata.id);
  });
  installDevice(activeDevice);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("Google Drive background multi-device convergence", () => {
  it("migrates a visible 2.0.5 image before any cloud pull and preserves it against an older no-image cloud", async () => {
    const legacyImage = "data:image/png;base64,bGVnYWN5LTIuMC41";
    const local = deviceData("device-a");
    delete local.syncReplica;
    delete local.settings.background.customImageId;
    local.settings.background.preset = "custom";
    installDevice("device-a", local);
    deviceStorage.get("device-a")![UI_STATE_STORAGE_KEY] = { customBackgroundImage: legacyImage, widgetNotes: "Local notes" };

    const olderCloud = deviceData("device-b");
    delete olderCloud.syncReplica;
    delete olderCloud.settings.background.customImageId;
    olderCloud.settings.background.preset = "none";
    olderCloud.groups[0].links[0].title = "Old cloud title";
    cloud.set("legacy-cloud", cloudSnapshot(olderCloud, "legacy-cloud"));
    let migratedId: string | null | undefined;
    onDownload = async () => {
      const durable = deviceStorage.get("device-a")![STORAGE_KEY] as AuraStartData;
      migratedId = durable.settings.background.customImageId;
      expect(migratedId).toMatch(/^[a-f0-9]{64}$/);
      expect(await loadBackgroundImage(migratedId)).toBe(legacyImage);
      expect(durable.syncReplica?.settings["background.customImageId"].stamp.counter).toBe(1);
      expect(durable.syncReplica?.settings["background.preset"].stamp.counter).toBe(1);
    };

    const result = await runGoogleDriveBackgroundSync(true);
    const after = await localData();
    expect(["uploaded", "downloaded"]).toContain(result.status);
    expect(after.settings.background).toMatchObject({ preset: "custom", customImageId: migratedId });
    expect(await loadBackgroundImage(after.settings.background.customImageId)).toBe(legacyImage);
    expect(sharedCloud().data.settings.background).toMatchObject({ preset: "custom", customImageId: migratedId });
    expect(uploads.mock.calls[0][0].settings.background.customImageId).toBe(migratedId);
    expect(deviceStorage.get("device-a")![UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: null, widgetNotes: "" });
    expect(after.settings.notes.text).toBe("Local notes");
    expect(sharedCloud().data.settings.notes.text).toBe("Local notes");
    expect(JSON.stringify(deviceStorage.get("device-a")![STORAGE_KEY])).not.toContain("data:image");
    expect(hasPendingGoogleDriveLocalChanges(after)).toBe(false);
  });

  it("preserves a 2.0.5 image and stops before authentication when its migration cannot persist", async () => {
    const local = deviceData("device-a");
    delete local.syncReplica;
    delete local.settings.background.customImageId;
    local.settings.background.preset = "custom";
    installDevice("device-a", local);
    deviceStorage.get("device-a")![UI_STATE_STORAGE_KEY] = { customBackgroundImage: "data:image/png;base64,a2VlcC1tZQ==" };
    const before = structuredClone(deviceStorage.get("device-a"));
    vi.stubGlobal("indexedDB", undefined);

    const result = await runGoogleDriveBackgroundSync(true);
    expect(result).toMatchObject({ status: "failed", quiet: true });
    expect(deviceStorage.get("device-a")).toEqual(before);
    expect(transport.getAuthToken).not.toHaveBeenCalled();
    expect(transport.downloadConditionalSyncFile).not.toHaveBeenCalled();
    expect(uploads).not.toHaveBeenCalled();
    expect(cloud.size).toBe(0);

    vi.stubGlobal("indexedDB", new IDBFactory());
    expect((await runGoogleDriveBackgroundSync(true)).status).toBe("uploaded");
    expect(await loadBackgroundImage((await localData()).settings.background.customImageId)).toBe("data:image/png;base64,a2VlcC1tZQ==");
  });

  it("converges image edits, removal and restoration across three devices while retaining independent edits and ignoring stale legacy absence", async () => {
    const devices = ["device-a", "device-b", "device-c"];
    for (const device of devices) installDevice(device);
    const initialId = await storeBackgroundImage("data:image/png;base64,aW5pdGlhbA==");
    const replacementId = await storeBackgroundImage("data:image/webp;base64,cmVwbGFjZW1lbnQ=");
    activeDevice = "device-a";
    await localEdit((next) => {
      next.settings.background.customImageId = initialId;
      next.settings.background.preset = "custom";
    });
    for (let round = 0; round < 2; round++) for (const device of devices) await syncDevice(device);

    activeDevice = "device-a";
    await localEdit((next) => { next.settings.background.customImageId = replacementId; });
    activeDevice = "device-b";
    await localEdit((next) => {
      next.settings.background.dim = 55;
      next.groups[0].links[0].title = "Independent bookmark edit";
    });
    activeDevice = "device-c";
    await localEdit((next) => { next.settings.background.customImageId = null; });
    const legacy = deviceData("legacy-device");
    delete legacy.syncReplica;
    delete legacy.settings.background.customImageId;
    legacy.updatedAt = "2099-01-01T00:00:00.000Z";
    cloud.set("stale-legacy", cloudSnapshot(legacy, "stale-legacy"));

    for (let round = 0; round < 3; round++) for (const device of devices) await syncDevice(device);
    const removedStates: AuraStartData[] = [];
    for (const device of devices) {
      activeDevice = device;
      const state = await localData();
      removedStates.push(state);
      expect(state.settings.background).toMatchObject({ customImageId: null, dim: 55, preset: "custom" });
      expect(state.groups[0].links[0].title).toBe("Independent bookmark edit");
      expect(state.syncReplica?.settings["background.customImageId"]).toMatchObject({ value: null, stamp: { deviceId: "device-c", counter: 2 } });
      expect(JSON.stringify(state)).not.toContain("data:image");
    }
    expect(sameSyncReplica(removedStates[0], removedStates[1])).toBe(true);
    expect(sameSyncReplica(removedStates[0], removedStates[2])).toBe(true);

    activeDevice = "device-a";
    await localEdit((next) => { next.settings.background.customImageId = replacementId; });
    for (let round = 0; round < 3; round++) for (const device of devices) await syncDevice(device);
    for (const device of devices) {
      activeDevice = device;
      expect((await localData()).settings.background.customImageId).toBe(replacementId);
      expect(hasPendingGoogleDriveLocalChanges(await localData())).toBe(false);
    }
    const uploadCount = uploads.mock.calls.length;
    for (const device of devices) expect((await syncDevice(device)).status).toBe("in_sync");
    expect(uploads).toHaveBeenCalledTimes(uploadCount);
  });

  it("automatically applies remote changes on a clean receiver and saves a local Restore Point", async () => {
    expect((await runGoogleDriveBackgroundSync(true)).status).toBe("uploaded");
    uploads.mockClear();
    const before = await localData();
    const remote = editRemote(before, "device-b", (next) => { next.groups[0].links[0].title = "Changed on another device"; });
    cloud.set("file-device-b", cloudSnapshot(remote, "file-device-b"));
    expect(hasPendingGoogleDriveLocalChanges(before)).toBe(false);

    const result = await runGoogleDriveBackgroundSync(true); // periodic alarm refresh
    const after = await localData();

    expect(result.status).toBe("downloaded");
    expect(result).toMatchObject({ syncDeviceId: "device-a", syncConnectionId: "connection-device-a" });
    expect(after.groups[0].links[0].title).toBe("Changed on another device");
    expect(after.settings.sync.deviceId).toBe("device-a");
    expect(after.settings.sync.connectionId).toBe("connection-device-a");
    expect(after.restorePoints).toHaveLength(1);
    expect(after.restorePoints[0].reason).toBe("before_cloud_restore");
    expect(after.restorePoints[0].data.groups[0].links[0].title).toBe("edited-link");
    expect(after.restorePoints[0].data).not.toHaveProperty("syncReplica");
    expect(hasPendingGoogleDriveLocalChanges(after)).toBe(false);
    expect(uploads).toHaveBeenCalledTimes(1);
    expect(uploads.mock.calls[0][1]).toMatchObject({ deviceId: "device-a", fileId: "file-shared", expectedExistingFile: true });
  });

  it("converges three existing devices after independent field edits and deletion, then stops uploading", async () => {
    const devices = ["device-a", "device-b", "device-c"];
    for (const device of devices) {
      installDevice(device);
      await syncDevice(device);
    }
    activeDevice = devices[0];
    await localEdit((next) => { next.groups[0].links[0].title = "New title from A"; });
    activeDevice = devices[1];
    await localEdit((next) => { next.groups[0].links[0].url = "https://device-b.example/"; });
    activeDevice = devices[2];
    await localEdit((next) => { next.groups[0].links = next.groups[0].links.filter((item) => item.id !== "deleted-link"); });

    for (let round = 0; round < 3; round++) for (const device of devices) await syncDevice(device);
    const states: AuraStartData[] = [];
    for (const device of devices) {
      activeDevice = device;
      const state = await localData();
      states.push(state);
      expect(state.groups[0].links).toHaveLength(1);
      expect(state.groups[0].links[0]).toMatchObject({ title: "New title from A", url: "https://device-b.example/" });
      expect(state.syncReplica?.links["deleted-link"].presence.value).toBe(false);
      expect(hasPendingGoogleDriveLocalChanges(state)).toBe(false);
    }
    expect(sameSyncContent(states[0], states[1])).toBe(true);
    expect(sameSyncReplica(states[0], states[2])).toBe(true);
    const uploadCount = uploads.mock.calls.length;
    const restoreCounts = states.map((state) => state.restorePoints.length);
    for (const device of devices) expect((await syncDevice(device)).status).toBe("in_sync");
    expect(uploads).toHaveBeenCalledTimes(uploadCount);
    for (const [index, device] of devices.entries()) {
      activeDevice = device;
      expect((await localData()).restorePoints).toHaveLength(restoreCounts[index]);
    }
    expect([...cloud.keys()]).toEqual(["file-shared"]);
  });

  it("preserves local edits made during download and includes them in the same upload", async () => {
    const before = await localData();
    const remote = editRemote(before, "device-b", (next) => { next.groups[0].links[0].url = "https://remote.example/"; });
    cloud.set("file-device-b", cloudSnapshot(remote, "file-device-b"));
    onDownload = async () => {
      onDownload = undefined;
      await localEdit((next) => { next.groups[0].links[0].title = "Typed while downloading"; });
    };

    await runGoogleDriveBackgroundSync(true);
    const after = await localData();
    expect(after.groups[0].links[0]).toMatchObject({ title: "Typed while downloading", url: "https://remote.example/" });
    expect(sharedCloud().data.groups[0].links[0]).toMatchObject({ title: "Typed while downloading", url: "https://remote.example/" });
    expect(hasPendingGoogleDriveLocalChanges(after)).toBe(false);
  });

  it("preserves edits made during upload and leaves that newer local revision pending", async () => {
    await runGoogleDriveBackgroundSync(true);
    await localEdit((next) => { next.groups[0].title = "Uploaded group name"; });
    onUpload = async () => {
      onUpload = undefined;
      await localEdit((next) => { next.groups[0].links[0].title = "Typed while uploading"; });
    };

    await runGoogleDriveBackgroundSync(true);
    const after = await localData();
    expect(after.groups[0].links[0].title).toBe("Typed while uploading");
    expect(cloud.get("file-shared")?.data.groups[0].links[0].title).toBe("edited-link");
    expect(hasPendingGoogleDriveLocalChanges(after)).toBe(true);

    await runGoogleDriveBackgroundSync();
    expect(cloud.get("file-shared")?.data.groups[0].links[0].title).toBe("Typed while uploading");
    expect(hasPendingGoogleDriveLocalChanges(await localData())).toBe(false);
  });

  it("ignores a download from an old connection after an account switch", async () => {
    const before = await localData();
    const remote = editRemote(before, "device-b", (next) => { next.groups[0].title = "Old account data"; });
    cloud.set("file-device-b", cloudSnapshot(remote, "file-device-b"));
    onDownload = async () => {
      await updateAuraData((current) => ({
        ...current,
        settings: { ...current.settings, sync: { ...current.settings.sync, connectionId: "new-account", cloudFileId: "new-account-file" } }
      }));
    };

    const result = await runGoogleDriveBackgroundSync(true);
    const after = await localData();
    expect(result).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(after.groups[0].title).toBe(before.groups[0].title);
    expect(after.settings.sync).toMatchObject({ connectionId: "new-account", cloudFileId: "new-account-file" });
    expect(after.restorePoints).toHaveLength(0);
    expect(uploads).not.toHaveBeenCalled();
  });

  it("does not acknowledge an old upload into a replacement connection", async () => {
    const before = await localData();
    onUpload = async () => {
      await updateAuraData((current) => ({
        ...current,
        settings: { ...current.settings, sync: { ...current.settings.sync, connectionId: "replacement", cloudFileId: "replacement-file" } }
      }));
    };

    const result = await runGoogleDriveBackgroundSync(true);
    const after = await localData();
    expect(result).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(after.settings.sync).toMatchObject({ connectionId: "replacement", cloudFileId: "replacement-file", lastSyncedAt: before.settings.sync.lastSyncedAt });
  });

  it("discards an authorization failure from a replaced connection instead of reporting a new reconnect", async () => {
    cloud.set("existing-file", cloudSnapshot(await localData(), "existing-file"));
    onDownload = async () => {
      await updateAuraData((current) => ({
        ...current,
        settings: { ...current.settings, sync: { ...current.settings.sync, connectionId: "replacement", reconnectRequired: false } }
      }));
      throw new GoogleDriveSyncError("unauthorized", "Old account token expired");
    };

    const result = await runGoogleDriveBackgroundSync(true);
    expect((await localData()).settings.sync).toMatchObject({ connectionId: "replacement", reconnectRequired: false });
    expect(result).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(result).toMatchObject({ syncDeviceId: "device-a", syncConnectionId: "connection-device-a" });
  });

  it.each([
    ["off", false, false, "skipped"],
    ["auto", false, false, "skipped"],
    ["auto", true, true, "needs_reconnect"]
  ] as const)("does not contact Drive for mode=%s connected=%s reconnect=%s", async (mode, connected, reconnectRequired, status) => {
    const data = await localData();
    data.settings.sync = { ...data.settings.sync, mode, connected, reconnectRequired };
    installDevice(activeDevice, data);

    // Reconnect warnings suppress edit-triggered work; the periodic forced
    // check separately attempts silent recovery of an enabled connection.
    expect((await runGoogleDriveBackgroundSync(reconnectRequired ? false : true)).status).toBe(status);
    expect(transport.getAuthToken).not.toHaveBeenCalled();
    expect(transport.downloadConditionalSyncFile).not.toHaveBeenCalled();
    expect(uploads).not.toHaveBeenCalled();
  });

  it("keeps local data and pending edits unchanged when the download fails", async () => {
    cloud.set("existing-file", cloudSnapshot(await localData(), "existing-file"));
    await localEdit((next) => { next.groups[0].title = "Unsynced local edit"; });
    const before = await localData();
    transport.downloadConditionalSyncFile.mockRejectedValue(new GoogleDriveSyncError("network", "Offline"));

    expect((await runGoogleDriveBackgroundSync(true)).status).toBe("failed");
    expect(await localData()).toEqual(before);
    expect(uploads).not.toHaveBeenCalled();
    expect(hasPendingGoogleDriveLocalChanges(await localData())).toBe(true);
  });

  it("retains merged content and its safety snapshot when an upload fails, then retries", async () => {
    const before = await localData();
    const remote = editRemote(before, "device-b", (next) => { next.groups[0].title = "Remote survives upload failure"; });
    cloud.set("file-device-b", cloudSnapshot(remote, "file-device-b"));
    onUpload = async () => { throw new GoogleDriveSyncError("network", "Temporary upload failure"); };

    expect((await runGoogleDriveBackgroundSync(true)).status).toBe("failed");
    const merged = await localData();
    expect(merged.groups[0].title).toBe("Remote survives upload failure");
    expect(merged.restorePoints).toHaveLength(1);
    expect(merged.settings.sync.lastSyncedAt).toBe(before.settings.sync.lastSyncedAt);
    expect(hasPendingGoogleDriveLocalChanges(merged)).toBe(true);
    onUpload = undefined;
    expect((await runGoogleDriveBackgroundSync()).status).toBe("uploaded");
    expect((await localData()).restorePoints).toHaveLength(1);
    expect(hasPendingGoogleDriveLocalChanges(await localData())).toBe(false);
  });

  it("marks expired authorization for reconnect without changing user content", async () => {
    const before = await localData();
    transport.getAuthToken.mockRejectedValue(new GoogleDriveSyncError("unauthorized", "Authorization revoked"));

    expect((await runGoogleDriveBackgroundSync(true)).status).toBe("needs_reconnect");
    const after = await localData();
    expect(after.settings.sync.reconnectRequired).toBe(true);
    expect(sameSyncContent(after, before)).toBe(true);
    expect(after.restorePoints).toEqual(before.restorePoints);
  });

  it("migrates a foreign legacy ID to a fresh common file before retiring the legacy copy", async () => {
    const before = await localData();
    const remote = editRemote(before, "device-b", (next) => { next.settings.theme = "dark"; });
    const otherFile = cloudSnapshot(remote, "foreign-file");
    cloud.set("foreign-file", otherFile);
    before.settings.sync.cloudFileId = "foreign-file";
    installDevice(activeDevice, before);

    await runGoogleDriveBackgroundSync(true);
    expect(uploads).toHaveBeenCalledTimes(1);
    expect(uploads.mock.calls[0][1]).toMatchObject({ deviceId: "device-a", fileId: undefined });
    expect(sharedCloud().data.settings.theme).toBe("dark");
    expect((await localData()).settings.sync.cloudFileId).toBe("file-shared");
    expect(transport.createSharedSyncFile).toHaveBeenCalledTimes(1);
    expect(transport.deleteConditionalSyncFile.mock.calls[0][0].metadata.id).toBe("foreign-file");
  });

  it("merges legacy duplicates into a fresh common file and replaces obsolete local file IDs", async () => {
    const base = await localData();
    const first = editRemote(base, "device-a", (next) => { next.groups[0].title = "From duplicate one"; });
    const second = editRemote(base, "device-a", (next) => { next.settings.theme = "dark"; });
    const duplicate = cloudSnapshot(first, "duplicate-1");
    cloud.set("duplicate-1", duplicate);
    cloud.set("duplicate-2", cloudSnapshot(second, "duplicate-2"));
    base.settings.sync.cloudFileId = "duplicate-2";
    installDevice(activeDevice, base);

    await runGoogleDriveBackgroundSync(true);
    expect(uploads).toHaveBeenCalledTimes(1);
    expect(uploads.mock.calls[0][1]).toMatchObject({ fileId: undefined });
    expect(sharedCloud().metadata.id).toBe("file-shared");
    expect(transport.deleteConditionalSyncFile).toHaveBeenCalledTimes(2);
    const merged = await localData();
    expect(merged.groups[0].title).toBe("From duplicate one");
    expect(merged.settings.theme).toBe("dark");
    expect(merged.settings.sync.cloudFileId).toBe("file-shared");
    await runGoogleDriveBackgroundSync(true);
    expect(uploads).toHaveBeenCalledTimes(1);
  });

  it("acknowledges the union actually committed after another browser changes the file during upload", async () => {
    await runGoogleDriveBackgroundSync(true);
    await localEdit((next) => { next.settings.theme = "dark"; });
    onUpload = async () => {
      onUpload = undefined;
      const remote = editRemote(sharedCloud().data, "device-b", (next) => {
        next.settings.notes.text = "Concurrent note from B";
        next.groups[0].links = next.groups[0].links.filter((item) => item.id !== "deleted-link");
      });
      cloud.set("file-shared", cloudSnapshot(remote, "file-shared", "device-b", true));
    };
    const result = await runGoogleDriveBackgroundSync(true);
    const local = await localData();
    expect(result.status).toBe("downloaded");
    expect(local.settings.theme).toBe("dark");
    expect(local.settings.notes.text).toBe("Concurrent note from B");
    expect(local.groups[0].links.map((item) => item.id)).toEqual(["edited-link"]);
    expect(sameSyncReplica(local, sharedCloud().data)).toBe(true);
    expect(hasPendingGoogleDriveLocalChanges(local)).toBe(false);
    expect(transport.updateConditionalSyncFile).toHaveBeenCalledTimes(2);
    expect(transport.createSharedSyncFile).toHaveBeenCalledTimes(1);
  });
});
