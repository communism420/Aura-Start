import type { AuraSyncConflict, AuraSyncSettings, AuraStartData } from "../types";
import {
  sendExtensionRuntimeMessageWithResponse
} from "../utils/browserApi";
import { nowIso } from "../utils/dates";
import { validateAuraData } from "../utils/importJson";
import { loadAuraData, updateAuraData } from "../utils/storage";
import {
  backupToDrive,
  compareLocalAndCloud,
  downloadSyncFile,
  getAuthToken,
  isGoogleDriveAuthorizationUnavailable,
  mapDriveError
} from "./googleDriveSync";

export const GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST = "aura-start:google-drive-background-sync";
export const GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT = "aura-start:google-drive-background-sync-result";
const GOOGLE_DRIVE_RECONNECT_MESSAGE = "Google authorization needs to be reconnected before Drive sync can continue.";

export type GoogleDriveBackgroundSyncResult =
  | { status: "uploaded"; reason: "created" | "updated" }
  | { status: "in_sync" }
  | { status: "cloud_newer" }
  | { status: "conflict"; conflict: AuraSyncConflict }
  | { status: "needs_reconnect"; message: string }
  | { status: "failed"; message: string }
  | { status: "skipped"; reason: "disabled" | "not_dirty" | "storage_unavailable" };

export type GoogleDriveBackgroundSyncRequest = {
  type: typeof GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST;
  force?: boolean;
};

export type GoogleDriveBackgroundSyncEvent = {
  type: typeof GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT;
  result: GoogleDriveBackgroundSyncResult;
};

function isoTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export function hasPendingGoogleDriveLocalChanges(data: AuraStartData): boolean {
  const sync = data.settings.sync;
  if (sync.lastSyncedLocalUpdatedAt) {
    return data.updatedAt !== sync.lastSyncedLocalUpdatedAt;
  }

  const localUpdatedAt = isoTime(data.updatedAt);
  const legacyLastSyncedAt = isoTime(sync.lastSyncedAt);
  return legacyLastSyncedAt === undefined || (localUpdatedAt !== undefined && localUpdatedAt > legacyLastSyncedAt);
}

export function shouldQueueGoogleDriveBackgroundSync(value: unknown): boolean {
  try {
    const data = validateAuraData(value);
    return data.settings.sync.mode === "auto"
      && Boolean(data.settings.sync.connected)
      && !data.settings.sync.reconnectRequired
      && hasPendingGoogleDriveLocalChanges(data);
  } catch {
    return false;
  }
}

export function isGoogleDriveBackgroundSyncRequest(message: unknown): message is GoogleDriveBackgroundSyncRequest {
  if (typeof message !== "object" || message === null) return false;
  const request = message as { force?: unknown; type?: unknown };
  return request.type === GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST
    && (request.force === undefined || typeof request.force === "boolean");
}

export function isGoogleDriveBackgroundSyncEvent(message: unknown): message is GoogleDriveBackgroundSyncEvent {
  if (typeof message !== "object" || message === null) return false;
  const event = message as { result?: unknown; type?: unknown };
  if (event.type !== GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT || typeof event.result !== "object" || event.result === null) {
    return false;
  }

  const result = event.result as { conflict?: unknown; message?: unknown; reason?: unknown; status?: unknown };
  if (result.status === "uploaded") return result.reason === "created" || result.reason === "updated";
  if (result.status === "conflict") return typeof result.conflict === "object" && result.conflict !== null;
  if (result.status === "needs_reconnect" || result.status === "failed") return typeof result.message === "string";
  if (result.status === "skipped") {
    return result.reason === "disabled" || result.reason === "not_dirty" || result.reason === "storage_unavailable";
  }
  return result.status === "in_sync" || result.status === "cloud_newer";
}

export async function requestGoogleDriveBackgroundSync(force = false): Promise<GoogleDriveBackgroundSyncResult | undefined> {
  return await sendExtensionRuntimeMessageWithResponse<GoogleDriveBackgroundSyncResult>({
    type: GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST,
    force
  } satisfies GoogleDriveBackgroundSyncRequest);
}

