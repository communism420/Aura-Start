import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import { t } from "../i18n";
import type { AuraStartData } from "../types";
import type { GoogleDriveSyncDownload } from "../services/googleDriveSync";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData, updateAuraData } from "../utils/storage";
import { installAuraStoreSyncLifecycle, useAuraStore } from "./useAuraStore";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  clearAuth: vi.fn(),
  account: vi.fn(),
  restore: vi.fn(),
  list: vi.fn(),
  disconnect: vi.fn(),
  lifecycle: vi.fn((_options: unknown) => () => undefined)
}));
vi.mock("../services/googleDriveSync", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/googleDriveSync")>(),
  getAuthToken: mocks.auth,
  clearAuthToken: mocks.clearAuth,
  getConnectedAccountInfo: mocks.account,
  listSyncFiles: mocks.list,
  disconnectGoogleAccount: mocks.disconnect,
  restoreFromDrive: mocks.restore
}));
vi.mock("../services/googleDriveSyncLifecycle", () => ({ installGoogleDriveSyncPageLifecycle: mocks.lifecycle }));
vi.mock("../services/googleDriveBackgroundSync", async (original) => ({
  ...await original<typeof import("../services/googleDriveBackgroundSync")>(),
  runGoogleDriveBackgroundSync: vi.fn(async () => ({ status: "in_sync", quiet: true }))
}));

const ISO = "2026-09-12T10:00:00.000Z";
let stored: Record<string, unknown>;
let afterRead: (() => void) | undefined;

function fixture(): AuraStartData {
  const data = structuredClone(createEmptyData());
  data.updatedAt = ISO;
  data.settings.sync = { ...data.settings.sync, deviceId: "local-device", mode: "auto", connected: true, connectionId: "current-connection", cloudFileId: "own-replica" };
  data.groups = ["delete", "keep"].map((id, order) => ({
    id: `group-${id}`, title: id, parentId: null, collapsed: false, order,
    links: ["one", "two"].map((link, linkOrder) => ({
      id: `${id}-${link}`, title: `${id}-${link}`, url: `https://${id}-${link}.test/`, order: linkOrder, createdAt: ISO, updatedAt: ISO
    }))
  }));
  return data;
}

async function seed(data = fixture()): Promise<AuraStartData> {
  const saved = await saveAuraData(data);
  useAuraStore.setState({ data: saved, status: "ready", syncStatus: "connected", syncMessage: null, syncConflict: null, toasts: [] });
  return saved;
}

async function durable(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error("Expected ready test storage");
  return loaded.data;
}

