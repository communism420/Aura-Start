import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEY } from "../constants";
import { t } from "../i18n";
import type { AuraStartData } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { applyExplicitSettingsPatch } from "../utils/settingsPatch";
import { commitLocalSyncChanges } from "../utils/syncReplica";
import { GOOGLE_DRIVE_POLL_CACHE_KEY } from "./googleDrivePollCache";
import type { GoogleDriveFileMetadata, GoogleDriveSyncPayload } from "./googleDriveSync";

const auth = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./googleDriveSync", async (original) => ({
  ...await original<typeof import("./googleDriveSync")>(), getAuthToken: auth.get
}));

type CloudFile = { metadata: GoogleDriveFileMetadata; payload: GoogleDriveSyncPayload; etag?: string };
let stored: Record<string, unknown>;
let cloud: Map<string, CloudFile>;
let storage: typeof import("../utils/storage");
let sync: typeof import("./googleDriveBackgroundSync");
let lists: number;
let downloads: number;
let uploads: number;
let mainWrites: number;
let cacheWrites: number;
let failMedia: boolean;
let failUpload: boolean;
let rejectCacheWrite: boolean;
let rejectMainWrite: boolean;
let beforeList: (() => void) | undefined;
let beforeMedia: (() => void) | undefined;
let beforeUpload: (() => void) | undefined;
let afterUpload: (() => void) | undefined;
let uploadMethods: string[];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function current(): AuraStartData { return structuredClone(stored[STORAGE_KEY]) as AuraStartData; }

function conditionalMetadata(file: CloudFile): Record<string, unknown> {
  const { metadata } = file;
  return { id: metadata.id, title: metadata.name, etag: file.etag ?? `"${metadata.id}-${metadata.version ?? metadata.modifiedTime ?? 'unchanged'}"`,
    createdDate: metadata.createdTime, modifiedDate: metadata.modifiedTime, version: metadata.version, fileSize: metadata.size,
    properties: Object.entries(metadata.appProperties ?? {}).map(([key, value]) => ({ key, value, visibility: "PRIVATE" })) };
}

function publish(data: AuraStartData, id: string, owner: string, shared = true): void {
  const raw = structuredClone(data);
  raw.settings.sync = { ...DEFAULT_SETTINGS.sync, deviceId: owner,
    deleteCloudFileOnDisconnect: data.settings.sync.deleteCloudFileOnDisconnect };
  raw.restorePoints = [];
  const payload: GoogleDriveSyncPayload = { schemaVersion: 1, app: "Aura Start", appVersion: "2.1.0",
    updatedAt: raw.updatedAt, deviceId: owner, data: raw };
  const version = String(Number(cloud.get(id)?.metadata.version ?? "0") + 1);
  cloud.set(id, { payload, metadata: { id, name: "aura-start-sync.json", version,
    createdTime: cloud.get(id)?.metadata.createdTime ?? "2026-09-12T10:00:00.000Z",
    modifiedTime: "2026-09-12T10:00:00.000Z", size: String(JSON.stringify(payload).length),
    appProperties: { auraStartSync: "true", ...(shared ? { auraStartSharedSync: "1" } : { auraStartDeviceId: owner }) } } });
}

function remoteNote(note: string, fileId = current().settings.sync.cloudFileId ?? "remote-file", shared = true): void {
  const previous = cloud.get(fileId)?.payload.data ?? current();
  const remote = structuredClone(previous);
  remote.settings.sync.deviceId = "remote-device";
  const next = { ...remote, ...applyExplicitSettingsPatch(remote, { notes: { text: note } }) };
  publish(commitLocalSyncChanges(remote, next), fileId, "remote-device", shared);
}

async function prime(): Promise<void> {
  expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "uploaded" });
  expect(stored[GOOGLE_DRIVE_POLL_CACHE_KEY]).toBeDefined();
}

async function quietPoll(): Promise<void> {
  expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "in_sync", quiet: true });
}

