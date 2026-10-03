import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { STORAGE_KEY } from "../constants";
import type { AuraStartData, AuraSyncValue } from "../types";
import { loadBackgroundImage, storeBackgroundImage } from "../utils/backgroundImageStorage";
import { createEmptyData } from "../utils/sampleData";
import { applyExplicitSettingsPatch, type AuraSettingsPatch } from "../utils/settingsPatch";
import { projectSharedSettings, SETTING_SCHEMA, SHARED_SETTING_PATHS, type SharedSettingPath } from "../utils/settingsSchema";
import { loadAuraData, saveAuraData } from "../utils/storage";
import { ensureSyncReplica, mergeSyncData, sameSyncReplica } from "../utils/syncReplica";
import { loadTimerSound, storeTimerSound, type TimerSoundAsset } from "../utils/timerSoundStorage";
import { hasPendingGoogleDriveLocalChanges, runGoogleDriveBackgroundSync } from "./googleDriveBackgroundSync";
import { backupToDrive, type GoogleDriveFileMetadata, type GoogleDriveSyncPayload } from "./googleDriveSync";

// Keep actual cloud serialization, multipart upload, download validation, asset
// storage and background merge. Only account authorization and HTTP are fake.
vi.mock("./googleDriveSync", async (original) => ({
  ...await original<typeof import("./googleDriveSync")>(),
  getAuthToken: vi.fn(async () => "all-settings-test-token")
}));

const DEVICES = ["device-a", "device-b", "device-c"] as const;
type Device = typeof DEVICES[number];
const TIME = "2026-09-12T10:00:00.000Z";
const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
const IMAGE_SAMPLE = "test-background-asset";
const SOUND_SAMPLE = "test-sound-asset";

// Explicit samples make newly registered fields a required addition to this
// end-to-end contract, rather than silently testing the default twice.
const SAMPLES = {
  theme: ["dark", "light"], language: ["ru", "uk"], columns: [6, "auto"],
  compactMode: [true, false], openLinksInNewTab: [true, false],
  showDescriptions: [false, true], showSearch: [false, true],
  showVersionInHeader: [false, true], autoRestorePoints: [false, true],
  captureOpenTabs: [true, false], "sync.deleteCloudFileOnDisconnect": [false, true],
  "background.preset": ["forest", "none"], "background.blur": [7, 0],
  "background.dim": [0, 80], "background.position": ["left", "bottom"],
  "background.customImageId": [IMAGE_SAMPLE, null],
  "widgets.clock": [true, false], "widgets.notes": [true, false],
  "widgets.pomodoro": [true, false], "widgets.timer": [true, false],
  "notes.text": ["Планы на день\n✓ Завершить Aura Start 🚀", ""],
  "timer.durationSeconds": [86400, 1], "timer.volume": [0, 100],
  "timer.customSoundId": [SOUND_SAMPLE, null],
  "pomodoro.focusMinutes": [90, 5], "pomodoro.breakMinutes": [30, 1]
} satisfies Record<SharedSettingPath, readonly [AuraSyncValue, AuraSyncValue]>;

type CloudFile = { metadata: GoogleDriveFileMetadata; payload: GoogleDriveSyncPayload };
let activeDevice: Device;
let local: Map<Device, Record<string, unknown>>;
let databases: Map<Device, IDBFactory>;
let cloud: Map<string, CloudFile>;
let uploadCount: number;

function fixture(device: Device): AuraStartData {
  const data = createEmptyData();
  data.updatedAt = TIME;
  data.settings.sync = {
    ...data.settings.sync, deviceId: device, connectionId: `connection-${device}`,
    // A fresh connection has not acknowledged a snapshot in the empty Drive.
    connected: true, mode: "auto",
    accountEmail: `${device}@example.invalid`
  };
  data.groups = [{ id: "shared-group", title: "Bookmarks", parentId: null, collapsed: false, order: 0, links: [] }];
  return data;
}

