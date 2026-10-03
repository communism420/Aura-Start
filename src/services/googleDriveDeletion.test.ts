import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyData } from "../utils/sampleData";
import type { GoogleDriveFileMetadata } from "./googleDriveSync";

const FILE_NAME = "aura-start-sync.json";
const DEVICE_KEY = "aura-start-google-device-auth-token";
const APPDATA = "https://www.googleapis.com/auth/drive.appdata";
const FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
let route: Route;
let drive: typeof import("./googleDriveSync");
let fetchMock: ReturnType<typeof vi.fn>;
let storage: Record<string, unknown>;
let identity: { getAuthToken: ReturnType<typeof vi.fn>; removeCachedAuthToken: ReturnType<typeof vi.fn> };
let manifest: Record<string, unknown>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const failure = (status: number, message = "Request failed", reason?: string) => json({ error: { message, errors: reason ? [{ reason }] : [] } }, status);
const owned = (id: string, name = FILE_NAME): GoogleDriveFileMetadata => ({ id, name, appProperties: { auraStartSync: "true", auraStartDeviceId: "my-device" } });
const calls = () => fetchMock.mock.calls.map(([input, init = {}]) => ({ url: new URL(String(input)), init: init as RequestInit }));
const deletes = () => calls().filter(({ init }) => init.method === "DELETE");

