import { MAX_RESTORE_POINTS } from "../constants";
import { t } from "../i18n";
import type { AuraRestorePoint, AuraSyncConflict, AuraSyncSettings, AuraStartData } from "../types";
import { sendExtensionRuntimeMessageWithResponse } from "../utils/browserApi";
import { nowIso } from "../utils/dates";
import { createId } from "../utils/ids";
import { snapshotSettingsCompatibility } from "../utils/settingsPatch";
import { validateAuraData } from "../utils/importJson";
import { mergeSyncData, sameSyncContent, sameSyncReplica } from "../utils/syncReplica";
import { loadAuraData, nextStorageRevision, updateAuraData } from "../utils/storage";
import { hasUnchangedGoogleDriveFiles, rememberGoogleDriveFiles } from "./googleDrivePollCache";
import { synchronizeSharedGoogleDrive } from "./googleDriveSharedSync";
import {
  getAuthToken,
  GoogleDriveSyncError,
  listSyncFiles,
  isSharedSyncFile,
  isGoogleDriveAuthorizationUnavailable,
  mapDriveError
} from "./googleDriveSync";

export const GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST = "aura-start:google-drive-background-sync";
export const GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT = "aura-start:google-drive-background-sync-result";
const GOOGLE_DRIVE_RECONNECT_MESSAGE = "Reconnect Google Drive to authorize shared sync. Existing local data is preserved.";

export type GoogleDriveBackgroundSyncResult = (
  | { status: "uploaded"; reason: "created" | "replica_created" | "updated" }
  | { status: "downloaded" }
  | { status: "in_sync" }
  | { status: "cloud_newer" }
  | { status: "conflict"; conflict: AuraSyncConflict }
  | { status: "needs_reconnect"; message: string }
  | { status: "failed"; message: string }
  | { status: "skipped"; reason: "disabled" | "not_dirty" | "storage_unavailable" }
) & { quiet?: boolean; resultId?: string; syncDeviceId?: string; syncConnectionId?: string; pollAfterMs?: number };

export type GoogleDriveBackgroundSyncRequest = {
  type: typeof GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST;
  force?: boolean;
  poll?: boolean;
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
  if (sync.lastSyncedLocalUpdatedAt) return data.updatedAt !== sync.lastSyncedLocalUpdatedAt;
  const localUpdatedAt = isoTime(data.updatedAt);
  const legacyLastSyncedAt = isoTime(sync.lastSyncedAt);
  return legacyLastSyncedAt === undefined || (localUpdatedAt !== undefined && localUpdatedAt > legacyLastSyncedAt);
}

export function shouldQueueGoogleDriveBackgroundSync(value: unknown): boolean {
  try {
    const data = validateAuraData(value);
    return data.settings.sync.mode === "auto" && Boolean(data.settings.sync.connected)
      && !data.settings.sync.reconnectRequired && hasPendingGoogleDriveLocalChanges(data);
  } catch {
    return false;
  }
}

export function isGoogleDriveBackgroundSyncRequest(message: unknown): message is GoogleDriveBackgroundSyncRequest {
  if (typeof message !== "object" || message === null) return false;
  const request = message as { force?: unknown; poll?: unknown; type?: unknown };
  return request.type === GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST
    && (request.force === undefined || typeof request.force === "boolean")
    && (request.poll === undefined || typeof request.poll === "boolean");
}

export function isGoogleDriveBackgroundSyncEvent(message: unknown): message is GoogleDriveBackgroundSyncEvent {
  if (typeof message !== "object" || message === null) return false;
  const event = message as { result?: unknown; type?: unknown };
  if (event.type !== GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT || typeof event.result !== "object" || event.result === null) return false;
  const result = event.result as { conflict?: unknown; message?: unknown; reason?: unknown; status?: unknown; quiet?: unknown };
  if (result.quiet !== undefined && typeof result.quiet !== "boolean") return false;
  if (result.status === "uploaded") return result.reason === "created" || result.reason === "replica_created" || result.reason === "updated";
  if (result.status === "conflict") return typeof result.conflict === "object" && result.conflict !== null;
  if (result.status === "needs_reconnect" || result.status === "failed") return typeof result.message === "string";
  if (result.status === "skipped") return ["disabled", "not_dirty", "storage_unavailable"].includes(String(result.reason));
  return ["in_sync", "cloud_newer", "downloaded"].includes(String(result.status));
}

export async function requestGoogleDriveBackgroundSync(force = false): Promise<GoogleDriveBackgroundSyncResult | undefined> {
  return await sendExtensionRuntimeMessageWithResponse<GoogleDriveBackgroundSyncResult>({
    type: GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST, force
  } satisfies GoogleDriveBackgroundSyncRequest);
}

/** Quiet remote revision check, coalesced across open pages by the background. */
export async function requestGoogleDriveBackgroundPoll(): Promise<GoogleDriveBackgroundSyncResult | undefined> {
  return await sendExtensionRuntimeMessageWithResponse<GoogleDriveBackgroundSyncResult>({
    type: GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST, force: true, poll: true
  } satisfies GoogleDriveBackgroundSyncRequest);
}

