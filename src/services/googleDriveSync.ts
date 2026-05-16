import type { AuraStartData, AuraSyncSettings } from "../types";
import { nowIso } from "../utils/dates";
import { validateAuraData } from "../utils/importJson";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SYNC_FILE_NAME = "aura-start-sync.json";
const CLOUD_SCHEMA_VERSION = 1;
const CLOUD_APP_NAME = "Aura Start";
const TOKEN_EXPIRY_SAFETY_MS = 60_000;
const OAUTH_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const WEB_OAUTH_CLIENT_ID = __AURA_GOOGLE_WEB_OAUTH_CLIENT_ID__.trim();
const EXAMPLE_OAUTH_CLIENT_IDS = new Set([
  "123-example.apps.googleusercontent.com",
  "1234567890-abcdef.apps.googleusercontent.com"
]);

type RecordValue = Record<string, unknown>;
type ManifestWithOAuth = chrome.runtime.Manifest & {
  oauth2?: {
    client_id?: string;
    scopes?: string[];
  };
};
type CachedToken = {
  token: string;
  expiresAt: number;
};

type NavigatorWithBrave = Navigator & {
  brave?: {
    isBrave?: () => Promise<boolean>;
  };
};

type GoogleApiErrorDetail = {
  domain?: string;
  message?: string;
  reason?: string;
};

type GoogleApiErrorBody = {
  error?: {
    code?: number;
    details?: unknown[];
    errors?: GoogleApiErrorDetail[];
    message?: string;
    status?: string;
  };
};

export type GoogleDriveErrorCode =
  | "auth_cancelled"
  | "identity_unavailable"
  | "network"
  | "not_found"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "invalid_cloud_file"
  | "unknown";

export type GoogleDriveFileMetadata = {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
};

export type GoogleDriveSyncPayload = {
  schemaVersion: 1;
  app: "Aura Start";
  appVersion: string;
  updatedAt: string;
  deviceId: string;
  data: AuraStartData;
};

export type GoogleDriveSyncDownload = {
  metadata: GoogleDriveFileMetadata;
  payload: GoogleDriveSyncPayload;
  data: AuraStartData;
  cloudUpdatedAt: string;
};

export type GoogleDriveComparison =
  | "no_cloud_file"
  | "in_sync"
  | "local_newer"
  | "cloud_newer"
  | "conflict";

export class GoogleDriveSyncError extends Error {
  code: GoogleDriveErrorCode;
  reason?: string;
  status?: number;

  constructor(code: GoogleDriveErrorCode, message: string, status?: number, reason?: string) {
    super(message);
    this.name = "GoogleDriveSyncError";
    this.code = code;
    this.reason = reason;
    this.status = status;
  }
}

let webAuthTokenCache: CachedToken | undefined;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getChromeLastErrorMessage(): string | undefined {
  return globalThis.chrome?.runtime?.lastError?.message;
}

function requireIdentityApi(): typeof chrome.identity {
  if (!globalThis.chrome?.identity) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "Google Drive sync is available only inside the installed Chromium extension."
    );
  }

  return chrome.identity;
}

function appVersion(): string {
  return globalThis.chrome?.runtime?.getManifest?.().version ?? "1.1.0";
}

function looksLikeExampleOAuthClientId(clientId: string): boolean {
  const normalized = clientId.toLowerCase();
  return EXAMPLE_OAUTH_CLIENT_IDS.has(normalized)
    || normalized.includes("your_google_oauth_client_id")
    || normalized.includes("your-real-client-id")
    || normalized.includes("paste_real_client_id_here");
}

