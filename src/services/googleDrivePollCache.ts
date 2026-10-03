import type { AuraStartData, AuraSyncSettings } from "../types";
import { getExtensionStorageArea } from "../utils/browserApi";
import type { GoogleDriveFileMetadata } from "./googleDriveSync";

export const GOOGLE_DRIVE_POLL_CACHE_KEY = "aura-start-google-drive-poll-cache-v1";
type PollCache = { version: 1; connection: string; localUpdatedAt: string; files: string };

export async function clearGoogleDrivePollCache(): Promise<void> {
  const area = getExtensionStorageArea("local");
  if (area) await area.remove(GOOGLE_DRIVE_POLL_CACHE_KEY);
  else if (typeof localStorage !== "undefined") localStorage.removeItem(GOOGLE_DRIVE_POLL_CACHE_KEY);
}

function connectionKey(sync: AuraSyncSettings): string {
  return JSON.stringify([sync.deviceId, sync.connectionId ?? "", sync.accountEmail ?? ""]);
}

/** Drive's version changes for every server-side modification, including edits
 * whose size and timestamp happen to match. Missing revision metadata disables
 * this optimization rather than hiding possible changes. */
function fileFingerprint(files: GoogleDriveFileMetadata[]): string | undefined {
  if (files.length > 10_000) return undefined;
  const rows: (string | boolean)[][] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (typeof file.id !== "string" || !file.id || file.id.length > 512 || seen.has(file.id)) return undefined;
    seen.add(file.id);
    const version = typeof file.version === "string" && /^\d{1,64}$/.test(file.version) ? file.version : "";
    // Timestamps can be preserved and equal-sized content can still differ.
    // Only Drive's revision counter proves an unchanged metadata snapshot.
    if (!version) return undefined;
    const modified = typeof file.modifiedTime === "string" && file.modifiedTime.length <= 64
      && Number.isFinite(Date.parse(file.modifiedTime)) ? file.modifiedTime : "";
    const size = typeof file.size === "string" && /^\d{1,64}$/.test(file.size) ? file.size : "";
    rows.push([file.id, version, modified, size, file.legacyAppData === true, file.name,
      file.appProperties?.auraStartDeviceId ?? "", file.appProperties?.auraStartSharedSync ?? ""]);
  }
  rows.sort((left, right) => String(left[0]) < String(right[0]) ? -1 : String(left[0]) > String(right[0]) ? 1 : 0);
  return JSON.stringify(rows);
}

export async function hasUnchangedGoogleDriveFiles(data: AuraStartData, files: GoogleDriveFileMetadata[]): Promise<boolean> {
  const fingerprint = fileFingerprint(files);
  if (fingerprint === undefined) return false;
  try {
    const area = getExtensionStorageArea("local");
    const raw = area ? (await area.get(GOOGLE_DRIVE_POLL_CACHE_KEY))[GOOGLE_DRIVE_POLL_CACHE_KEY]
      : JSON.parse(localStorage.getItem(GOOGLE_DRIVE_POLL_CACHE_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const cached = raw as Partial<PollCache>;
    return cached.version === 1 && cached.connection === connectionKey(data.settings.sync)
      && cached.localUpdatedAt === (data.settings.sync.lastSyncedLocalUpdatedAt ?? data.updatedAt) && cached.files === fingerprint;
  } catch { return false; }
}

/** A cache write is optional and separate from the user's synced document. */
export async function rememberGoogleDriveFiles(data: AuraStartData, files: GoogleDriveFileMetadata[]): Promise<void> {
  const fingerprint = fileFingerprint(files);
  if (fingerprint === undefined) return;
  // Older clean installations acknowledge content using lastSyncedAt only.
  // Their exact local revision is sufficient for the cursor; upgrading this
  // optimization must not itself rewrite settings or the visible sync time.
  const cache: PollCache = { version: 1, connection: connectionKey(data.settings.sync),
    localUpdatedAt: data.settings.sync.lastSyncedLocalUpdatedAt ?? data.updatedAt, files: fingerprint };
  try {
    const area = getExtensionStorageArea("local");
    if (area) await area.set({ [GOOGLE_DRIVE_POLL_CACHE_KEY]: cache });
    else localStorage.setItem(GOOGLE_DRIVE_POLL_CACHE_KEY, JSON.stringify(cache));
  } catch { /* A later poll safely downloads again if this optimization cannot persist. */ }
}
