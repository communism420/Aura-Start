import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import { driveDeletionTranslations } from "../i18nDriveDeletion";
import type { AuraStartData } from "../types";
import { GoogleDriveSyncError, type GoogleDriveDeletionResult } from "../services/googleDriveSync";
import { withGoogleDriveSyncLock } from "../services/googleDriveBackgroundSync";
import { loadBackgroundImage, storeBackgroundImage } from "../utils/backgroundImageStorage";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData, updateAuraData } from "../utils/storage";
import { loadTimerSound, storeTimerSound, timerSoundBytesToDataUrl } from "../utils/timerSoundStorage";
import { useAuraStore } from "./useAuraStore";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), cachedAuth: vi.fn(), deletionAuth: vi.fn(), clearAuth: vi.fn(),
  deleteFile: vi.fn(), disconnect: vi.fn()
}));
vi.mock("../services/googleDriveSync", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/googleDriveSync")>(),
  getAuthToken: mocks.auth,
  getCachedAuthToken: mocks.cachedAuth,
  getGoogleDriveDeletionAuthToken: mocks.deletionAuth,
  clearAuthToken: mocks.clearAuth,
  deleteSyncFile: mocks.deleteFile,
  disconnectGoogleAccount: mocks.disconnect
}));

const ISO = "2026-09-12T10:00:00.000Z";
const IMAGE = "data:image/png;base64,aGVsbG8=";
let stored: Record<string, unknown>;
let afterStorageRead: ((key: string) => void) | undefined;
let beforeStorageWrite: ((items: Record<string, unknown>) => void) | undefined;

function soundAsset() {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    bytes.set(new TextEncoder().encode(value), offset);
  }
  view.setUint32(4, 40, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, 4, true); view.setInt16(44, 1_000, true); view.setInt16(46, -1_000, true);
  const dataUrl = timerSoundBytesToDataUrl(bytes, "audio/wav");
  return { name: "Мой сигнал.wav", dataUrl, playbackDataUrl: dataUrl };
}

async function seed(): Promise<AuraStartData> {
  const data = structuredClone(createEmptyData());
  delete data.settingsCompatibility;
  data.updatedAt = ISO;
  data.settings.theme = "dark";
  data.settings.captureOpenTabs = true;
  data.settings.notes.text = "Мои заметки\nKeep these after deleting Google Drive data.";
  data.settings.background = { ...data.settings.background, preset: "custom", customImageId: await storeBackgroundImage(IMAGE) };
  data.settings.timer.customSoundId = await storeTimerSound(soundAsset());
  data.settings.sync = {
    ...data.settings.sync, mode: "auto", connected: true, reconnectRequired: false,
    deviceId: "local-device", connectionId: "original-connection", cloudFileId: "own-cloud-replica",
    accountEmail: "original@example.test", accountName: "Original test account",
    accountAvatarUrl: "https://example.test/avatar.png",
    lastSyncedAt: ISO, lastSyncedLocalUpdatedAt: ISO, lastCloudUpdatedAt: ISO
  };
  data.groups = [{ id: "group", title: "Keep locally", parentId: null, collapsed: false, order: 0,
    links: [{ id: "link", title: "Local link", url: "https://example.test/", order: 0, createdAt: ISO, updatedAt: ISO }] }];
  data.restorePoints = [{ id: "point", name: "Local recovery", reason: "manual", createdAt: ISO,
    data: { version: 1, updatedAt: ISO, settings: structuredClone(data.settings), groups: structuredClone(data.groups) } }];
  const saved = await saveAuraData(data);
  useAuraStore.setState({ data: saved, status: "ready", syncStatus: "connected", syncMessage: null, syncConflict: null, toasts: [] });
  return saved;
}

async function durable(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error("Expected ready local storage");
  return loaded.data;
}

