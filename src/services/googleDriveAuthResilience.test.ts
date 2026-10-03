import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DEVICE_KEY = "aura-start-google-device-auth-token";
const SESSION_KEY = "aura-start-google-auth-session";
type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
let drive: typeof import("./googleDriveSync");
let route: Route;
let stored: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let identity: { getAuthToken: ReturnType<typeof vi.fn>; removeCachedAuthToken: ReturnType<typeof vi.fn> };
let manifest: Record<string, unknown>;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function seedDevice(expired = false, token = "device-original", refreshToken = "refresh-original") {
  stored[DEVICE_KEY] = { token, refreshToken, expiresAt: Date.now() + (expired ? -1 : 3_600_000), grantedScopes: [FILE_SCOPE] };
}

function profile(kind: "helium" | "firefox" | "chrome") {
  if (kind === "chrome") manifest.update_url = "https://clients2.google.com/service/update2/crx";
  else delete manifest.update_url;
  (chrome.runtime as unknown as { id: string }).id = kind === "firefox" ? "aura-start@example.test" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  vi.stubGlobal("navigator", {
    language: "en", languages: ["en"], vendor: kind === "firefox" ? "" : "Google Inc.",
    userAgent: kind === "firefox" ? "Firefox/145.0" : kind === "helium" ? "Helium Chrome/140.0.0.0" : "Chrome/140.0.0.0",
    userAgentData: kind === "firefox" ? undefined : { brands: [{ brand: kind === "helium" ? "Chromium" : "Google Chrome", version: "140" }] }
  });
}

const requestedPaths = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  stored = {};
  manifest = { manifest_version: 3, version: "2.1.0", oauth2: {
    client_id: "71648271904-testchromeclient.apps.googleusercontent.com", scopes: [FILE_SCOPE, "https://www.googleapis.com/auth/drive.appdata"]
  } };
  identity = {
    getAuthToken: vi.fn((_options, callback: (token: string) => void) => callback("native-token")),
    removeCachedAuthToken: vi.fn((_options, callback: () => void) => callback())
  };
  vi.stubGlobal("browser", undefined);
  vi.stubGlobal("chrome", {
    runtime: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", getManifest: () => manifest }, identity,
    tabs: { create: (_options: unknown, callback: () => void) => callback() },
    storage: { local: {
      get: (key: string, callback: (items: Record<string, unknown>) => void) => callback({ [key]: structuredClone(stored[key]) }),
      set: (items: Record<string, unknown>, callback: () => void) => { Object.assign(stored, structuredClone(items)); callback(); },
      remove: (key: string, callback: () => void) => { delete stored[key]; callback(); }
    } }
  });
  profile("helium");
  route = (url) => { throw new Error(`Unexpected mock request: ${url.pathname}`); };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => route(new URL(String(input)), init));
  vi.stubGlobal("fetch", fetchMock);
  // Use controllable timers for aborts instead of Node's native timeout clock.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), delay);
    return controller.signal;
  });
  drive = await import("./googleDriveSync");
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe.skipIf(!__AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__)("recoverable Device authorization", () => {
  it.each(["offline", "rate-limit", "server-error", "malformed-success"] as const)("keeps the durable refresh grant through %s and recovers on the next sync", async (failure) => {
    seedDevice(true);
    route = (url) => {
      expect(url.pathname).toBe("/token");
      if (failure === "offline") throw new TypeError("Failed to fetch");
      if (failure === "malformed-success") return new Response("<html>Gateway failure</html>", { status: 200 });
      return json({ error: failure === "rate-limit" ? "temporarily_unavailable" : "server_error" }, failure === "rate-limit" ? 429 : 503);
    };
    const failed = drive.getAuthToken(false).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await failed;
    expect(error).toBeInstanceOf(Error);
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(stored[DEVICE_KEY]).toMatchObject({ refreshToken: "refresh-original" });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);

    route = () => json({ access_token: "recovered-token", expires_in: 3600 });
    await expect(drive.getAuthToken(false)).resolves.toBe("recovered-token");
    expect(stored[DEVICE_KEY]).toMatchObject({ token: "recovered-token", refreshToken: "refresh-original" });
    expect(identity.getAuthToken).not.toHaveBeenCalled();
  });

  it("bounds a hung refresh, preserves the grant, and permits a later retry", async () => {
    seedDevice(true);
    route = (_url, init) => new Promise((_resolve, reject) => {
      expect(init.signal).toBeDefined();
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
    let settled = false;
    const failed = drive.getAuthToken(false).catch((error: unknown) => error).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(settled).toBe(true);
    const error = await failed;
    expect(error).toBeInstanceOf(Error);
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(stored[DEVICE_KEY]).toMatchObject({ refreshToken: "refresh-original" });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
    route = () => json({ access_token: "recovered-token", expires_in: 3600 });
    await expect(drive.getAuthToken(false)).resolves.toBe("recovered-token");
  });

  it("coalesces concurrent expiry refreshes for one grant", async () => {
    seedDevice(true);
    const response = deferred<Response>();
    route = () => response.promise;
    const attempts = [drive.getAuthToken(false), drive.getAuthToken(false), drive.getAuthToken(false)];
    await vi.advanceTimersByTimeAsync(0);
    response.resolve(json({ access_token: "refreshed-once", expires_in: 3600 }));
    await expect(Promise.all(attempts)).resolves.toEqual(["refreshed-once", "refreshed-once", "refreshed-once"]);
    expect(requestedPaths()).toEqual(["/token"]);
  });

  it("keeps Google's rotated refresh token durable across a worker restart", async () => {
    seedDevice(true);
    route = () => json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 });
    await expect(drive.getAuthToken(false)).resolves.toBe("rotated-access");
    expect(stored[DEVICE_KEY]).toMatchObject({ refreshToken: "rotated-refresh" });
    vi.resetModules();
    drive = await import("./googleDriveSync");
    stored[DEVICE_KEY] = { ...(stored[DEVICE_KEY] as object), expiresAt: Date.now() - 1 };
    route = (_url, init) => {
      expect(new URLSearchParams(String(init.body)).get("refresh_token")).toBe("rotated-refresh");
      return json({ access_token: "after-restart", expires_in: 3600 });
    };
    await expect(drive.getAuthToken(false)).resolves.toBe("after-restart");
    expect(stored[DEVICE_KEY]).toMatchObject({ refreshToken: "rotated-refresh" });
  });

  it("keeps a double Drive 401 recoverable when Google just refreshed the same grant", async () => {
    seedDevice();
    const original = await drive.getAuthToken(false);
    route = (url) => url.pathname === "/token"
      ? json({ access_token: "refreshed-token", expires_in: 3600 })
      : json({ error: { code: 401, message: "Temporarily rejected access token" } }, 401);
    const error = await drive.listSyncFiles(original).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(requestedPaths().filter((path) => path === "/token")).toHaveLength(1);
    expect(stored[DEVICE_KEY]).toMatchObject({ refreshToken: "refresh-original" });
    route = () => json({ files: [] });
    await expect(drive.listSyncFiles(await drive.getAuthToken(false))).resolves.toEqual([]);
  });

  it("marks only Google's confirmed invalid_grant as needing a new login", async () => {
    seedDevice(true);
    route = () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
    const error = await drive.getAuthToken(false).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ reason: "invalid_grant" });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(true);
    expect(requestedPaths()).toEqual(["/token"]);
  });
});

