import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import { t } from "../i18n";
import type { AuraStartData } from "../types";
import { useAuraStore } from "../store/useAuraStore";
import { loadBackgroundImage, storeBackgroundImage } from "../utils/backgroundImageStorage";
import { createEmptyData } from "../utils/sampleData";
import { applyExplicitSettingsPatch } from "../utils/settingsPatch";
import { projectSharedSettings } from "../utils/settingsSchema";
import { loadAuraData, saveAuraData, updateAuraData } from "../utils/storage";
import { loadTimerSound, storeTimerSound, timerSoundBytesToDataUrl, type TimerSoundAsset } from "../utils/timerSoundStorage";
import { runGoogleDriveBackgroundSync, type GoogleDriveBackgroundSyncResult } from "./googleDriveBackgroundSync";
import { backupToDrive, type GoogleDriveFileMetadata, type GoogleDriveSyncPayload } from "./googleDriveSync";

// No Aura service/store mock: use real authorization selection, transport,
// payload validation, asset databases, merge and notification handling. Only
// native browser APIs and HTTP responses are supplied by the isolated host.
type Device = "source" | "fresh";
type CloudFile = { metadata: GoogleDriveFileMetadata; payload: GoogleDriveSyncPayload };
type RequestRecord = { device: Device; method: string; path: string };
const ISO = "2026-09-12T10:00:00.000Z";
const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
let active: Device;
let stores: Map<Device, Record<string, unknown>>;
let databases: Map<Device, IDBFactory>;
let cloud: Map<string, CloudFile>;
let requests: RequestRecord[];
let fail: "list" | "media" | "upload" | undefined;
let serial: number;

function activate(device: Device): void {
  active = device;
  vi.stubGlobal("indexedDB", databases.get(device));
}

function audioAsset(): TimerSoundAsset {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    bytes.set(new TextEncoder().encode(value), offset);
  }
  view.setUint32(4, 40, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, 4, true); view.setInt16(44, 1000, true); view.setInt16(46, -1000, true);
  const dataUrl = timerSoundBytesToDataUrl(bytes, "audio/wav");
  return { name: "Мой сигнал.wav", dataUrl, playbackDataUrl: dataUrl };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function conditionalMetadata(file: CloudFile): Record<string, unknown> {
  const { metadata } = file;
  return { id: metadata.id, title: metadata.name, etag: `"${metadata.id}-${metadata.version}"`,
    createdDate: metadata.createdTime, modifiedDate: metadata.modifiedTime, version: metadata.version, fileSize: metadata.size,
    properties: Object.entries(metadata.appProperties ?? {}).map(([key, value]) => ({ key, value, visibility: "PRIVATE" })) };
}

async function read(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error(`Missing ${active} data`);
  return loaded.data;
}

async function populateSource(): Promise<{ source: AuraStartData; file: CloudFile }> {
  activate("source");
  const imageId = await storeBackgroundImage(IMAGE);
  const soundId = await storeTimerSound(audioAsset());
  const initial = createEmptyData();
  initial.updatedAt = ISO;
  const preferences = applyExplicitSettingsPatch(initial, {
    theme: "dark", language: "ru", columns: 5, compactMode: true, openLinksInNewTab: true,
    showDescriptions: false, showSearch: false, showVersionInHeader: false, captureOpenTabs: true,
    background: { preset: "custom", customImageId: imageId, blur: 8, dim: 42, position: "left" },
    widgets: { clock: true, notes: true, pomodoro: true, timer: true },
    pomodoro: { focusMinutes: 50, breakMinutes: 15 },
    timer: { durationSeconds: 1234, volume: 0, customSoundId: soundId },
    notes: { text: "# Из облака\nСсылки, заметки и свои файлы должны вернуться. 🚀" },
    autoRestorePoints: false, sync: { deleteCloudFileOnDisconnect: false }
  });
  const source = await saveAuraData({ ...initial, ...preferences,
    settings: { ...preferences.settings, sync: { ...preferences.settings.sync,
      deviceId: "source-device", connectionId: "source-connection", connected: true, mode: "auto"
    } },
    groups: [{ id: "root-group", title: "Мои ссылки", parentId: null, collapsed: false, order: 0,
      links: [{ id: "restored-link", title: "Cloud bookmark", url: "https://example.test/saved", order: 0,
        description: "Keep all link fields", tags: ["важное", "sync"], createdAt: ISO, updatedAt: ISO }] },
    { id: "child-group", title: "Вложенная группа", parentId: "root-group", collapsed: true, order: 0, links: [] }]
  });
  const metadata = await backupToDrive(source, { deviceId: source.settings.sync.deviceId });
  const file = structuredClone(cloud.get(metadata.id)!);
  expect(file.payload.backgroundImage?.dataUrl).toBe(IMAGE);
  expect(file.payload.timerSound).toMatchObject(audioAsset());
  return { source, file };
}