function oauthClientConfigurationError(clientId: string | undefined): string {
  if (!clientId || clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")) {
    return "Google Drive sync is not configured in this build. Build Aura Start with AURA_GOOGLE_OAUTH_CLIENT_ID set so the generated manifest contains the Google OAuth Client ID.";
  }

  if (!OAUTH_CLIENT_ID_PATTERN.test(clientId)) {
    return "Google Drive sync is not configured correctly. The OAuth Client ID in the generated manifest must end with .apps.googleusercontent.com.";
  }

  if (looksLikeExampleOAuthClientId(clientId)) {
    return "Google Drive sync is using an example OAuth Client ID, so Google rejects it with invalid_client. Rebuild Aura Start with a real OAuth Client ID from Google Cloud Console.";
  }

  return "Google Drive sync is not configured correctly. Rebuild Aura Start with a real Google OAuth Client ID.";
}

function manifestOAuthClientId(): string | undefined {
  const manifest = globalThis.chrome?.runtime?.getManifest?.() as ManifestWithOAuth | undefined;
  const clientId = manifest?.oauth2?.client_id?.trim();
  return clientId
    && !clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")
    && OAUTH_CLIENT_ID_PATTERN.test(clientId)
    && !looksLikeExampleOAuthClientId(clientId)
    ? clientId
    : undefined;
}

function configuredWebOAuthClientId(): string | undefined {
  return WEB_OAUTH_CLIENT_ID
    && OAUTH_CLIENT_ID_PATTERN.test(WEB_OAUTH_CLIENT_ID)
    && !looksLikeExampleOAuthClientId(WEB_OAUTH_CLIENT_ID)
    ? WEB_OAUTH_CLIENT_ID
    : undefined;
}

function oauthScopes(): string[] {
  const manifest = globalThis.chrome?.runtime?.getManifest?.() as ManifestWithOAuth | undefined;
  const scopes = manifest?.oauth2?.scopes?.filter((scope) => typeof scope === "string" && scope.trim());
  return scopes?.length ? scopes : [DRIVE_APPDATA_SCOPE];
}

function cachedWebAuthToken(): string | undefined {
  if (!webAuthTokenCache) return undefined;
  if (Date.now() + TOKEN_EXPIRY_SAFETY_MS >= webAuthTokenCache.expiresAt) {
    webAuthTokenCache = undefined;
    return undefined;
  }

  return webAuthTokenCache.token;
}

function randomState(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto);
  }

  const values = new Uint32Array(4);
  globalThis.crypto?.getRandomValues(values);
  return Array.from(values, (value) => value.toString(36)).join("");
}

function authResultToken(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value.token === "string") {
    return value.token;
  }

  return undefined;
}

function isBrowserSigninDisabledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("browser signin") || message.includes("browser sign-in");
}

async function isBraveBrowser(): Promise<boolean> {
  const brave = (globalThis.navigator as NavigatorWithBrave | undefined)?.brave;
  if (typeof brave?.isBrave !== "function") {
    return false;
  }

  return await brave.isBrave().catch(() => false);
}

async function shouldAvoidChromeIdentityTokenFlow(): Promise<boolean> {
  if (await isBraveBrowser()) {
    return true;
  }

  const userAgent = globalThis.navigator?.userAgent ?? "";
  return /\bEdg\//.test(userAgent) || /\bOPR\//.test(userAgent);
}

async function getChromeAuthToken(interactive: boolean): Promise<string> {
  const identity = requireIdentityApi();
  return await new Promise<string>((resolve, reject) => {
    identity.getAuthToken({ interactive }, (token) => {
      const lastError = getChromeLastErrorMessage();
      if (lastError) {
        reject(new GoogleDriveSyncError("auth_cancelled", lastError));
        return;
      }

      const resolvedToken = authResultToken(token);
      if (!resolvedToken) {
        reject(new GoogleDriveSyncError("auth_cancelled", "Google authorization did not return a token."));
        return;
      }

      resolve(resolvedToken);
    });
  });
}