beforeEach(async () => {
  vi.resetModules();
  storage = {};
  identity = {
    getAuthToken: vi.fn((_options, callback: (token: string) => void) => callback("renewed-token")),
    removeCachedAuthToken: vi.fn((_options, callback: () => void) => callback())
  };
  manifest = {
    manifest_version: 3, name: "Aura Start tests", version: "2.1.0",
    update_url: "https://clients2.google.com/service/update2/crx",
    oauth2: { client_id: "71648271904-testchromeclient.apps.googleusercontent.com", scopes: [APPDATA, FILE_SCOPE] }
  };
  vi.stubGlobal("browser", undefined);
  vi.stubGlobal("chrome", {
    identity,
    tabs: { create: (_properties: unknown, callback: () => void) => callback() },
    storage: { local: {
      get: (key: string, callback: (data: Record<string, unknown>) => void) => callback({ [key]: storage[key] }),
      set: (items: Record<string, unknown>, callback: () => void) => { Object.assign(storage, structuredClone(items)); callback(); },
      remove: (key: string, callback: () => void) => { delete storage[key]; callback(); }
    } },
    runtime: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", getManifest: () => manifest }
  });
  vi.stubGlobal("navigator", {
    languages: ["en"], language: "en", vendor: "Google Inc.", userAgent: "Chrome/130.0.0.0",
    userAgentData: { brands: [{ brand: "Google Chrome", version: "130" }] }
  });
  route = (url) => { throw new Error(`Unexpected mock request: ${url.pathname}`); };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => route(new URL(String(input)), init));
  vi.stubGlobal("fetch", fetchMock);
  drive = await import("./googleDriveSync");
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("complete Google Drive backup deletion", () => {
  it("deletes all marked renamed and trashed replicas plus legacy pages, preserving unrelated files", async () => {
    const gone = new Set<string>();
    route = (url, init) => {
      if (init.method === "DELETE") {
        gone.add(decodeURIComponent(url.pathname.split("/").at(-1)!));
        return new Response(null, { status: 204 });
      }
      const legacy = url.searchParams.get("spaces") === "appDataFolder";
      const query = url.searchParams.get("q")!;
      expect(query).not.toContain("trashed");
      if (!legacy) {
        expect(query).not.toContain("name =");
        expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
        expect(url.searchParams.get("supportsAllDrives")).toBe("true");
      }
      expect(url.searchParams.get("fields")).toContain("incompleteSearch");
      const page = url.searchParams.get("pageToken");
      const candidates = legacy
        ? page ? [{ id: "legacy-b", name: FILE_NAME }] : [{ id: "legacy-a", name: FILE_NAME }, { id: "other-legacy", name: "other.json" }]
        : page ? [owned("replica-b"), owned("renamed", "My saved Aura copy.json")]
          : [owned("replica-a"), { ...owned("trashed"), trashed: true }, { id: "unrelated", name: FILE_NAME }];
      return json({ files: candidates.filter((file) => !gone.has(file.id)), ...(!page ? { nextPageToken: "second" } : {}) });
    };
    await expect(drive.deleteSyncFile("chrome-token")).resolves.toEqual({ deleted: true, legacyAppData: "verified" });
    expect([...gone].sort()).toEqual(["legacy-a", "legacy-b", "renamed", "replica-a", "replica-b", "trashed"]);
    expect(deletes()).toHaveLength(6);
    expect(calls().filter(({ init }) => init.method !== "DELETE")).toHaveLength(8);
  });

  it("acquires a noninteractive usable token when none is supplied and verifies an empty account", async () => {
    route = () => json({ files: [] });
    await expect(drive.deleteSyncFile()).resolves.toEqual({ deleted: false, legacyAppData: "verified" });
    expect(identity.getAuthToken).toHaveBeenCalledWith({ interactive: false }, expect.any(Function));
    expect(calls().map(({ url }) => url.searchParams.get("spaces"))).toEqual(["drive", "appDataFolder"]);
  });

  it.each(["incompleteSearch", "repeatedPage", "laterPageFailure", "legacyDenied"])("does not delete anything after %s discovery", async (fault) => {
    route = (url) => {
      if (fault === "legacyDenied" && url.searchParams.get("spaces") === "appDataFolder") return failure(403, "Insufficient authentication scopes", "insufficientPermissions");
      if (fault === "incompleteSearch") return json({ files: [owned("a")], incompleteSearch: true });
      if (fault === "repeatedPage") return json({ files: [owned("a")], nextPageToken: "same" });
      if (fault === "laterPageFailure") return url.searchParams.has("pageToken") ? failure(503) : json({ files: [owned("a")], nextPageToken: "next" });
      return json({ files: [owned("a")] });
    };
    await expect(drive.deleteSyncFile("chrome-token")).rejects.toThrow();
    expect(deletes()).toHaveLength(0);
    expect(identity.removeCachedAuthToken).not.toHaveBeenCalled();
  });

  it("treats a concurrent DELETE 404 as absent, then verifies the listing", async () => {
    let gone = false;
    route = (url, init) => {
      if (init.method === "DELETE") { gone = true; return failure(404); }
      return json({ files: !gone && url.searchParams.get("spaces") === "drive" ? [owned("a")] : [] });
    };
    await expect(drive.deleteSyncFile("chrome-token")).resolves.toEqual({ deleted: true, legacyAppData: "verified" });
    expect(deletes()).toHaveLength(1);
    expect(calls()).toHaveLength(5);
  });

  it.each([403, 429, 503])("reports partial deletion on DELETE %i and leaves authorization available for retry", async (status) => {
    const gone = new Set<string>();
    let fail = true;
    route = (url, init) => {
      if (init.method === "DELETE") {
        const id = url.pathname.split("/").at(-1)!;
        if (id === "b" && fail) return failure(status);
        gone.add(id); return new Response(null, { status: 204 });
      }
      return json({ files: url.searchParams.get("spaces") === "drive" ? [owned("a"), owned("b")].filter((file) => !gone.has(file.id)) : [] });
    };
    await expect(drive.deleteSyncFile("chrome-token")).rejects.toMatchObject({ status });
    expect([...gone]).toEqual(["a"]);
    expect(identity.removeCachedAuthToken).not.toHaveBeenCalled();
    expect(calls().some(({ url }) => url.pathname === "/revoke")).toBe(false);
    fail = false;
    await expect(drive.deleteSyncFile("chrome-token")).resolves.toEqual({ deleted: true, legacyAppData: "verified" });
    expect([...gone]).toEqual(["a", "b"]);
  });

  it("removes a replica created during deletion before reporting success", async () => {
    const files = new Set(["a"]);
    route = (url, init) => {
      if (init.method === "DELETE") {
        const id = url.pathname.split("/").at(-1)!;
        files.delete(id); if (id === "a") files.add("late-peer");
        return new Response(null, { status: 204 });
      }
      return json({ files: url.searchParams.get("spaces") === "drive" ? [...files].map((id) => owned(id)) : [] });
    };
    await expect(drive.deleteSyncFile("chrome-token")).resolves.toEqual({ deleted: true, legacyAppData: "verified" });
    expect(deletes().map(({ url }) => url.pathname.split("/").at(-1))).toEqual(["a", "late-peer"]);
    expect(files.size).toBe(0);
  });

  it("fails after three deletion passes when a device keeps recreating the backup", async () => {
    route = (url, init) => init.method === "DELETE" ? new Response(null, { status: 204 })
      : json({ files: url.searchParams.get("spaces") === "drive" ? [owned("recreated")] : [] });
    await expect(drive.deleteSyncFile("chrome-token")).rejects.toThrow("still present");
    expect(deletes()).toHaveLength(3);
    expect(calls()).toHaveLength(11);
  });

  it("does not claim success when final confirmation cannot be read", async () => {
    let gone = false;
    route = (url, init) => {
      if (init.method === "DELETE") { gone = true; return new Response(null, { status: 204 }); }
      if (gone) return failure(503);
      return json({ files: url.searchParams.get("spaces") === "drive" ? [owned("a")] : [] });
    };
    await expect(drive.deleteSyncFile("chrome-token")).rejects.toMatchObject({ status: 503 });
    expect(deletes()).toHaveLength(1);
  });

  it("renews a DELETE 401 once and disconnects locally after verified deletion without revoking other devices", async () => {
    let gone = false;
    route = (url, init) => {
      if (url.pathname === "/revoke") throw new Error("Local disconnect must not revoke the shared Google grant");
      if (init.method === "DELETE") {
        if (new Headers(init.headers).get("Authorization") === "Bearer expired-token") return failure(401);
        gone = true; return new Response(null, { status: 204 });
      }
      return json({ files: !gone && url.searchParams.get("spaces") === "drive" ? [owned("a")] : [] });
    };
    await drive.deleteSyncFile("expired-token");
    await expect(drive.disconnectGoogleAccount("expired-token")).resolves.toEqual({ revokeError: undefined });
    expect(gone).toBe(true);
    expect(calls().some(({ url }) => url.pathname === "/revoke")).toBe(false);
    expect(identity.getAuthToken).toHaveBeenCalledTimes(1);
    expect(identity.removeCachedAuthToken.mock.calls.map(([options]) => options.token)).toEqual(["expired-token", "renewed-token"]);
  });

  it("stops after the renewed DELETE token also returns 401", async () => {
    route = (url, init) => init.method === "DELETE" ? failure(401)
      : json({ files: url.searchParams.get("spaces") === "drive" ? [owned("a")] : [] });
    const error = await drive.deleteSyncFile("expired-token").catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 401 });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(deletes()).toHaveLength(2);
    expect(identity.getAuthToken).toHaveBeenCalledTimes(1);
  });
});

