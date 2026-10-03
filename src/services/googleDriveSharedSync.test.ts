import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuraStartData } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { commitLocalSyncChanges, ensureSyncReplica, sameSyncReplica } from "../utils/syncReplica";
import { synchronizeSharedGoogleDrive } from "./googleDriveSharedSync";
import { GoogleDriveSyncError, type GoogleDriveConditionalDownload, type GoogleDriveFileMetadata } from "./googleDriveSync";

const transport = vi.hoisted(() => ({
  listSyncFiles: vi.fn(),
  downloadConditionalSyncFile: vi.fn(),
  updateConditionalSyncFile: vi.fn(),
  deleteConditionalSyncFile: vi.fn(),
  createSharedSyncFile: vi.fn(),
  isGoogleDrivePreconditionFailed: vi.fn()
}));

vi.mock("./googleDriveSync", async (original) => ({
  ...await original<typeof import("./googleDriveSync")>(), ...transport
}));

const TIME = "2026-09-12T10:00:00.000Z";
const OPTIONS = { token: "isolated-test-token", deviceId: "device-local" };
let cloud: Map<string, GoogleDriveConditionalDownload>;
let createSerial: number;

function baseline(deviceId = "device-local"): AuraStartData {
  const data = createEmptyData();
  data.updatedAt = TIME;
  data.settings.sync.deviceId = deviceId;
  data.settingsCompatibility = { version: 1, defaulted: [], preserved: {} };
  data.groups = [{ id: "group", title: "Saved", order: 0, parentId: null, collapsed: false, links: [{
    id: "link", title: "Saved link", url: "https://example.test/saved", order: 0, createdAt: TIME, updatedAt: TIME
  }] }];
  data.syncReplica = ensureSyncReplica(data);
  return data;
}

function edit(data: AuraStartData, deviceId: string, mutate: (next: AuraStartData) => void): AuraStartData {
  const current = structuredClone(data);
  current.settings.sync.deviceId = deviceId;
  const next = structuredClone(current);
  mutate(next);
  return commitLocalSyncChanges(current, next);
}

function snapshot(
  id: string,
  data: AuraStartData,
  options: { shared?: boolean; legacy?: boolean; createdTime?: string; version?: number } = {}
): GoogleDriveConditionalDownload {
  const version = options.version ?? 1;
  const metadata: GoogleDriveFileMetadata = {
    id, name: "aura-start-sync.json", version: String(version), modifiedTime: TIME,
    createdTime: options.createdTime ?? TIME, legacyAppData: Boolean(options.legacy),
    appProperties: { auraStartSync: "true", ...(options.shared
      ? { auraStartSharedSync: "1" } : { auraStartDeviceId: data.settings.sync.deviceId }) }
  };
  return {
    metadata, etag: `"${id}-revision-${version}"`, data: structuredClone(data), cloudUpdatedAt: TIME,
    payload: { app: "Aura Start", appVersion: "2.1.0", schemaVersion: 1,
      deviceId: data.settings.sync.deviceId, updatedAt: TIME, data: structuredClone(data) }
  };
}

function put(snapshot: GoogleDriveConditionalDownload): void {
  cloud.set(snapshot.metadata.id, structuredClone(snapshot));
}

function conflict(): GoogleDriveSyncError {
  return new GoogleDriveSyncError("unknown", "Conditional conflict", 412, "conditionNotMet");
}

function update(data: AuraStartData, options: { snapshot: GoogleDriveConditionalDownload }): GoogleDriveFileMetadata {
  const existing = cloud.get(options.snapshot.metadata.id);
  if (!existing) throw new GoogleDriveSyncError("not_found", "Deleted", 404);
  if (existing.etag !== options.snapshot.etag) throw conflict();
  const next = snapshot(existing.metadata.id, data, {
    shared: true, createdTime: existing.metadata.createdTime, version: Number(existing.metadata.version) + 1
  });
  put(next);
  return structuredClone(next.metadata);
}