async function launchGoogleWebAuthFlow(interactive: boolean): Promise<string> {
  const clientId = configuredWebOAuthClientId();
  if (!clientId) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This browser cannot use Chrome's built-in Google sign-in for Drive sync. Build Aura Start with AURA_GOOGLE_WEB_OAUTH_CLIENT_ID set to a Web OAuth Client ID whose redirect URI is chrome.identity.getRedirectURL('oauth2')."
    );
  }

  const cached = cachedWebAuthToken();
  if (cached) {
    return cached;
  }

  const identity = requireIdentityApi();
  if (!identity.launchWebAuthFlow || !identity.getRedirectURL) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "This browser does not support the Google OAuth web auth flow required for Drive sync."
    );
  }

  const redirectUri = identity.getRedirectURL("oauth2");
  const state = randomState();
  const authUrl = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("scope", oauthScopes().join(" "));
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", "select_account consent");
  authUrl.searchParams.set("state", state);

  const redirectResult = await new Promise<string>((resolve, reject) => {
    identity.launchWebAuthFlow({ interactive, url: authUrl.toString() }, (redirectedTo) => {
      const lastError = getChromeLastErrorMessage();
      if (lastError) {
        reject(new GoogleDriveSyncError("auth_cancelled", lastError));
        return;
      }

      if (!redirectedTo) {
        reject(new GoogleDriveSyncError("auth_cancelled", "Google authorization did not complete."));
        return;
      }

      resolve(redirectedTo);
    });
  });

  const redirectedUrl = new URL(redirectResult);
  const fragmentParams = new URLSearchParams(redirectedUrl.hash.startsWith("#") ? redirectedUrl.hash.slice(1) : "");
  const queryParams = redirectedUrl.searchParams;
  const params = fragmentParams.size ? fragmentParams : queryParams;
  const error = params.get("error");
  if (error) {
    throw new GoogleDriveSyncError("auth_cancelled", params.get("error_description") ?? error);
  }

  if (params.get("state") !== state) {
    throw new GoogleDriveSyncError("auth_cancelled", "Google authorization returned an invalid state.");
  }

  const token = params.get("access_token");
  if (!token) {
    throw new GoogleDriveSyncError("auth_cancelled", "Google authorization did not return an access token.");
  }

  const expiresInSeconds = Number(params.get("expires_in") ?? "3600");
  const expiresIn = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
  webAuthTokenCache = {
    token,
    expiresAt: Date.now() + expiresIn * 1000
  };

  return token;
}

function driveHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...extra
  };
}

function statusCodeToErrorCode(status: number): GoogleDriveErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unknown";
}

async function errorFromResponse(response: Response): Promise<GoogleDriveSyncError> {
  let message = response.statusText || "Google Drive request failed.";
  let reason: string | undefined;
  try {
    const body = await response.json() as GoogleApiErrorBody;
    message = body.error?.message ?? message;
    reason = body.error?.errors?.find((item) => item.reason)?.reason ?? body.error?.status;
  } catch {
    // Keep the HTTP status text when Google returns a non-JSON error body.
  }

  return new GoogleDriveSyncError(statusCodeToErrorCode(response.status), message, response.status, reason);
}