describe("deleted peer upload protection", () => {
  it("does not recreate a previously observed owned replica missing from a later listing", async () => {
    route = () => json({ files: [] });
    await expect(drive.uploadSyncFile(createEmptyData(), { deviceId: "my-device", fileId: "deleted", expectedExistingFile: true, token: "chrome-token" }))
      .rejects.toMatchObject({ code: "cloud_deleted" });
    expect(calls().some(({ init }) => init.method === "POST" || init.method === "PATCH")).toBe(false);
  });

  it("does not recreate the shared file deleted between reading and conditional PUT", async () => {
    const remote = createEmptyData();
    const local = structuredClone(remote);
    local.groups = [{ id: "local-group", title: "Unsynced group", parentId: null, collapsed: false, order: 0, links: [] }];
    const shared = { ...owned("a"), version: "1", appProperties: { auraStartSync: "true", auraStartSharedSync: "1" } };
    let deleted = false;
    route = (url, init) => {
      if (init.method === "PUT") { deleted = true; return failure(404); }
      if (url.pathname === "/drive/v3/files") return json({ files: !deleted && url.searchParams.get("spaces") === "drive" ? [shared] : [] });
      if (url.pathname === "/drive/v2/files/a") return json({ id: "a", title: shared.name, etag: '"revision-1"', version: "1",
        properties: Object.entries(shared.appProperties).map(([key, value]) => ({ key, value, visibility: "PRIVATE" })) });
      if (url.searchParams.get("alt") === "media") return json({ schemaVersion: 1, app: "Aura Start", appVersion: "2.1.0",
        deviceId: remote.settings.sync.deviceId, updatedAt: remote.updatedAt, data: remote });
      throw new Error(`Unexpected Drive request ${url.pathname}`);
    };
    await expect(drive.uploadSyncFile(local, { deviceId: "my-device", fileId: "a", token: "chrome-token" }))
      .rejects.toMatchObject({ code: "cloud_deleted" });
    expect(calls().filter(({ init }) => init.method === "PUT")).toHaveLength(1);
    expect(calls().filter(({ init }) => init.method === "POST")).toHaveLength(0);
  });
});

