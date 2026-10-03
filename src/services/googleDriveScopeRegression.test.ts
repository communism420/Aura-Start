import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FILE = "https://www.googleapis.com/auth/drive.file";
const APPDATA = "https://www.googleapis.com/auth/drive.appdata";
const DEVICE_KEY = "aura-start-google-device-auth-token";
const WEB_KEY = "aura-start-google-web-auth-token";
const SPACES_ERROR = "The granted scopes do not give access to all of the requested spaces.";
type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
let route: Route;
let drive: typeof import("./googleDriveSync");
let fetchMock: ReturnType<typeof vi.fn>;
let stored: Record<string, unknown>;
let identity: { getAuthToken: ReturnType<typeof vi.fn>; removeCachedAuthToken: ReturnType<typeof vi.fn> };
let manifest: Record<string, unknown>;
let runtime: { id: string; getManifest: () => Record<string, unknown> };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const requests = () => fetchMock.mock.calls.map(([input, init = {}]) => ({ url: new URL(String(input)), init: init as RequestInit }));
const mutations = () => requests().filter(({ init }) => init.method === "DELETE" || init.method === "PATCH");

function scopeError(reason?: string, structured = false) {
  return json({ error: {
    code: 403, status: "PERMISSION_DENIED", message: structured ? "Request had insufficient authentication scopes." : SPACES_ERROR,
    ...(reason ? { errors: [{ domain: "global", reason }] } : {}),
    ...(structured ? { message: "Access denied.", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", domain: "googleapis.com" }] } : {})
  } }, 403);
}

function profile(kind: "helium" | "firefox" | "chrome") {
  if (kind === "chrome") manifest.update_url = "https://clients2.google.com/service/update2/crx";
  else delete manifest.update_url;
  runtime.id = kind === "firefox" ? "aura-start@example.test" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  vi.stubGlobal("navigator", {
    language: "en", languages: ["en"], vendor: kind === "firefox" ? "" : "Google Inc.",
    userAgent: kind === "firefox" ? "Firefox/145.0" : kind === "helium" ? "Helium Chrome/140.0.0.0" : "Chrome/140.0.0.0",
    userAgentData: kind === "firefox" ? undefined : { brands: [{ brand: kind === "helium" ? "Chromium" : "Google Chrome", version: "140" }] }
  });
}

function seedDevice(scopes?: string[]) {
  stored[DEVICE_KEY] = {
    token: "device-prior", refreshToken: "refresh-prior", expiresAt: Date.now() + 3_600_000,
    ...(scopes ? { grantedScopes: scopes } : {})
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  stored = {};
  manifest = { manifest_version: 3, version: "2.1.0", oauth2: {
    client_id: "71648271904-testchromeclient.apps.googleusercontent.com", scopes: [FILE, APPDATA]
  } };
  runtime = { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", getManifest: () => manifest };
  identity = {
    getAuthToken: vi.fn((_options, callback: (token: string) => void) => callback("chrome-native")),
    removeCachedAuthToken: vi.fn((_options, callback: () => void) => callback())
  };
  vi.stubGlobal("browser", undefined);
  vi.stubGlobal("chrome", { runtime, identity,
    tabs: { create: (_options: unknown, callback: () => void) => callback() },
    storage: { local: {
      get: (key: string, callback: (result: Record<string, unknown>) => void) => callback({ [key]: structuredClone(stored[key]) }),
      set: (items: Record<string, unknown>, callback: () => void) => { Object.assign(stored, structuredClone(items)); callback(); },
      remove: (key: string, callback: () => void) => { delete stored[key]; callback(); }
    } }
  });
  profile("helium");
  route = (url) => { throw new Error(`Unexpected mock request: ${url.pathname}`); };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => route(new URL(String(input)), init));
  vi.stubGlobal("fetch", fetchMock);
  drive = await import("./googleDriveSync");
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe.skipIf(!__AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__)("realistic Device OAuth permission limits", () => {
  function installFileOnlyRoute(options: { reason?: string; structured?: boolean; knownScopes?: boolean } = {}) {
    seedDevice(options.knownScopes ? [FILE] : undefined);
    const files = new Set(["current"]);
    route = (url, init) => {
      // The real configured Google endpoint rejects this unsupported scope.
      // Deletion must succeed for its Drive files without invoking that flow.
      if (url.pathname === "/device/code") return json({ error: "invalid_scope", error_description: `Invalid device flow scope: ${APPDATA}` }, 400);
      if (url.searchParams.get("spaces") === "appDataFolder") return scopeError(options.reason, options.structured);
      if (init.method === "DELETE") { files.delete(url.pathname.split("/").at(-1)!); return new Response(null, { status: 204 }); }
      return json({ files: [...files].map((id) => ({ id, name: "aura-start-sync.json", appProperties: { auraStartSync: "true" } })) });
    };
    return files;
  }

  it.each(["forbidden", "insufficientFilePermissions", undefined])("handles the exact requested-spaces error with reason=%s without unsupported scope authorization", async (reason) => {
    const files = installFileOnlyRoute({ reason });
    const previous = structuredClone(stored[DEVICE_KEY]);
    const token = await drive.getGoogleDriveDeletionAuthToken(true);
    expect(mutations()).toHaveLength(0);
    await expect(drive.deleteSyncFile(token)).resolves.toEqual({ deleted: true, legacyAppData: "unavailable" });
    expect(files.size).toBe(0);
    expect(stored[DEVICE_KEY]).toEqual(previous);
    expect(requests().some(({ url }) => url.pathname === "/device/code" || url.pathname === "/token")).toBe(false);
    expect(identity.getAuthToken).not.toHaveBeenCalled();
  });

  it("recognizes structured ACCESS_TOKEN_SCOPE_INSUFFICIENT without pretending the inaccessible legacy space was empty", async () => {
    installFileOnlyRoute({ reason: "forbidden", structured: true });
    const token = await drive.getGoogleDriveDeletionAuthToken(true);
    await expect(drive.deleteSyncFile(token)).resolves.toEqual({ deleted: true, legacyAppData: "unavailable" });
    expect(requests().some(({ url }) => url.pathname === "/device/code")).toBe(false);
  });

  it("does not probe appData for a known drive.file-only grant", async () => {
    installFileOnlyRoute({ knownScopes: true });
    const token = await drive.getGoogleDriveDeletionAuthToken(true);
    await expect(drive.deleteSyncFile(token)).resolves.toEqual({ deleted: true, legacyAppData: "unavailable" });
    expect(requests().some(({ url }) => url.searchParams.get("spaces") === "appDataFolder" || url.pathname === "/device/code")).toBe(false);
  });

  it.each(["The user does not have sufficient permissions for file abc.", "Insufficient permissions for this file."])("does not skip an ordinary legacy file ACL failure: %s", async (message) => {
    seedDevice();
    route = (url) => url.searchParams.get("spaces") === "appDataFolder"
      ? json({ error: { code: 403, message, errors: [{ reason: "insufficientFilePermissions" }] } }, 403) : json({ files: [] });
    const token = await drive.getGoogleDriveDeletionAuthToken(true);
    const error = await drive.deleteSyncFile(token).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "forbidden" });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(requests().some(({ url }) => url.pathname === "/device/code")).toBe(false);
    expect(mutations()).toHaveLength(0);
  });

  it("requires a usable Drive grant rather than hiding ordinary Drive scope failure", async () => {
    seedDevice([FILE]);
    route = () => scopeError("forbidden");
    const previous = structuredClone(stored[DEVICE_KEY]);
    await expect(drive.getGoogleDriveDeletionAuthToken(true)).rejects.toMatchObject({ code: "unauthorized", reason: "deletion_scope_required" });
    expect(stored[DEVICE_KEY]).toEqual(previous);
    expect(requests()).toHaveLength(1);
    expect(mutations()).toHaveLength(0);
  });

  it.each([{ grantedScopes: [] }, { grantedScopes: [APPDATA] }])("rejects actual granted scopes $grantedScopes that omit drive.file during ordinary Device connect", async ({ grantedScopes }) => {
    route = (url, init) => {
      if (url.pathname === "/device/code") {
        expect(new URLSearchParams(String(init.body)).get("scope")).toBe(FILE);
        return json({ device_code: "test-code", user_code: "CODE", verification_url: "https://example.test/consent", expires_in: 30, interval: 1 });
      }
      if (url.pathname === "/token") return json({ access_token: "new-device", refresh_token: "new-refresh", expires_in: 3600, scope: grantedScopes.join(" ") });
      throw new Error("No Drive request expected before a sufficient grant");
    };
    const pending = expect(drive.getAuthToken(true)).rejects.toMatchObject({ code: "forbidden", reason: "insufficientPermissions" });
    await vi.advanceTimersByTimeAsync(1_100);
    await pending;
    expect(stored[DEVICE_KEY]).toBeUndefined();
  });

  it.each([false, true])("retains actual scopes through a worker reload and refresh response scope-present=%s", async (includeScope) => {
    seedDevice([FILE, "openid"]);
    stored[DEVICE_KEY] = { ...(stored[DEVICE_KEY] as object), expiresAt: Date.now() - 1 };
    route = (url) => url.pathname === "/token"
      ? json({ access_token: "refreshed-device", expires_in: 3600, ...(includeScope ? { scope: FILE } : {}) }) : json({ files: [] });
    vi.resetModules();
    drive = await import("./googleDriveSync");
    await expect(drive.getAuthToken(false)).resolves.toBe("refreshed-device");
    expect(stored[DEVICE_KEY]).toMatchObject({ grantedScopes: includeScope ? [FILE] : [FILE, "openid"] });
  });
});

describe("non-Device scope errors", () => {
  it.each(["drive", "appDataFolder"])("requires reconnection when the old Chrome token cannot access %s", async (deniedSpace) => {
    profile("chrome");
    route = (url) => url.searchParams.get("spaces") === deniedSpace ? scopeError("forbidden") : json({ files: [] });
    const error = await drive.getGoogleDriveDeletionAuthToken(true).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "unauthorized", reason: "deletion_scope_required" });
    expect(drive.mapDriveError(error)).toContain("grant the requested access");
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(true);
    expect(identity.getAuthToken.mock.calls.map(([options]) => options.interactive)).toEqual([false]);
    expect(mutations()).toHaveLength(0);
  });
});