async function driveFetch<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: driveHeaders(token, init.headers)
    });
  } catch (error) {
    throw new GoogleDriveSyncError(
      "network",
      error instanceof Error ? error.message : "Network connection failed."
    );
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

function createMultipartBody(metadata: RecordValue, payload: GoogleDriveSyncPayload): {
  body: string;
  contentType: string;
} {
  const boundary = `aura_start_${Math.random().toString(36).slice(2)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(payload, null, 2),
    `--${boundary}--`,
    ""
  ].join("\r\n");

  return {
    body,
    contentType: `multipart/related; boundary=${boundary}`
  };
}

function cloudPayload(data: AuraStartData, deviceId: string): GoogleDriveSyncPayload {
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    app: CLOUD_APP_NAME,
    appVersion: appVersion(),
    updatedAt: nowIso(),
    deviceId,
    data
  };
}

function normalizeCloudUpdatedAt(payload: GoogleDriveSyncPayload): string {
  const dataTime = new Date(payload.data.updatedAt).getTime();
  if (Number.isFinite(dataTime)) {
    return new Date(dataTime).toISOString();
  }

  const payloadTime = new Date(payload.updatedAt).getTime();
  return Number.isFinite(payloadTime) ? new Date(payloadTime).toISOString() : nowIso();
}

function validateCloudPayload(value: unknown): GoogleDriveSyncPayload {
  if (!isRecord(value)) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive sync file must be a JSON object.");
  }

  if (value.schemaVersion !== CLOUD_SCHEMA_VERSION) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "This Google Drive sync file version is not supported.");
  }

  if (value.app !== CLOUD_APP_NAME) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "This is not an Aura Start Google Drive sync file.");
  }

  if (typeof value.appVersion !== "string" || !value.appVersion.trim()) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive sync file is missing appVersion.");
  }

  if (typeof value.updatedAt !== "string" || Number.isNaN(new Date(value.updatedAt).getTime())) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive sync file has an invalid updatedAt value.");
  }

  if (typeof value.deviceId !== "string" || !value.deviceId.trim()) {
    throw new GoogleDriveSyncError("invalid_cloud_file", "Google Drive sync file is missing deviceId.");
  }

  try {
    return {
      schemaVersion: CLOUD_SCHEMA_VERSION,
      app: CLOUD_APP_NAME,
      appVersion: value.appVersion,
      updatedAt: new Date(value.updatedAt).toISOString(),
      deviceId: value.deviceId,
      data: validateAuraData(value.data)
    };
  } catch (error) {
    if (error instanceof GoogleDriveSyncError) {
      throw error;
    }

    throw new GoogleDriveSyncError(
      "invalid_cloud_file",
      error instanceof Error ? error.message : "Google Drive sync file contains invalid Aura Start data."
    );
  }
}

export async function getAuthToken(interactive: boolean): Promise<string> {
  if (configuredWebOAuthClientId()) {
    return await launchGoogleWebAuthFlow(interactive);
  }

  if (!manifestOAuthClientId()) {
    const manifest = globalThis.chrome?.runtime?.getManifest?.() as ManifestWithOAuth | undefined;
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      oauthClientConfigurationError(manifest?.oauth2?.client_id?.trim())
    );
  }

  if (interactive && await shouldAvoidChromeIdentityTokenFlow()) {
    return await launchGoogleWebAuthFlow(true);
  }

  return await getChromeAuthToken(interactive).catch(async (error) => {
    if (isBrowserSigninDisabledError(error)) {
      throw new GoogleDriveSyncError(
        "auth_cancelled",
        "Google Drive sync requires Chrome's built-in Google sign-in through chrome.identity. Sign in to Chrome with a Google account, or test this Chrome Web Store build in Google Chrome."
      );
    }

    throw error;
  });
}

export async function clearAuthToken(token?: string): Promise<void> {
  const identity = requireIdentityApi();
  const tokenToClear = token ?? cachedWebAuthToken() ?? await getAuthToken(false).catch(() => undefined);
  if (!tokenToClear) return;
  if (webAuthTokenCache?.token === tokenToClear) {
    webAuthTokenCache = undefined;
  }

  await new Promise<void>((resolve, reject) => {
    identity.removeCachedAuthToken({ token: tokenToClear }, () => {
      const lastError = getChromeLastErrorMessage();
      if (lastError) {
        reject(new GoogleDriveSyncError("unknown", lastError));
        return;
      }

      resolve();
    });
  });
}

export async function revokeAuthToken(token: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST"
    });
  } catch (error) {
    throw new GoogleDriveSyncError(
      "network",
      error instanceof Error ? error.message : "Google OAuth token revoke failed."
    );
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }
}

export async function disconnectGoogleAccount(token?: string): Promise<{ revokeError?: string }> {
  const tokenToDisconnect = token ?? await getAuthToken(false).catch(() => undefined);
  if (!tokenToDisconnect) {
    return {};
  }

  let revokeError: string | undefined;
  try {
    await revokeAuthToken(tokenToDisconnect);
  } catch (error) {
    revokeError = mapDriveError(error);
  }

  await clearAuthToken(tokenToDisconnect);
  return { revokeError };
}

export async function getConnectedAccountInfo(): Promise<{
  email?: string;
  name?: string;
  avatarUrl?: string;
} | undefined> {
  const identity = requireIdentityApi();
  if (!identity.getProfileUserInfo) {
    return undefined;
  }

  return await new Promise((resolve) => {
    identity.getProfileUserInfo((info) => {
      const email = typeof info.email === "string" && info.email ? info.email : undefined;
      resolve(email ? { email } : undefined);
    });
  });
}

export async function findSyncFile(token?: string): Promise<GoogleDriveFileMetadata | undefined> {
  const authToken = token ?? await getAuthToken(false);
  const query = `name = '${SYNC_FILE_NAME}' and 'appDataFolder' in parents and trashed = false`;
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: query,
    fields: "files(id,name,modifiedTime,size)",
    pageSize: "10"
  });
  const result = await driveFetch<{ files?: GoogleDriveFileMetadata[] }>(
    authToken,
    `${DRIVE_API_BASE}/files?${params.toString()}`
  );

  return result.files?.[0];
}

export async function getCloudFileMetadata(token?: string): Promise<GoogleDriveFileMetadata | undefined> {
  return await findSyncFile(token);
}

export async function createSyncFile(
  data: AuraStartData,
  deviceId: string,
  token?: string
): Promise<GoogleDriveFileMetadata> {
  const authToken = token ?? await getAuthToken(false);
  const payload = cloudPayload(data, deviceId);
  const multipart = createMultipartBody(
    {
      name: SYNC_FILE_NAME,
      parents: ["appDataFolder"],
      mimeType: "application/json"
    },
    payload
  );
  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,name,modifiedTime,size"
  });

  return await driveFetch<GoogleDriveFileMetadata>(authToken, `${DRIVE_UPLOAD_BASE}/files?${params.toString()}`, {
    method: "POST",
    body: multipart.body,
    headers: {
      "Content-Type": multipart.contentType
    }
  });
}

export async function uploadSyncFile(
  data: AuraStartData,
  options: { deviceId: string; fileId?: string; token?: string }
): Promise<GoogleDriveFileMetadata> {
  const token = options.token ?? await getAuthToken(false);
  const payload = cloudPayload(data, options.deviceId);
  const metadata = {
    name: SYNC_FILE_NAME,
    mimeType: "application/json"
  };
  const multipart = createMultipartBody(metadata, payload);
  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,name,modifiedTime,size"
  });
  const currentFileId = options.fileId ?? (await findSyncFile(token))?.id;

  if (!currentFileId) {
    return await createSyncFile(data, options.deviceId, token);
  }

  try {
    return await driveFetch<GoogleDriveFileMetadata>(
      token,
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(currentFileId)}?${params.toString()}`,
      {
        method: "PATCH",
        body: multipart.body,
        headers: {
          "Content-Type": multipart.contentType
        }
      }
    );
  } catch (error) {
    if (error instanceof GoogleDriveSyncError && error.code === "not_found") {
      return await createSyncFile(data, options.deviceId, token);
    }

    throw error;
  }
}