beforeEach(() => {
  vi.clearAllMocks();
  cloud = new Map();
  createSerial = 0;
  transport.listSyncFiles.mockImplementation(async () => [...cloud.values()].map((file) => structuredClone(file.metadata)));
  transport.downloadConditionalSyncFile.mockImplementation(async (metadata: GoogleDriveFileMetadata) => {
    const file = cloud.get(metadata.id);
    return file ? structuredClone(file) : undefined;
  });
  transport.updateConditionalSyncFile.mockImplementation(async (data, options) => update(data, options));
  transport.deleteConditionalSyncFile.mockImplementation(async (observed: GoogleDriveConditionalDownload) => {
    const existing = cloud.get(observed.metadata.id);
    if (!existing) return;
    if (existing.etag !== observed.etag) throw conflict();
    cloud.delete(observed.metadata.id);
  });
  transport.createSharedSyncFile.mockImplementation(async (data: AuraStartData) => {
    const serial = ++createSerial;
    const created = snapshot(`created-${serial}`, data, { shared: true, createdTime: `2026-09-12T10:00:0${serial}.000Z` });
    put(created);
    return structuredClone(created.metadata);
  });
  transport.isGoogleDrivePreconditionFailed.mockImplementation((error: unknown) => error instanceof GoogleDriveSyncError && error.status === 412);
});

