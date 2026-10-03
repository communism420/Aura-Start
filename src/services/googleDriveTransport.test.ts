import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DEFAULT_SETTINGS } from "../constants";
import type { AuraStartData } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { loadBackgroundImage, storeBackgroundImage } from "../utils/backgroundImageStorage";
import { loadTimerSound, storeTimerSound, type TimerSoundAsset } from "../utils/timerSoundStorage";
import { commitLocalSyncChanges, ensureSyncReplica, mergeSyncData } from "../utils/syncReplica";
import { validateAuraData } from "../utils/importJson";
import { applyExplicitSettingsPatch } from "../utils/settingsPatch";
import type { GoogleDriveFileMetadata, GoogleDriveSyncPayload } from "./googleDriveSync";

const ISO = "2026-09-12T10:00:00.000Z";
const FILE_NAME = "aura-start-sync.json";
type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
let route: Route;
let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
let drive: typeof import("./googleDriveSync");
let identity: {
  getAuthToken: ReturnType<typeof vi.fn>;
  removeCachedAuthToken: ReturnType<typeof vi.fn>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function owned(id: string, deviceId = id): GoogleDriveFileMetadata {
  return { id, name: FILE_NAME, appProperties: { auraStartSync: "true", auraStartDeviceId: deviceId } };
}

function fixture(deviceId = "my-device", groupId = "group-one"): AuraStartData {
  const data = structuredClone(createEmptyData());
  data.updatedAt = ISO;
  data.settings.sync = { ...data.settings.sync, deviceId, mode: "auto", connected: true };
  data.groups = [{ id: groupId, title: groupId, parentId: null, collapsed: false, order: 0, links: [] }];
  return data;
}

function payload(data: AuraStartData): GoogleDriveSyncPayload {
  return { schemaVersion: 1, app: "Aura Start", appVersion: "2.1.0", updatedAt: ISO, deviceId: data.settings.sync.deviceId, data };
}

function requestCalls() {
  return fetchMock.mock.calls.map(([input, init = {}]) => ({ url: new URL(String(input)), init }));
}

function writes() {
  return requestCalls().filter(({ init }) => ["POST", "PUT", "PATCH", "DELETE"].includes(init.method ?? "GET"));
}

function conditionalMetadata(file: GoogleDriveFileMetadata) {
  return {
    id: file.id, title: file.name, etag: '"transport-test-etag"', version: file.version ?? "1",
    properties: [{ key: "auraStartSync", value: "true", visibility: "PRIVATE" },
      { key: "auraStartSharedSync", value: "1", visibility: "PRIVATE" }]
  };
}

// Media tests exercise the real serializers and bounded HTTP upload primitive;
// discovery/consolidation behavior is covered separately below and in the CAS suites.
async function uploadPayload(data: AuraStartData, options: { deviceId: string; fileId?: string; token: string }) {
  if (!options.fileId) return await drive.createSharedSyncFile(data, options.deviceId, options.token);
  return await drive.updateConditionalSyncFile(data, { ...options, snapshot: {
    metadata: owned(options.fileId), etag: '"transport-test-etag"', data, payload: payload(data), cloudUpdatedAt: ISO
  } });
}

function multipart(init: RequestInit): [Record<string, unknown>, GoogleDriveSyncPayload] {
  const boundary = new Headers(init.headers).get("Content-Type")?.split("boundary=")[1];
  if (!boundary) throw new Error("Upload missing multipart boundary");
  return String(init.body).split(`--${boundary}`).slice(1, -1).map((part) => {
    const body = part.slice(part.indexOf("\r\n\r\n") + 4).trim();
    return JSON.parse(body);
  }) as [Record<string, unknown>, GoogleDriveSyncPayload];
}

function listing(url: URL, normalFiles: GoogleDriveFileMetadata[], legacyFiles: GoogleDriveFileMetadata[] = []): Response | undefined {
  if (url.pathname !== "/drive/v3/files") return undefined;
  return json({ files: url.searchParams.get("spaces") === "appDataFolder" ? legacyFiles : normalFiles });
}

function simulateSharedCloud(entries: Array<{ metadata: GoogleDriveFileMetadata; payload: GoogleDriveSyncPayload }>) {
  const cloud = new Map(entries.map((entry) => [entry.metadata.id, {
    metadata: { ...entry.metadata, createdTime: ISO, version: "1" }, payload: structuredClone(entry.payload)
  }]));
  const v2Metadata = (entry: (typeof entries)[number]) => ({
    id: entry.metadata.id, title: entry.metadata.name, createdDate: entry.metadata.createdTime,
    version: entry.metadata.version, etag: `"${entry.metadata.id}-${entry.metadata.version}"`,
    properties: Object.entries(entry.metadata.appProperties ?? {}).map(([key, value]) => ({ key, value, visibility: "PRIVATE" }))
  });
  route = (url, init) => {
    if (init.method === "POST" && url.pathname === "/upload/drive/v3/files") {
      const [sentMetadata, sentPayload] = multipart(init);
      const created = {
        metadata: { id: "new-shared-file", name: String(sentMetadata.name), createdTime: ISO, version: "1",
          appProperties: sentMetadata.appProperties as Record<string, string> },
        payload: sentPayload
      };
      cloud.set(created.metadata.id, created);
      return json(created.metadata);
    }
    const listed = listing(url, [...cloud.values()].filter((entry) => !entry.metadata.legacyAppData).map((entry) => entry.metadata),
      [...cloud.values()].filter((entry) => entry.metadata.legacyAppData).map((entry) => entry.metadata));
    if (listed) return listed;
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    const entry = cloud.get(id);
    if (!entry) return json({ error: { message: "File disappeared" } }, 404);
    if (init.method === "PUT" || init.method === "DELETE") {
      expect(new Headers(init.headers).get("If-Match")).toBe(v2Metadata(entry).etag);
      if (init.method === "DELETE") { cloud.delete(id); return new Response(null, { status: 204 }); }
      expect(url.pathname).toBe(`/upload/drive/v2/files/${id}`);
      const [metadata, value] = multipart(init);
      entry.payload = value;
      entry.metadata.name = String(metadata.title);
      entry.metadata.version = String(Number(entry.metadata.version) + 1);
      const properties = { ...entry.metadata.appProperties };
      for (const property of metadata.properties as Array<{ key: string; value: string | null }>) {
        if (property.value === null) delete properties[property.key];
        else properties[property.key] = property.value;
      }
      entry.metadata.appProperties = properties;
      return json(v2Metadata(entry));
    }
    if (url.pathname.startsWith("/drive/v2/")) return json(v2Metadata(entry));
    expect(url.searchParams.get("alt")).toBe("media");
    return json(entry.payload);
  };
  return cloud;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const authValues: Record<string, unknown> = {};
  const authStorage = {
    get: (key: string, callback: (value: Record<string, unknown>) => void) => callback({ [key]: structuredClone(authValues[key]) }),
    set: (items: Record<string, unknown>, callback: () => void) => { Object.assign(authValues, structuredClone(items)); callback(); },
    remove: (key: string, callback: () => void) => { delete authValues[key]; callback(); }
  };
  identity = {
    getAuthToken: vi.fn((_options: unknown, callback: (token: string) => void) => callback("renewed-token")),
    removeCachedAuthToken: vi.fn((_options: unknown, callback: () => void) => callback())
  };
  vi.stubGlobal("browser", undefined);
  vi.stubGlobal("chrome", {
    identity,
    storage: { local: authStorage },
    runtime: {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getManifest: () => ({
        manifest_version: 3, name: "Aura Start tests", version: "2.1.0",
        update_url: "https://clients2.google.com/service/update2/crx",
        oauth2: {
          client_id: "71648271904-testchromeclient.apps.googleusercontent.com",
          scopes: ["https://www.googleapis.com/auth/drive.appdata", "https://www.googleapis.com/auth/drive.file"]
        }
      })
    }
  });
  vi.stubGlobal("navigator", {
    languages: ["en"], language: "en", vendor: "Google Inc.", userAgent: "Chrome/130.0.0.0",
    userAgentData: { brands: [{ brand: "Google Chrome", version: "130" }] }
  });
  route = (url) => { throw new Error(`Unexpected test request: ${url.pathname}`); };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => route(new URL(String(input)), init));
  vi.stubGlobal("fetch", fetchMock);
  drive = await import("./googleDriveSync");
});