async function freshInstallation(): Promise<AuraStartData> {
  activate("fresh");
  expect(stores.get("fresh")).toEqual({});
  useAuraStore.setState({ data: null, status: "idle", syncStatus: "idle", syncMessage: null,
    syncConflict: null, widgetNotes: "", customBackgroundImage: null, toasts: [] });
  await useAuraStore.getState().load();
  const fresh = await read();
  expect(fresh.groups).toHaveLength(0);
  expect(fresh.settings.sync.deviceId).not.toBe("source-device");
  expect(fresh.settings.sync.connected).toBe(false);
  return fresh;
}

async function connectFresh(): Promise<AuraStartData> {
  const connected = await updateAuraData((current) => ({ ...current, settings: { ...current.settings,
    sync: { ...current.settings.sync, mode: "auto", connected: true, connectionId: "fresh-connection" }
  } }));
  if (!connected) throw new Error("Missing fresh connection");
  useAuraStore.setState({ data: connected, syncStatus: "connected", syncMessage: null, toasts: [] });
  return connected;
}

async function expectRestored(source: AuraStartData, localDeviceId: string): Promise<AuraStartData> {
  const restored = await read();
  expect(projectSharedSettings(restored)).toEqual(projectSharedSettings(source));
  expect(restored.groups).toEqual(source.groups);
  expect(restored.settings.sync.deviceId).toBe(localDeviceId);
  expect(await loadBackgroundImage(restored.settings.background.customImageId)).toBe(IMAGE);
  expect(await loadTimerSound(restored.settings.timer.customSoundId)).toEqual(audioAsset());
  return restored;
}

async function showResult(result: GoogleDriveBackgroundSyncResult): Promise<void> {
  await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult(result);
}

function expectExistingCloudToast(): void {
  const state = useAuraStore.getState();
  const language = state.data!.settings.language;
  expect(state.toasts.at(-1)).toMatchObject({ type: "success",
    title: t(language, "googleDriveBackupSuccess"), message: t(language, "googleDriveLocalUploaded") });
  expect(state.toasts.some((toast) => toast.message === t(language, "googleDriveNoFileUploadedLocal"))).toBe(false);
}