function activate(device: Device): void {
  activeDevice = device;
  vi.stubGlobal("indexedDB", databases.get(device));
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

type UploadMetadata = GoogleDriveFileMetadata & { title?: string; properties?: { key: string; value: string | null; visibility: string }[] };

function conditionalMetadata(file: CloudFile): Record<string, unknown> {
  const { metadata } = file;
  return { id: metadata.id, title: metadata.name, etag: `"${metadata.id}-${metadata.version}"`,
    createdDate: metadata.createdTime, modifiedDate: metadata.modifiedTime, version: metadata.version, fileSize: metadata.size,
    properties: Object.entries(metadata.appProperties ?? {}).map(([key, value]) => ({ key, value, visibility: "PRIVATE" })) };
}

function multipart(init: RequestInit): [UploadMetadata, GoogleDriveSyncPayload] {
  const boundary = new Headers(init.headers).get("Content-Type")?.split("boundary=")[1];
  if (!boundary) throw new Error("A real multipart cloud upload was expected");
  const parts = String(init.body).split(`--${boundary}`).slice(1, -1);
  return parts.map((part) => JSON.parse(part.slice(part.indexOf("\r\n\r\n") + 4).trim())) as [UploadMetadata, GoogleDriveSyncPayload];
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  for (const key of parts.slice(0, -1)) {
    if (!target[key]) target[key] = {};
    target = target[key] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = value;
}

function getPath(target: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], target);
}

function omitPath(data: AuraStartData, path: string): void {
  const parts = path.split(".");
  let target = data.settings as unknown as Record<string, unknown>;
  for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
  delete target[parts.at(-1)!];
  if (data.syncReplica) delete data.syncReplica.settings[path];
}