function sameConnection(data: AuraStartData, started: AuraSyncSettings): boolean {
  const sync = data.settings.sync;
  return sync.mode === "auto" && Boolean(sync.connected)
    && Boolean(sync.reconnectRequired) === Boolean(started.reconnectRequired)
    && sync.deviceId === started.deviceId && sync.connectionId === started.connectionId;
}

async function persistSyncMetadata(started: AuraSyncSettings, patch: Partial<AuraSyncSettings>): Promise<AuraStartData | undefined> {
  return await updateAuraData((current) => sameConnection(current, started) ? {
    ...current, settings: { ...current.settings, sync: { ...current.settings.sync, ...patch } }
  } : undefined);
}

function hasAcknowledgedGoogleDriveSync(sync: AuraSyncSettings): boolean {
  return Boolean(sync.lastSyncedLocalUpdatedAt || sync.lastSyncedAt || sync.cloudFileId);
}

async function pauseForDeletedCloudData(started: AuraSyncSettings): Promise<GoogleDriveBackgroundSyncResult> {
  try {
    const paused = await persistSyncMetadata(started, { mode: "off", reconnectRequired: true });
    if (!paused) return { status: "skipped", reason: "disabled" };
    return { status: "needs_reconnect", message: t(paused.settings.language, "googleDriveCloudDataDeleted") };
  } catch (error) {
    return { status: "failed", message: mapDriveError(error), quiet: true };
  }
}

let fallbackSyncLock: Promise<unknown> = Promise.resolve();

// The same lock covers page fallback and the extension background. No network
// work happens inside the shorter local-storage lock.
export async function withGoogleDriveSyncLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks) return await locks.request("aura-start-drive-sync", operation);
  const pending = fallbackSyncLock.then(operation, operation);
  fallbackSyncLock = pending.catch(() => undefined);
  return await pending;
}

export async function runGoogleDriveBackgroundSync(force = false): Promise<GoogleDriveBackgroundSyncResult> {
  return await withGoogleDriveSyncLock(async () => ({ ...await runSyncPass(force), resultId: createId("sync") }));
}

async function runSyncPass(force: boolean): Promise<GoogleDriveBackgroundSyncResult> {
  const loaded = await loadAuraData().catch(() => undefined);
  if (!loaded) return { status: "failed", message: "Local storage could not be loaded for sync.", quiet: true };
  if (loaded.status !== "ready") return { status: "skipped", reason: "storage_unavailable" };
  const started = loaded.data.settings.sync;
  if (started.mode !== "auto" || !started.connected) return { status: "skipped", reason: "disabled" };
  if (loaded.backgroundMigrationError || loaded.notesMigrationError) return {
    status: "failed", message: t(loaded.data.settings.language, loaded.notesMigrationError ? "notesMigrationFailed" : "backgroundMigrationFailed"), quiet: true,
    syncDeviceId: started.deviceId, syncConnectionId: started.connectionId
  };
  // Periodic silent recovery can repair a stale reconnect flag or a browser
  // identity session restored externally. It cannot resume mode=off (including
  // explicit disconnects and remote wipes), nor open an authorization window.
  if (started.reconnectRequired && !force) return { status: "needs_reconnect", message: GOOGLE_DRIVE_RECONNECT_MESSAGE, quiet: true };
  if (!force && !hasPendingGoogleDriveLocalChanges(loaded.data)) return { status: "skipped", reason: "not_dirty" };

  return {
    ...await runConnectedSyncPass(started),
    syncDeviceId: started.deviceId,
    syncConnectionId: started.connectionId
  };
}

