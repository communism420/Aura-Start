import { MAX_RESTORE_POINTS } from "../constants";
import type { AuraStartData } from "../types";
import { isBackgroundImageId, loadBackgroundImage, normalizeCustomBackgroundImage, storeBackgroundImage } from "./backgroundImageStorage";

type BackgroundImageBundle = Readonly<Record<string, string>>;

// Keep portable image bytes outside the main document and its Restore Points.
// The parsed object owns this temporary bundle until import succeeds or is discarded.
const pendingBundles = new WeakMap<AuraStartData, BackgroundImageBundle>();

function referencedImageIds(data: AuraStartData): Set<string> {
  const ids = new Set<string>();
  const snapshots = [data, ...data.restorePoints.map((point) => point.data)];
  for (const snapshot of snapshots) {
    const id = snapshot.settings.background.customImageId;
    if (id === undefined || id === null) continue;
    if (!isBackgroundImageId(id)) throw new Error("The backup contains an invalid background image reference.");
    ids.add(id);
  }
  if (ids.size > MAX_RESTORE_POINTS + 1) throw new Error("The backup contains too many background images.");
  return ids;
}

export function registerBackgroundImageBackup(data: AuraStartData, rawBundle: unknown): void {
  if (rawBundle === undefined) {
    pendingBundles.delete(data);
    return;
  }
  if (typeof rawBundle !== "object" || rawBundle === null || Array.isArray(rawBundle)) {
    throw new Error("The backup background images must be an object.");
  }
  const ids = referencedImageIds(data);
  const entries = Object.entries(rawBundle);
  if (entries.length > MAX_RESTORE_POINTS + 1) throw new Error("The backup contains too many background images.");
  const bundle: Record<string, string> = Object.create(null);
  for (const [id, value] of entries) {
    if (!isBackgroundImageId(id) || !ids.has(id)) {
      throw new Error("The backup contains an unreferenced or invalid background image.");
    }
    const image = normalizeCustomBackgroundImage(value);
    if (!image) throw new Error("A backup background image has an invalid format or size.");
    bundle[id] = image;
  }
  pendingBundles.set(data, Object.freeze(bundle));
}

export async function collectBackgroundImageBackup(data: AuraStartData): Promise<Record<string, string>> {
  const bundle: Record<string, string> = Object.create(null);
  for (const id of referencedImageIds(data)) {
    const image = await loadBackgroundImage(id);
    if (!image) {
      throw new Error("A background image needed for this backup is unavailable. The backup was not exported.");
    }
    bundle[id] = image;
  }
  return bundle;
}

/** Save and verify every referenced asset before an import can publish image IDs. */
export async function importBackgroundImageBackup(data: AuraStartData): Promise<void> {
  const bundle = pendingBundles.get(data);
  for (const id of referencedImageIds(data)) {
    const image = bundle?.[id];
    if (image !== undefined) {
      await storeBackgroundImage(image, id);
    } else if (!await loadBackgroundImage(id)) {
      throw new Error("This backup refers to a background image that is not included and is unavailable on this device. Export a new full ZIP backup from the source device.");
    }
  }
}