describe("one shared Google Drive backup", () => {
  it("migrates a hybrid file to a new ID so an old device writer cannot own the canonical", async () => {
    const data = baseline();
    const hybrid = snapshot("old-owned-id", data, { shared: true });
    hybrid.metadata.appProperties!.auraStartDeviceId = "old-device";
    put(hybrid);
    const result = await synchronizeSharedGoogleDrive(data, OPTIONS);
    expect(result.metadata.id).toBe("created-1");
    expect(result.metadata.appProperties).not.toHaveProperty("auraStartDeviceId");
    expect(sameSyncReplica(result.data, data)).toBe(true);
    expect(transport.updateConditionalSyncFile).not.toHaveBeenCalled();
    expect(transport.deleteConditionalSyncFile).toHaveBeenCalledWith(hybrid, OPTIONS.token);
    expect([...cloud.keys()]).toEqual(["created-1"]);
  });

  it("reads an unchanged shared canonical without writing or creating a device replica", async () => {
    const data = baseline();
    put(snapshot("canonical", data, { shared: true }));
    const result = await synchronizeSharedGoogleDrive(data, OPTIONS);
    expect(result).toMatchObject({ uploaded: false, cloudWasEmpty: false, consolidated: true });
    expect(result.observedFiles).toEqual([cloud.get("canonical")!.metadata]);
    expect(transport.updateConditionalSyncFile).not.toHaveBeenCalled();
    expect(transport.createSharedSyncFile).not.toHaveBeenCalled();
    expect(transport.deleteConditionalSyncFile).not.toHaveBeenCalled();
  });

  it("unites independent preferences, media references and tombstones before retiring all duplicates", async () => {
    const base = baseline();
    const deleted = edit(base, "device-a", (next) => { next.groups[0].links = []; });
    const notes = edit(base, "device-b", (next) => { next.settings.notes.text = "Заметки\n🚀"; });
    const media = edit(base, "device-local", (next) => {
      next.settings.background.customImageId = "a".repeat(64);
      next.settings.timer.customSoundId = "b".repeat(64);
    });
    put(snapshot("oldest", deleted, { createdTime: "2020-01-01T00:00:00.000Z" }));
    put(snapshot("newer", notes));
    put(snapshot("legacy-hidden", base, { legacy: true }));
    const result = await synchronizeSharedGoogleDrive(media, OPTIONS);
    expect([...cloud.keys()]).toEqual(["created-1"]);
    expect(result.data.groups[0].links).toEqual([]);
    expect(result.data.syncReplica!.links.link.presence.value).toBe(false);
    expect(result.data.settings.notes.text).toBe("Заметки\n🚀");
    expect(result.data.settings.background.customImageId).toBe(media.settings.background.customImageId);
    expect(result.data.settings.timer.customSoundId).toBe(media.settings.timer.customSoundId);
    expect(sameSyncReplica(cloud.get("created-1")!.data, result.data)).toBe(true);
    expect(transport.deleteConditionalSyncFile).toHaveBeenCalledTimes(3);
    expect(transport.updateConditionalSyncFile).not.toHaveBeenCalled();
  });

  it("settles equal canonical creation timestamps by ID rather than listing order or device owner", async () => {
    const data = baseline();
    put(snapshot("z-file", data, { shared: true }));
    put(snapshot("a-file", data, { shared: true }));
    const result = await synchronizeSharedGoogleDrive(data, OPTIONS);
    expect(result.metadata.id).toBe("a-file");
    expect([...cloud.keys()]).toEqual(["a-file"]);
  });

  it("rereads and merges a concurrent change after a failed CAS instead of overwriting it", async () => {
    const base = baseline();
    const local = edit(base, "device-local", (next) => { next.settings.notes.text = "local"; });
    put(snapshot("canonical", base, { shared: true }));
    transport.updateConditionalSyncFile.mockImplementationOnce(async () => {
      const remote = edit(base, "device-remote", (next) => { next.groups[0].links = []; next.settings.columns = 5; });
      put(snapshot("canonical", remote, { shared: true, version: 2 }));
      throw conflict();
    });
    const result = await synchronizeSharedGoogleDrive(local, OPTIONS);
    expect(result.data.settings.notes.text).toBe("local");
    expect(result.data.settings.columns).toBe(5);
    expect(result.data.groups[0].links).toEqual([]);
    expect(transport.updateConditionalSyncFile).toHaveBeenCalledTimes(2);
    expect(sameSyncReplica(result.data, cloud.get("canonical")!.data)).toBe(true);
  });

  it("converges two simultaneous creations into one file containing both writers' changes", async () => {
    const base = baseline();
    const a = edit(base, "device-a", (next) => { next.settings.notes.text = "from A"; });
    const b = edit(base, "device-b", (next) => { next.settings.columns = 5; });
    const [first, second] = await Promise.all([
      synchronizeSharedGoogleDrive(a, { ...OPTIONS, deviceId: "device-a", files: [] }),
      synchronizeSharedGoogleDrive(b, { ...OPTIONS, deviceId: "device-b", files: [] })
    ]);
    expect(transport.createSharedSyncFile).toHaveBeenCalledTimes(2);
    expect(cloud.size).toBe(1);
    expect(first.metadata.id).toBe(second.metadata.id);
    expect(first.cloudWasEmpty).toBe(false);
    expect(second.cloudWasEmpty).toBe(false);
    const canonical = [...cloud.values()][0];
    expect(canonical.data.settings.notes.text).toBe("from A");
    expect(canonical.data.settings.columns).toBe(5);
    expect(sameSyncReplica(first.data, second.data)).toBe(true);
  });

  it("reserves an empty-cloud creation result for a genuinely empty observed dataset", async () => {
    const result = await synchronizeSharedGoogleDrive(baseline(), OPTIONS);
    expect(result).toMatchObject({ uploaded: true, cloudWasEmpty: true, consolidated: true });
    expect(cloud.size).toBe(1);
  });

  it("stops calling the cloud empty when another file appears only after the first creation listing", async () => {
    const data = baseline();
    transport.listSyncFiles.mockImplementationOnce(async () => [...cloud.values()].map((file) => structuredClone(file.metadata)));
    transport.listSyncFiles.mockImplementationOnce(async () => {
      const other = edit(data, "device-remote", (next) => { next.settings.notes.text = "Already on Drive"; });
      put(snapshot("other-shared", other, { shared: true, createdTime: "2020-01-01T00:00:00.000Z" }));
      return [...cloud.values()].map((file) => structuredClone(file.metadata));
    });
    const result = await synchronizeSharedGoogleDrive(data, { ...OPTIONS, files: [] });
    expect(result.cloudWasEmpty).toBe(false);
    expect(result.data.settings.notes.text).toBe("Already on Drive");
    expect(cloud.size).toBe(1);
  });

  it("merges an old client's last update when its duplicate changes just before conditional deletion", async () => {
    const base = baseline();
    put(snapshot("canonical", base, { shared: true, createdTime: "2020-01-01T00:00:00.000Z" }));
    put(snapshot("duplicate", base));
    transport.deleteConditionalSyncFile.mockImplementationOnce(async () => {
      const changed = edit(base, "old-client", (next) => { next.settings.notes.text = "last edit before cleanup"; });
      put(snapshot("duplicate", changed, { version: 2 }));
      throw conflict();
    });
    const result = await synchronizeSharedGoogleDrive(base, OPTIONS);
    expect(result.data.settings.notes.text).toBe("last edit before cleanup");
    expect(cloud.get("canonical")!.data.settings.notes.text).toBe("last edit before cleanup");
    expect(cloud.size).toBe(1);
    expect(transport.deleteConditionalSyncFile).toHaveBeenCalledTimes(2);
  });

  it("persists downloaded data and rebases edits made during download before attempting the upload", async () => {
    const base = baseline();
    const remote = edit(base, "remote", (next) => { next.settings.notes.text = "downloaded notes"; });
    const latestLocal = edit(base, "device-local", (next) => { next.settings.columns = 5; });
    put(snapshot("canonical", remote, { shared: true }));
    const reconcileLocal = vi.fn(async (incoming: AuraStartData) => {
      expect(incoming.settings.notes.text).toBe("downloaded notes");
      return latestLocal;
    });
    transport.updateConditionalSyncFile.mockImplementationOnce(async (payload: AuraStartData) => {
      expect(reconcileLocal).toHaveBeenCalledTimes(1);
      expect(payload.settings.columns).toBe(5);
      expect(payload.settings.notes.text).toBe("downloaded notes");
      throw new GoogleDriveSyncError("network", "Offline");
    });
    await expect(synchronizeSharedGoogleDrive(base, { ...OPTIONS, reconcileLocal })).rejects.toMatchObject({ code: "network" });
    expect(transport.deleteConditionalSyncFile).not.toHaveBeenCalled();
  });

  it("keeps all copies after a lost upload response and safely finishes consolidation on retry", async () => {
    const base = baseline();
    const local = edit(base, "device-local", (next) => { next.settings.notes.text = "preserve"; });
    put(snapshot("canonical", base, { shared: true, createdTime: "2020-01-01T00:00:00.000Z" }));
    put(snapshot("duplicate", base));
    transport.updateConditionalSyncFile.mockImplementationOnce(async (data, options) => {
      update(data, options);
      throw new GoogleDriveSyncError("network", "Response lost after commit");
    });
    await expect(synchronizeSharedGoogleDrive(local, OPTIONS)).rejects.toMatchObject({ code: "network" });
    expect(cloud.size).toBe(2);
    expect(transport.deleteConditionalSyncFile).not.toHaveBeenCalled();
    const retried = await synchronizeSharedGoogleDrive(local, OPTIONS);
    expect(retried.cloudWasEmpty).toBe(false);
    expect(retried.data.settings.notes.text).toBe("preserve");
    expect(cloud.size).toBe(1);
  });

  it("does not overwrite or delete any backup when another discovered file cannot be validated", async () => {
    const data = baseline();
    put(snapshot("valid", data));
    put(snapshot("corrupt", data));
    transport.downloadConditionalSyncFile.mockImplementation(async (metadata: GoogleDriveFileMetadata) => {
      if (metadata.id === "corrupt") throw new GoogleDriveSyncError("invalid_cloud_file", "Invalid asset or JSON");
      return structuredClone(cloud.get(metadata.id));
    });
    await expect(synchronizeSharedGoogleDrive(data, OPTIONS)).rejects.toMatchObject({ code: "invalid_cloud_file" });
    expect(transport.updateConditionalSyncFile).not.toHaveBeenCalled();
    expect(transport.createSharedSyncFile).not.toHaveBeenCalled();
    expect(transport.deleteConditionalSyncFile).not.toHaveBeenCalled();
    expect(cloud.size).toBe(2);
  });

  it("migrates accessible appData-only content into a normal shared file without calling the cloud empty", async () => {
    const base = baseline();
    const remote = edit(base, "legacy", (next) => { next.settings.notes.text = "2.0.5 notes"; });
    put(snapshot("hidden", remote, { legacy: true }));
    const result = await synchronizeSharedGoogleDrive(base, { ...OPTIONS, expectedExistingFile: true });
    expect(result).toMatchObject({ uploaded: true, cloudWasEmpty: false });
    expect(result.metadata.legacyAppData).toBe(false);
    expect(result.data.settings.notes.text).toBe("2.0.5 notes");
    expect(cloud.size).toBe(1);
    expect(cloud.has("hidden")).toBe(false);
  });

  it("does not resurrect an acknowledged canonical deleted immediately before a conditional write", async () => {
    const base = baseline();
    const local = edit(base, "device-local", (next) => { next.settings.notes.text = "offline edit"; });
    put(snapshot("canonical", base, { shared: true }));
    transport.updateConditionalSyncFile.mockImplementationOnce(async () => {
      cloud.clear();
      throw new GoogleDriveSyncError("not_found", "Deleted", 404);
    });
    await expect(synchronizeSharedGoogleDrive(local, { ...OPTIONS, expectedExistingFile: true })).rejects.toMatchObject({ code: "cloud_deleted" });
    expect(transport.createSharedSyncFile).not.toHaveBeenCalled();
    expect(local.settings.notes.text).toBe("offline edit");
  });

  it("accepts retirement of an old local file ID when another valid canonical survives", async () => {
    const data = baseline();
    const retired = snapshot("old-replica", data);
    put(snapshot("survivor", data, { shared: true }));
    const result = await synchronizeSharedGoogleDrive(data, {
      ...OPTIONS, expectedExistingFile: true, files: [retired.metadata, cloud.get("survivor")!.metadata]
    });
    expect(result.metadata.id).toBe("survivor");
    expect(transport.createSharedSyncFile).not.toHaveBeenCalled();
  });

  it("rediscovers a canonical created by another migrator after every previously listed ID disappears", async () => {
    const data = baseline();
    const old = snapshot("old-per-device", data);
    put(old);
    transport.downloadConditionalSyncFile.mockImplementationOnce(async () => {
      cloud.delete(old.metadata.id);
      put(snapshot("new-shared", data, { shared: true }));
      return undefined;
    });
    const result = await synchronizeSharedGoogleDrive(data, { ...OPTIONS, files: [old.metadata], expectedExistingFile: true });
    expect(result.metadata.id).toBe("new-shared");
    expect(result.cloudWasEmpty).toBe(false);
    expect(transport.createSharedSyncFile).not.toHaveBeenCalled();
  });

  it("verifies the strong ETag when Drive omits version metadata instead of failing or claiming an unread revision", async () => {
    const data = baseline();
    const noVersion = snapshot("canonical", data, { shared: true });
    delete noVersion.metadata.version;
    delete noVersion.metadata.modifiedTime;
    put(noVersion);
    const result = await synchronizeSharedGoogleDrive(data, OPTIONS);
    expect(result.metadata.id).toBe("canonical");
    expect(result.metadata.version).toBeUndefined();
    expect(result.uploaded).toBe(false);
    expect(transport.downloadConditionalSyncFile).toHaveBeenCalledTimes(2);
    expect(transport.updateConditionalSyncFile).not.toHaveBeenCalled();
  });

  it("leaves persistent contention retryable without ever falling back to an unconditional write", async () => {
    const base = baseline();
    const local = edit(base, "device-local", (next) => { next.settings.notes.text = "still local"; });
    put(snapshot("canonical", base, { shared: true }));
    transport.updateConditionalSyncFile.mockImplementation(async () => { throw conflict(); });
    await expect(synchronizeSharedGoogleDrive(local, OPTIONS)).rejects.toMatchObject({ status: 412, reason: "shared_sync_contention" });
    expect(transport.updateConditionalSyncFile).toHaveBeenCalledTimes(8);
    expect(transport.createSharedSyncFile).not.toHaveBeenCalled();
    expect(transport.deleteConditionalSyncFile).not.toHaveBeenCalled();
    expect(local.settings.notes.text).toBe("still local");
    expect(sameSyncReplica(cloud.get("canonical")!.data, base)).toBe(true);
  });

  it("checks connection authority immediately before mutating the cloud", async () => {
    const data = baseline();
    const assertActive = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Connection changed"));
    await expect(synchronizeSharedGoogleDrive(data, { ...OPTIONS, assertActive })).rejects.toThrow("Connection changed");
    expect(transport.createSharedSyncFile).not.toHaveBeenCalled();
    expect(transport.updateConditionalSyncFile).not.toHaveBeenCalled();
    expect(transport.deleteConditionalSyncFile).not.toHaveBeenCalled();
  });
});