function cloud(): GoogleDriveSyncDownload {
  const data = fixture();
  data.settings.sync = { ...data.settings.sync, deviceId: "remote-device", connectionId: "remote-connection" };
  data.groups[0].title = "Cloud title";
  data.restorePoints = [{
    id: "remote-private-history", name: "Remote history", reason: "manual", createdAt: ISO,
    data: { version: 1, updatedAt: ISO, settings: data.settings, groups: [] }
  }];
  return {
    metadata: { id: "foreign-replica", name: "aura-start-sync.json" },
    data, cloudUpdatedAt: ISO,
    payload: { schemaVersion: 1, app: "Aura Start", appVersion: "2.1.0", updatedAt: ISO, deviceId: "remote-device", data }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = {};
  afterRead = undefined;
  mocks.auth.mockResolvedValue("test-token");
  mocks.account.mockResolvedValue(undefined);
  mocks.clearAuth.mockResolvedValue(undefined);
  mocks.restore.mockResolvedValue(cloud());
  mocks.list.mockResolvedValue([]);
  mocks.disconnect.mockResolvedValue({});
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => {
      const result = stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) };
      afterRead?.();
      return result;
    },
    set: async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); },
    remove: async (key: string) => { delete stored[key]; }
  } } });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("sync-safe store actions", () => {
  it.each(["group", "link", "bulk"] as const)("undoes only the original %s deletion while retaining concurrent device changes", async (kind) => {
    const baseline = await seed();
    const earlierRemote = structuredClone(baseline);
    earlierRemote.groups.push({ id: "remote-before-write", title: "Remote before write", parentId: null, order: 2, collapsed: false, links: [] });
    // Durable state changes before the page starts saving, so the delete's
    // canonical result contains additions that were absent from its intent.
    await saveAuraData(earlierRemote, { baseline });
    if (kind === "group") await useAuraStore.getState().deleteGroup("group-delete");
    if (kind === "link") await useAuraStore.getState().deleteLink("group-delete", "delete-one");
    if (kind === "bulk") await useAuraStore.getState().deleteLinksWithRestorePoint([{ groupId: "group-delete", linkId: "delete-one" }]);
    const undo = useAuraStore.getState().toasts.find((toast) => toast.onAction)?.onAction;
    expect(undo).toBeTypeOf("function");

    const afterDeletion = await durable();
    const laterRemote = structuredClone(afterDeletion);
    laterRemote.groups.push({ id: "remote-after-write", title: "Remote after write", parentId: null, order: 3, collapsed: false, links: [] });
    laterRemote.groups.find((group) => group.id === "group-keep")!.links[0].title = "Edited on another device";
    useAuraStore.setState({ data: await saveAuraData(laterRemote, { baseline: afterDeletion }) });
    await undo?.();

    const result = await durable();
    expect(result.groups.map((group) => group.id)).toEqual(expect.arrayContaining(["group-delete", "group-keep", "remote-before-write", "remote-after-write"]));
    expect(result.groups.find((group) => group.id === "group-delete")?.links.map((link) => link.id)).toContain("delete-one");
    expect(result.groups.find((group) => group.id === "group-keep")?.links[0].title).toBe("Edited on another device");
    expect(useAuraStore.getState().data).toEqual(result);
  });

  it("restores preferences using the current device identity and connection", async () => {
    const initial = fixture();
    initial.settings.captureOpenTabs = true;
    const oldPointData = structuredClone(initial);
    oldPointData.groups[0].title = "Point title";
    oldPointData.settings.sync = { mode: "off", deviceId: "foreign-old-device", deleteCloudFileOnDisconnect: true };
    oldPointData.settings.captureOpenTabs = false;
    initial.restorePoints = [{
      id: "point", name: "Point", reason: "manual", createdAt: ISO,
      data: { version: 1, updatedAt: ISO, groups: oldPointData.groups, settings: oldPointData.settings }
    }];
    const baseline = await seed(initial);
    await useAuraStore.getState().restoreRestorePoint("point");
    const result = await durable();
    expect(result.settings.sync).toEqual(baseline.settings.sync);
    expect(result.settings.captureOpenTabs).toBe(false);
    expect(result.groups[0].title).toBe("Point title");
    expect(result.syncReplica?.groups["group-delete"].fields.title.stamp.deviceId).toBe("local-device");
  });

  it("shows the canonical cloud-restore save and keeps local history and replica ownership", async () => {
    const initial = fixture();
    initial.settings.captureOpenTabs = true;
    initial.restorePoints = [{ id: "local-point", name: "Local", reason: "manual", createdAt: ISO,
      data: { version: 1, updatedAt: ISO, groups: [], settings: structuredClone(initial.settings) } }];
    await seed(initial);
    await expect(useAuraStore.getState().restoreFromGoogleDrive()).resolves.toBe(true);
    const result = await durable();
    expect(useAuraStore.getState().data).toEqual(result);
    expect(result.groups[0].title).toBe("Cloud title");
    expect(result.updatedAt).not.toBe(ISO);
    expect(result.settings.sync).toMatchObject({ deviceId: "local-device", connectionId: "current-connection", cloudFileId: "own-replica" });
    expect(result.settings.captureOpenTabs).toBe(true);
    expect(result.restorePoints.map((point) => point.id)).toContain("local-point");
    expect(result.restorePoints.map((point) => point.id)).not.toContain("remote-private-history");
    expect(result.syncReplica?.groups["group-delete"].fields.title.stamp.deviceId).toBe("local-device");
  });

  it("ignores a cloud download completed after disconnect", async () => {
    await seed();
    mocks.restore.mockImplementation(async () => {
      const disconnected = await updateAuraData((current) => ({
        ...current, settings: { ...current.settings, sync: { ...current.settings.sync, mode: "off", connected: false, connectionId: "disconnected" } }
      }));
      useAuraStore.setState({ data: disconnected!, syncStatus: "idle" });
      return cloud();
    });
    await expect(useAuraStore.getState().restoreFromGoogleDrive()).resolves.toBe(false);
    expect((await durable()).groups[0].title).toBe("delete");
    expect(useAuraStore.getState().syncStatus).toBe("idle");
    expect(useAuraStore.getState().toasts).toEqual([]);
  });

  it("checks the connection atomically when it changes between restore preparation and saving", async () => {
    await seed();
    let reads = 0;
    afterRead = () => {
      reads += 1;
      if (reads !== 2) return;
      const changed = structuredClone(stored[STORAGE_KEY]) as AuraStartData;
      changed.settings.sync.connectionId = "new-connection";
      stored[STORAGE_KEY] = changed;
      useAuraStore.setState({ data: changed, syncStatus: "connecting" });
    };
    await expect(useAuraStore.getState().restoreFromGoogleDrive()).resolves.toBe(false);
    expect((await durable()).groups[0].title).toBe("delete");
    expect(useAuraStore.getState().syncStatus).toBe("connecting");
    expect(useAuraStore.getState().toasts).toEqual([]);
  });

  it("does not reconnect after another page disconnects during pending OAuth", async () => {
    const baseline = await seed();
    let finishAuth: ((token: string) => void) | undefined;
    mocks.auth.mockImplementation(() => new Promise<string>((resolve) => { finishAuth = resolve; }));
    const connecting = useAuraStore.getState().connectGoogleDrive();
    await vi.waitFor(() => expect(mocks.auth).toHaveBeenCalledWith(false));
    const disconnected = await updateAuraData((current) => ({
      ...current, settings: { ...current.settings, sync: { ...current.settings.sync, mode: "off", connected: false, connectionId: "disconnected" } }
    }));
    useAuraStore.setState({ data: disconnected!, syncStatus: "idle" });
    finishAuth?.("test-token");
    await connecting;
    const result = await durable();
    expect(result.settings.sync).toMatchObject({ mode: "off", connected: false, connectionId: "disconnected" });
    expect(result.groups).toEqual(baseline.groups);
    expect(useAuraStore.getState().syncStatus).toBe("idle");
    expect(mocks.clearAuth).not.toHaveBeenCalled();
    expect(useAuraStore.getState().toasts).toEqual([]);
  });

  it("does not open a fresh sign-in when restoring an existing account fails temporarily", async () => {
    await seed();
    const { GoogleDriveSyncError } = await import("../services/googleDriveSync");
    mocks.auth.mockRejectedValueOnce(new GoogleDriveSyncError("network", "Temporary outage"));
    await expect(useAuraStore.getState().restoreFromGoogleDrive()).rejects.toMatchObject({ code: "network" });
    expect(mocks.auth).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.restore).not.toHaveBeenCalled();
    expect((await durable()).settings.sync).toMatchObject({ connected: true, mode: "auto" });
    expect((await durable()).settings.sync.reconnectRequired).not.toBe(true);
  });

  it("reuses existing authorization when reconnecting after a stale reconnect warning", async () => {
    const data = fixture();
    data.settings.sync.reconnectRequired = true;
    await seed(data);
    await useAuraStore.getState().connectGoogleDrive();
    expect(mocks.auth).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.clearAuth).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("test-token");
    expect((await durable()).settings.sync).toMatchObject({ connected: true, mode: "auto", reconnectRequired: false });
  });

  it("asks for fresh consent only after confirming that the existing grant lacks a required scope", async () => {
    const data = fixture();
    data.settings.sync.reconnectRequired = true;
    await seed(data);
    const { GoogleDriveSyncError } = await import("../services/googleDriveSync");
    mocks.list.mockRejectedValueOnce(new GoogleDriveSyncError("forbidden", "Insufficient authentication scopes", 403, "insufficientPermissions"));
    await useAuraStore.getState().connectGoogleDrive();
    expect(mocks.auth.mock.calls).toEqual([[false], [true, { forceReauthorize: true }]]);
    expect(mocks.clearAuth).not.toHaveBeenCalled();
    expect((await durable()).settings.sync.reconnectRequired).toBe(false);
  });

  it("lets an explicit disconnect finish while another page is waiting for Google consent", async () => {
    await seed();
    let finishAuth: ((token: string) => void) | undefined;
    mocks.auth.mockImplementationOnce(() => new Promise<string>((resolve) => { finishAuth = resolve; }));
    const connecting = useAuraStore.getState().connectGoogleDrive();
    await vi.waitFor(() => expect(finishAuth).toBeTypeOf("function"));
    await useAuraStore.getState().disconnectGoogleDrive();
    expect((await durable()).settings.sync).toMatchObject({ mode: "off", connected: false });
    finishAuth!("abandoned-token");
    await connecting;
    expect((await durable()).settings.sync).toMatchObject({ mode: "off", connected: false });
    expect(mocks.clearAuth).not.toHaveBeenCalled();
  });

  it("does not erase a reused grant when two pages try to commit the same connection", async () => {
    await seed();
    let releaseSecond: ((token: string) => void) | undefined;
    mocks.auth.mockResolvedValueOnce("shared-account-token").mockImplementationOnce(() => new Promise<string>((resolve) => { releaseSecond = resolve; }));
    const first = useAuraStore.getState().connectGoogleDrive();
    const second = useAuraStore.getState().connectGoogleDrive();
    await first;
    const established = (await durable()).settings.sync;
    await vi.waitFor(() => expect(releaseSecond).toBeTypeOf("function"));
    releaseSecond!("shared-account-token");
    await second;
    expect((await durable()).settings.sync).toEqual(established);
    expect(mocks.clearAuth).not.toHaveBeenCalled();
  });

  it("ignores old-connection result messages without resetting the new connection UI", async () => {
    await seed();
    useAuraStore.setState({ syncStatus: "connecting", syncMessage: "New authorization" });
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult({
      status: "uploaded", reason: "updated", syncDeviceId: "local-device", syncConnectionId: "previous-connection"
    });
    expect(useAuraStore.getState().syncStatus).toBe("connecting");
    expect(useAuraStore.getState().syncMessage).toBe("New authorization");
    expect(useAuraStore.getState().toasts).toEqual([]);
  });

  it("reports a new device joining existing Drive data once even if both reply and broadcast arrive", async () => {
    const data = fixture();
    data.settings.language = "ru";
    const before = await seed(data);
    const result = { status: "uploaded", reason: "replica_created", resultId: "new-device-existing-cloud",
      syncDeviceId: "local-device", syncConnectionId: "current-connection" } as const;
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult(result);
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult(result);
    expect(useAuraStore.getState().syncStatus).toBe("connected");
    expect(useAuraStore.getState().syncMessage).toBe(t("ru", "googleDriveSyncCompleted"));
    expect(useAuraStore.getState().toasts).toHaveLength(1);
    expect(useAuraStore.getState().toasts[0]).toMatchObject({
      type: "success", title: t("ru", "googleDriveSyncCompleted"), message: t("ru", "googleDriveSyncCompletedDescription")
    });
    expect(await durable()).toEqual(before);
  });

  it("keeps an explicitly quiet uploaded result silent", async () => {
    await seed();
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult({
      status: "uploaded", reason: "replica_created", quiet: true,
      syncDeviceId: "local-device", syncConnectionId: "current-connection"
    });
    expect(useAuraStore.getState().syncStatus).toBe("connected");
    expect(useAuraStore.getState().toasts).toHaveLength(0);
  });

  it("clears a transient error after silent recovery without adding a toast or changing already connected UI", async () => {
    await seed();
    useAuraStore.setState({ syncStatus: "error", syncMessage: "Google temporarily unavailable" });
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult({ status: "in_sync", quiet: true });
    expect(useAuraStore.getState().syncStatus).toBe("connected");
    expect(useAuraStore.getState().syncMessage).not.toBe("Google temporarily unavailable");
    expect(useAuraStore.getState().toasts).toEqual([]);
    useAuraStore.setState({ syncMessage: "Existing success message" });
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult({ status: "in_sync", quiet: true });
    expect(useAuraStore.getState().syncMessage).toBe("Existing success message");
  });

  it("preserves busy status for local storage writes and releases it for a changed connection", async () => {
    const baseline = await seed();
    useAuraStore.setState({ syncStatus: "syncing" });
    const cleanup = installAuraStoreSyncLifecycle();
    const lifecycle = mocks.lifecycle.mock.calls[0][0] as { onDataChanged: (data: AuraStartData) => void };
    const metadataWrite = structuredClone(baseline);
    metadataWrite.settings.sync.lastCloudUpdatedAt = ISO;
    lifecycle.onDataChanged(metadataWrite);
    expect(useAuraStore.getState().syncStatus).toBe("syncing");
    const disconnected = structuredClone(metadataWrite);
    disconnected.settings.sync = { ...disconnected.settings.sync, mode: "off", connected: false, connectionId: "disconnected" };
    lifecycle.onDataChanged(disconnected);
    expect(useAuraStore.getState().syncStatus).toBe("idle");
    cleanup();
  });
});