beforeEach(async () => {
  vi.resetModules();
  auth.get.mockReset().mockResolvedValue("polling-test-token");
  cloud = new Map();
  lists = downloads = uploads = mainWrites = cacheWrites = 0;
  failMedia = failUpload = rejectCacheWrite = rejectMainWrite = false;
  beforeList = beforeMedia = beforeUpload = afterUpload = undefined;
  uploadMethods = [];
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  const data = createEmptyData();
  data.settings.sync = { ...data.settings.sync, deviceId: "local-device", connectionId: "connection-one",
    connected: true, mode: "auto" };
  stored = { [STORAGE_KEY]: data };
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { runtime: { getManifest: () => ({ version: "2.1.0" }) }, storage: { local: {
    get: async (key: string) => Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {},
    set: async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, STORAGE_KEY)) {
        if (rejectMainWrite) throw new Error("Local storage unavailable");
        mainWrites++;
      }
      if (Object.hasOwn(items, GOOGLE_DRIVE_POLL_CACHE_KEY)) {
        if (rejectCacheWrite) throw new Error("Cache storage unavailable");
        cacheWrites++;
      }
      Object.assign(stored, structuredClone(items));
    },
    remove: async (key: string) => { delete stored[key]; }
  } } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://www.googleapis.com");
    if (url.pathname === "/drive/v3/files") {
      lists++;
      expect(url.searchParams.get("fields")).toContain("version");
      beforeList?.();
      return json({ files: url.searchParams.get("spaces") === "appDataFolder" ? []
        : [...cloud.values()].map((file) => file.metadata).reverse() });
    }
    if (url.pathname.startsWith("/drive/v3/files/") && url.searchParams.get("alt") === "media") {
      downloads++;
      beforeMedia?.();
      if (failMedia) return json({ error: { message: "Temporary media failure" } }, 503);
      const file = cloud.get(url.pathname.split("/").at(-1)!);
      return file ? json(file.payload) : json({}, 404);
    }
    if (url.pathname.startsWith("/drive/v2/files/")) {
      const file = cloud.get(url.pathname.split("/").at(-1)!);
      if (!file) return json({}, 404);
      if (init.method === "DELETE") {
        expect(new Headers(init.headers).get("If-Match")).toBe(conditionalMetadata(file).etag);
        cloud.delete(file.metadata.id);
        return new Response(null, { status: 204 });
      }
      return json(conditionalMetadata(file));
    }
    if ((url.pathname === "/upload/drive/v3/files" && init.method === "POST")
      || (url.pathname.startsWith("/upload/drive/v2/files/") && init.method === "PUT")) {
      uploadMethods.push(init.method!);
      beforeUpload?.();
      if (failUpload) return json({ error: { message: "Temporary upload failure" } }, 503);
      const id = init.method === "POST" ? `shared-${uploads + 1}` : url.pathname.split("/").at(-1)!;
      if (init.method === "PUT") {
        const previous = cloud.get(id);
        if (!previous) return json({}, 404);
        const expected = new Headers(init.headers).get("If-Match");
        expect(expected).toBeTruthy();
        if (expected !== conditionalMetadata(previous).etag) return json({}, 412);
      }
      const boundary = new Headers(init.headers).get("Content-Type")!.split("boundary=")[1];
      const [metadata, payload] = String(init.body).split(`--${boundary}`).slice(1, -1)
        .map((part) => JSON.parse(part.slice(part.indexOf("\r\n\r\n") + 4).trim())) as [GoogleDriveFileMetadata & {
          properties?: { key: string; value: string | null; visibility: string }[]
        }, GoogleDriveSyncPayload];
      const properties = metadata.properties
        ? Object.fromEntries(metadata.properties.filter((property) => property.value !== null).map(({ key, value }) => [key, value!]))
        : metadata.appProperties;
      expect(properties).toMatchObject({ auraStartSharedSync: "1" });
      expect(properties).not.toHaveProperty("auraStartDeviceId");
      uploads++;
      publish(payload.data, id, payload.deviceId);
      const responseMetadata = structuredClone(init.method === "PUT" ? conditionalMetadata(cloud.get(id)!) : cloud.get(id)!.metadata);
      afterUpload?.();
      return json(responseMetadata);
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  }));
  storage = await import("../utils/storage");
  sync = await import("./googleDriveBackgroundSync");
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("metadata-only Google Drive polling", () => {
  it("performs no network work for a clean local-change request", async () => {
    const clean = current();
    clean.settings.sync.lastSyncedLocalUpdatedAt = clean.updatedAt;
    stored[STORAGE_KEY] = clean;
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "skipped", reason: "not_dirty" });
    expect(auth.get).not.toHaveBeenCalled();
    expect(lists + downloads + uploads + mainWrites + cacheWrites).toBe(0);
  });

  it("checks metadata silently without media, writes or timestamp changes when the shared file is unchanged", async () => {
    await prime();
    const before = structuredClone(stored);
    const counts = { downloads, uploads, mainWrites, cacheWrites, lists };
    for (let pass = 0; pass < 3; pass++) await quietPoll();
    expect(lists).toBeGreaterThan(counts.lists);
    expect({ downloads, uploads, mainWrites, cacheWrites }).toEqual({ downloads: counts.downloads, uploads: counts.uploads,
      mainWrites: counts.mainWrites, cacheWrites: counts.cacheWrites });
    expect(stored).toEqual(before);
  });

  it("keeps the metadata cursor across a service worker module restart", async () => {
    await prime();
    const before = { downloads, uploads, mainWrites, cacheWrites };
    vi.resetModules();
    sync = await import("./googleDriveBackgroundSync");
    await quietPoll();
    expect({ downloads, uploads, mainWrites, cacheWrites }).toEqual(before);
  });

  it("does not rewrite main data or lastSyncedAt even if the first check needs to establish a cursor", async () => {
    await prime();
    delete stored[GOOGLE_DRIVE_POLL_CACHE_KEY];
    const before = current();
    const writes = mainWrites;
    const media = downloads;
    await quietPoll();
    expect(downloads).toBeGreaterThan(media);
    expect(mainWrites).toBe(writes);
    expect(current()).toEqual(before);
    expect(stored[GOOGLE_DRIVE_POLL_CACHE_KEY]).toBeDefined();
  });

  it("caches a clean legacy installation without rewriting its older lastSyncedAt-only acknowledgement", async () => {
    await prime();
    const legacy = current();
    delete legacy.settings.sync.lastSyncedLocalUpdatedAt;
    legacy.settings.sync.lastSyncedAt = new Date(new Date(legacy.updatedAt).getTime() + 1000).toISOString();
    stored[STORAGE_KEY] = legacy;
    delete stored[GOOGLE_DRIVE_POLL_CACHE_KEY];
    expect(sync.hasPendingGoogleDriveLocalChanges(legacy)).toBe(false);
    const writes = mainWrites;
    await quietPoll();
    const media = downloads;
    const privateWrites = cacheWrites;
    await quietPoll();
    expect(downloads).toBe(media);
    expect(cacheWrites).toBe(privateWrites);
    expect(mainWrites).toBe(writes);
    expect(current()).toEqual(legacy);
    expect(current().settings.sync.lastSyncedLocalUpdatedAt).toBeUndefined();
  });

  it("delivers same-size shared-file revisions even when modifiedTime stays unchanged", async () => {
    await prime();
    remoteNote("First remote note");
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "downloaded" });
    expect(current().settings.notes.text).toBe("First remote note");
    const sharedId = current().settings.sync.cloudFileId!;
    const metadata = structuredClone(cloud.get(sharedId)!.metadata);
    remoteNote("Other remote note");
    cloud.get(sharedId)!.metadata.size = metadata.size;
    expect(cloud.get(sharedId)!.metadata.modifiedTime).toBe(metadata.modifiedTime);
    expect(cloud.get(sharedId)!.metadata.version).not.toBe(metadata.version);
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "downloaded" });
    expect(current().settings.notes.text).toBe("Other remote note");
    const before = { downloads, uploads, mainWrites };
    await quietPoll();
    expect({ downloads, uploads, mainWrites }).toEqual(before);
  });

  it("updates only the private cursor when Drive metadata changes but shared content does not", async () => {
    await prime();
    const own = [...cloud.values()][0];
    own.metadata.version = "999999999999999999999999";
    const before = current();
    const writes = mainWrites;
    const uploaded = uploads;
    const media = downloads;
    await quietPoll();
    expect(downloads).toBeGreaterThan(media);
    expect(mainWrites).toBe(writes);
    expect(uploads).toBe(uploaded);
    expect(current()).toEqual(before);
    const read = downloads;
    await quietPoll();
    expect(downloads).toBe(read);
  });

  it("uploads a real local edit even when remote metadata matches the cursor", async () => {
    await prime();
    const base = current();
    await storage.saveAuraData({ ...base, ...applyExplicitSettingsPatch(base, { notes: { text: "Local edit" }, timer: { volume: 0 } }) }, { baseline: base });
    const uploaded = uploads;
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "uploaded" });
    expect(uploads).toBe(uploaded + 1);
    expect([...cloud.values()][0].payload.data.settings).toMatchObject({ notes: { text: "Local edit" }, timer: { volume: 0 } });
    await quietPoll();
    expect(uploads).toBe(uploaded + 1);
  });

  it("invalidates the cursor for a new local connection even when the Drive listing is identical", async () => {
    await prime();
    const data = current();
    data.settings.sync.connectionId = "connection-two";
    stored[STORAGE_KEY] = data;
    const media = downloads;
    await quietPoll();
    expect(downloads).toBeGreaterThan(media);
    const read = downloads;
    await quietPoll();
    expect(downloads).toBe(read);
  });

  it("consolidates a newly discovered legacy file and remains quiet after its retirement", async () => {
    await prime();
    const sharedId = current().settings.sync.cloudFileId!;
    remoteNote("Survives file removal", "remote-file", false);
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "downloaded" });
    expect(cloud.has("remote-file")).toBe(false);
    expect([...cloud.keys()]).toEqual([sharedId]);
    expect(cloud.get(sharedId)!.payload.data.settings.notes.text).toBe("Survives file removal");
    const uploaded = uploads;
    await quietPoll();
    expect(uploads).toBe(uploaded);
    expect(current().settings.notes.text).toBe("Survives file removal");
  });

  it("pauses after a remote wipe while preserving all local data and acknowledgements", async () => {
    await prime();
    remoteNote("Keep this local copy");
    await sync.runGoogleDriveBackgroundSync(true);
    const before = current();
    const transferred = { downloads, uploads };
    cloud.clear();
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "needs_reconnect",
      message: t(before.settings.language, "googleDriveCloudDataDeleted") });
    expect({ downloads, uploads }).toEqual(transferred);
    expect(cloud.size).toBe(0);
    expect(current()).toEqual({ ...before, settings: { ...before.settings,
      sync: { ...before.settings.sync, mode: "off", reconnectRequired: true } } });
    const checked = lists;
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(lists).toBe(checked);
    expect({ downloads, uploads }).toEqual(transferred);
  });

  it.each(["lastSyncedLocalUpdatedAt", "lastSyncedAt", "cloudFileId"] as const)(
    "recognizes an empty cloud from the previous %s acknowledgement", async (key) => {
      const acknowledged = current();
      acknowledged.settings.language = "ru";
      acknowledged.settings.sync[key] = key === "cloudFileId" ? "legacy-shared-file" : acknowledged.updatedAt;
      stored[STORAGE_KEY] = acknowledged;
      expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "needs_reconnect",
        message: t("ru", "googleDriveCloudDataDeleted") });
      expect(downloads + uploads).toBe(0);
      expect(current().settings.sync).toMatchObject({ mode: "off", reconnectRequired: true });
    }
  );

  it("does not resurrect a remote wipe from pending local edits", async () => {
    await prime();
    const base = current();
    await storage.saveAuraData({ ...base, ...applyExplicitSettingsPatch(base, { notes: { text: "Unsynced local note" } }) }, { baseline: base });
    const before = current();
    const transferred = { downloads, uploads };
    cloud.clear();
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "needs_reconnect" });
    expect({ downloads, uploads }).toEqual(transferred);
    expect(current().settings.notes.text).toBe("Unsynced local note");
    expect(current().updatedAt).toBe(before.updatedAt);
    expect(sync.hasPendingGoogleDriveLocalChanges(current())).toBe(true);
  });

  it("permits the first upload of a new connection without a previous cloud acknowledgement", async () => {
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "uploaded", reason: "created" });
    expect(uploads).toBe(1);
    expect(current().settings.sync).toMatchObject({ mode: "auto", connected: true, reconnectRequired: false });
  });

  it.each([false, true])("distinguishes an existing identical cloud copy from an empty Drive (legacy ownerless: %s)", async (legacy) => {
    publish(current(), "existing-file", "previous-installation", false);
    if (legacy) delete cloud.get("existing-file")!.metadata.appProperties!.auraStartDeviceId;
    const original = structuredClone(cloud.get("existing-file")!);
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "uploaded", reason: "updated" });
    expect(uploads).toBe(1);
    expect(cloud.size).toBe(1);
    expect(cloud.has("existing-file")).toBe(false);
    expect([...cloud.values()][0].payload.data.settings.notes).toEqual(original.payload.data.settings.notes);
    expect([...cloud.values()][0].metadata.appProperties).toMatchObject({ auraStartSharedSync: "1" });
    expect([...cloud.values()][0].metadata.appProperties).not.toHaveProperty("auraStartDeviceId");
    expect(current().settings.sync.cloudFileId).not.toBe("existing-file");
    await quietPoll();
    expect(uploads).toBe(1);
  });

  it("rebinds a legacy foreign cloudFileId to the surviving shared file without creating another copy", async () => {
    remoteNote("Existing legacy account");
    const legacy = current();
    legacy.settings.sync.cloudFileId = "remote-file";
    legacy.settings.sync.lastSyncedAt = legacy.updatedAt;
    stored[STORAGE_KEY] = legacy;
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "downloaded" });
    expect(uploads).toBe(0);
    expect(current().settings.notes.text).toBe("Existing legacy account");
    expect(current().settings.sync).toMatchObject({ mode: "auto", reconnectRequired: false });
    expect(cloud.has("remote-file")).toBe(true);
    expect(cloud.size).toBe(1);
    expect(current().settings.sync.cloudFileId).toBe("remote-file");
  });

  it("ignores an empty listing from a connection that was replaced while the request was in flight", async () => {
    await prime();
    cloud.clear();
    beforeList = () => {
      beforeList = undefined;
      const reconnected = current();
      reconnected.settings.sync.connectionId = "connection-two";
      stored[STORAGE_KEY] = reconnected;
    };
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(current().settings.sync).toMatchObject({ mode: "auto", connectionId: "connection-two", reconnectRequired: false });
  });

  it("pauses if the confirmed shared file disappears before the media download", async () => {
    await prime();
    delete stored[GOOGLE_DRIVE_POLL_CACHE_KEY];
    const before = current();
    const uploaded = uploads;
    beforeMedia = () => { beforeMedia = undefined; cloud.clear(); };
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "needs_reconnect" });
    expect(uploads).toBe(uploaded);
    expect(current().settings.notes).toEqual(before.settings.notes);
    expect(current().settings.sync).toMatchObject({ mode: "off", reconnectRequired: true });
  });

  it("pauses if a remote wipe occurs after downloading but before its conditional upload", async () => {
    await prime();
    const base = current();
    await storage.saveAuraData({ ...base, ...applyExplicitSettingsPatch(base, { notes: { text: "Pending upload" } }) }, { baseline: base });
    const uploaded = uploads;
    beforeMedia = () => {
      beforeMedia = undefined;
      beforeUpload = () => { beforeUpload = undefined; cloud.clear(); };
    };
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "needs_reconnect" });
    expect(uploads).toBe(uploaded);
    expect(cloud.size).toBe(0);
    expect(current().settings.notes.text).toBe("Pending upload");
    expect(current().settings.sync).toMatchObject({ mode: "off", reconnectRequired: true });
  });

  it("pauses after an in-flight conditional PUT 404 without falling back to a new file", async () => {
    await prime();
    const base = current();
    await storage.saveAuraData({ ...base, ...applyExplicitSettingsPatch(base, { notes: { text: "Do not recreate" } }) }, { baseline: base });
    uploadMethods = [];
    beforeUpload = () => { beforeUpload = undefined; cloud.clear(); };
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "needs_reconnect" });
    expect(uploadMethods).toEqual(["PUT"]);
    expect(cloud.size).toBe(0);
    expect(current().settings.notes.text).toBe("Do not recreate");
    expect(current().settings.sync).toMatchObject({ mode: "off", reconnectRequired: true });
  });

  it("reports failed pause persistence after conditional PUT 404 and still never recreates the file", async () => {
    await prime();
    const base = current();
    await storage.saveAuraData({ ...base, ...applyExplicitSettingsPatch(base, { notes: { text: "Keep despite storage failure" } }) }, { baseline: base });
    const before = current();
    uploadMethods = [];
    beforeUpload = () => { beforeUpload = undefined; cloud.clear(); rejectMainWrite = true; };
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "failed", quiet: true });
    expect(uploadMethods).toEqual(["PUT"]);
    expect(current()).toEqual(before);
    expect(cloud.size).toBe(0);
    rejectMainWrite = false;
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "needs_reconnect" });
    expect(uploadMethods).toEqual(["PUT"]);
    expect(cloud.size).toBe(0);
  });

  it("does not advance the cursor after failed downloads and retries the unseen change", async () => {
    await prime();
    const cached = structuredClone(stored[GOOGLE_DRIVE_POLL_CACHE_KEY]);
    remoteNote("Retry this revision");
    failMedia = true;
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "failed" });
    expect(stored[GOOGLE_DRIVE_POLL_CACHE_KEY]).toEqual(cached);
    failMedia = false;
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "downloaded" });
    expect(current().settings.notes.text).toBe("Retry this revision");
  });

  it("silently recovers a stale reconnect flag using the existing grant without uploading unchanged data", async () => {
    await prime();
    const before = current();
    const writes = uploads;
    stored[STORAGE_KEY] = { ...before, settings: { ...before.settings,
      sync: { ...before.settings.sync, reconnectRequired: true } } };
    await quietPoll();
    expect(auth.get.mock.calls.every(([interactive]) => interactive === false)).toBe(true);
    expect(current().settings.sync.reconnectRequired).toBe(false);
    expect(current().settings.sync.connectionId).toBe(before.settings.sync.connectionId);
    expect(current().groups).toEqual(before.groups);
    expect(uploads).toBe(writes);
  });

  it("keeps revoked authorization paused quietly and recovers only after silent authorization becomes available", async () => {
    await prime();
    const { GoogleDriveSyncError } = await import("./googleDriveSync");
    auth.get.mockRejectedValue(new GoogleDriveSyncError("unauthorized", "Revoked", 400, "invalid_grant"));
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "needs_reconnect" });
    const before = current();
    const writes = mainWrites;
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "needs_reconnect", quiet: true });
    expect(mainWrites).toBe(writes);
    expect(current()).toEqual(before);
    auth.get.mockResolvedValue("restored-browser-session");
    await quietPoll();
    expect(current().settings.sync.reconnectRequired).toBe(false);
    expect(auth.get.mock.calls.every(([interactive]) => interactive === false)).toBe(true);
  });

  it.each(["manual", "remote_wipe"])("never recovers an explicitly paused connection: %s", async () => {
    await prime();
    const before = current();
    stored[STORAGE_KEY] = { ...before, settings: { ...before.settings,
      sync: { ...before.settings.sync, mode: "off", reconnectRequired: true } } };
    auth.get.mockClear();
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(auth.get).not.toHaveBeenCalled();
    expect(current().settings.sync.mode).toBe("off");
  });

  it("rejects silent recovery if the user disconnects while authorization is pending", async () => {
    await prime();
    const before = current();
    stored[STORAGE_KEY] = { ...before, settings: { ...before.settings,
      sync: { ...before.settings.sync, reconnectRequired: true } } };
    auth.get.mockImplementation(async () => {
      const latest = current();
      stored[STORAGE_KEY] = { ...latest, settings: { ...latest.settings,
        sync: { ...latest.settings.sync, connected: false, mode: "off", connectionId: "explicit-disconnect" } } };
      return "late-token";
    });
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(current().settings.sync).toMatchObject({ connected: false, mode: "off", connectionId: "explicit-disconnect" });
  });

  it("does not mark uploaded state as observed when the upload fails", async () => {
    await prime();
    const cached = structuredClone(stored[GOOGLE_DRIVE_POLL_CACHE_KEY]);
    const base = current();
    await storage.saveAuraData({ ...base, ...applyExplicitSettingsPatch(base, { notes: { text: "Retry local upload" } }) }, { baseline: base });
    failUpload = true;
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "failed" });
    expect(stored[GOOGLE_DRIVE_POLL_CACHE_KEY]).toEqual(cached);
    failUpload = false;
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "uploaded" });
  });

  it("does not swallow a remote change arriving during our upload", async () => {
    await prime();
    remoteNote("First revision");
    const base = current();
    await storage.saveAuraData({ ...base, ...applyExplicitSettingsPatch(base, { timer: { volume: 0 } }) }, { baseline: base });
    afterUpload = () => { afterUpload = undefined; remoteNote("Arrived during upload"); };
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "downloaded" });
    expect(current().settings.notes.text).toBe("Arrived during upload");
    expect(current().settings.timer.volume).toBe(0);
    expect([...cloud.values()][0].payload.data.settings).toMatchObject({ notes: { text: "Arrived during upload" }, timer: { volume: 0 } });
    await quietPoll();
    expect(current().settings.notes.text).toBe("Arrived during upload");
  });

  it("re-reads and merges a competing write after conditional PUT returns 412", async () => {
    await prime();
    const base = current();
    await storage.saveAuraData({ ...base, ...applyExplicitSettingsPatch(base, { timer: { volume: 0 } }) }, { baseline: base });
    uploadMethods = [];
    beforeUpload = () => { beforeUpload = undefined; remoteNote("Concurrent remote note"); };
    expect(await sync.runGoogleDriveBackgroundSync(false)).toMatchObject({ status: "downloaded" });
    expect(uploadMethods).toEqual(["PUT", "PUT"]);
    expect(cloud.size).toBe(1);
    expect(current().settings).toMatchObject({ notes: { text: "Concurrent remote note" }, timer: { volume: 0 } });
    expect([...cloud.values()][0].payload.data.settings).toMatchObject({ notes: { text: "Concurrent remote note" }, timer: { volume: 0 } });
    await quietPoll();
  });

  it("falls back to checking content when revision metadata is unavailable", async () => {
    await prime();
    const own = [...cloud.values()][0];
    delete own.metadata.version;
    delete own.metadata.modifiedTime;
    const before = current();
    const writes = mainWrites;
    const media = downloads;
    await quietPoll();
    await quietPoll();
    expect(downloads).toBeGreaterThanOrEqual(media + 2);
    expect(mainWrites).toBe(writes);
    expect(current()).toEqual(before);
  });

  it.each([undefined, "", "not-a-version"])("silently checks content on every poll if Drive returns an unusable version: %s", async (version) => {
    await prime();
    const own = [...cloud.values()][0];
    own.metadata.version = version;
    const before = current();
    const writes = { mainWrites, cacheWrites, uploads };
    const media = downloads;
    await quietPoll();
    expect(downloads).toBeGreaterThan(media);
    const nextMedia = downloads;
    await quietPoll();
    expect(downloads).toBeGreaterThan(nextMedia);
    expect({ mainWrites, cacheWrites, uploads }).toEqual(writes);
    expect(current()).toEqual(before);
  });

  it("receives a new ETag with unchanged size and timestamp when Drive omits version", async () => {
    await prime();
    remoteNote("First note");
    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "downloaded" });
    const id = current().settings.sync.cloudFileId!;
    const previous = cloud.get(id)!;
    delete previous.metadata.version;
    previous.etag = '"before-remote-edit"';
    await quietPoll();
    const media = downloads;
    const uploadCount = uploads;

    remoteNote("Other note");
    const changed = cloud.get(id)!;
    delete changed.metadata.version;
    changed.etag = '"after-remote-edit"';
    changed.metadata.modifiedTime = previous.metadata.modifiedTime;
    changed.metadata.size = previous.metadata.size;
    expect(changed.metadata).toEqual(previous.metadata);

    expect(await sync.runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "downloaded" });
    expect(downloads).toBeGreaterThan(media);
    expect(current().settings.notes.text).toBe("Other note");
    expect(uploads).toBe(uploadCount);
    expect(cloud.size).toBe(1);
    const acknowledged = current();
    const writes = mainWrites;
    await quietPoll();
    expect(current()).toEqual(acknowledged);
    expect(mainWrites).toBe(writes);
  });

  it("safely retries full checks when the optional private cursor cannot be written", async () => {
    await prime();
    delete stored[GOOGLE_DRIVE_POLL_CACHE_KEY];
    rejectCacheWrite = true;
    const before = current();
    const writes = mainWrites;
    const media = downloads;
    await quietPoll();
    await quietPoll();
    expect(downloads).toBeGreaterThanOrEqual(media + 2);
    expect(stored[GOOGLE_DRIVE_POLL_CACHE_KEY]).toBeUndefined();
    expect(mainWrites).toBe(writes);
    expect(current()).toEqual(before);
  });
});