beforeEach(() => {
  stores = new Map([["source", {}], ["fresh", {}]]);
  databases = new Map([["source", new IDBFactory()], ["fresh", new IDBFactory()]]);
  cloud = new Map(); requests = []; serial = 0; fail = undefined;
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout() {} });
  vi.stubGlobal("navigator", { language: "en", languages: ["en"], vendor: "Google Inc.",
    userAgent: "Chrome/140.0.0.0", userAgentData: { brands: [{ brand: "Google Chrome", version: "140" }] } });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", {
    runtime: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", getManifest: () => ({ manifest_version: 3, version: "2.1.0",
      update_url: "https://clients2.google.com/service/update2/crx",
      oauth2: { client_id: "71648271904-testchromeclient.apps.googleusercontent.com",
        scopes: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.appdata"] }
    }) },
    identity: { getAuthToken: async () => `test-token-${active}`, removeCachedAuthToken: async () => undefined },
    storage: { local: {
      get: async (key: string) => Object.hasOwn(stores.get(active)!, key) ? { [key]: structuredClone(stores.get(active)![key]) } : {},
      set: async (items: Record<string, unknown>) => { Object.assign(stores.get(active)!, structuredClone(items)); },
      remove: async (key: string) => { delete stores.get(active)![key]; }
    } }
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer test-token-${active}`);
    requests.push({ device: active, method: init.method ?? "GET", path: url.pathname });
    if (url.pathname === "/drive/v3/files") {
      if (fail === "list") return json({ error: { message: "Drive listing temporarily unavailable" } }, 503);
      return json({ files: url.searchParams.get("spaces") === "appDataFolder" ? [] : [...cloud.values()].map((file) => file.metadata) });
    }
    if (url.pathname.startsWith("/drive/v3/files/") && url.searchParams.get("alt") === "media") {
      if (fail === "media") return json({ error: { message: "Drive media temporarily unavailable" } }, 503);
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
      if (fail === "upload") return json({ error: { message: "Upload interrupted after local restore" } }, 503);
      const boundary = new Headers(init.headers).get("Content-Type")?.split("boundary=")[1];
      if (!boundary) throw new Error("Expected production multipart upload");
      const [metadata, payload] = String(init.body).split(`--${boundary}`).slice(1, -1)
        .map((part) => JSON.parse(part.slice(part.indexOf("\r\n\r\n") + 4).trim())) as [GoogleDriveFileMetadata & {
          title?: string; properties?: { key: string; value: string | null; visibility: string }[]
        }, GoogleDriveSyncPayload];
      const id = init.method === "POST" ? `cloud-file-${++serial}` : url.pathname.split("/").at(-1)!;
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
      const file = { payload, metadata: { id, name: metadata.title ?? metadata.name, appProperties,
        version: String(Number(previous?.metadata.version ?? 0) + 1), createdTime: previous?.metadata.createdTime ?? ISO,
        modifiedTime: new Date().toISOString(), size: String(JSON.stringify(payload).length) } };
      cloud.set(id, file);
      return json(init.method === "PUT" ? conditionalMetadata(file) : file.metadata);
    }
    throw new Error(`Unexpected HTTP request ${init.method ?? "GET"} ${url.pathname}`);
  }));
  activate("source");
  useAuraStore.setState({ data: null, status: "idle", syncStatus: "idle", syncMessage: null,
    syncConflict: null, customBackgroundImage: null, widgetNotes: "", toasts: [] });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("fresh-install restoration and shared-file notifications", () => {
  it("restores every shared category from existing Drive into new storage and media databases", async () => {
    const { source, file } = await populateSource();
    const fresh = await freshInstallation();
    expect(await loadBackgroundImage(source.settings.background.customImageId)).toBeNull();
    expect(await loadTimerSound(source.settings.timer.customSoundId)).toBeNull();
    await connectFresh();
    const result = await runGoogleDriveBackgroundSync(true);
    expect(result).toMatchObject({ status: "downloaded" });
    await expectRestored(source, fresh.settings.sync.deviceId);
    await showResult(result);
    expect(useAuraStore.getState().widgetNotes).toBe(source.settings.notes.text);
    expect(useAuraStore.getState().toasts.at(-1)?.title).toBe(t("ru", "googleDriveUpdatesApplied"));
    expect(cloud.get(file.metadata.id)).toEqual(file);
    expect(cloud.size).toBe(1);
    expect((await read()).settings.sync.cloudFileId).toBe(file.metadata.id);
  });

  it("quietly acknowledges the existing shared file after onboarding restores it", async () => {
    const { source, file } = await populateSource();
    const fresh = await freshInstallation();
    // This is the exact action used by OnboardingDialog's Drive restore button.
    await expect(useAuraStore.getState().restoreFromGoogleDrive({ requireExistingFile: true })).resolves.toBe(true);
    await expectRestored(source, fresh.settings.sync.deviceId);
    expect((await read()).settings.sync.connected).toBe(true);
    expect(cloud.size).toBe(1);
    useAuraStore.setState({ toasts: [] });
    const result = await runGoogleDriveBackgroundSync(true);
    expect(result).toMatchObject({ status: "in_sync", quiet: true });
    await showResult(result);
    expect(useAuraStore.getState().toasts).toEqual([]);
    expect(cloud.get(file.metadata.id)).toEqual(file);
    expect(cloud.size).toBe(1);
    expect((await read()).settings.sync.cloudFileId).toBe(file.metadata.id);
  });

  it("keeps restored media after an interrupted legacy migration and retires the old file only after a successful retry", async () => {
    const { source, file } = await populateSource();
    // A pre-shared-file backup needs migration even when the fresh
    // installation has no independent data to add.
    delete file.metadata.appProperties!.auraStartSharedSync;
    file.metadata.appProperties!.auraStartDeviceId = "source-device";
    cloud.set(file.metadata.id, structuredClone(file));
    const fresh = await freshInstallation();
    await connectFresh();
    fail = "upload";
    const interrupted = await runGoogleDriveBackgroundSync(true);
    expect(interrupted).toMatchObject({ status: "failed" });
    await expectRestored(source, fresh.settings.sync.deviceId);
    expect(cloud.size).toBe(1);
    expect(cloud.get(file.metadata.id)).toEqual(file);
    fail = undefined;
    const retry = await runGoogleDriveBackgroundSync(true);
    expect(retry).toMatchObject({ status: "uploaded", reason: "updated" });
    await showResult(retry);
    expectExistingCloudToast();
    await expectRestored(source, fresh.settings.sync.deviceId);
    expect(cloud.size).toBe(1);
    expect(cloud.has(file.metadata.id)).toBe(false);
    const shared = [...cloud.values()][0];
    expect(shared.metadata.appProperties).toMatchObject({ auraStartSharedSync: "1" });
    expect(shared.metadata.appProperties).not.toHaveProperty("auraStartDeviceId");
    expect(projectSharedSettings(shared.payload.data)).toEqual(projectSharedSettings(source));
    expect((await read()).settings.sync.cloudFileId).toBe(shared.metadata.id);
  });

  it.each(["list", "media"] as const)("does not treat a %s failure as an empty cloud or overwrite its backup", async (stage) => {
    const { file } = await populateSource();
    await freshInstallation();
    await connectFresh();
    fail = stage;
    const result = await runGoogleDriveBackgroundSync(true);
    expect(result).toMatchObject({ status: "failed" });
    await showResult(result);
    expect((await read()).groups).toHaveLength(0);
    expect(cloud.get(file.metadata.id)).toEqual(file);
    expect(cloud.size).toBe(1);
    expect(requests.filter((request) => request.device === "fresh" && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method))).toHaveLength(0);
    expect(useAuraStore.getState().toasts.every((toast) => toast.type !== "success")).toBe(true);
    expect(useAuraStore.getState().syncStatus).toBe("error");
  });

  it("reserves the cloud-was-empty message for a genuinely empty Drive", async () => {
    const fresh = await freshInstallation();
    await connectFresh();
    const result = await runGoogleDriveBackgroundSync(true);
    expect(result).toMatchObject({ status: "uploaded", reason: "created" });
    await showResult(result);
    expect(useAuraStore.getState().toasts.at(-1)?.message).toBe(t(fresh.settings.language, "googleDriveNoFileUploadedLocal"));
    expect(cloud.size).toBe(1);
    expect((await read()).groups).toHaveLength(0);
    expect(stores.get("fresh")?.[STORAGE_KEY]).toBeDefined();
  });
});
