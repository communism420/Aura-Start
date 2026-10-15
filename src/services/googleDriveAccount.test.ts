import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import type { AuraStartData, AuraSyncSettings } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData, updateAuraData } from "../utils/storage";
import { sameSyncContent } from "../utils/syncReplica";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), account: vi.fn() }));
vi.mock("./googleDriveSync", () => ({
  getAuthToken: mocks.auth,
  getConnectedAccountInfo: mocks.account
}));

const NOW = "2026-10-15T10:00:00.000Z";
const BEFORE = "2026-10-14T09:00:00.000Z";
let stored: Record<string, unknown>;
let write: ReturnType<typeof vi.fn>;
let refresh: typeof import("./googleDriveAccount").refreshGoogleDriveAccountInfo;

function fixture(patch: Partial<AuraSyncSettings> = {}): AuraStartData {
  const data = createEmptyData();
  delete data.settingsCompatibility;
  data.updatedAt = BEFORE;
  data.settings.notes.text = "Keep my note";
  data.settings.sync = {
    ...data.settings.sync, mode: "auto", connected: true, deviceId: "this-device",
    connectionId: "this-connection", cloudFileId: "shared-file", lastSyncedAt: BEFORE,
    lastSyncedLocalUpdatedAt: BEFORE, lastCloudUpdatedAt: BEFORE, ...patch
  };
  data.groups = [{
    id: "group", title: "My links", parentId: null, order: 0, collapsed: false,
    links: [{ id: "link", title: "My link", url: "https://example.test/", order: 0,
      createdAt: BEFORE, updatedAt: BEFORE }]
  }];
  data.restorePoints = [{
    id: "history", name: "Keep my recovery point", reason: "manual", createdAt: BEFORE,
    data: { version: data.version, updatedAt: BEFORE, groups: structuredClone(data.groups),
      settings: structuredClone(data.settings) }
  }];
  return data;
}

async function durable(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error(`Unexpected storage status: ${loaded.status}`);
  return loaded.data;
}