describe.skipIf(!__AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__)("deliberate local disconnect fences old authorization", () => {
  it("rejects a previously issued Device token before contacting Drive after disconnect", async () => {
    seedDevice();
    const token = await drive.getAuthToken(false);
    await drive.disconnectGoogleAccount();
    await expect(drive.listSyncFiles(token)).rejects.toMatchObject({ reason: "authorization_changed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["helium", "firefox"] as const)("disconnects expired credentials in %s without refreshing or revoking the Google grant on other devices", async (kind) => {
    profile(kind); seedDevice(true);
    await expect(drive.disconnectGoogleAccount()).resolves.toEqual({ revokeError: undefined });
    expect(stored[DEVICE_KEY]).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(identity.getAuthToken).not.toHaveBeenCalled();
    await expect(drive.getAuthToken(false)).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not clear another account when stale work cleans up its own old access token", async () => {
    seedDevice();
    await drive.getAuthToken(false);
    seedDevice(false, "other-account-token", "other-account-refresh");
    await drive.clearAuthToken("device-original");
    expect(stored[DEVICE_KEY]).toMatchObject({ token: "other-account-token", refreshToken: "other-account-refresh" });
    await expect(drive.getAuthToken(false)).resolves.toBe("other-account-token");
  });

  it("does not cancel a newer consent attempt when the older attempt discovers insufficient scopes", async () => {
    seedDevice();
    stored[DEVICE_KEY] = { ...(stored[DEVICE_KEY] as object), grantedScopes: [] };
    stored[SESSION_KEY] = { generation: "older-attempt", flow: "device_oauth", clientId: __AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID__ };
    const nextSession = { generation: "newer-attempt", flow: "device_oauth", clientId: __AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID__ };
    let advanced = false;
    vi.spyOn(chrome.storage.local, "get").mockImplementation(((key: string, callback: (items: Record<string, unknown>) => void) => {
      const value = structuredClone(stored[key]);
      // A second extension context starts its own consent before the old
      // scope failure reaches cleanup; both attempts still see the old token.
      if (key === DEVICE_KEY && !advanced) {
        advanced = true;
        stored[SESSION_KEY] = nextSession;
      }
      callback({ [key]: value });
    }) as typeof chrome.storage.local.get);
    await expect(drive.getAuthToken(true)).rejects.toMatchObject({ reason: "authorization_changed" });
    expect(stored[SESSION_KEY]).toEqual(nextSession);
    expect(stored[DEVICE_KEY]).toMatchObject({ token: "device-original", refreshToken: "refresh-original" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not let an in-flight successful refresh restore credentials after disconnect", async () => {
    seedDevice(true);
    const response = deferred<Response>();
    route = () => response.promise;
    const refresh = drive.getAuthToken(false).catch((failure: unknown) => failure);
    await vi.advanceTimersByTimeAsync(0);
    expect(requestedPaths()).toEqual(["/token"]);
    let disconnected = false;
    const disconnect = drive.disconnectGoogleAccount().then(() => { disconnected = true; });
    await vi.advanceTimersByTimeAsync(0);
    const finishedBeforeNetwork = disconnected;
    response.resolve(json({ access_token: "late-access", refresh_token: "late-refresh", expires_in: 3600 }));
    await disconnect;
    expect(await refresh).toBeInstanceOf(Error);
    expect(finishedBeforeNetwork).toBe(true);
    expect(stored[DEVICE_KEY]).toBeUndefined();
    await expect(drive.getAuthToken(false)).rejects.toBeInstanceOf(Error);
    expect(requestedPaths()).not.toContain("/revoke");
  });

  it.each([false, true])("does not overwrite a replacement account when an older refresh finishes invalid_grant=%s", async (invalidGrant) => {
    seedDevice(true);
    const response = deferred<Response>();
    route = () => response.promise;
    const refresh = drive.getAuthToken(false).catch((failure: unknown) => failure);
    await vi.advanceTimersByTimeAsync(0);
    seedDevice(false, "replacement-token", "replacement-refresh");
    response.resolve(invalidGrant
      ? json({ error: "invalid_grant" }, 400)
      : json({ access_token: "late-access", expires_in: 3600 }));
    const error = await refresh;
    expect(error).toMatchObject({ reason: "authorization_changed" });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(stored[DEVICE_KEY]).toMatchObject({ token: "replacement-token", refreshToken: "replacement-refresh" });
    await expect(drive.getAuthToken(false)).resolves.toBe("replacement-token");
  });

  it("ignores authorization completed in an already-open consent tab after disconnect", async () => {
    const tokenResponse = deferred<Response>();
    route = (url) => url.pathname === "/device/code"
      ? json({ device_code: "pending-code", user_code: "CODE", verification_url: "https://example.test/consent", expires_in: 300, interval: 1 })
      : tokenResponse.promise;
    const connect = drive.getAuthToken(true).catch((failure: unknown) => failure);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(requestedPaths()).toContain("/token");
    await drive.disconnectGoogleAccount();
    tokenResponse.resolve(json({ access_token: "late-consent-token", refresh_token: "late-consent-refresh", expires_in: 3600, scope: FILE_SCOPE }));
    expect(await connect).toMatchObject({ reason: "authorization_changed" });
    expect(stored[DEVICE_KEY]).toBeUndefined();
    await expect(drive.getAuthToken(false)).rejects.toBeInstanceOf(Error);
    expect(requestedPaths()).not.toContain("/revoke");
  });

  it("makes a warm page respect disconnect by a fresh worker context", async () => {
    seedDevice();
    await expect(drive.getAuthToken(false)).resolves.toBe("device-original");
    vi.resetModules();
    const worker = await import("./googleDriveSync");
    await worker.disconnectGoogleAccount();
    await expect(drive.getAuthToken(false)).rejects.toBeInstanceOf(Error);
    await expect(drive.getCachedAuthToken()).resolves.toBeUndefined();
    expect(stored[DEVICE_KEY]).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the successful Device flow across a worker reload and changed browser detection", async () => {
    seedDevice();
    await expect(drive.getAuthToken(false)).resolves.toBe("device-original");
    expect(stored[SESSION_KEY]).toMatchObject({ flow: "device_oauth" });
    profile("chrome");
    vi.resetModules();
    drive = await import("./googleDriveSync");
    await expect(drive.getAuthToken(false)).resolves.toBe("device-original");
    expect(identity.getAuthToken).not.toHaveBeenCalled();
  });

  it("keeps the established Device flow when the user explicitly renews its scopes after browser detection changes", async () => {
    seedDevice();
    await drive.getAuthToken(false);
    profile("chrome");
    route = (url) => url.pathname === "/device/code"
      ? json({ device_code: "renew-scopes", user_code: "CODE", verification_url: "https://example.test/consent", expires_in: 300, interval: 1 })
      : json({ access_token: "new-scopes-token", refresh_token: "new-scopes-refresh", expires_in: 3600, scope: FILE_SCOPE });
    const reconnect = drive.getAuthToken(true, { forceReauthorize: true });
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(reconnect).resolves.toBe("new-scopes-token");
    expect(stored[SESSION_KEY]).toMatchObject({ flow: "device_oauth" });
    expect(requestedPaths()).toEqual(["/device/code", "/token"]);
    expect(identity.getAuthToken).not.toHaveBeenCalled();
  });
});

describe("native Chrome identity resilience", () => {
  it("rejects a previously issued native token before contacting Drive after disconnect", async () => {
    profile("chrome");
    const token = await drive.getAuthToken(false);
    await drive.disconnectGoogleAccount();
    await expect(drive.listSyncFiles(token)).rejects.toMatchObject({ reason: "authorization_changed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not evict a newer connection when an old native callback returns the same token string", async () => {
    profile("chrome");
    await expect(drive.getAuthToken(false)).resolves.toBe("native-token");
    const callbackReady = deferred<(token: string) => void>();
    identity.getAuthToken.mockImplementation((_options, callback: (token: string) => void) => { callbackReady.resolve(callback); });
    const oldConnect = drive.getAuthToken(true).catch((failure: unknown) => failure);
    const oldCallback = await callbackReady.promise;
    await drive.disconnectGoogleAccount();
    identity.getAuthToken.mockImplementation((_options, callback: (token: string) => void) => callback("native-token"));
    await expect(drive.getAuthToken(true)).resolves.toBe("native-token");
    identity.removeCachedAuthToken.mockClear();
    oldCallback("native-token");
    await expect(oldConnect).resolves.toMatchObject({ reason: "authorization_changed" });
    expect(identity.removeCachedAuthToken).not.toHaveBeenCalled();
    await expect(drive.getAuthToken(false)).resolves.toBe("native-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not let a late native identity callback reconnect after explicit disconnect", async () => {
    profile("chrome");
    const callbackReady = deferred<(token: string) => void>();
    identity.getAuthToken.mockImplementation((options: { interactive: boolean }, callback: (token: string) => void) => {
      if (!options.interactive) callback("native-probe-token");
      else callbackReady.resolve(callback);
    });
    const pending = drive.getAuthToken(true).catch((failure: unknown) => failure);
    const callback = await callbackReady.promise;
    await drive.disconnectGoogleAccount();
    callback("late-native-token");
    expect(await pending).toMatchObject({ reason: "authorization_changed" });
    const callsBefore = identity.getAuthToken.mock.calls.length;
    await expect(drive.getAuthToken(false)).rejects.toBeInstanceOf(Error);
    expect(identity.getAuthToken).toHaveBeenCalledTimes(callsBefore);
    expect(identity.removeCachedAuthToken.mock.calls.map(([options]) => options.token)).toContain("late-native-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a temporary native timeout recoverable without switching to a stale Device account", async () => {
    profile("chrome"); seedDevice();
    identity.getAuthToken.mockImplementation(() => undefined);
    let settled = false;
    const pending = drive.getAuthToken(false).catch((failure: unknown) => failure).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(settled).toBe(true);
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored[DEVICE_KEY]).toMatchObject({ token: "device-original" });
    identity.getAuthToken.mockImplementation((_options, callback: (token: string) => void) => callback("native-recovered"));
    await expect(drive.getAuthToken(false)).resolves.toBe("native-recovered");
  });

  it("does not silently reconnect an explicitly disconnected native account", async () => {
    profile("chrome");
    await expect(drive.getAuthToken(false)).resolves.toBe("native-token");
    await drive.disconnectGoogleAccount();
    const callsBefore = identity.getAuthToken.mock.calls.length;
    await expect(drive.getAuthToken(false)).rejects.toBeInstanceOf(Error);
    expect(identity.getAuthToken).toHaveBeenCalledTimes(callsBefore);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(drive.getAuthToken(true)).resolves.toBe("native-token");
  });
});

describe.skipIf(!__AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK__ || __AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK__)("optional Web OAuth lifecycle", () => {
  const WEB_KEY = "aura-start-google-web-auth-token";
  function installWebFlow(run: (details: { url: string; interactive: boolean }, callback: (url: string) => void) => void) {
    Object.assign(identity, {
      getRedirectURL: () => "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/",
      launchWebAuthFlow: vi.fn(run)
    });
  }
  function responseFor(url: string, token: string) {
    const auth = new URL(url);
    return `${auth.searchParams.get("redirect_uri")}#${new URLSearchParams({ access_token: token, expires_in: "3600", state: auth.searchParams.get("state")! })}`;
  }
  function errorResponseFor(url: string, error: string, validState = true) {
    const auth = new URL(url);
    return `${auth.searchParams.get("redirect_uri")}#${new URLSearchParams({ error, state: validState ? auth.searchParams.get("state")! : "different-request-state" })}`;
  }

  it.each(["login_required", "consent_required", "interaction_required", "account_selection_required"])("permits an explicit interactive retry for Google's %s response", async (reason) => {
    installWebFlow((details, callback) => {
      callback(details.interactive ? responseFor(details.url, "interactive-recovered") : errorResponseFor(details.url, reason));
    });
    const error = await drive.getAuthToken(false).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ reason });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(true);
    await expect(drive.getAuthToken(true)).resolves.toBe("interactive-recovered");
    expect(stored[WEB_KEY]).toMatchObject({ token: "interactive-recovered" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["access_denied", "server_error", "temporarily_unavailable"])("does not interpret Google's %s response as revoked authorization or required consent", async (reason) => {
    installWebFlow((details, callback) => callback(errorResponseFor(details.url, reason)));
    const error = await drive.getAuthToken(false).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ reason });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(stored[WEB_KEY]).toBeUndefined();
  });

  it("rejects an OAuth error with a mismatched state before trusting its reason", async () => {
    installWebFlow((details, callback) => callback(errorResponseFor(details.url, "login_required", false)));
    const error = await drive.getAuthToken(false).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ message: "Google authorization returned an invalid state.", reason: undefined });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(stored[WEB_KEY]).toBeUndefined();
  });

  it.each(["User interaction required.", "User interaction is required."])("recognizes Firefox's exact silent-flow response '%s' without treating interactive cancellation as revoked", async (message) => {
    profile("firefox");
    installWebFlow(() => { throw new Error(message); });
    const silentError = await drive.getAuthToken(false).catch((failure: unknown) => failure);
    expect(silentError).toMatchObject({ reason: "interaction_required" });
    expect(drive.isGoogleDriveAuthorizationUnavailable(silentError)).toBe(true);
    const interactiveError = await drive.getAuthToken(true).catch((failure: unknown) => failure);
    expect(interactiveError).toMatchObject({ code: "auth_cancelled", reason: undefined });
    expect(drive.isGoogleDriveAuthorizationUnavailable(interactiveError)).toBe(false);
  });

  it.each(["Network request failed.", "The user did not approve access.", "Network failure; user interaction required to diagnose it."])("keeps other browser failures recoverable: %s", async (message) => {
    installWebFlow(() => { throw new Error(message); });
    const error = await drive.getAuthToken(false).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ reason: undefined });
    expect(drive.isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
  });

  it("silently renews an expired Web access token and saves the replacement", async () => {
    stored[WEB_KEY] = { token: "expired-web", expiresAt: Date.now() - 1 };
    installWebFlow((details, callback) => {
      expect(details.interactive).toBe(false);
      callback(responseFor(details.url, "renewed-web"));
    });
    await expect(drive.getAuthToken(false)).resolves.toBe("renewed-web");
    expect(stored[WEB_KEY]).toMatchObject({ token: "renewed-web" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a late Web authorization redirect after explicit local disconnect", async () => {
    const ready = deferred<{ details: { url: string; interactive: boolean }; callback: (url: string) => void }>();
    installWebFlow((details, callback) => { ready.resolve({ details, callback }); });
    const pending = drive.getAuthToken(true).catch((failure: unknown) => failure);
    const { details, callback } = await ready.promise;
    await drive.disconnectGoogleAccount();
    callback(responseFor(details.url, "late-web"));
    expect(await pending).toMatchObject({ reason: "authorization_changed" });
    expect(stored[WEB_KEY]).toBeUndefined();
    await expect(drive.getAuthToken(false)).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
