import type { AuraStartData, AuraSyncSettings } from "../types";
import { nowIso } from "../utils/dates";
import { validateAuraData } from "../utils/importJson";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SYNC_FILE_NAME = "aura-start-sync.json";
const CLOUD_SCHEMA_VERSION = 1;
const CLOUD_APP_NAME = "Aura Start";

type RecordValue = Record<string, unknown>;
type ManifestWithOAuth = chrome.runtime.Manifest & {
  oauth2?: {
    client_id?: string;
    scopes?: string[];
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
  status?: number;

  constructor(code: GoogleDriveErrorCode, message: string, status?: number) {
    super(message);
    this.name = "GoogleDriveSyncError";
    this.code = code;
    this.status = status;
  }
}

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

function ensureOAuthConfigured(): void {
  const manifest = globalThis.chrome?.runtime?.getManifest?.() as ManifestWithOAuth | undefined;
  const clientId = manifest?.oauth2?.client_id?.trim();
  if (!clientId || clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "Google Drive sync needs Aura Start's Google OAuth app client to be configured in manifest.json before this build can connect through Google Account sign-in."
    );
  }

  const scopes = manifest?.oauth2?.scopes?.filter((scope) => typeof scope === "string" && scope.trim()) ?? [];
  if (!scopes.includes(DRIVE_APPDATA_SCOPE)) {
    throw new GoogleDriveSyncError(
      "identity_unavailable",
      "Google Drive sync needs the drive.appdata OAuth scope configured in manifest.json."
    );
  }
}

export function isGoogleDriveSignInConfigured(): boolean {
  try {
    ensureOAuthConfigured();
    return true;
  } catch {
    return false;
  }
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
  try {
    const body = await response.json() as { error?: { message?: string } };
    message = body.error?.message ?? message;
  } catch {
    // Keep the HTTP status text when Google returns a non-JSON error body.
  }

  return new GoogleDriveSyncError(statusCodeToErrorCode(response.status), message, response.status);
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
  ensureOAuthConfigured();
  const identity = requireIdentityApi();

  return await new Promise<string>((resolve, reject) => {
    identity.getAuthToken({ interactive }, (token) => {
      const lastError = getChromeLastErrorMessage();
      if (lastError) {
        const message = isBrowserSigninDisabledError(new Error(lastError))
          ? "Chrome browser sign-in is disabled for this profile. Sign in to Chrome with a Google Account and try Connect Google Drive again."
          : lastError;
        reject(new GoogleDriveSyncError("auth_cancelled", message));
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

export async function clearAuthToken(token?: string): Promise<void> {
  const identity = requireIdentityApi();
  const tokenToClear = token ?? await getAuthToken(false).catch(() => undefined);
  if (!tokenToClear) return;

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

export async function disconnectGoogleAccount(): Promise<{ revokeError?: string }> {
  const token = await getAuthToken(false).catch(() => undefined);
  if (!token) {
    return {};
  }

  let revokeError: string | undefined;
  try {
    await revokeAuthToken(token);
  } catch (error) {
    revokeError = mapDriveError(error);
  }

  await clearAuthToken(token);
  return { revokeError };
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
      return "Aura Start does not have permission to access its Google Drive app data.";
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