function localContent(data: AuraStartData) {
  const { sync, ...settings } = data.settings;
  return { settings, deleteCloudFileOnDisconnect: sync.deleteCloudFileOnDisconnect, groups: data.groups, restorePoints: data.restorePoints };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function replaceConnection() {
  const updated = await updateAuraData((current) => ({ ...current,
    settings: { ...current.settings, sync: { ...current.settings.sync,
      mode: "auto", connected: true, reconnectRequired: false, connectionId: "replacement-connection",
      cloudFileId: "replacement-file", accountEmail: "replacement@example.test"
    } }
  }));
  if (!updated) throw new Error("Expected replacement connection");
  return updated;
}

beforeEach(() => {
  vi.resetAllMocks();
  stored = {};
  afterStorageRead = undefined;
  beforeStorageWrite = undefined;
  mocks.auth.mockResolvedValue("test-token");
  mocks.cachedAuth.mockResolvedValue("test-token");
  mocks.deletionAuth.mockResolvedValue("test-token");
  mocks.clearAuth.mockResolvedValue(undefined);
  mocks.deleteFile.mockResolvedValue({ deleted: true, legacyAppData: "verified" });
  mocks.disconnect.mockResolvedValue({});
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => {
      const result = stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) };
      afterStorageRead?.(key);
      return result;
    },
    set: async (items: Record<string, unknown>) => { beforeStorageWrite?.(items); Object.assign(stored, structuredClone(items)); },
    remove: async (key: string) => { delete stored[key]; }
  } } });
  useAuraStore.setState({ data: null, status: "idle", syncStatus: "idle", syncMessage: null, syncConflict: null, toasts: [] });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("deleting all Google Drive data before disconnecting", () => {
  it("durably pauses before authorization, verifies deletion before revocation, and preserves every local category", async () => {
    const initial = await seed();
    const order: string[] = [];
    mocks.deletionAuth.mockImplementation(async () => {
      const sync = (await durable()).settings.sync;
      expect(sync.mode).toBe("off");
      expect(sync.connected).toBe(true);
      expect(sync.connectionId).not.toBe(initial.settings.sync.connectionId);
      order.push("authorize");
      return "deletion-token";
    });
    mocks.deleteFile.mockImplementation(async (token: string) => {
      expect(token).toBe("deletion-token");
      expect((await durable()).settings.sync.cloudFileId).toBe("own-cloud-replica");
      order.push("verified-delete");
      return { deleted: true, legacyAppData: "verified" };
    });
    mocks.disconnect.mockImplementation(async (token: string) => {
      expect(token).toBe("deletion-token");
      expect(order).toEqual(["authorize", "verified-delete"]);
      order.push("revoke");
      return {};
    });

    await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();

    expect(order).toEqual(["authorize", "verified-delete", "revoke"]);
    expect(mocks.deletionAuth).toHaveBeenCalledWith(true);
    const result = await durable();
    expect(result.settings.sync).toMatchObject({ mode: "off", connected: false, reconnectRequired: false, deviceId: "local-device" });
    for (const field of ["accountEmail", "accountName", "accountAvatarUrl", "cloudFileId", "lastSyncedAt", "lastSyncedLocalUpdatedAt", "lastCloudUpdatedAt"] as const) {
      expect(result.settings.sync[field]).toBeUndefined();
    }
    expect(localContent(result)).toEqual(localContent(initial));
    expect(await loadBackgroundImage(result.settings.background.customImageId!)).toBe(IMAGE);
    expect(await loadTimerSound(result.settings.timer.customSoundId!)).toEqual(soundAsset());
    expect(useAuraStore.getState().syncStatus).toBe("idle");
    expect(useAuraStore.getState().toasts.some((toast) => toast.type === "success")).toBe(true);
  });

  it("uses deletion authorization when there is no cached token instead of silently skipping deletion", async () => {
    await seed();
    mocks.cachedAuth.mockResolvedValue(undefined);
    mocks.deletionAuth.mockResolvedValue("renewed-token");
    await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    expect(mocks.deletionAuth).toHaveBeenCalledWith(true);
    expect(mocks.deleteFile).toHaveBeenCalledWith("renewed-token");
    expect(mocks.disconnect).toHaveBeenCalledWith("renewed-token");
    expect((await durable()).settings.sync.connected).toBe(false);
  });

  it.each(["delete", "authorize"] as const)("keeps the paused connection and recovery information when %s fails", async (stage) => {
    const initial = await seed();
    const error = stage === "authorize"
      ? new GoogleDriveSyncError("auth_cancelled", "Deletion authorization cancelled")
      : new GoogleDriveSyncError("network", "One cloud replica could not be deleted");
    (stage === "authorize" ? mocks.deletionAuth : mocks.deleteFile).mockRejectedValue(error);
    await expect(useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect()).rejects.toBe(error);
    const result = await durable();
    expect(result.settings.sync).toMatchObject({ mode: "off", connected: true, cloudFileId: "own-cloud-replica", accountEmail: "original@example.test", lastCloudUpdatedAt: ISO });
    expect(localContent(result)).toEqual(localContent(initial));
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.clearAuth).not.toHaveBeenCalled();
    if (stage === "authorize") expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(["error", "reconnect_required"]).toContain(useAuraStore.getState().syncStatus);
    expect(useAuraStore.getState().toasts.every((toast) => toast.type !== "success")).toBe(true);
  });

  it("disconnects after a verified empty cloud instead of requiring that a file existed", async () => {
    await seed();
    mocks.deleteFile.mockResolvedValue({ deleted: false, legacyAppData: "verified" });
    await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledWith("test-token");
    expect((await durable()).settings.sync.connected).toBe(false);
  });

  it.each([true, false])("keeps an honest hidden-backup notice across disconnect and reload when ordinary files existed: %s", async (deleted) => {
    const initial = await seed();
    mocks.deleteFile.mockResolvedValue({ deleted, legacyAppData: "unavailable" });
    mocks.disconnect.mockImplementation(async () => {
      // Revoking the token must not be the point at which the limitation is lost.
      expect((await durable()).settings.sync).toMatchObject({
        lastDeletionLegacyUnchecked: true, mode: "off", connected: true
      });
      return {};
    });

    await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();

    const result = await durable();
    expect(result.settings.sync).toMatchObject({ lastDeletionLegacyUnchecked: true, mode: "off", connected: false });
    expect(localContent(result)).toEqual(localContent(initial));
    expect(result.syncReplica).toEqual(initial.syncReplica);
    expect(result.updatedAt).toBe(initial.updatedAt);
    expect(await loadBackgroundImage(result.settings.background.customImageId!)).toBe(IMAGE);
    expect(await loadTimerSound(result.settings.timer.customSoundId!)).toEqual(soundAsset());
    expect(useAuraStore.getState().toasts).toHaveLength(1);
    expect(useAuraStore.getState().toasts[0]).toMatchObject({
      type: "info",
      title: driveDeletionTranslations.en.googleDriveBackupDeletedLegacyUncheckedTitle,
      message: driveDeletionTranslations.en.googleDriveBackupDeletedLegacyUncheckedDescription
    });
    await useAuraStore.getState().load();
    expect(useAuraStore.getState().data?.settings.sync).toMatchObject({ lastDeletionLegacyUnchecked: true, connected: false });
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("retains a previous hidden-backup notice when another account's hidden-space deletion was verified", async () => {
    await seed();
    const previous = await updateAuraData((data) => ({ ...data,
      settings: { ...data.settings, sync: { ...data.settings.sync,
        lastDeletionLegacyUnchecked: true, accountEmail: "another-account@example.test" } }
    }));
    useAuraStore.setState({ data: previous! });
    mocks.deleteFile.mockResolvedValue({ deleted: false, legacyAppData: "verified" });
    await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    expect((await durable()).settings.sync.lastDeletionLegacyUnchecked).toBe(true);
    expect(useAuraStore.getState().toasts[0].type).toBe("success");
  });

  it("retains credentials for retry if the hidden-backup notice cannot be saved before revocation", async () => {
    await seed();
    mocks.deleteFile.mockResolvedValue({ deleted: true, legacyAppData: "unavailable" });
    beforeStorageWrite = (items) => {
      if ((items[STORAGE_KEY] as AuraStartData | undefined)?.settings.sync.lastDeletionLegacyUnchecked) {
        throw new Error("Local storage write failed");
      }
    };
    await expect(useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect()).rejects.toThrow("Local storage write failed");
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.clearAuth).not.toHaveBeenCalled();
    expect((await durable()).settings.sync).toMatchObject({ mode: "off", connected: true, accountEmail: "original@example.test" });
    expect(useAuraStore.getState().toasts.every((toast) => toast.type !== "success")).toBe(true);
  });

  it("keeps both the hidden-backup notice and revoke warning when Google revocation fails", async () => {
    await seed();
    mocks.deleteFile.mockResolvedValue({ deleted: true, legacyAppData: "unavailable" });
    mocks.disconnect.mockResolvedValue({ revokeError: "Google revoke unavailable" });
    await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    expect((await durable()).settings.sync).toMatchObject({ lastDeletionLegacyUnchecked: true, connected: false });
    const toast = useAuraStore.getState().toasts[0];
    expect(toast.type).toBe("info");
    expect(toast.message).toContain(driveDeletionTranslations.en.googleDriveBackupDeletedLegacyUncheckedDescription);
    expect(toast.message).toContain("Google revoke unavailable");
  });

  it("can retry a failed deletion from the paused connection without losing local changes", async () => {
    const initial = await seed();
    mocks.deleteFile.mockRejectedValueOnce(new GoogleDriveSyncError("network", "Partial deletion failed"));
    await expect(useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect()).rejects.toThrow("Partial deletion failed");
    const paused = await durable();
    expect(paused.settings.sync).toMatchObject({ mode: "off", connected: true, cloudFileId: "own-cloud-replica" });
    await useAuraStore.getState().setWidgetNotes("Edited locally while cloud deletion is paused");
    await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    const result = await durable();
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(result.settings.notes.text).toBe("Edited locally while cloud deletion is paused");
    expect(result.settings.sync).toMatchObject({ mode: "off", connected: false });
    expect(result.groups).toEqual(initial.groups);
    expect(await loadBackgroundImage(result.settings.background.customImageId!)).toBe(IMAGE);
    expect(await loadTimerSound(result.settings.timer.customSoundId!)).toEqual(soundAsset());
  });

  it("pauses while an existing synchronization holds the shared lock and only deletes after it finishes", async () => {
    await seed();
    const gate = deferred<void>();
    const entered = deferred<void>();
    const previousSync = withGoogleDriveSyncLock(async () => { entered.resolve(); await gate.promise; });
    await entered.promise;
    const deletion = useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    try {
      await vi.waitFor(async () => { expect((await durable()).settings.sync.mode).toBe("off"); });
      expect(mocks.deletionAuth).not.toHaveBeenCalled();
      expect(mocks.deleteFile).not.toHaveBeenCalled();
      expect(mocks.disconnect).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await previousSync;
      await deletion;
    }
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["delete", "disconnect"] as const)("rejects a stale page's %s intent before touching a replacement connection", async (action) => {
    await seed();
    const replacement = await replaceConnection();
    // The page still has the original connection even though another page has saved a replacement.
    await (action === "delete"
      ? useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect()
      : useAuraStore.getState().disconnectGoogleDrive());
    expect((await durable()).settings.sync).toEqual(replacement.settings.sync);
    expect(mocks.deletionAuth).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.clearAuth).not.toHaveBeenCalled();
    expect(useAuraStore.getState().toasts).toHaveLength(0);
  });

  it.each(["authorize", "delete", "disconnect"] as const)("does not continue or clear a replacement connection after awaiting %s", async (stage) => {
    await seed();
    const gate = deferred<string | GoogleDriveDeletionResult | Record<string, never>>();
    const entered = deferred<void>();
    const mock = stage === "authorize" ? mocks.deletionAuth : stage === "delete" ? mocks.deleteFile : mocks.disconnect;
    mock.mockImplementation(async () => { entered.resolve(); return await gate.promise; });
    const deletion = useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    await entered.promise;
    let replacement: AuraStartData;
    try {
      replacement = await replaceConnection();
      useAuraStore.setState({ data: replacement, syncStatus: "connected", syncMessage: null, toasts: [] });
    } finally {
      gate.resolve(stage === "authorize" ? "test-token" : stage === "delete" ? { deleted: true, legacyAppData: "verified" } : {});
      await deletion;
    }
    expect((await durable()).settings.sync).toEqual(replacement!.settings.sync);
    if (stage === "authorize") expect(mocks.deleteFile).not.toHaveBeenCalled();
    if (stage !== "disconnect") expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(useAuraStore.getState().toasts).toHaveLength(0);
  });

  it("ignores old upload completion after deletion without reconnecting or presenting an upload success", async () => {
    const initial = await seed();
    await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    const result = await durable();
    useAuraStore.setState({ toasts: [] });
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult({ status: "uploaded", reason: "updated",
      syncDeviceId: initial.settings.sync.deviceId, syncConnectionId: initial.settings.sync.connectionId });
    expect((await durable()).settings.sync).toEqual(result.settings.sync);
    expect(useAuraStore.getState().data?.settings.sync.connected).toBe(false);
    expect(useAuraStore.getState().toasts).toHaveLength(0);
  });

  it("ignores an old operation's failure after another page has established a new connection", async () => {
    await seed();
    const gate = deferred<GoogleDriveDeletionResult>();
    const entered = deferred<void>();
    mocks.deleteFile.mockImplementation(async () => { entered.resolve(); return await gate.promise; });
    const deletion = useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
    await entered.promise;
    const replacement = await replaceConnection();
    useAuraStore.setState({ data: replacement, syncStatus: "connected", syncMessage: null, toasts: [] });
    gate.reject(new GoogleDriveSyncError("unauthorized", "Old operation failed"));
    await expect(deletion).resolves.toBeUndefined();
    expect((await durable()).settings.sync).toEqual(replacement.settings.sync);
    expect(useAuraStore.getState().syncStatus).toBe("connected");
    expect(useAuraStore.getState().toasts).toHaveLength(0);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.clearAuth).not.toHaveBeenCalled();
  });

  it("guards the reconnect metadata write when the connection changes after the error handler's read", async () => {
    await seed();
    let replacement: AuraStartData | undefined;
    mocks.deleteFile.mockImplementation(async () => {
      afterStorageRead = (key) => {
        if (key !== STORAGE_KEY) return;
        afterStorageRead = undefined;
        // The error handler has already read the paused connection. Another page
        // persists a new account before the following metadata transaction starts.
        replacement = structuredClone(stored[STORAGE_KEY]) as AuraStartData;
        replacement.settings.sync = { ...replacement.settings.sync,
          mode: "auto", connected: true, reconnectRequired: false,
          connectionId: "replacement-connection", cloudFileId: "replacement-file",
          accountEmail: "replacement@example.test"
        };
        stored[STORAGE_KEY] = structuredClone(replacement);
        useAuraStore.setState({ data: replacement, syncStatus: "connected", syncMessage: "Replacement account ready", toasts: [] });
      };
      throw new GoogleDriveSyncError("unauthorized", "The old deletion token expired");
    });

    await expect(useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect()).resolves.toBeUndefined();

    expect(replacement).toBeDefined();
    expect((await durable()).settings.sync).toEqual(replacement!.settings.sync);
    expect(useAuraStore.getState().syncStatus).toBe("connected");
    expect(useAuraStore.getState().syncMessage).toBe("Replacement account ready");
    expect(useAuraStore.getState().toasts).toHaveLength(0);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.clearAuth).not.toHaveBeenCalled();
  });

  it("deletes the existing account while new consent is pending and rejects its late replacement", async () => {
    await seed();
    const gate = deferred<string>();
    const entered = deferred<void>();
    const order: string[] = [];
    let cachedToken: string | undefined = "account-a-token";
    mocks.auth.mockImplementation(async () => {
      entered.resolve();
      cachedToken = await gate.promise;
      order.push("oauth-b-cached");
      return cachedToken;
    });
    mocks.deletionAuth.mockImplementation(async () => {
      order.push("deletion-auth");
      if (!cachedToken) throw new Error("No authorized account");
      return cachedToken;
    });

    const connecting = useAuraStore.getState().connectGoogleDrive();
    await entered.promise;
    try {
      await useAuraStore.getState().deleteGoogleDriveBackupAndDisconnect();
      expect(mocks.deleteFile).toHaveBeenCalledExactlyOnceWith("account-a-token");
      expect(mocks.disconnect).toHaveBeenCalledExactlyOnceWith("account-a-token");
      expect((await durable()).settings.sync).toMatchObject({ mode: "off", connected: false });
    } finally {
      gate.resolve("account-b-token");
      await connecting;
    }

    expect(order).toEqual(["deletion-auth", "oauth-b-cached"]);
    // Real OAuth is generation-fenced in the service. A store metadata race
    // alone must never clear a token that another connection could reuse.
    expect(mocks.clearAuth).not.toHaveBeenCalled();
    expect((await durable()).settings.sync).toMatchObject({ mode: "off", connected: false });
  });

  it("makes the legacy delete-only action use the same deletion and disconnect path", async () => {
    await seed();
    await useAuraStore.getState().deleteGoogleDriveSyncFile();
    expect(mocks.deletionAuth).toHaveBeenCalledWith(true);
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect((await durable()).settings.sync).toMatchObject({ mode: "off", connected: false });
  });

  it("keeps cloud files and all local data when disconnecting without deletion", async () => {
    const initial = await seed();
    await useAuraStore.getState().disconnectGoogleDrive();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.deletionAuth).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    const result = await durable();
    expect(result.settings.sync).toMatchObject({ mode: "off", connected: false });
    expect(localContent(result)).toEqual(localContent(initial));
  });
});
