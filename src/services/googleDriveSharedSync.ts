import type { AuraStartData } from "../types";
import { mergeSyncData, sameSyncReplica } from "../utils/syncReplica";
import {
  createSharedSyncFile,
  deleteConditionalSyncFile,
  downloadConditionalSyncFile,
  GoogleDriveSyncError,
  isGoogleDrivePreconditionFailed,
  isSharedSyncFile,
  listSyncFiles,
  updateConditionalSyncFile,
  type GoogleDriveConditionalDownload,
  type GoogleDriveFileMetadata
} from "./googleDriveSync";

const MAX_SHARED_SYNC_ATTEMPTS = 8;

export type GoogleDriveSharedSyncResult = {
  metadata: GoogleDriveFileMetadata;
  /** The full causal state actually verified in the surviving cloud file. */
  data: AuraStartData;
  uploaded: boolean;
  cloudWasEmpty: boolean;
  /** Only revisions whose contents this operation actually consumed. */
  observedFiles: GoogleDriveFileMetadata[];
  consolidated: boolean;
};

export type GoogleDriveSharedSyncOptions = {
  token: string;
  deviceId: string;
  files?: GoogleDriveFileMetadata[];
  expectedExistingFile?: boolean;
  assertActive?: () => Promise<void>;
  reconcileLocal?: (merged: AuraStartData) => Promise<AuraStartData>;
};

function deletedCloudError(): GoogleDriveSyncError {
  return new GoogleDriveSyncError("cloud_deleted", "The Google Drive backup was deleted. Reconnect Google Drive to create a new backup.");
}

function isMissing(error: unknown): boolean {
  return error instanceof GoogleDriveSyncError && (error.code === "not_found" || error.code === "cloud_deleted" || error.status === 404);
}

function compareCanonical(a: GoogleDriveConditionalDownload, b: GoogleDriveConditionalDownload): number {
  // All clients use the same immutable ordering. A missing legacy creation
  // date sorts after known dates; the ID also settles equal timestamps.
  const aCreated = a.metadata.createdTime ?? "\uffff";
  const bCreated = b.metadata.createdTime ?? "\uffff";
  return aCreated < bCreated ? -1 : aCreated > bCreated ? 1
    : a.metadata.id < b.metadata.id ? -1 : a.metadata.id > b.metadata.id ? 1 : 0;
}

function containsReplica(container: AuraStartData, candidate: AuraStartData): boolean {
  return sameSyncReplica(container, mergeSyncData(container, candidate));
}

function matchesRevision(a: GoogleDriveFileMetadata, b: GoogleDriveFileMetadata): boolean {
  // Missing metadata is not evidence that a newly listed revision was read.
  return a.id === b.id && Boolean(a.version) && a.version === b.version;
}

/** Merge every accessible backup into one normal Drive file. A conflict always
 * causes a fresh read and CRDT merge; neither updates nor retirement of a
 * duplicate have an unconditional-write fallback. */