describe.skipIf(!__AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__)("cached account belongs to the selected authorization flow", () => {
  it.each(["helium", "firefox"] as const)("uses the same Device account for connect, silent sync and disconnect in %s despite stale Web credentials", async (kind) => {
    profile(kind); seedDevice([FILE]);
    stored[WEB_KEY] = { token: "obsolete-web-account", expiresAt: Date.now() + 3_600_000 };
    await expect(drive.getAuthToken(true)).resolves.toBe("device-prior");
    await expect(drive.getAuthToken(false)).resolves.toBe("device-prior");
    await expect(drive.getCachedAuthToken()).resolves.toBe("device-prior");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(identity.getAuthToken).not.toHaveBeenCalled();
  });

  it("does not fall back to a cached Web account when the selected Device session is absent", async () => {
    stored[WEB_KEY] = { token: "obsolete-web-account", expiresAt: Date.now() + 3_600_000 };
    await expect(drive.getAuthToken(false)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(drive.getCachedAuthToken()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not select a stale Device account when installed Chrome uses native identity", async () => {
    profile("chrome"); seedDevice([FILE]);
    await expect(drive.getAuthToken(false)).resolves.toBe("chrome-native");
    await expect(drive.getCachedAuthToken()).resolves.toBe("chrome-native");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an explicitly unsupported native identity fallback consistent across sync and cached-token lookup", async () => {
    profile("chrome"); seedDevice([FILE]);
    identity.getAuthToken.mockImplementation(() => { throw new Error("Browser sign-in is disabled"); });
    await expect(drive.getAuthToken(false)).resolves.toBe("device-prior");
    await expect(drive.getCachedAuthToken()).resolves.toBe("device-prior");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe.skipIf(!__AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__)("durable authorization overrides a warm page or worker cache", () => {
  function replaceDevice(refreshToken = "refresh-other") {
    stored[DEVICE_KEY] = { token: "device-other", refreshToken, expiresAt: Date.now() + 3_600_000, grantedScopes: [FILE] };
  }

  function installStaleSessionMirror() {
    const mirror = structuredClone(stored);
    const get = vi.fn((key: string, callback: (result: Record<string, unknown>) => void) => callback({ [key]: mirror[key] }));
    (chrome.storage as unknown as { session: unknown }).session = {
      get,
      set: (items: Record<string, unknown>, callback: () => void) => { Object.assign(mirror, structuredClone(items)); callback(); },
      remove: (key: string, callback: () => void) => { delete mirror[key]; callback(); }
    };
    return get;
  }

  it.each(["helium", "firefox"] as const)("reads another context's replacement after warming Device credentials in %s", async (kind) => {
    profile(kind); seedDevice([FILE]);
    await expect(drive.getAuthToken(false)).resolves.toBe("device-prior");
    replaceDevice();
    await expect(drive.getAuthToken(false)).resolves.toBe("device-other");
    await expect(drive.getCachedAuthToken()).resolves.toBe("device-other");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not resurrect a removed durable grant from memory or a stale session mirror", async () => {
    seedDevice([FILE]);
    await drive.getAuthToken(false);
    const sessionGet = installStaleSessionMirror();
    delete stored[DEVICE_KEY];
    await expect(drive.getAuthToken(false)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(drive.getCachedAuthToken()).resolves.toBeUndefined();
    expect(sessionGet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails a durable read error without using warm memory or the stale session mirror", async () => {
    seedDevice([FILE]);
    await drive.getAuthToken(false);
    const sessionGet = installStaleSessionMirror();
    vi.spyOn(chrome.storage.local, "get").mockImplementation(() => { throw new Error("storage unavailable"); });
    await expect(drive.getAuthToken(false)).rejects.toThrow("authorization storage is temporarily unavailable");
    await expect(drive.getCachedAuthToken()).rejects.toThrow("authorization storage is temporarily unavailable");
    expect(sessionGet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses session storage when the local storage API does not exist", async () => {
    seedDevice([FILE]);
    const sessionGet = installStaleSessionMirror();
    delete (chrome.storage as unknown as { local?: unknown }).local;
    await expect(drive.getAuthToken(false)).resolves.toBe("device-prior");
    expect(sessionGet).toHaveBeenCalled();
  });

  it.each(["replaced", "removed", "rotated"] as const)("never retries an old request against a %s credential lineage", async (change) => {
    seedDevice([FILE]);
    const token = await drive.getAuthToken(false);
    route = (_url, init) => {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer device-prior");
      if (change === "removed") delete stored[DEVICE_KEY];
      else replaceDevice(change === "rotated" ? "refresh-prior-rotated" : "refresh-other-account");
      return json({ error: { code: 401, message: "Expired token" } }, 401);
    };
    const error = await drive.listSyncFiles(token).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "unknown", reason: "authorization_changed" });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(identity.getAuthToken).not.toHaveBeenCalled();

    if (change === "removed") {
      await expect(drive.getAuthToken(false)).rejects.toMatchObject({ code: "unauthorized" });
    } else {
      await expect(drive.getAuthToken(false)).resolves.toBe("device-other");
      route = (_url, init) => {
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer device-other");
        return json({ files: [] });
      };
      await expect(drive.listSyncFiles(await drive.getAuthToken(false))).resolves.toEqual([]);
    }
  });

  it("remembers an old request's lineage even after another lookup has warmed the replacement", async () => {
    seedDevice([FILE]);
    const token = await drive.getAuthToken(false);
    replaceDevice();
    await drive.getAuthToken(false);
    route = () => json({ error: { code: 401 } }, 401);
    await expect(drive.listSyncFiles(token)).rejects.toMatchObject({ reason: "authorization_changed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(requests()[0].init.headers).get("Authorization")).toBe("Bearer device-prior");
  });

  it("reuses a concurrent refresh for the same grant without an extra OAuth refresh", async () => {
    seedDevice([FILE]);
    const token = await drive.getAuthToken(false);
    let calls = 0;
    route = (_url, init) => {
      calls += 1;
      if (calls === 1) {
        replaceDevice("refresh-prior");
        return json({ error: { code: 401 } }, 401);
      }
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer device-other");
      return json({ files: [] });
    };
    await expect(drive.listSyncFiles(token)).resolves.toEqual([]);
    await expect(drive.getAuthToken(false)).resolves.toBe("device-other");
    expect(requests().some(({ url }) => url.pathname === "/token")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// This suite also runs with explicit fake Web-only build configuration; local
// release builds deliberately disable Web OAuth in favor of Device OAuth.
describe.skipIf(!__AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK__ || __AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__)("durable Web authorization", () => {
  function seedWeb(token = "web-prior") {
    stored[WEB_KEY] = { token, expiresAt: Date.now() + 3_600_000 };
  }

  it("uses a replacement instead of its warm memory cache", async () => {
    seedWeb();
    await expect(drive.getAuthToken(false)).resolves.toBe("web-prior");
    seedWeb("web-other");
    await expect(drive.getAuthToken(false)).resolves.toBe("web-other");
    await expect(drive.getCachedAuthToken()).resolves.toBe("web-other");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["removed", "unavailable"] as const)("does not use its warm cache after storage is %s", async (change) => {
    seedWeb();
    await drive.getAuthToken(false);
    if (change === "removed") delete stored[WEB_KEY];
    else vi.spyOn(chrome.storage.local, "get").mockImplementation(() => { throw new Error("storage unavailable"); });
    await expect(drive.getAuthToken(false)).rejects.toBeInstanceOf(Error);
    if (change === "removed") await expect(drive.getCachedAuthToken()).resolves.toBeUndefined();
    else await expect(drive.getCachedAuthToken()).rejects.toThrow("authorization storage is temporarily unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["removed", "replaced"] as const)("does not erase or reuse a %s Web grant after an old request returns 401", async (change) => {
    seedWeb();
    const token = await drive.getAuthToken(false);
    route = () => {
      if (change === "removed") delete stored[WEB_KEY];
      else seedWeb("web-other");
      return json({ error: { code: 401 } }, 401);
    };
    const error = await drive.listSyncFiles(token).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ reason: "authorization_changed" });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(stored[WEB_KEY]).toEqual(change === "removed" ? undefined : { token: "web-other", expiresAt: Date.now() + 3_600_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(identity.getAuthToken).not.toHaveBeenCalled();
    expect(identity.removeCachedAuthToken).not.toHaveBeenCalled();
  });
});