describe("Google Drive custom background transport", () => {
  const firstImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
  const secondImage = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";

  async function imageData(image = firstImage, deviceId = "my-device"): Promise<AuraStartData> {
    const current = fixture(deviceId);
    const next = structuredClone(current);
    next.settings.background.customImageId = await storeBackgroundImage(image);
    next.settings.background.preset = "custom";
    return commitLocalSyncChanges(current, next);
  }

  function downloadRoute(sent: unknown): void {
    route = (url) => listing(url, [owned("remote", "other-device")]) ?? json(sent);
  }

  it("uploads the selected image once in JSON, including when a built-in background is active", async () => {
    const data = await imageData();
    const next = structuredClone(data);
    next.settings.background.preset = "forest";
    const hidden = commitLocalSyncChanges(data, next);
    route = (url) => listing(url, []) ?? json(owned("created", "my-device"));
    await uploadPayload(hidden, { deviceId: "my-device", token: "chrome-token" });
    const [, sent] = multipart(writes()[0].init);
    expect(sent.backgroundImage).toEqual({ id: hidden.settings.background.customImageId, dataUrl: firstImage });
    expect(sent.data.settings.background.preset).toBe("forest");
    expect(sent.data.syncReplica?.settings["background.customImageId"].value).toBe(hidden.settings.background.customImageId);
    expect(JSON.stringify(sent).split(firstImage)).toHaveLength(2);
  });

  it("refuses to overwrite a cloud backup when the referenced local image is missing", async () => {
    const data = await imageData();
    vi.stubGlobal("indexedDB", new IDBFactory());
    route = (url) => listing(url, [owned("current", "my-device")]) ?? json(owned("current", "my-device"));
    await expect(uploadPayload(data, { deviceId: "my-device", token: "chrome-token" })).rejects.toThrow("unavailable locally");
    expect(writes()).toHaveLength(0);
  });

  it("refuses to publish a reference that was changed without updating its causal history", async () => {
    const data = await imageData();
    data.settings.background.customImageId = await storeBackgroundImage(secondImage);
    route = (url) => listing(url, []) ?? json(owned("created"));
    await expect(uploadPayload(data, { deviceId: "my-device", token: "chrome-token" })).rejects.toThrow("sync history do not match");
    expect(writes()).toHaveLength(0);
  });

  it("stores and verifies downloaded image bytes before returning the shared data", async () => {
    const data = await imageData();
    const id = data.settings.background.customImageId!;
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await loadBackgroundImage(id)).toBeNull();
    downloadRoute({ ...payload(data), backgroundImage: { id, dataUrl: firstImage } });
    const [download] = await drive.downloadSyncFiles("chrome-token");
    expect(download.data.settings.background.customImageId).toBe(id);
    expect(await loadBackgroundImage(id)).toBe(firstImage);
    expect(download.payload.backgroundImage?.dataUrl).toBe(firstImage);
  });

  it.each([
    ["missing", undefined],
    ["wrong reference", { id: "b".repeat(64), dataUrl: firstImage }],
    ["wrong content hash", { dataUrl: secondImage }],
    ["remote URL", { dataUrl: "https://example.com/image.png" }],
    ["executable URL", { dataUrl: "javascript:alert(1)" }],
    ["non-image data", { dataUrl: "data:text/html,<script>alert(1)</script>" }],
    ["oversized", { dataUrl: `data:image/png;base64,${"A".repeat(2_500_000)}` }]
  ])("rejects %s image payloads without replacing a previously cached valid image", async (_name, asset) => {
    const data = await imageData();
    const id = data.settings.background.customImageId!;
    downloadRoute({ ...payload(data), ...(asset ? { backgroundImage: { id, ...asset } } : {}) });
    await expect(drive.downloadSyncFiles("chrome-token")).rejects.toMatchObject({ code: "invalid_cloud_file" });
    expect(await loadBackgroundImage(id)).toBe(firstImage);
    expect(writes()).toHaveLength(0);
  });

  it("rejects inconsistent reference metadata even if the supplied image itself is valid", async () => {
    const data = await imageData();
    const id = data.settings.background.customImageId!;
    data.syncReplica!.settings["background.customImageId"].value = null;
    downloadRoute({ ...payload(data), backgroundImage: { id, dataUrl: firstImage } });
    await expect(drive.downloadSyncFiles("chrome-token")).rejects.toThrow("sync history do not match");
  });

  it("does not cache an orphan image attached to a backup with no image reference", async () => {
    downloadRoute({ ...payload(fixture()), backgroundImage: { id: "a".repeat(64), dataUrl: firstImage } });
    await expect(drive.downloadSyncFiles("chrome-token")).rejects.toMatchObject({ code: "invalid_cloud_file" });
    expect(await loadBackgroundImage("a".repeat(64))).toBeNull();
  });

  it("accepts legacy backups and replicas that predate the image register", async () => {
    for (const withHistory of [false, true]) {
      const data = fixture();
      if (withHistory) {
        data.syncReplica = ensureSyncReplica(data);
        delete data.syncReplica.settings["background.customImageId"];
      }
      downloadRoute(payload(data));
      const [download] = await drive.downloadSyncFiles("chrome-token");
      expect(download.data.settings.background.customImageId).toBeUndefined();
      expect(download.payload.backgroundImage).toBeUndefined();
    }
  });

  it("sends an explicit image removal without stale image bytes", async () => {
    const image = await imageData();
    const next = structuredClone(image);
    next.settings.background.customImageId = null;
    const removed = commitLocalSyncChanges(image, next);
    route = (url) => listing(url, [owned("current", "my-device")]) ?? json(owned("current", "my-device"));
    await uploadPayload(removed, { deviceId: "my-device", token: "chrome-token" });
    const [, sent] = multipart(writes()[0].init);
    expect(sent.backgroundImage).toBeUndefined();
    expect(sent.data.settings.background.customImageId).toBeNull();
    expect(sent.data.syncReplica?.settings["background.customImageId"].value).toBeNull();
  });

  it("returns the winning image with a restore merged from multiple device replicas", async () => {
    const first = await imageData(firstImage, "device-a");
    const second = await imageData(secondImage, "device-b");
    const files = [owned("replica-a", "device-a"), owned("replica-b", "device-b")];
    route = (url) => {
      const listed = listing(url, files);
      if (listed) return listed;
      const data = url.pathname.endsWith("replica-a") ? first : second;
      return json({ ...payload(data), backgroundImage: { id: data.settings.background.customImageId, dataUrl: data === first ? firstImage : secondImage } });
    };
    const restored = await drive.restoreFromDrive("chrome-token");
    expect(restored?.data.settings.background.customImageId).toBe(second.settings.background.customImageId);
    expect(restored?.payload.backgroundImage).toEqual({ id: second.settings.background.customImageId, dataUrl: secondImage });
    expect(await loadBackgroundImage(restored?.data.settings.background.customImageId)).toBe(secondImage);
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("Google Drive timer sound transport", () => {
  function soundAsset(name = "My chime.wav", sample = 100): TimerSoundAsset {
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

  async function soundData(sound = soundAsset(), deviceId = "my-device"): Promise<AuraStartData> {
    const current = fixture(deviceId);
    const next = structuredClone(current);
    next.settings.timer.customSoundId = await storeTimerSound(sound);
    return commitLocalSyncChanges(current, next);
  }

  function downloadRoute(sent: unknown): void {
    route = (url) => listing(url, [owned("remote", "other-device")]) ?? json(sent);
  }

  it("uploads original audio and portable playback together while the timer is disabled", async () => {
    const sound = soundAsset();
    const data = await soundData(sound);
    expect(data.settings.widgets.timer).toBe(false);
    route = (url) => listing(url, []) ?? json(owned("created", "my-device"));
    await uploadPayload(data, { deviceId: "my-device", token: "chrome-token" });
    const [, sent] = multipart(writes()[0].init);
    expect(sent.timerSound).toEqual({ id: data.settings.timer.customSoundId, ...sound });
    expect(sent.data.syncReplica?.settings["timer.customSoundId"].value).toBe(data.settings.timer.customSoundId);
    expect(sent.data.settings.widgets.timer).toBe(false);
    expect(sent.data.restorePoints).toEqual([]);
  });

  it("refuses to overwrite Drive when locally referenced audio is missing", async () => {
    const data = await soundData();
    vi.stubGlobal("indexedDB", new IDBFactory());
    route = (url) => listing(url, [owned("current", "my-device")]) ?? json(owned("current"));
    await expect(uploadPayload(data, { deviceId: "my-device", token: "chrome-token" })).rejects.toThrow("unavailable locally");
    expect(writes()).toHaveLength(0);
  });

  it("rejects a sound reference changed outside its causal settings history", async () => {
    const data = await soundData();
    data.settings.timer.customSoundId = await storeTimerSound(soundAsset("Other.wav", 200));
    route = (url) => listing(url, []) ?? json(owned("created"));
    await expect(uploadPayload(data, { deviceId: "my-device", token: "chrome-token" })).rejects.toThrow("sync history do not match");
    expect(writes()).toHaveLength(0);
  });

  it("makes both audio representations durable before returning downloaded settings", async () => {
    const sound = soundAsset();
    const data = await soundData(sound);
    const id = data.settings.timer.customSoundId!;
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await loadTimerSound(id)).toBeNull();
    downloadRoute({ ...payload(data), timerSound: { id, ...sound } });
    const [download] = await drive.downloadSyncFiles("chrome-token");
    expect(download.data.settings.timer.customSoundId).toBe(id);
    expect(download.payload.timerSound).toEqual({ id, ...sound });
    expect(await loadTimerSound(id)).toEqual(sound);
  });

  it("does not expose downloaded sound references when durable asset storage fails", async () => {
    const sound = soundAsset();
    const data = await soundData(sound);
    const id = data.settings.timer.customSoundId!;
    downloadRoute({ ...payload(data), timerSound: { id, ...sound } });
    vi.stubGlobal("indexedDB", undefined);
    await expect(drive.downloadSyncFiles("chrome-token")).rejects.toMatchObject({ code: "invalid_cloud_file" });
    expect(writes()).toHaveLength(0);
  });

  it.each(["missing", "wrong reference", "changed original", "changed playback", "remote URL", "invalid audio", "invalid filename"])(
    "rejects %s audio without overwriting cached sound or uploading partial data", async (kind) => {
      const sound = soundAsset();
      const data = await soundData(sound);
      const id = data.settings.timer.customSoundId!;
      const asset: Record<string, unknown> = { id, ...sound };
      if (kind === "wrong reference") asset.id = "b".repeat(64);
      if (kind === "changed original") asset.dataUrl = soundAsset("Other.wav", 200).dataUrl;
      if (kind === "changed playback") asset.playbackDataUrl = soundAsset("Other.wav", 200).playbackDataUrl;
      if (kind === "remote URL") asset.dataUrl = "https://example.com/alarm.mp3";
      if (kind === "invalid audio") asset.playbackDataUrl = "data:audio/wav;base64,YQ==";
      if (kind === "invalid filename") asset.name = null;
      downloadRoute({ ...payload(data), ...(kind === "missing" ? {} : { timerSound: asset }) });
      await expect(drive.downloadSyncFiles("chrome-token")).rejects.toMatchObject({ code: "invalid_cloud_file" });
      expect(await loadTimerSound(id)).toEqual(sound);
      expect(writes()).toHaveLength(0);
    }
  );

  it("rejects valid audio attached to inconsistent reference history or no sound setting", async () => {
    const sound = soundAsset();
    const data = await soundData(sound);
    const id = data.settings.timer.customSoundId!;
    data.syncReplica!.settings["timer.customSoundId"].value = null;
    downloadRoute({ ...payload(data), timerSound: { id, ...sound } });
    await expect(drive.downloadSyncFiles("chrome-token")).rejects.toThrow("sync history do not match");
    downloadRoute({ ...payload(fixture()), timerSound: { id, ...sound } });
    await expect(drive.downloadSyncFiles("chrome-token")).rejects.toMatchObject({ code: "invalid_cloud_file" });
  });

  it("accepts older snapshots and partial replicas without replacing a selected sound with their default", async () => {
    const selected = await soundData();
    for (const withHistory of [false, true]) {
      const old = fixture("old-device");
      delete old.settingsCompatibility;
      if (withHistory) {
        old.syncReplica = ensureSyncReplica(old);
        for (const path of Object.keys(old.syncReplica.settings)) if (path.startsWith("timer.") || path === "widgets.timer") delete old.syncReplica.settings[path];
      }
      delete (old.settings as unknown as Record<string, unknown>).timer;
      delete (old.settings.widgets as unknown as Record<string, unknown>).timer;
      downloadRoute(payload(old));
      const [download] = await drive.downloadSyncFiles("chrome-token");
      expect(download.data.settings.timer.customSoundId).toBeNull();
      expect(download.data.syncReplica?.settings["timer.customSoundId"].stamp).toEqual({ counter: 0, deviceId: "settings-default" });
      expect(mergeSyncData(selected, download.data).settings.timer.customSoundId).toBe(selected.settings.timer.customSoundId);
      expect(download.payload.timerSound).toBeUndefined();
    }
  });

  it("sends explicit custom sound removal without sending obsolete bytes", async () => {
    const current = await soundData();
    const next = structuredClone(current);
    next.settings.timer.customSoundId = null;
    const removed = commitLocalSyncChanges(current, next);
    route = (url) => listing(url, []) ?? json(owned("created"));
    await uploadPayload(removed, { deviceId: "my-device", token: "chrome-token" });
    const [, sent] = multipart(writes()[0].init);
    expect(sent.timerSound).toBeUndefined();
    expect(sent.data.settings.timer.customSoundId).toBeNull();
    expect(sent.data.syncReplica?.settings["timer.customSoundId"].value).toBeNull();
  });

  it("keeps the deterministically winning audio in a restore merged across device files", async () => {
    const firstSound = soundAsset();
    const secondSound = soundAsset("Second.wav", 400);
    const first = await soundData(firstSound, "device-a");
    const second = await soundData(secondSound, "device-b");
    vi.stubGlobal("indexedDB", new IDBFactory());
    const files = [owned("replica-a", "device-a"), owned("replica-b", "device-b")];
    route = (url) => {
      const listed = listing(url, files);
      if (listed) return listed;
      const data = url.pathname.endsWith("replica-a") ? first : second;
      return json({ ...payload(data), timerSound: { id: data.settings.timer.customSoundId, ...(data === first ? firstSound : secondSound) } });
    };
    const restored = await drive.restoreFromDrive("chrome-token");
    expect(restored?.data.settings.timer.customSoundId).toBe(second.settings.timer.customSoundId);
    expect(restored?.payload.timerSound).toEqual({ id: second.settings.timer.customSoundId, ...secondSound });
    expect(await loadTimerSound(restored?.data.settings.timer.customSoundId)).toEqual(secondSound);
    expect(mergeSyncData(second, first).settings.timer.customSoundId).toBe(second.settings.timer.customSoundId);
  });

  async function largeSoundData(): Promise<AuraStartData> {
    const sound = { ...soundAsset("Large audio.flac"), dataUrl: `data:audio/flac;base64,${"AAAA".repeat(400_000)}` };
    return await soundData(sound);
  }

  it("uploads large audio as bounded resumable chunks and publishes the complete JSON only at the end", async () => {
    const data = await largeSoundData();
    const own = owned("my-replica", "my-device");
    const chunks: Blob[] = [];
    let expectedStart = 0;
    let finalPayload: GoogleDriveSyncPayload | undefined;
    route = async (url, init) => {
      const listed = listing(url, [own]);
      if (listed) return listed;
      if (init.method === "PUT" && !url.searchParams.has("upload_id")) {
        expect(url.pathname).toBe("/upload/drive/v2/files/my-replica");
        expect(url.searchParams.get("uploadType")).toBe("resumable");
        expect(JSON.parse(String(init.body))).toMatchObject({ properties: expect.arrayContaining([
          { key: "auraStartSharedSync", value: "1", visibility: "PRIVATE" }
        ]) });
        expect(new Headers(init.headers).get("If-Match")).toBe('"transport-test-etag"');
        expect(new Headers(init.headers).get("X-Upload-Content-Length")).toMatch(/^\d+$/);
        return new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=test-session` } });
      }
      expect(init.method).toBe("PUT");
      const match = new Headers(init.headers).get("Content-Range")!.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!;
      const [, start, end, total] = match.map(Number);
      expect(start).toBe(expectedStart);
      expect(init.body).toBeInstanceOf(Blob);
      expect((init.body as Blob).size).toBe(end - start + 1);
      expect((init.body as Blob).size).toBeLessThanOrEqual(256 * 1024);
      chunks.push(init.body as Blob);
      expectedStart = end + 1;
      if (expectedStart < total) return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      finalPayload = JSON.parse(await new Blob(chunks).text());
      return json(conditionalMetadata(own));
    };
    expect(await uploadPayload(data, { deviceId: "my-device", fileId: "my-replica", token: "chrome-token" })).toMatchObject({
      id: own.id, appProperties: { auraStartSharedSync: "1" }
    });
    expect(chunks.length).toBeGreaterThan(4);
    expect(finalPayload!.timerSound).toEqual({ id: data.settings.timer.customSoundId, ...await loadTimerSound(data.settings.timer.customSoundId) });
    expect(finalPayload!.data.restorePoints).toEqual([]);
  });

  it("queries the resumable position after a lost response rather than replaying already accepted audio bytes", async () => {
    const data = await largeSoundData();
    const own = owned("my-replica", "my-device");
    const starts: number[] = [];
    let lostResponse = false;
    let statusQueries = 0;
    route = (url, init) => {
      const listed = listing(url, [own]);
      if (listed) return listed;
      if (init.method === "PUT" && !url.searchParams.has("upload_id")) return new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=test-session` } });
      const range = new Headers(init.headers).get("Content-Range")!;
      if (range.startsWith("bytes */")) {
        statusQueries++;
        expect((init.body as Blob).size).toBe(0);
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${256 * 1024 - 1}` } });
      }
      const [, start, end, total] = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!.map(Number);
      starts.push(start);
      if (!lostResponse) { lostResponse = true; throw new Error("Response lost after Drive stored chunk"); }
      return end + 1 === total ? json(conditionalMetadata(own)) : new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
    };
    await uploadPayload(data, { deviceId: "my-device", fileId: "my-replica", token: "chrome-token" });
    expect(statusQueries).toBe(1);
    expect(starts.slice(0, 2)).toEqual([0, 256 * 1024]);
    expect(starts.filter((start) => start === 0)).toHaveLength(1);
  });

  it("uses Drive's acknowledged offset when only part of an audio chunk was accepted", async () => {
    const data = await largeSoundData();
    const starts: number[] = [];
    route = (url, init) => {
      const listed = listing(url, []);
      if (listed) return listed;
      if (init.method === "POST") return new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=test-session` } });
      const [, start, end, total] = new Headers(init.headers).get("Content-Range")!.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!.map(Number);
      starts.push(start);
      return start === 0 ? new Response(null, { status: 308, headers: { Range: "bytes=0-1023" } })
        : end + 1 === total ? json(owned("created")) : new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
    };
    await uploadPayload(data, { deviceId: "my-device", token: "chrome-token" });
    expect(starts.slice(0, 2)).toEqual([0, 1024]);
  });

  it.each(["https://outside.invalid/upload?uploadType=resumable&upload_id=x", "http://www.googleapis.com/upload/drive/v2/files/my-replica?uploadType=resumable&upload_id=x",
    "https://www.googleapis.com/upload/drive/v2/files/foreign-replica?uploadType=resumable&upload_id=x", "not-a-url"])(
    "never sends credentials or audio to an invalid resumable session URL: %s", async (location) => {
      const data = await largeSoundData();
      route = (url) => listing(url, [owned("my-replica", "my-device")]) ?? new Response(null, { status: 200, headers: { Location: location } });
      await expect(uploadPayload(data, { deviceId: "my-device", fileId: "my-replica", token: "chrome-token" })).rejects.toThrow(/invalid upload session/);
      expect(requestCalls().some(({ url }) => url.searchParams.has("upload_id"))).toBe(false);
    }
  );

  it.each(["bytes=0-999999999", "bytes=50-100", "invalid"])("rejects invalid resumable acknowledgment %s", async (range) => {
    const data = await largeSoundData();
    route = (url, init) => listing(url, [owned("my-replica", "my-device")])
      ?? (init.method === "PUT" && !url.searchParams.has("upload_id") ? new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=test-session` } })
        : new Response(null, { status: 308, headers: { Range: range } }));
    await expect(uploadPayload(data, { deviceId: "my-device", fileId: "my-replica", token: "chrome-token" })).rejects.toThrow(/invalid upload position/);
    expect(requestCalls().filter(({ url }) => url.searchParams.has("upload_id"))).toHaveLength(1);
  });

  it("does not create another replica when only its resumable session expires", async () => {
    const data = await largeSoundData();
    route = (url, init) => listing(url, [owned("my-replica", "my-device")])
      ?? (init.method === "PUT" && !url.searchParams.has("upload_id") ? new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=test-session` } })
        : json({ error: { message: "Upload session expired" } }, 404));
    await expect(uploadPayload(data, { deviceId: "my-device", fileId: "my-replica", token: "chrome-token" })).rejects.toMatchObject({ code: "network" });
    expect(requestCalls().some(({ init }) => init.method === "POST")).toBe(false);
    expect(await loadTimerSound(data.settings.timer.customSoundId)).not.toBeNull();
  });

  it("stops a stalled resumable session instead of looping or claiming a successful upload", async () => {
    const data = await largeSoundData();
    route = (url, init) => listing(url, [owned("my-replica", "my-device")])
      ?? (init.method === "PUT" && !url.searchParams.has("upload_id") ? new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=test-session` } })
        : new Response(null, { status: 308 }));
    await expect(uploadPayload(data, { deviceId: "my-device", fileId: "my-replica", token: "chrome-token" })).rejects.toThrow(/no upload progress/);
    expect(requestCalls().filter(({ url }) => url.searchParams.has("upload_id"))).toHaveLength(3);
  });

  it.each([10_000, 70_000])("bounds the whole resumable transfer while allowing multiple short requests (%i ms per simulated chunk)", async (elapsedPerChunk) => {
    const data = await largeSoundData();
    let now = Date.now();
    const initial = now;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const intervals = vi.spyOn(globalThis, "setInterval");
    const cleared = vi.spyOn(globalThis, "clearInterval");
    let completed = false;
    try {
      route = (url, init) => {
        const listed = listing(url, [owned("my-replica", "my-device")]);
        if (listed) return listed;
        if (init.method === "PUT" && !url.searchParams.has("upload_id")) return new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=test-session` } });
        const [, , end, total] = new Headers(init.headers).get("Content-Range")!.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!.map(Number);
        now += elapsedPerChunk;
        if (end + 1 === total) { completed = true; return json(conditionalMetadata(owned("my-replica", "my-device"))); }
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
      };
      const upload = uploadPayload(data, { deviceId: "my-device", fileId: "my-replica", token: "chrome-token" });
      if (elapsedPerChunk === 10_000) {
        await expect(upload).resolves.toMatchObject({ id: "my-replica" });
        expect(now - initial).toBeGreaterThan(25_000);
        expect(completed).toBe(true);
      } else {
        await expect(upload).rejects.toThrow(/took too long/);
        expect(completed).toBe(false);
      }
      expect(intervals).toHaveBeenCalledWith(expect.any(Function), 20_000);
      expect(cleared).toHaveBeenCalledWith(intervals.mock.results[0].value);
    } finally {
      clock.mockRestore(); intervals.mockRestore(); cleared.mockRestore();
    }
  });

  it("keeps short request limits for metadata/chunks and permits a longer complete media download", async () => {
    const sound = soundAsset();
    const data = await soundData(sound);
    const timeouts = new WeakMap<AbortSignal, number>();
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((duration) => {
      const signal = new AbortController().signal;
      timeouts.set(signal, duration);
      return signal;
    });
    try {
      route = (url, init) => {
        expect(timeouts.get(init.signal!)).toBe(url.searchParams.get("alt") === "media" ? 180_000 : 25_000);
        return listing(url, [owned("remote")]) ?? json({ ...payload(data), timerSound: { id: data.settings.timer.customSoundId, ...sound } });
      };
      await drive.downloadSyncFiles("chrome-token");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Google Drive settings evolution transport", () => {
  it("preserves missing-setting provenance through a legacy download and a multipart re-upload", async () => {
    const old = fixture("my-device");
    delete old.settingsCompatibility;
    delete (old.settings as unknown as Record<string, unknown>).showSearch;
    delete (old.settings.background as unknown as Record<string, unknown>).dim;
    const file = owned("my-replica", "my-device");
    let remotePayload = payload(old);
    route = (url, init) => {
      const response = listing(url, [file]);
      if (response) return response;
      if (init.method === "PUT" && !url.searchParams.has("upload_id")) {
        remotePayload = multipart(init)[1];
        return json(conditionalMetadata(file));
      }
      return json(remotePayload);
    };
    const first = (await drive.downloadSyncFiles("chrome-token"))[0].data;
    await uploadPayload(first, { deviceId: "my-device", fileId: file.id, token: "chrome-token" });
    const downloadedAgain = (await drive.downloadSyncFiles("chrome-token"))[0].data;
    const receiver = fixture("second-device");
    receiver.settings.showSearch = false;
    receiver.settings.background.dim = 0;

    const merged = mergeSyncData(receiver, downloadedAgain);
    expect(merged.settings.showSearch).toBe(false);
    expect(merged.settings.background.dim).toBe(0);
    expect(merged.syncReplica?.clock).toBe(0);
    expect(writes()).toHaveLength(1);
  });

  it("keeps future nested preferences and their clocks in the actual uploaded JSON after a local edit", async () => {
    const future = fixture("my-device");
    Object.assign(future.settings.background, { futureTint: { color: "#246810", strength: 0 } });
    Object.assign(future.settings, { futureLayout: { sizes: [1, 2, 3], enabled: false } });
    future.syncReplica = ensureSyncReplica(future);
    future.syncReplica.clock = 9;
    future.syncReplica.settings["background.futureTint.color"] = { stamp: { counter: 9, deviceId: "future-device" }, value: "#246810" };
    const file = owned("my-replica", "my-device");
    let remotePayload = payload(future);
    route = (url, init) => {
      const response = listing(url, [file]);
      if (response) return response;
      if (init.method === "PUT" && !url.searchParams.has("upload_id")) {
        remotePayload = multipart(init)[1];
        return json(conditionalMetadata(file));
      }
      return json(remotePayload);
    };
    const downloaded = (await drive.downloadSyncFiles("chrome-token"))[0].data;
    const next = structuredClone(downloaded);
    next.settings.showDescriptions = false;
    await uploadPayload(commitLocalSyncChanges(downloaded, next), { deviceId: "my-device", fileId: file.id, token: "chrome-token" });
    const roundTripped = (await drive.downloadSyncFiles("chrome-token"))[0].data;

    expect(roundTripped.settings).toMatchObject({
      showDescriptions: false, background: { futureTint: { color: "#246810", strength: 0 } },
      futureLayout: { sizes: [1, 2, 3], enabled: false }
    });
    expect(roundTripped.syncReplica?.settings["background.futureTint.color"]).toEqual(future.syncReplica.settings["background.futureTint.color"]);
    expect(remotePayload.data.settings).toMatchObject({ futureLayout: { sizes: [1, 2, 3], enabled: false } });
  });

  it("rejects a malformed future register without accepting only part of the cloud snapshot", async () => {
    const future = fixture("future-device");
    future.syncReplica = ensureSyncReplica(future);
    future.syncReplica.settings["futureLayout.density"] = { stamp: { counter: -1, deviceId: "future-device" }, value: "airy" };
    route = (url) => listing(url, [owned("future-replica", "future-device")]) ?? json(payload(future));
    await expect(drive.downloadSyncFiles("chrome-token")).rejects.toMatchObject({ code: "invalid_cloud_file" });
    expect(writes()).toHaveLength(0);
  });
});

describe("Google Drive previously local preference migration", () => {
  it.each([false, true])("ignores old artificial preference values without causal registers (history present: %s)", async (history) => {
    const old = fixture("old-device");
    old.settings.captureOpenTabs = false;
    old.settings.sync.deleteCloudFileOnDisconnect = true;
    delete old.settingsCompatibility;
    if (history) {
      old.syncReplica = ensureSyncReplica(old);
      old.syncReplica.clock = 900;
      delete old.syncReplica.settings.captureOpenTabs;
      delete old.syncReplica.settings["sync.deleteCloudFileOnDisconnect"];
    }
    route = (url) => listing(url, [owned("old-replica", "old-device")]) ?? json(payload(old));
    const [download] = await drive.downloadSyncFiles("chrome-token");
    expect(download.data.syncReplica!.settings.captureOpenTabs).toEqual({
      stamp: { counter: 0, deviceId: "settings-default" }, value: false
    });
    expect(download.data.syncReplica!.settings["sync.deleteCloudFileOnDisconnect"]).toEqual({
      stamp: { counter: 0, deviceId: "settings-default" }, value: true
    });
    const local = fixture("local-device");
    local.settings.captureOpenTabs = true;
    local.settings.sync.deleteCloudFileOnDisconnect = false;
    delete local.settingsCompatibility;
    const received = mergeSyncData(validateAuraData(local), download.data);
    expect(received.settings.captureOpenTabs).toBe(true);
    expect(received.settings.sync).toEqual(local.settings.sync);
    expect(old.settings.captureOpenTabs).toBe(false);
    expect(old.settings.sync.deleteCloudFileOnDisconnect).toBe(true);
  });

  it("retains explicit defaults from a modern cloud file and transfers later reversals", async () => {
    const initial = validateAuraData(fixture("remote-device"));
    const explicit = commitLocalSyncChanges(initial, { ...initial, ...applyExplicitSettingsPatch(initial, {
      captureOpenTabs: false, sync: { deleteCloudFileOnDisconnect: true }
    }) });
    const local = fixture("local-device");
    local.settings.captureOpenTabs = true;
    local.settings.sync.deleteCloudFileOnDisconnect = false;
    delete local.settingsCompatibility;
    route = (url) => listing(url, [owned("remote-replica", "remote-device")]) ?? json(payload(explicit));
    const [download] = await drive.downloadSyncFiles("chrome-token");
    const received = mergeSyncData(validateAuraData(local), download.data);
    expect(received.settings.captureOpenTabs).toBe(false);
    expect(received.settings.sync).toEqual({ ...local.settings.sync, deleteCloudFileOnDisconnect: true });
    expect(download.data.settingsCompatibility?.defaulted).not.toContain("captureOpenTabs");
    expect(download.data.settingsCompatibility?.defaulted).not.toContain("sync.deleteCloudFileOnDisconnect");
    const reversed = commitLocalSyncChanges(received, { ...received, ...applyExplicitSettingsPatch(received, {
      captureOpenTabs: true, sync: { deleteCloudFileOnDisconnect: false }
    }) });
    const returned = mergeSyncData(explicit, reversed);
    expect(returned.settings.captureOpenTabs).toBe(true);
    expect(returned.settings.sync).toEqual({ ...explicit.settings.sync, deleteCloudFileOnDisconnect: false });
  });
});

describe("Google Drive replica transport", () => {
  it("paginates both Drive spaces, filters ownership, and deduplicates repeated files", async () => {
    route = (url) => {
      expect(url.pathname).toBe("/drive/v3/files");
      expect(url.searchParams.get("fields")).toContain("appProperties");
      const cursor = url.searchParams.get("pageToken");
      if (url.searchParams.get("spaces") === "drive") {
        expect(url.searchParams.get("q")).toContain("auraStartSync");
        return cursor === null
          ? json({ files: [owned("replica-b"), { id: "foreign", name: FILE_NAME }, { ...owned("other-name"), name: "unrelated.json" }], nextPageToken: "normal-next" })
          : json({ files: [owned("replica-a"), owned("replica-b")] });
      }
      expect(url.searchParams.get("spaces")).toBe("appDataFolder");
      return cursor === null
        ? json({ files: [{ id: "legacy-a", name: FILE_NAME }], nextPageToken: "legacy-next" })
        : json({ files: [{ id: "legacy-b", name: FILE_NAME }] });
    };
    const files = await drive.listSyncFiles("chrome-token");
    expect(files.map((file) => file.id)).toEqual(["legacy-a", "legacy-b", "replica-a", "replica-b"]);
    expect(files.filter((file) => file.legacyAppData).map((file) => file.id)).toEqual(["legacy-a", "legacy-b"]);
    expect(requestCalls().map(({ url }) => url.searchParams.get("pageToken"))).toEqual([null, "normal-next", null, "legacy-next"]);
  });

  it("consolidates all device replicas through conditional writes regardless of a stale local file ID", async () => {
    const foreign = owned("foreign-replica", "other-device");
    const own = owned("my-replica", "my-device");
    const cloud = simulateSharedCloud([
      { metadata: foreign, payload: payload(fixture("other-device", "foreign-group")) },
      { metadata: own, payload: payload(fixture("my-device", "local-group")) }
    ]);
    const result = await drive.uploadSyncFile(fixture(), { deviceId: "my-device", fileId: own.id, token: "chrome-token" });
    expect(result.id).toBe("new-shared-file");
    expect(drive.isSharedSyncFile(result)).toBe(true);
    expect([...cloud.keys()]).toEqual(["new-shared-file"]);
    expect(result.appProperties).not.toHaveProperty("auraStartDeviceId");
    expect(cloud.get(result.id)?.payload.data.groups.map((group) => group.id).sort()).toEqual(["foreign-group", "group-one", "local-group"]);
    expect(writes().map(({ init }) => init.method)).toEqual(["POST", "DELETE", "DELETE"]);
  });

  it("migrates foreign and legacy copies to a fresh shared file and strips local private state", async () => {
    const data = fixture();
    data.settings.captureOpenTabs = true;
    data.settings.sync = {
      ...data.settings.sync, cloudFileId: "foreign-replica", connectionId: "private-connection",
      accountEmail: "local@invalid.test", accountName: "Local account", accountAvatarUrl: "https://invalid.test/avatar.png",
      lastSyncedAt: ISO, lastSyncedLocalUpdatedAt: ISO, lastCloudUpdatedAt: ISO, reconnectRequired: true, deleteCloudFileOnDisconnect: false
    };
    data.restorePoints = [{
      id: "local-history", name: "Private local history", reason: "manual", createdAt: ISO,
      data: { version: 1, updatedAt: ISO, settings: structuredClone(data.settings), groups: [] }
    }];
    const cloud = simulateSharedCloud([
      { metadata: owned("foreign-replica", "other-device"), payload: payload(fixture("other-device")) },
      { metadata: { id: "old-appdata", name: FILE_NAME, legacyAppData: true }, payload: payload(fixture("old-device")) }
    ]);
    await drive.uploadSyncFile(data, { deviceId: "my-device", fileId: "old-appdata", token: "chrome-token" });
    expect(writes().map(({ init }) => init.method)).toEqual(["POST", "DELETE", "DELETE"]);
    expect([...cloud.keys()]).toEqual(["new-shared-file"]);
    const [metadata, sent] = multipart(writes()[0].init);
    expect(metadata).toMatchObject({ appProperties: { auraStartSync: "true", auraStartSharedSync: "1" } });
    expect(metadata.appProperties).not.toHaveProperty("auraStartDeviceId");
    expect(metadata).not.toHaveProperty("parents");
    expect(sent.data.restorePoints).toEqual([]);
    expect(sent.data.settings.captureOpenTabs).toBe(true);
    expect(sent.data.syncReplica?.groups["group-one"].presence.value).toBe(true);
    expect(sent.data.settings.sync).toEqual({ ...DEFAULT_SETTINGS.sync, deviceId: "my-device", deleteCloudFileOnDisconnect: false });
    expect(JSON.stringify(sent)).not.toContain("private-connection");
    expect(JSON.stringify(sent)).not.toContain("local@invalid.test");
    expect(JSON.stringify(sent)).not.toContain("local-history");
    expect(data.restorePoints).toHaveLength(1);
  });

  it("downloads every duplicate replica once and restores their combined groups", async () => {
    const left = owned("replica-a", "device-a");
    const right = owned("replica-b", "device-b");
    route = (url) => {
      const response = listing(url, [left, right, right]);
      if (response) return response;
      expect(url.searchParams.get("alt")).toBe("media");
      return json(payload(url.pathname.endsWith("replica-a") ? fixture("device-a", "group-a") : fixture("device-b", "group-b")));
    };
    const downloads = await drive.downloadSyncFiles("chrome-token");
    expect(downloads.map((download) => download.metadata.id)).toEqual([left.id, right.id]);
    expect(requestCalls().filter(({ url }) => url.searchParams.get("alt") === "media")).toHaveLength(2);
    const restored = await drive.restoreFromDrive("chrome-token");
    expect(restored?.data.groups.map((group) => group.id).sort()).toEqual(["group-a", "group-b"]);
  });

  it("does not upload a partial discovery when a later listing page fails", async () => {
    route = (url) => url.searchParams.has("pageToken")
      ? json({ error: { message: "Later replica page unavailable" } }, 503)
      : json({ files: [owned("my-replica", "my-device")], nextPageToken: "unavailable-page" });
    await expect(drive.uploadSyncFile(fixture(), { deviceId: "my-device", fileId: "my-replica", token: "chrome-token" }))
      .rejects.toMatchObject({ status: 503, message: "Later replica page unavailable" });
    expect(writes()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a repeated pagination cursor instead of looping or uploading incomplete state", async () => {
    route = () => json({ files: [owned("my-replica", "my-device")], nextPageToken: "same-page" });
    await expect(drive.uploadSyncFile(fixture(), { deviceId: "my-device", token: "chrome-token" })).rejects.toThrow(/repeated listing page/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writes()).toHaveLength(0);
  });

  it("rejects the whole download when a discovered replica is invalid", async () => {
    route = (url) => {
      const response = listing(url, [owned("replica-a"), owned("replica-b")]);
      if (response) return response;
      return json(url.pathname.endsWith("replica-a") ? payload(fixture()) : { schemaVersion: 999 });
    };
    await expect(drive.downloadSyncFiles("chrome-token")).rejects.toMatchObject({ code: "invalid_cloud_file" });
    expect(writes()).toHaveLength(0);
  });

  it("reacquires an expired Chrome token once and retries the same Drive request", async () => {
    route = (_url, init) => new Headers(init.headers).get("Authorization") === "Bearer expired-token"
      ? json({ error: { message: "Expired" } }, 401)
      : json({ files: [] });
    await expect(drive.listSyncFiles("expired-token")).resolves.toEqual([]);
    const calls = requestCalls();
    expect(calls[0].url.href).toBe(calls[1].url.href);
    expect(calls.map(({ init }) => new Headers(init.headers).get("Authorization"))).toEqual([
      "Bearer expired-token", "Bearer renewed-token", "Bearer renewed-token"
    ]);
    expect(identity.getAuthToken).toHaveBeenCalledTimes(1);
    expect(identity.getAuthToken.mock.calls[0][0]).toEqual({ interactive: false });
    expect(identity.removeCachedAuthToken.mock.calls[0][0]).toEqual({ token: "expired-token" });
  });

  it("stops after a second 401 without a refresh loop or a permanent reconnect flag", async () => {
    route = () => json({ error: { message: "Grant no longer accepted" } }, 401);
    const error = await drive.listSyncFiles("expired-token").catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 401 });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(identity.getAuthToken).toHaveBeenCalledTimes(1);
  });

  it("deletes every discovered Aura replica and legacy backup while excluding unrelated Drive files", async () => {
    const deleted = new Set<string>();
    route = (url, init) => {
      const response = listing(url, [owned("replica-a"), owned("replica-b"), { id: "foreign", name: FILE_NAME }].filter((file) => !deleted.has(file.id)), [{ id: "legacy", name: FILE_NAME }].filter((file) => !deleted.has(file.id)));
      if (response) return response;
      expect(init.method).toBe("DELETE");
      deleted.add(url.pathname.split("/").at(-1)!);
      return new Response(null, { status: 204 });
    };
    await expect(drive.deleteSyncFile("chrome-token")).resolves.toEqual({ deleted: true, legacyAppData: "verified" });
    expect(writes().map(({ url }) => url.pathname)).toEqual([
      "/drive/v3/files/legacy", "/drive/v3/files/replica-a", "/drive/v3/files/replica-b"
    ]);
  });
});