export async function backupToDrive(
  data: AuraStartData,
  options: { deviceId: string; fileId?: string; token?: string }
): Promise<GoogleDriveFileMetadata> {
  return await uploadSyncFile(data, options);
}

export async function downloadSyncFile(
  fileId?: string,
  token?: string
): Promise<GoogleDriveSyncDownload | undefined> {
  const authToken = token ?? await getAuthToken(false);
  const metadata = fileId
    ? await driveFetch<GoogleDriveFileMetadata>(
        authToken,
        `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,size`
      ).catch(async (error) => {
        if (error instanceof GoogleDriveSyncError && error.code === "not_found") {
          return await findSyncFile(authToken);
        }

        throw error;
      })
    : await findSyncFile(authToken);

  if (!metadata) {
    return undefined;
  }

  const rawPayload = await driveFetch<unknown>(
    authToken,
    `${DRIVE_API_BASE}/files/${encodeURIComponent(metadata.id)}?alt=media`
  );
  const payload = validateCloudPayload(rawPayload);

  return {
    metadata,
    payload,
    data: payload.data,
    cloudUpdatedAt: normalizeCloudUpdatedAt(payload)
  };
}

export async function restoreFromDrive(token?: string): Promise<GoogleDriveSyncDownload | undefined> {
  return await downloadSyncFile(undefined, token);
}

