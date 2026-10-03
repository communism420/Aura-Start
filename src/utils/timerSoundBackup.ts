import { MAX_RESTORE_POINTS } from "../constants";
import type { AuraStartData } from "../types";
import { isTimerSoundId, loadTimerSound, normalizeTimerSoundAsset, storeTimerSound, type TimerSoundAsset } from "./timerSoundStorage";
import { PortableJsonBudget } from "./portableJsonSize";

type TimerSoundBundle = Readonly<Record<string, TimerSoundAsset>>;

// Portable bytes belong to the pending import, never to main storage or history.
const pendingBundles = new WeakMap<AuraStartData, TimerSoundBundle>();

function referencedSoundIds(data: AuraStartData): Set<string> {
  const ids = new Set<string>();
  for (const snapshot of [data, ...data.restorePoints.map((point) => point.data)]) {
    const id = snapshot.settings.timer.customSoundId;
    if (id === undefined || id === null) continue;
    if (!isTimerSoundId(id)) throw new Error("The backup contains an invalid timer sound reference.");
    ids.add(id);
  }
  if (ids.size > MAX_RESTORE_POINTS + 1) throw new Error("The backup contains too many timer sounds.");
  return ids;
}

export function registerTimerSoundBackup(data: AuraStartData, rawBundle: unknown): void {
  if (rawBundle === undefined) {
    pendingBundles.delete(data);
    return;
  }
  if (typeof rawBundle !== "object" || rawBundle === null || Array.isArray(rawBundle)) {
    throw new Error("The backup timer sounds must be an object.");
  }
  const ids = referencedSoundIds(data);
  const entries = Object.entries(rawBundle);
  if (entries.length > MAX_RESTORE_POINTS + 1) throw new Error("The backup contains too many timer sounds.");
  const bundle: Record<string, TimerSoundAsset> = Object.create(null);
  for (const [id, value] of entries) {
    if (!isTimerSoundId(id) || !ids.has(id)) {
      throw new Error("The backup contains an unreferenced or invalid timer sound.");
    }
    const sound = normalizeTimerSoundAsset(value);
    if (!sound) throw new Error("A backup timer sound has an invalid format or size.");
    bundle[id] = Object.freeze({ ...sound });
  }
  pendingBundles.set(data, Object.freeze(bundle));
}

export async function collectTimerSoundBackup(data: AuraStartData, budget = new PortableJsonBudget()): Promise<Record<string, TimerSoundAsset>> {
  const bundle: Record<string, TimerSoundAsset> = Object.create(null);
  budget.add({ timerSounds: {} });
  for (const id of referencedSoundIds(data)) {
    const sound = await loadTimerSound(id);
    if (!sound) {
      throw new Error("A timer sound needed for this backup is unavailable. The backup was not exported.");
    }
    budget.add({ [id]: sound }, 1);
    bundle[id] = sound;
  }
  return bundle;
}

/** All referenced assets must be durable before imported settings can be published. */
export async function importTimerSoundBackup(data: AuraStartData): Promise<void> {
  const bundle = pendingBundles.get(data);
  for (const id of referencedSoundIds(data)) {
    const sound = bundle?.[id];
    if (sound !== undefined) {
      await storeTimerSound(sound, id);
    } else if (!await loadTimerSound(id)) {
      throw new Error("This backup refers to a timer sound that is not included and is unavailable on this device. Export a new full ZIP backup from the source device.");
    }
  }
}