export async function synchronizeSharedGoogleDrive(
  data: AuraStartData,
  options: GoogleDriveSharedSyncOptions
): Promise<GoogleDriveSharedSyncResult> {
  let merged = data;
  let files = options.files ?? await listSyncFiles(options.token);
  let uploaded = false;
  let cloudWasEmpty = files.length === 0;
  let sawExisting = Boolean(options.expectedExistingFile || files.length);
  let sawCanonical = files.some(isSharedSyncFile);
  // A successful create is useful even if an immediately following listing
  // has not exposed it yet. Confirm it directly; never create a second copy.
  let created: GoogleDriveFileMetadata | undefined;

  for (let attempt = 0; attempt < MAX_SHARED_SYNC_ATTEMPTS; attempt += 1) {
    await options.assertActive?.();
    if (cloudWasEmpty && files.some((file) => file.id !== created?.id)) cloudWasEmpty = false;
    if (created && !files.some((file) => file.id === created!.id)) files = [...files, created];
    if (!files.length && sawExisting) {
      files = await listSyncFiles(options.token);
      if (!files.length) throw deletedCloudError();
    }

    const snapshots: GoogleDriveConditionalDownload[] = [];
    try {
      // Validate all copies and their selected assets before mutating any of
      // them. A corrupt or unreadable duplicate must never be discarded.
      for (const metadata of files) {
        const snapshot = await downloadConditionalSyncFile(metadata, options.token);
        if (snapshot) snapshots.push(snapshot);
      }
    } catch (error) {
      if (!isGoogleDrivePreconditionFailed(error)) throw error;
      files = await listSyncFiles(options.token);
      continue;
    }

    if (created && !snapshots.some((snapshot) => snapshot.metadata.id === created!.id)) created = undefined;
    if (snapshots.some((snapshot) => snapshot.metadata.id !== created?.id)) cloudWasEmpty = false;
    if (!snapshots.length && sawExisting) {
      // Another migrator may have retired every ID in our earlier listing.
      // Only a fresh empty listing confirms a wipe of the whole dataset.
      files = await listSyncFiles(options.token);
      if (!files.length) throw deletedCloudError();
      continue;
    }
    for (const snapshot of snapshots) merged = mergeSyncData(merged, snapshot.data);
    // The caller persists incoming data before a network write can fail, and
    // rebases edits made while downloads were pending into this same upload.
    if (options.reconcileLocal) merged = mergeSyncData(merged, await options.reconcileLocal(merged));
    let canonical = snapshots.filter((snapshot) => isSharedSyncFile(snapshot.metadata)).sort(compareCanonical)[0];

    if (!canonical) {
      if (sawCanonical) {
        files = await listSyncFiles(options.token);
        if (!files.length) throw deletedCloudError();
        continue;
      }
      // A fresh ID prevents an already in-flight old per-device writer from
      // unconditionally overwriting the merged canonical during migration.
      await options.assertActive?.();
      created = await createSharedSyncFile(merged, options.deviceId, options.token);
      uploaded = true;
      sawExisting = true;
      sawCanonical = true;
      // Discovery after creating is required: another installation can have
      // created a file at the same time, since Drive names are not unique.
      files = await listSyncFiles(options.token);
      if (files.some((file) => file.id !== created!.id)) cloudWasEmpty = false;
      continue;
    }

    sawExisting = true;
    sawCanonical = true;
    if (!sameSyncReplica(canonical.data, merged)) {
      await options.assertActive?.();
      try {
        const metadata = await updateConditionalSyncFile(merged, {
          deviceId: options.deviceId, token: options.token, snapshot: canonical
        });
        uploaded = true;
        // Obtain the actual committed state and its ETag, rather than assuming
        // another writer could not have updated it after our successful PUT.
        const verified = await downloadConditionalSyncFile(metadata, options.token);
        if (!verified) {
          files = await listSyncFiles(options.token);
          continue;
        }
        canonical = verified;
      } catch (error) {
        if (!isGoogleDrivePreconditionFailed(error) && !isMissing(error)) throw error;
        files = await listSyncFiles(options.token);
        continue;
      }
    }

    if (!isSharedSyncFile(canonical.metadata) || !containsReplica(canonical.data, merged)) {
      merged = mergeSyncData(merged, canonical.data);
      files = await listSyncFiles(options.token);
      continue;
    }
    merged = mergeSyncData(merged, canonical.data);

    let retry = false;
    for (const duplicate of snapshots) {
      if (duplicate.metadata.id === canonical.metadata.id) continue;
      // Every retired snapshot is already covered by the confirmed canonical.
      // Its ETag prevents deleting an old client's concurrent last update.
      if (!containsReplica(canonical.data, duplicate.data)) { retry = true; break; }
      await options.assertActive?.();
      try {
        await deleteConditionalSyncFile(duplicate, options.token);
      } catch (error) {
        if (!isGoogleDrivePreconditionFailed(error)) throw error;
        retry = true;
        break;
      }
    }

    files = await listSyncFiles(options.token);
    if (!files.length) throw deletedCloudError();
    if (retry || files.length !== 1 || files[0].id !== canonical.metadata.id || !isSharedSyncFile(files[0])) continue;
    if (!matchesRevision(files[0], canonical.metadata)) {
      if (files[0].version && canonical.metadata.version) continue;
      // Some Drive responses omit revision metadata. They must disable the
      // metadata-only cache, but a verified strong ETag still allows sync.
      try {
        const verified = await downloadConditionalSyncFile(files[0], options.token);
        if (!verified || !isSharedSyncFile(verified.metadata)) continue;
        if (verified.etag !== canonical.etag) {
          merged = mergeSyncData(merged, verified.data);
          continue;
        }
        canonical = verified;
      } catch (error) {
        if (!isGoogleDrivePreconditionFailed(error)) throw error;
        continue;
      }
    }

    return {
      metadata: canonical.metadata,
      data: merged,
      uploaded,
      cloudWasEmpty,
      observedFiles: [canonical.metadata],
      consolidated: true
    };
  }

  throw new GoogleDriveSyncError("unknown", "Google Drive changed repeatedly during synchronization. Local changes are preserved and sync will retry.", 412, "shared_sync_contention");
}