async function runConnectedSyncPass(started: AuraSyncSettings): Promise<GoogleDriveBackgroundSyncResult> {
  try {
    const token = await getAuthToken(false);
    const files = await listSyncFiles(token);
    // A periodic check reads small file metadata first. A clean installation
    // needs no media download, merge, timestamp change or main-storage write
    // when every observed server revision still matches the completed pass.
    const checked = await loadAuraData();
    if (checked.status !== "ready" || !sameConnection(checked.data, started)) return { status: "skipped", reason: "disabled" };
    // A previously acknowledged connection must not undo a remote wipe by
    // recreating the deleted files from its still-intact local copy.
    if (!files.length && hasAcknowledgedGoogleDriveSync(checked.data.settings.sync)) {
      return await pauseForDeletedCloudData(started);
    }
    if (!hasPendingGoogleDriveLocalChanges(checked.data)
      && files.length === 1 && isSharedSyncFile(files[0])
      && checked.data.settings.sync.cloudFileId === files[0].id
      && await hasUnchangedGoogleDriveFiles(checked.data, files)) {
      if (started.reconnectRequired) {
        const recovered = await persistSyncMetadata(started, { reconnectRequired: false });
        if (!recovered) return { status: "skipped", reason: "disabled" };
      }
      return { status: "in_sync", quiet: true };
    }
    let receivedChanges = false;
    let receivedReplica = false;
    const mergeReceived = (current: AuraStartData, remote: AuraStartData): AuraStartData => {
      const next = mergeSyncData(current, remote);
      const contentChanged = !sameSyncContent(current, next);
      const replicaChanged = !sameSyncReplica(current, next);
      receivedChanges ||= contentChanged;
      receivedReplica ||= replicaChanged;
      if (contentChanged) {
        const { restorePoints: _history, syncReplica: _replica, ...snapshot } = current;
        next.restorePoints = [{
          id: createId("restore"),
          name: t(current.settings.language, "restoreNameBeforeCloudRestore"),
          reason: "before_cloud_restore",
          createdAt: nowIso(),
          context: { entity: "sync", source: "Google Drive" },
          data: { ...snapshot, settingsCompatibility: snapshotSettingsCompatibility(current) }
        } satisfies AuraRestorePoint, ...current.restorePoints].slice(0, MAX_RESTORE_POINTS);
      }
      if (contentChanged || replicaChanged) next.updatedAt = nextStorageRevision(current.updatedAt);
      return next;
    };
    const result = await synchronizeSharedGoogleDrive(checked.data, {
      token, deviceId: started.deviceId, files,
      expectedExistingFile: hasAcknowledgedGoogleDriveSync(checked.data.settings.sync),
      reconcileLocal: async (remote) => {
        let unchanged: AuraStartData | undefined;
        const changed = await updateAuraData((current) => {
          if (!sameConnection(current, started)) return undefined;
          const next = mergeReceived(current, remote);
          if (next.updatedAt === current.updatedAt) { unchanged = current; return undefined; }
          return next;
        });
        const latest = changed ?? unchanged;
        if (!latest) throw new GoogleDriveSyncError("unknown", "The Google Drive connection changed during sync.");
        return latest;
      },
      assertActive: async () => {
        const current = await loadAuraData();
        if (current.status !== "ready" || !sameConnection(current.data, started)) {
          throw new GoogleDriveSyncError("unknown", "The Google Drive connection changed during sync.");
        }
      }
    });
    let unchanged: AuraStartData | undefined;
    const changed = await updateAuraData((current) => {
      if (!sameConnection(current, started)) return undefined;
      const next = mergeReceived(current, result.data);
      // The transport may have merged another writer while retrying a 412.
      // Acknowledge the actual committed union, never the original input. An
      // edit made locally during the upload remains dirty until its own pass.
      const acknowledged = sameSyncReplica(next, result.data);
      const transferred = result.uploaded || receivedChanges || receivedReplica
        || current.settings.sync.cloudFileId !== result.metadata.id;
      const needsAcknowledgement = acknowledged && hasPendingGoogleDriveLocalChanges(next);
      if (!transferred && !needsAcknowledgement && !current.settings.sync.reconnectRequired) {
        unchanged = current;
        return undefined;
      }
      next.settings.sync = {
        ...current.settings.sync,
        cloudFileId: result.metadata.id,
        ...(transferred ? { lastSyncedAt: nowIso(),
          lastCloudUpdatedAt: result.metadata.modifiedTime ?? result.data.updatedAt } : {}),
        ...(acknowledged ? { lastSyncedLocalUpdatedAt: next.updatedAt } : {}),
        reconnectRequired: false
      };
      return next;
    });
    const persisted = changed ?? unchanged;
    if (!persisted) return { status: "skipped", reason: "disabled" };
    // Cache only revisions actually consumed. Unresolved duplicate retirement
    // or a concurrent local edit must get another full pass.
    if (result.consolidated && !hasPendingGoogleDriveLocalChanges(persisted)) {
      await rememberGoogleDriveFiles(persisted, result.observedFiles);
    }
    if (receivedChanges) return { status: "downloaded" };
    return result.uploaded
      ? { status: "uploaded", reason: result.cloudWasEmpty ? "created" : "updated" }
      : { status: "in_sync", quiet: true };
  } catch (error) {
    const current = await loadAuraData().catch(() => undefined);
    if (current?.status === "ready" && !sameConnection(current.data, started)) {
      return { status: "skipped", reason: "disabled" };
    }
    if (error instanceof GoogleDriveSyncError && error.code === "cloud_deleted") {
      return await pauseForDeletedCloudData(started);
    }
    const message = mapDriveError(error);
    if (isGoogleDriveAuthorizationUnavailable(error)) {
      if (started.reconnectRequired) return { status: "needs_reconnect", message, quiet: true };
      const marked = await persistSyncMetadata(started, { reconnectRequired: true }).catch(() => undefined);
      if (!marked) return { status: "skipped", reason: "disabled" };
      return { status: "needs_reconnect", message };
    }
    return { status: "failed", message, quiet: true };
  }
}