function sound(): TimerSoundAsset {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => [...value].forEach((character, index) => { bytes[offset + index] = character.charCodeAt(0); });
  label(0, "RIFF"); view.setUint32(4, 38, true); label(8, "WAVE");
  label(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, "data"); view.setUint32(40, 2, true); view.setInt16(44, 1000, true);
  const dataUrl = `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
  return { name: "Своя мелодия.wav", dataUrl, playbackDataUrl: dataUrl };
}

async function resolveSample(value: AuraSyncValue): Promise<AuraSyncValue> {
  if (value === IMAGE_SAMPLE) return await storeBackgroundImage(IMAGE);
  if (value === SOUND_SAMPLE) return await storeTimerSound(sound());
  return value;
}

async function read(): Promise<AuraStartData> {
  const result = await loadAuraData();
  if (result.status !== "ready") throw new Error(`Device ${activeDevice} failed to load: ${result.status}`);
  return result.data;
}

async function edit(path: string, value: AuraSyncValue, previous?: AuraStartData): Promise<AuraStartData> {
  const baseline = previous ?? await read();
  const patch: Record<string, unknown> = {};
  setPath(patch, path, value);
  return await saveAuraData({ ...baseline, ...applyExplicitSettingsPatch(baseline, patch as AuraSettingsPatch) }, { baseline });
}

async function sync(device: Device): Promise<void> {
  activate(device);
  const result = await runGoogleDriveBackgroundSync(true);
  expect(result.status, JSON.stringify(result)).not.toBe("failed");
  expect(result.status, JSON.stringify(result)).not.toBe("skipped");
}

async function assertShared(path: string, value: AuraSyncValue): Promise<void> {
  expect(cloud.size).toBe(1);
  const shared = [...cloud.values()][0];
  expect(shared.metadata.appProperties).toMatchObject({ auraStartSharedSync: "1" });
  expect(shared.metadata.appProperties).not.toHaveProperty("auraStartDeviceId");
  for (const device of DEVICES) {
    activate(device);
    const data = await read();
    expect(projectSharedSettings(data)[path], `${device}: ${path}`).toEqual(value);
    expect(getPath(data.settings, path), `${device} visible setting: ${path}`).toEqual(value);
    expect(shared.payload.data.syncReplica?.settings[path].value).toEqual(value);
    expect(getPath(shared.payload.data.settings, path)).toEqual(value);
    expect(data.settings.sync.cloudFileId).toBe(shared.metadata.id);
    expect(data.settings.sync).toMatchObject({ deviceId: device, connectionId: `connection-${device}`, accountEmail: `${device}@example.invalid` });
    expect(shared.payload.data.settings.sync).not.toHaveProperty("accountEmail");
    if (path === "background.customImageId") expect(await loadBackgroundImage(value as string | null)).toBe(value ? IMAGE : null);
    if (path === "timer.customSoundId") expect(await loadTimerSound(value as string | null)).toEqual(value ? sound() : null);
  }
}

beforeEach(() => {
  local = new Map(DEVICES.map((device) => [device, { [STORAGE_KEY]: fixture(device) }]));
  databases = new Map(DEVICES.map((device) => [device, new IDBFactory()]));
  cloud = new Map();
  uploadCount = 0;
  vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", {
    runtime: { getManifest: () => ({ version: "2.1.0" }) },
    storage: { local: {
      get: async (key: string) => Object.hasOwn(local.get(activeDevice)!, key)
        ? { [key]: structuredClone(local.get(activeDevice)![key]) } : {},
      set: async (items: Record<string, unknown>) => { Object.assign(local.get(activeDevice)!, structuredClone(items)); },
      remove: async (key: string) => { delete local.get(activeDevice)![key]; }
    } }
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.origin !== "https://www.googleapis.com") throw new Error(`Unexpected test origin ${url.origin}`);
    if (url.pathname === "/drive/v3/files") {
      return json({ files: url.searchParams.get("spaces") === "appDataFolder" ? [] : [...cloud.values()].map((file) => file.metadata).reverse() });
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
      const [metadata, payload] = multipart(init);
      const id = init.method === "POST" ? `shared-file-${uploadCount + 1}` : url.pathname.split("/").at(-1)!;
      const previous = cloud.get(id);
      if (init.method === "PUT") {
        if (!previous) return json({}, 404);
        expect(new Headers(init.headers).get("If-Match")).toBe(conditionalMetadata(previous).etag);
      }
      const appProperties = metadata.properties
        ? Object.fromEntries(metadata.properties.filter((property) => property.value !== null).map(({ key, value }) => [key, value!]))
        : metadata.appProperties;
      expect(appProperties).toMatchObject({ auraStartSharedSync: "1" });
      expect(appProperties).not.toHaveProperty("auraStartDeviceId");
      const stored = { metadata: { id, name: metadata.title ?? metadata.name, appProperties,
        createdTime: previous?.metadata.createdTime ?? TIME, modifiedTime: TIME,
        version: String(Number(previous?.metadata.version ?? 0) + 1), size: String(JSON.stringify(payload).length) }, payload };
      cloud.set(id, stored);
      uploadCount++;
      return json(init.method === "PUT" ? conditionalMetadata(stored) : stored.metadata);
    }
    if (url.pathname.startsWith("/drive/v3/files/") && url.searchParams.get("alt") === "media") {
      const file = cloud.get(url.pathname.split("/").at(-1)!);
      if (!file) throw new Error("Unknown test cloud file");
      return json(file.payload);
    }
    throw new Error(`Unexpected test request ${init.method ?? "GET"} ${url.pathname}`);
  }));
  activate("device-a");
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("every registered setting through real Google Drive payloads on three devices", () => {
  it("requires distinct integration samples for every shared setting", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...SHARED_SETTING_PATHS].sort());
    for (const [path, values] of Object.entries(SAMPLES)) {
      expect(values[0], path).not.toEqual(values[1]);
      if (!["background.customImageId", "timer.customSoundId"].includes(path)) {
        expect(SETTING_SCHEMA[path as SharedSettingPath].acceptsWire(values[0]), path).toBe(true);
        expect(SETTING_SCHEMA[path as SharedSettingPath].acceptsWire(values[1]), path).toBe(true);
      }
    }
  });

  it.each(SHARED_SETTING_PATHS)("saves, downloads and updates %s from another device", async (path) => {
    const first = await resolveSample(SAMPLES[path][0]);
    await edit(path, first);
    for (const device of DEVICES) await sync(device);
    await assertShared(path, first);

    activate("device-c");
    const second = await resolveSample(SAMPLES[path][1]);
    await edit(path, second);
    for (const device of ["device-c", "device-a", "device-b"] as const) await sync(device);
    await assertShared(path, second);
    const writes = uploadCount;
    for (const device of DEVICES) {
      activate(device);
      const before = await read();
      await sync(device);
      const after = await read();
      expect(after.updatedAt).toBe(before.updatedAt);
      expect(after.restorePoints).toEqual(before.restorePoints);
      expect(hasPendingGoogleDriveLocalChanges(after)).toBe(false);
    }
    expect(uploadCount).toBe(writes);
  });

  it("combines simultaneous independent edits to every setting irrespective of replica merge order", async () => {
    const expected: Record<string, AuraSyncValue> = {};
    const snapshots: AuraStartData[] = [];
    for (let index = 0; index < DEVICES.length; index++) {
      const device = DEVICES[index];
      activate(device);
      for (const [pathIndex, path] of SHARED_SETTING_PATHS.entries()) {
        if (pathIndex % DEVICES.length !== index) continue;
        expected[path] = await resolveSample(SAMPLES[path][0]);
        await edit(path, expected[path]);
      }
      snapshots.push(await read());
      await backupToDrive(snapshots.at(-1)!, { deviceId: device, token: "all-settings-test-token" });
    }
    const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const order of permutations) {
      const merged = order.reduce((value, index) => mergeSyncData(value, snapshots[index]), fixture("device-a"));
      expect(projectSharedSettings(merged)).toMatchObject(expected);
    }
    for (const device of DEVICES) await sync(device);
    for (const [path, value] of Object.entries(expected)) await assertShared(path, value);
    activate("device-a");
    const reference = await read();
    for (const device of DEVICES.slice(1)) {
      activate(device);
      expect(sameSyncReplica(await read(), reference)).toBe(true);
    }
  });

  it("retains settings added after an old cloud document even if its unrelated edit has a high clock", async () => {
    await edit("timer.volume", 0);
    await edit("showDescriptions", false);
    await edit("futureWidget.options.offset", 0);
    await edit("futureWidget.options.enabled", false);
    await edit("futureWidget.options.label", "Новый параметр");
    const older = fixture("device-b");
    delete older.settingsCompatibility;
    older.syncReplica = ensureSyncReplica(older);
    for (const path of ["timer.volume", "showDescriptions", "widgets.timer", "timer.durationSeconds"]) omitPath(older, path);
    older.syncReplica.clock = 500;
    older.groups[0].title = "Remote old-client edit";
    older.syncReplica.groups["shared-group"].fields.title = { stamp: { counter: 500, deviceId: "device-b" }, value: older.groups[0].title };
    cloud.set("old-client", {
      metadata: { id: "old-client", name: "aura-start-sync.json", version: "1", createdTime: TIME, modifiedTime: TIME,
        appProperties: { auraStartSync: "true", auraStartDeviceId: "old-client" } },
      payload: { schemaVersion: 1, app: "Aura Start", appVersion: "2.0.5", deviceId: "old-client", updatedAt: TIME, data: older }
    });
    for (const device of DEVICES) await sync(device);
    await assertShared("timer.volume", 0);
    await assertShared("showDescriptions", false);
    await assertShared("futureWidget.options.offset", 0);
    await assertShared("futureWidget.options.enabled", false);
    await assertShared("futureWidget.options.label", "Новый параметр");
    expect((await read()).groups[0].title).toBe("Remote old-client edit");
  });

  it("rebases a stale page change after a remote nested and future-field edit", async () => {
    for (const device of DEVICES) await sync(device);
    activate("device-a");
    const stale = await read();
    activate("device-b");
    await edit("timer.durationSeconds", 17);
    await edit("timer.futureFadeSeconds", 0);
    await sync("device-b");
    await sync("device-a");
    await edit("timer.volume", 0, stale);
    for (const device of DEVICES) await sync(device);
    await assertShared("timer.durationSeconds", 17);
    await assertShared("timer.volume", 0);
    await assertShared("timer.futureFadeSeconds", 0);
  });

  it("converges simultaneous note edits and keeps the replaced local note in a Restore Point", async () => {
    for (const [device, note] of [["device-a", "Заметка с первого устройства"], ["device-b", "Note from the second device\n✓"]] as const) {
      activate(device);
      await edit("notes.text", note);
      await backupToDrive(await read(), { deviceId: device, token: "all-settings-test-token" });
    }
    for (const device of DEVICES) await sync(device);
    await assertShared("notes.text", "Note from the second device\n✓");
    activate("device-a");
    expect((await read()).restorePoints.some((point) => point.reason === "before_cloud_restore"
      && point.data.settings.notes.text === "Заметка с первого устройства")).toBe(true);

    // An intentional clear must beat a stale replica containing old text.
    activate("device-c");
    await edit("notes.text", "");
    for (const device of ["device-c", "device-a", "device-b"] as const) await sync(device);
    await assertShared("notes.text", "");
  });

  it.each(["background.customImageId", "timer.customSoundId"] as const)("preserves receiver settings when %s bytes are missing from Drive", async (path) => {
    const id = await resolveSample(SAMPLES[path][0]);
    await edit(path, id);
    await sync("device-a");
    const sent = [...cloud.values()][0].payload;
    if (path === "background.customImageId") delete sent.backgroundImage;
    else delete sent.timerSound;
    activate("device-b");
    const before = await read();
    const writes = uploadCount;
    expect(await runGoogleDriveBackgroundSync(true)).toMatchObject({ status: "failed" });
    const after = await read();
    expect(projectSharedSettings(after)).toEqual(projectSharedSettings(before));
    expect(after.restorePoints).toEqual(before.restorePoints);
    expect(uploadCount).toBe(writes);
    expect(await loadBackgroundImage(id as string)).toBeNull();
    expect(await loadTimerSound(id as string)).toBeNull();
  });
});