async function persistSyncMetadata(
  patch: Partial<AuraSyncSettings>
): Promise<AuraStartData | undefined> {
  return await updateAuraData((current) => {
    const currentSync = current.settings.sync;
    if (currentSync.mode === "off" || !currentSync.connected) {
      return undefined;
    }

    return {
      ...current,
      settings: {
        ...current.settings,
        sync: {
          ...currentSync,
          ...patch,
          deviceId: patch.deviceId ?? currentSync.deviceId
        }
      }
    };
  });
}

export async function runGoogleDriveBackgroundSync(force = false): Promise<GoogleDriveBackgroundSyncResult> {
  const loaded = await loadAuraData().catch(() => undefined);
  if (!loaded) {
    return { status: "failed", message: "Local storage could not be loaded for background sync." };
  }
  if (loaded.status !== "ready") {
    return { status: "skipped", reason: "storage_unavailable" };
  }

  const data = loaded.data;
  const sync = data.settings.sync;
  if (sync.mode !== "auto" || !sync.connected) {
    return { status: "skipped", reason: "disabled" };
  }
  if (sync.reconnectRequired) {
    return { status: "needs_reconnect", message: GOOGLE_DRIVE_RECONNECT_MESSAGE };
  }
  if (!force && !hasPendingGoogleDriveLocalChanges(data)) {
    return { status: "skipped", reason: "not_dirty" };
  }

  try {
    const token = await getAuthToken(false);
    const download = await downloadSyncFile(sync.cloudFileId, token);
    const comparison = compareLocalAndCloud(data, download, sync);

    if (comparison === "no_cloud_file" || comparison === "local_newer") {
      const metadata = await backupToDrive(data, {
        deviceId: sync.deviceId,
        fileId: sync.cloudFileId,
        token
      });
      const persisted = await persistSyncMetadata({
        mode: "auto",
        connected: true,
        reconnectRequired: false,
        cloudFileId: metadata.id,
        lastSyncedAt: nowIso(),
        lastSyncedLocalUpdatedAt: data.updatedAt,
        lastCloudUpdatedAt: data.updatedAt
      });
      return persisted
        ? { status: "uploaded", reason: comparison === "no_cloud_file" ? "created" : "updated" }
        : { status: "skipped", reason: "disabled" };
    }

    if (!download) {
      return { status: "skipped", reason: "storage_unavailable" };
    }

    if (comparison === "in_sync") {
      const persisted = await persistSyncMetadata({
        mode: "auto",
        connected: true,
        reconnectRequired: false,
        cloudFileId: download.metadata.id,
        lastSyncedAt: nowIso(),
        lastSyncedLocalUpdatedAt: data.updatedAt,
        lastCloudUpdatedAt: download.cloudUpdatedAt
      });
      return persisted ? { status: "in_sync" } : { status: "skipped", reason: "disabled" };
    }

    if (comparison === "cloud_newer") {
      const persisted = await persistSyncMetadata({
        mode: "auto",
        connected: true,
        reconnectRequired: false,
        cloudFileId: download.metadata.id,
        lastCloudUpdatedAt: download.cloudUpdatedAt
      });
      return persisted ? { status: "cloud_newer" } : { status: "skipped", reason: "disabled" };
    }

    return {
      status: "conflict",
      conflict: {
        detectedAt: nowIso(),
        localUpdatedAt: data.updatedAt,
        cloudUpdatedAt: download.cloudUpdatedAt,
        cloudFileId: download.metadata.id,
        cloudData: download.data
      }
    };
  } catch (error) {
    const message = mapDriveError(error);
    if (isGoogleDriveAuthorizationUnavailable(error)) {
      await persistSyncMetadata({ reconnectRequired: true }).catch(() => undefined);
      return { status: "needs_reconnect", message };
    }

    return { status: "failed", message };
  }
}