describe("deletion-specific OAuth permission", () => {
  it("checks both spaces with an existing grant without requesting additional authentication", async () => {
    route = () => json({ files: [] });
    await expect(drive.getGoogleDriveDeletionAuthToken(true)).resolves.toBe("renewed-token");
    expect(calls()).toHaveLength(2);
    expect(calls().map(({ url }) => url.searchParams.get("spaces"))).toEqual(["drive", "appDataFolder"]);
    expect(identity.getAuthToken).toHaveBeenCalledWith({ interactive: false }, expect.any(Function));
  });

  it("requires explicit reconnection if the prior Chrome grant is missing instead of opening another account", async () => {
    identity.getAuthToken.mockImplementation((options: { interactive: boolean }, callback: (token?: string) => void) => callback(options.interactive ? "another-account" : undefined));
    await expect(drive.getGoogleDriveDeletionAuthToken(true)).rejects.toMatchObject({ code: "unauthorized" });
    expect(identity.getAuthToken).toHaveBeenCalledTimes(1);
    expect(identity.getAuthToken.mock.calls[0][0]).toEqual({ interactive: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never reports a permission failure as an empty legacy backup", async () => {
    route = () => failure(403, "Insufficient authentication scopes", "insufficientPermissions");
    await expect(drive.getGoogleDriveDeletionAuthToken(false)).rejects.toMatchObject({ code: "unauthorized", reason: "deletion_scope_required" });
    expect(deletes()).toHaveLength(0);
  });

  describe.skipIf(!__AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__)("Device OAuth deletion without an unsupported scope upgrade", () => {
    function installDeviceSession(scopes?: string[]): unknown {
      delete manifest.update_url;
      const previous = { token: "device-original", refreshToken: "refresh-original", expiresAt: Date.now() + 3_600_000,
        ...(scopes ? { grantedScopes: scopes } : {}) };
      storage[DEVICE_KEY] = structuredClone(previous);
      return previous;
    }

    function rejectUnsupportedDeviceGrant(url: URL): Response | undefined {
      if (url.pathname !== "/device/code") return undefined;
      return json({ error: "invalid_scope", error_description: `Invalid device flow scope: ${APPDATA}` }, 400);
    }

    it("deletes all current and 2.0.5 Device files, including renamed/trash copies and later pages, without appData authorization", async () => {
      const previous = installDeviceSession([FILE_SCOPE]);
      const gone = new Set<string>();
      route = (url, init) => {
        const unsupported = rejectUnsupportedDeviceGrant(url);
        if (unsupported) return unsupported;
        expect(url.pathname).not.toBe("/token");
        if (init.method === "DELETE") {
          gone.add(url.pathname.split("/").at(-1)!);
          return new Response(null, { status: 204 });
        }
        expect(url.searchParams.get("spaces")).toBe("drive");
        if (url.searchParams.get("pageSize") === "1") return json({ files: [] });
        const candidates = url.searchParams.has("pageToken")
          ? [{ id: "legacy-205", name: FILE_NAME, appProperties: { auraStartSync: "true" } }, owned("renamed", "renamed.json")]
          : [owned("current"), { ...owned("trashed"), trashed: true }, { id: "unrelated", name: FILE_NAME }];
        expect(url.searchParams.get("q")).not.toMatch(/name =|trashed/);
        return json({ files: candidates.filter((file) => !gone.has(file.id)),
          ...(!url.searchParams.has("pageToken") ? { nextPageToken: "second" } : {}) });
      };
      const token = await drive.getGoogleDriveDeletionAuthToken(true);
      await expect(drive.deleteSyncFile(token)).resolves.toEqual({ deleted: true, legacyAppData: "unavailable" });
      expect([...gone].sort()).toEqual(["current", "legacy-205", "renamed", "trashed"]);
      expect(storage[DEVICE_KEY]).toEqual(previous);
      expect(identity.getAuthToken).not.toHaveBeenCalled();
      expect(calls().some(({ url }) => url.pathname === "/device/code")).toBe(false);
    });

    it("reports unavailable legacy storage separately when an older Device credential's scopes are unknown", async () => {
      installDeviceSession();
      route = (url) => rejectUnsupportedDeviceGrant(url)
        ?? (url.searchParams.get("spaces") === "appDataFolder"
          ? failure(403, "The granted scopes do not give access to all of the requested spaces.", "forbidden")
          : json({ files: [] }));
      const token = await drive.getGoogleDriveDeletionAuthToken(true);
      await expect(drive.deleteSyncFile(token)).resolves.toEqual({ deleted: false, legacyAppData: "unavailable" });
      expect(calls().filter(({ url }) => url.searchParams.get("spaces") === "appDataFolder")).toHaveLength(1);
      expect(calls().some(({ url }) => url.pathname === "/device/code")).toBe(false);
    });

    it("does not open a new Device account sign-in when the existing session is missing", async () => {
      installDeviceSession();
      delete storage[DEVICE_KEY];
      await expect(drive.getGoogleDriveDeletionAuthToken(true)).rejects.toMatchObject({ code: "unauthorized" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storage[DEVICE_KEY]).toBeUndefined();
    });

    it("renews an expired existing session silently without requesting unsupported deletion permissions", async () => {
      installDeviceSession([FILE_SCOPE]);
      storage[DEVICE_KEY] = { ...(storage[DEVICE_KEY] as object), expiresAt: Date.now() - 1 };
      route = (url) => url.pathname === "/token"
        ? json({ access_token: "refreshed-device", expires_in: 3600, scope: FILE_SCOPE }) : json({ files: [] });
      const token = await drive.getGoogleDriveDeletionAuthToken(true);
      expect(token).toBe("refreshed-device");
      await expect(drive.deleteSyncFile(token)).resolves.toEqual({ deleted: false, legacyAppData: "unavailable" });
      expect(storage[DEVICE_KEY]).toMatchObject({ token: "refreshed-device", refreshToken: "refresh-original", grantedScopes: [FILE_SCOPE] });
      expect(calls().some(({ url }) => url.pathname === "/device/code" || url.searchParams.get("spaces") === "appDataFolder")).toBe(false);
    });

    it.each(["network", "file-acl", "incompleteSearch", "repeatedPage", "laterPage"])("does not mask a legacy %s error as unavailable or delete files before discovery completes", async (fault) => {
      installDeviceSession();
      route = (url) => {
        if (url.searchParams.get("spaces") !== "appDataFolder") return json({ files: [owned("current")] });
        if (fault === "network") return failure(503);
        if (fault === "file-acl") return failure(403, "Insufficient permissions for this file.", "insufficientFilePermissions");
        if (url.searchParams.get("pageSize") === "1") return json({ files: [] });
        if (fault === "incompleteSearch") return json({ files: [], incompleteSearch: true });
        if (fault === "repeatedPage") return json({ files: [], nextPageToken: "same" });
        return url.searchParams.has("pageToken") ? failure(503) : json({ files: [], nextPageToken: "next" });
      };
      const token = await drive.getGoogleDriveDeletionAuthToken(true);
      await expect(drive.deleteSyncFile(token)).rejects.toThrow();
      expect(deletes()).toHaveLength(0);
      expect(storage[DEVICE_KEY]).toMatchObject({ token: "device-original" });
    });

    it("fails if legacy access is lost after a successful probe instead of downgrading the verified space", async () => {
      installDeviceSession();
      route = (url) => {
        if (url.searchParams.get("spaces") !== "appDataFolder") return json({ files: [owned("current")] });
        return url.searchParams.get("pageSize") === "1" ? json({ files: [] })
          : failure(403, "The granted scopes do not give access to all of the requested spaces.", "forbidden");
      };
      const token = await drive.getGoogleDriveDeletionAuthToken(true);
      await expect(drive.deleteSyncFile(token)).rejects.toMatchObject({ code: "forbidden" });
      expect(deletes()).toHaveLength(0);
    });

    it("fails if verified legacy access is lost during the final rescan", async () => {
      installDeviceSession();
      let gone = false;
      route = (url, init) => {
        if (init.method === "DELETE") { gone = true; return new Response(null, { status: 204 }); }
        if (url.searchParams.get("spaces") === "appDataFolder") return gone
          ? failure(403, "Insufficient authentication scopes", "insufficientPermissions") : json({ files: [] });
        return json({ files: gone ? [] : [owned("current")] });
      };
      const token = await drive.getGoogleDriveDeletionAuthToken(true);
      await expect(drive.deleteSyncFile(token)).rejects.toMatchObject({ code: "forbidden" });
      expect(deletes()).toHaveLength(1);
    });
  });
});

describe("disconnect token cleanup", () => {
  it("clears local credentials without contacting Google's revocation endpoint", async () => {
    storage[DEVICE_KEY] = { token: "old-device", refreshToken: "old-refresh", expiresAt: Date.now() + 3_600_000 };
    route = () => failure(503);
    const nativeToken = await drive.getAuthToken(false);
    const result = await drive.disconnectGoogleAccount(nativeToken);
    expect(result.revokeError).toBeUndefined();
    expect(storage[DEVICE_KEY]).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(identity.removeCachedAuthToken).toHaveBeenCalledWith({ token: nativeToken }, expect.any(Function));
  });

  it("still clears the Chrome identity cache when credential storage removal fails", async () => {
    const nativeToken = await drive.getAuthToken(false);
    const area = chrome.storage.local as unknown as { remove: (key: string, callback: () => void) => void };
    area.remove = () => { throw new Error("Credential storage unavailable"); };
    await expect(drive.clearAuthToken(nativeToken)).rejects.toThrow("Credential storage unavailable");
    expect(identity.removeCachedAuthToken).toHaveBeenCalledWith({ token: nativeToken }, expect.any(Function));
  });
});