export function compareLocalAndCloud(
  localData: AuraStartData,
  cloud: GoogleDriveSyncDownload | undefined,
  syncSettings: AuraSyncSettings
): GoogleDriveComparison {
  if (!cloud) {
    return "no_cloud_file";
  }

  const lastSyncedTime = syncSettings.lastSyncedAt ? new Date(syncSettings.lastSyncedAt).getTime() : 0;
  const localTime = new Date(localData.updatedAt).getTime();
  const cloudTime = new Date(cloud.cloudUpdatedAt).getTime();

  if (!Number.isFinite(localTime) || !Number.isFinite(cloudTime)) {
    return "conflict";
  }

  const localChanged = lastSyncedTime > 0 ? localTime > lastSyncedTime : false;
  const cloudChanged = lastSyncedTime > 0 ? cloudTime > lastSyncedTime : false;

  if (localChanged && cloudChanged && Math.abs(localTime - cloudTime) > 1000) {
    return "conflict";
  }

  if (Math.abs(localTime - cloudTime) <= 1000) {
    return "in_sync";
  }

  return localTime > cloudTime ? "local_newer" : "cloud_newer";
}

export async function deleteSyncFile(token?: string): Promise<boolean> {
  const authToken = token ?? await getAuthToken(false);
  const metadata = await findSyncFile(authToken);
  if (!metadata) {
    return false;
  }

  await driveFetch<void>(authToken, `${DRIVE_API_BASE}/files/${encodeURIComponent(metadata.id)}`, {
    method: "DELETE"
  });
  return true;
}

export function mapDriveError(error: unknown): string {
  if (error instanceof GoogleDriveSyncError) {
    const message = error.message.toLowerCase();
    const reason = error.reason?.toLowerCase() ?? "";

    if (error.code === "auth_cancelled") {
      return error.message || "Google authorization was cancelled or did not complete.";
    }
    if (error.code === "identity_unavailable") {
      return error.message;
    }
    if (error.code === "unauthorized") {
      return "Google authorization expired. Reconnect Google Drive and try again.";
    }
    if (error.code === "forbidden") {
      if (
        reason === "accessnotconfigured"
        || message.includes("api has not been used")
        || message.includes("api has not been enabled")
        || message.includes("it is disabled")
      ) {
        return "Google Drive API is disabled for this OAuth project. Enable Google Drive API in Google Cloud Console, wait a few minutes, then reconnect Google Drive.";
      }

      if (
        reason === "insufficientpermissions"
        || message.includes("insufficient authentication scopes")
        || message.includes("insufficient permission")
      ) {
        return "Google authorized Aura Start without the required drive.appdata permission. Disconnect Google Account, connect again, and make sure the OAuth consent screen includes the Google Drive appdata scope.";
      }

      return `Google Drive denied access: ${error.message}`;
    }
    if (error.code === "not_found") {
      return "No Google Drive sync file found.";
    }
    if (error.code === "rate_limited") {
      return "Google Drive rate limit reached. Try again later.";
    }
    if (error.code === "network") {
      return `Network error: ${error.message}`;
    }
    if (error.code === "invalid_cloud_file") {
      return error.message;
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "Google Drive sync failed.";
}