function heldLookup() {
  let resolve!: (value: { email: string; name: string }) => void;
  let started!: () => void;
  const called = new Promise<void>((ready) => { started = ready; });
  const result = new Promise<{ email: string; name: string }>((ready) => { resolve = ready; });
  mocks.account.mockImplementationOnce(() => { started(); return result; });
  return { called, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  stored = {};
  write = vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
    set: write,
    remove: async (key: string) => { delete stored[key]; }
  } } });
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Unexpected direct network request"))));
  mocks.auth.mockResolvedValue("silent-token");
  mocks.account.mockResolvedValue({ email: "drive@example.test", name: "Drive account" });
  refresh = (await import("./googleDriveAccount")).refreshGoogleDriveAccountInfo;
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("quiet Google Drive account hydration", () => {
  it("hydrates an already connected clean installation without changing user data or dirtying sync", async () => {
    const before = await saveAuraData(fixture());
    await refresh();
    const after = await durable();
    expect(after.settings.sync).toMatchObject({
      accountEmail: "drive@example.test", accountName: "Drive account", accountInfoUpdatedAt: NOW,
      connected: true, connectionId: "this-connection", mode: "auto", reconnectRequired: false
    });
    expect(mocks.auth).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.account).toHaveBeenCalledExactlyOnceWith("silent-token");
    expect(fetch).not.toHaveBeenCalled();
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.settings.sync.lastSyncedLocalUpdatedAt).toBe(after.updatedAt);
    expect(after.settings.sync.lastSyncedAt).toBe(before.settings.sync.lastSyncedAt);
    expect(after.settings.sync.lastCloudUpdatedAt).toBe(before.settings.sync.lastCloudUpdatedAt);
    expect(after.syncReplica).toEqual(before.syncReplica);
    expect(after.restorePoints).toEqual(before.restorePoints);
    expect(sameSyncContent(before, after)).toBe(true);
  });

  it("replaces unverified legacy browser-profile identity even when an email already exists", async () => {
    const before = await saveAuraData(fixture({
      accountEmail: "browser-profile@example.test", accountName: "Browser profile",
      accountAvatarUrl: "https://example.test/old-avatar.png"
    }));
    await refresh(before.settings.sync, "authorized-drive-token");
    const after = await durable();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.account).toHaveBeenCalledExactlyOnceWith("authorized-drive-token");
    expect(after.settings.sync.accountEmail).toBe("drive@example.test");
    expect(after.settings.sync.accountName).toBe("Drive account");
    expect(after.settings.sync.accountAvatarUrl).toBeUndefined();
  });

  it("can identify a retained paused connection without resuming synchronization", async () => {
    const before = await saveAuraData(fixture({ mode: "off", reconnectRequired: true }));
    await refresh(before.settings.sync);
    const after = await durable();
    expect(after.settings.sync).toMatchObject({ mode: "off", connected: true, reconnectRequired: true,
      accountEmail: "drive@example.test" });
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(mocks.auth).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each(["missing", "disconnected"] as const)("does not authorize or look up an account for %s local data", async (state) => {
    if (state === "disconnected") await saveAuraData(fixture({ connected: false, mode: "off" }));
    await refresh();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it("reuses verified identity within 24 hours and refreshes it after expiration", async () => {
    const data = fixture({ accountEmail: "cached@example.test", accountName: "Cached account" });
    data.settings.sync.accountInfoUpdatedAt = "2026-10-15T09:00:00.000Z";
    await saveAuraData(data);
    await refresh();
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-16T10:00:00.000Z"));
    await refresh();
    expect(mocks.account).toHaveBeenCalledTimes(1);
    expect((await durable()).settings.sync.accountEmail).toBe("drive@example.test");
  });

  it("retains cached identity on failure and retries after its persistent cooldown", async () => {
    const before = await saveAuraData(fixture({ accountEmail: "cached@example.test", accountName: "Known account" }));
    mocks.account.mockRejectedValueOnce(new Error("Temporary Drive outage"));
    await expect(refresh()).resolves.toBeUndefined();
    expect(await durable()).toEqual(before);
    vi.resetModules();
    refresh = (await import("./googleDriveAccount")).refreshGoogleDriveAccountInfo;
    await refresh();
    expect(mocks.account).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.parse(NOW) + 60_001));
    await refresh();
    expect(mocks.account).toHaveBeenCalledTimes(2);
    expect((await durable()).settings.sync.accountEmail).toBe("drive@example.test");
  });

  it("does not open interactive authorization or damage the connection when silent token retrieval fails", async () => {
    const before = await saveAuraData(fixture());
    mocks.auth.mockRejectedValueOnce(new Error("Authorization temporarily unavailable"));
    await expect(refresh()).resolves.toBeUndefined();
    expect(mocks.auth).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.account).not.toHaveBeenCalled();
    expect(await durable()).toEqual(before);
    await refresh();
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });

  it("keeps an in-memory retry cooldown when replacing an expired persistent attempt fails", async () => {
    await saveAuraData(fixture());
    mocks.account.mockRejectedValue(new Error("Temporary Drive outage"));
    await refresh();
    vi.setSystemTime(new Date(Date.parse(NOW) + 60_001));
    write.mockImplementation(async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, "aura-start-google-drive-account-attempt-v1")) throw new Error("Cursor write failed");
      Object.assign(stored, structuredClone(items));
    });
    await refresh();
    expect(mocks.account).toHaveBeenCalledTimes(2);
    await refresh();
    expect(mocks.account).toHaveBeenCalledTimes(2);
  });

  it("waits while offline without consuming the next online hydration attempt", async () => {
    await saveAuraData(fixture());
    vi.stubGlobal("navigator", { onLine: false });
    await refresh();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.account).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
    await refresh();
    expect(mocks.account).toHaveBeenCalledTimes(1);
  });

  it("does not certify an empty account response and retries later", async () => {
    const before = await saveAuraData(fixture());
    mocks.account.mockResolvedValueOnce(undefined);
    await refresh();
    expect(await durable()).toEqual(before);
    vi.setSystemTime(new Date(Date.parse(NOW) + 60_001));
    await refresh();
    expect((await durable()).settings.sync.accountEmail).toBe("drive@example.test");
  });

  it("coalesces simultaneous hydration calls into one account lookup", async () => {
    const before = await saveAuraData(fixture());
    const held = heldLookup();
    const first = refresh(before.settings.sync, "same-token");
    await held.called;
    const second = refresh(before.settings.sync, "same-token");
    held.resolve({ email: "drive@example.test", name: "Drive account" });
    await Promise.all([first, second]);
    expect(mocks.account).toHaveBeenCalledTimes(1);
  });

  it.each([
    { deviceId: "replacement-device" },
    { connectionId: "replacement-connection" },
    { connected: false, mode: "off" as const },
    { mode: "off" as const },
    { reconnectRequired: true }
  ])("rejects an obsolete starting connection before requesting identity (%j)", async (patch) => {
    const before = await saveAuraData(fixture());
    await updateAuraData((current) => ({ ...current, settings: { ...current.settings,
      sync: { ...current.settings.sync, ...patch } } }));
    await refresh(before.settings.sync, "stale-token");
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it.each(["disconnect", "replacement", "pause"] as const)("discards a late account response after %s", async (change) => {
    const before = await saveAuraData(fixture());
    const held = heldLookup();
    const pending = refresh(before.settings.sync, "old-token");
    await held.called;
    const next = await updateAuraData((current) => ({ ...current, settings: { ...current.settings,
      sync: { ...current.settings.sync,
        ...(change === "disconnect" ? { connected: false, mode: "off" as const, accountEmail: undefined }
          : change === "replacement" ? { connectionId: "new-connection", accountEmail: "new@example.test" }
            : { mode: "off" as const }) } } }));
    held.resolve({ email: "old@example.test", name: "Old account" });
    await pending;
    expect(await durable()).toEqual(next);
  });

  it("preserves edits and sync acknowledgements that arrive while identity is loading", async () => {
    const before = await saveAuraData(fixture());
    const held = heldLookup();
    const pending = refresh(before.settings.sync, "same-token");
    await held.called;
    const edit = structuredClone(before);
    edit.groups[0].links[0].title = "Edited during account lookup";
    edit.settings.notes.text = "New note from another page";
    await saveAuraData(edit, { baseline: before });
    const newer = await updateAuraData((current) => ({ ...current, settings: { ...current.settings,
      sync: { ...current.settings.sync, lastSyncedAt: NOW, lastSyncedLocalUpdatedAt: current.updatedAt } } }));
    held.resolve({ email: "drive@example.test", name: "Drive account" });
    await pending;
    const after = await durable();
    expect(after.groups).toEqual(newer!.groups);
    expect(after.settings.notes).toEqual(newer!.settings.notes);
    expect(after.updatedAt).toBe(newer!.updatedAt);
    expect(after.settings.sync.lastSyncedLocalUpdatedAt).toBe(newer!.updatedAt);
    expect(after.settings.sync.lastSyncedAt).toBe(NOW);
    expect(after.syncReplica).toEqual(newer!.syncReplica);
    expect(after.restorePoints).toEqual(newer!.restorePoints);
    expect(after.settings.sync.accountEmail).toBe("drive@example.test");
  });

  it("does not let a previous connection's retry cooldown delay a newly linked account", async () => {
    await saveAuraData(fixture());
    mocks.account.mockRejectedValueOnce(new Error("Temporary failure for old connection"));
    await refresh();
    await updateAuraData((current) => ({ ...current, settings: { ...current.settings,
      sync: { ...current.settings.sync, connectionId: "new-connection" } } }));
    await refresh();
    expect(mocks.account).toHaveBeenCalledTimes(2);
    expect((await durable()).settings.sync.accountEmail).toBe("drive@example.test");
  });

  it("leaves user data intact when saving account metadata fails", async () => {
    const before = await saveAuraData(fixture());
    write.mockImplementation(async (items: Record<string, unknown>) => {
      if (Object.hasOwn(items, STORAGE_KEY)) throw new Error("Local storage unavailable");
      Object.assign(stored, structuredClone(items));
    });
    await expect(refresh()).resolves.toBeUndefined();
    expect(await durable()).toEqual(before);
  });
});
