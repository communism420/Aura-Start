import { MAX_RESTORE_POINTS, MAX_WIDGET_NOTES_CHARS, STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import { t } from "../i18n";
import type { AuraStartData } from "../types";
import { getExtensionStorageArea } from "./browserApi";
import { normalizeCustomBackgroundImage, storeBackgroundImage } from "./backgroundImageStorage";
import { validateAuraData } from "./importJson";
import { createId } from "./ids";
import { applyExplicitSettingsPatch, snapshotSettingsCompatibility } from "./settingsPatch";
import { isDefaultedSetting } from "./settingsSchema";
import { commitLocalSyncChanges, ensureSyncReplica, sameSyncContent, sameSyncReplica } from "./syncReplica";

export type StorageLoadResult =
  | { status: "missing"; fallback: boolean }
  | { status: "ready"; data: AuraStartData; fallback: boolean; backgroundMigrationError?: string; notesMigrationError?: string }
  | { status: "corrupt"; raw: string; message: string; fallback: boolean };

const STORAGE_LOCK_NAME = "aura-start-data-storage";
let fallbackStorageLock: Promise<unknown> = Promise.resolve();

export class StorageStateChangedError extends Error {
  constructor() {
    super("The local connection changed before the operation completed.");
    this.name = "StorageStateChangedError";
  }
}

export async function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    const pending = fallbackStorageLock.then(operation, operation);
    fallbackStorageLock = pending.catch(() => undefined);
    return await pending;
  }

  return await locks.request(STORAGE_LOCK_NAME, operation);
}

function localGet(key: string): unknown {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : undefined;
}

function localSet(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function localRemove(key: string): void {
  localStorage.removeItem(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LEGACY_NOTES_RESTORE_SOURCE = "legacy_notes_migration";

async function migrateLegacyNotes(loaded: Extract<StorageLoadResult, { status: "ready" }>): Promise<StorageLoadResult> {
  const storage = getExtensionStorageArea("local");
  let migrated = loaded.data;
  let persisted = false;
  try {
    const uiState = storage ? (await storage.get(UI_STATE_STORAGE_KEY))[UI_STATE_STORAGE_KEY] : localGet(UI_STATE_STORAGE_KEY);
    if (!isRecord(uiState) || typeof uiState.widgetNotes !== "string" || !uiState.widgetNotes.length) return loaded;
    const legacyNotes = uiState.widgetNotes.slice(0, MAX_WIDGET_NOTES_CHARS);
    // Retain the original notes in the existing recovery UI even when another
    // device already supplied a different shared value. This also makes a
    // failed legacy cleanup retryable without creating duplicate snapshots.
    const recoveryExists = migrated.restorePoints.some((point) =>
      point.context?.source === LEGACY_NOTES_RESTORE_SOURCE && point.data.settings.notes.text === legacyNotes);
    if (!recoveryExists) {
      const recovered = { ...migrated, ...applyExplicitSettingsPatch(migrated, { notes: { text: legacyNotes } }) };
      const createdAt = nextStorageRevision(migrated.updatedAt);
      const point = {
        id: createId("restore"), name: t(migrated.settings.language, "widgetNotes"), createdAt,
        reason: "before_restore" as const,
        context: { entity: "settings" as const, title: t(migrated.settings.language, "widgetNotes"), source: LEGACY_NOTES_RESTORE_SOURCE },
        data: {
          version: recovered.version, updatedAt: recovered.updatedAt, settings: recovered.settings,
          settingsCompatibility: snapshotSettingsCompatibility(recovered), groups: recovered.groups
        }
      };
      const next = isDefaultedSetting(migrated, "notes.text")
        ? commitLocalSyncChanges(migrated, recovered, migrated)
        : migrated;
      migrated = await saveAuraDataUnlocked({ ...next, updatedAt: createdAt,
        restorePoints: [point, ...migrated.restorePoints].slice(0, MAX_RESTORE_POINTS) });
    }
    persisted = true;
    const cleaned = { ...uiState, widgetNotes: "" };
    if (storage) await storage.set({ [UI_STATE_STORAGE_KEY]: cleaned });
    else localSet(UI_STATE_STORAGE_KEY, cleaned);
    return { ...loaded, data: migrated };
  } catch (error) {
    if (persisted) return { ...loaded, data: migrated };
    return { ...loaded, notesMigrationError: error instanceof Error ? error.message : "The existing notes could not be migrated." };
  }
}

async function migrateLegacyBackgroundImage(data: AuraStartData, fallback: boolean): Promise<StorageLoadResult> {
  const storage = getExtensionStorageArea("local");
  let migrated = data;
  try {
    const uiState = storage ? (await storage.get(UI_STATE_STORAGE_KEY))[UI_STATE_STORAGE_KEY] : localGet(UI_STATE_STORAGE_KEY);
    if (!isRecord(uiState)) return { status: "ready", data, fallback };
    const legacyImage = normalizeCustomBackgroundImage(uiState.customBackgroundImage);
    if (!legacyImage) return { status: "ready", data, fallback };

    // Undefined means an old snapshot has never learned about custom images.
    // An explicit null is a deletion and must never revive an old UI copy.
    if (data.settings.background.customImageId === undefined) {
      const id = await storeBackgroundImage(legacyImage);
      const next = {
        ...data,
        settings: { ...data.settings, background: { ...data.settings.background, customImageId: id } }
      };
      const committed = commitLocalSyncChanges(data, next, data);
      if (data.settings.background.preset === "custom" && committed.syncReplica) {
        // The old local image was visible before this upgrade. Move its active
        // selection with the image so an older no-image cloud seed cannot hide it.
        committed.syncReplica.settings["background.preset"] = {
          stamp: { ...committed.syncReplica.settings["background.customImageId"].stamp }, value: "custom"
        };
        committed.settings.background.preset = "custom";
      }
      migrated = await saveAuraDataUnlocked({
        ...committed,
        updatedAt: nextStorageRevision(data.updatedAt)
      });
    }

    // This runs only after asset and main document transactions completed.
    // UI-state writes use the same lock, so stale pages cannot put the image back.
    const cleaned = { ...uiState, customBackgroundImage: null };
    if (storage) await storage.set({ [UI_STATE_STORAGE_KEY]: cleaned });
    else localSet(UI_STATE_STORAGE_KEY, cleaned);
    return { status: "ready", data: migrated, fallback };
  } catch (error) {
    // Once the main reference is durable, failed legacy cleanup is harmless and
    // will be retried on a later read. Before that, keep the original bytes.
    if (migrated.settings.background.customImageId !== undefined) return { status: "ready", data: migrated, fallback };
    return {
      status: "ready", data, fallback,
      backgroundMigrationError: error instanceof Error ? error.message : "The existing background image could not be migrated."
    };
  }
}

async function loadAuraDataUnlocked(): Promise<StorageLoadResult> {
  const storage = getExtensionStorageArea("local");
  const fallback = !storage;
  try {
    const rawValue = storage ? (await storage.get(STORAGE_KEY))[STORAGE_KEY] : localGet(STORAGE_KEY);
    if (rawValue === undefined) {
      return { status: "missing", fallback };
    }

    try {
      const data = validateAuraData(rawValue);
      const migrated = await migrateLegacyBackgroundImage(data, fallback);
      return migrated.status === "ready" ? await migrateLegacyNotes(migrated) : migrated;
    } catch (error) {
      return {
        status: "corrupt",
        raw: JSON.stringify(rawValue, null, 2),
        message: error instanceof Error ? error.message : "Stored data could not be validated.",
        fallback
      };
    }
  } catch (error) {
    return {
      status: "corrupt",
      raw: "",
      message: error instanceof Error ? error.message : "Stored data could not be loaded.",
      fallback
    };
  }
}

async function saveAuraDataUnlocked(data: AuraStartData): Promise<AuraStartData> {
  const validated = validateAuraData(data);
  const storage = getExtensionStorageArea("local");
  if (storage) {
    await storage.set({ [STORAGE_KEY]: validated });
  } else {
    localSet(STORAGE_KEY, validated);
  }
  return validated;
}

async function clearAuraDataUnlocked(): Promise<void> {
  const storage = getExtensionStorageArea("local");
  if (storage) {
    await storage.remove(STORAGE_KEY);
  } else {
    localRemove(STORAGE_KEY);
  }
}

export async function loadAuraData(): Promise<StorageLoadResult> {
  return await withStorageLock(loadAuraDataUnlocked);
}

export async function saveAuraData(
  data: AuraStartData,
  options: { baseline?: AuraStartData; guard?: (current: AuraStartData) => boolean } = {}
): Promise<AuraStartData> {
  return await withStorageLock(async () => {
    const next = validateAuraData(data);
    const loaded = await loadAuraDataUnlocked();
    if (loaded.status === "corrupt") throw new Error(loaded.message);
    if (options.guard && (loaded.status !== "ready" || !options.guard(loaded.data))) {
      throw new StorageStateChangedError();
    }
    if (loaded.status === "missing") {
      return await saveAuraDataUnlocked({ ...next, syncReplica: ensureSyncReplica(next) });
    }
    if (loaded.backgroundMigrationError && next.settings.background.customImageId !== undefined) {
      throw new Error(loaded.backgroundMigrationError);
    }
    const current = loaded.data;
    const baseline = options.baseline ?? current;
    if (loaded.notesMigrationError && (next.settings.notes.text !== baseline.settings.notes.text
      || isDefaultedSetting(next, "notes.text") !== isDefaultedSetting(baseline, "notes.text"))) {
      throw new Error(loaded.notesMigrationError);
    }
    const merged = commitLocalSyncChanges(current, next, baseline);
    // A temporary image-storage failure must not block local bookmark work.
    // Keep the legacy image unresolved so later reads retry its safe migration;
    // the replica's neutral null seed is not an intentional removal.
    if (loaded.backgroundMigrationError) delete merged.settings.background.customImageId;
    // Apply only the caller's local metadata/history changes, retaining changes
    // from a different page or the background while this write was waiting.
    const sync = { ...merged.settings.sync };
    for (const key of new Set([...Object.keys(baseline.settings.sync), ...Object.keys(next.settings.sync)])) {
      if (key === "deleteCloudFileOnDisconnect") continue;
      const field = key as keyof typeof sync;
      if (JSON.stringify(baseline.settings.sync[field]) !== JSON.stringify(next.settings.sync[field])) {
        Object.assign(sync, { [field]: next.settings.sync[field] });
      }
    }
    const nextPointIds = new Set(next.restorePoints.map((point) => point.id));
    const basePointIds = new Set(baseline.restorePoints.map((point) => point.id));
    const removedIds = new Set([...basePointIds].filter((id) => !nextPointIds.has(id)));
    const addedPoints = next.restorePoints.filter((point) => !basePointIds.has(point.id));
    const points = new Map([...addedPoints, ...current.restorePoints.filter((point) => !removedIds.has(point.id))]
      .map((point) => [point.id, point]));
    const changed = !sameSyncContent(current, merged) || !sameSyncReplica(current, merged);
    return await saveAuraDataUnlocked({
      ...merged,
      updatedAt: changed ? nextStorageRevision(current.updatedAt) : current.updatedAt,
      settings: { ...merged.settings, sync },
      restorePoints: [...points.values()].slice(0, MAX_RESTORE_POINTS)
    });
  });
}

export function nextStorageRevision(previous: string): string {
  const time = new Date(previous).getTime();
  return new Date(Math.max(Date.now(), Number.isFinite(time) ? time + 1 : 0)).toISOString();
}

export async function updateAuraData(
  update: (current: AuraStartData) => AuraStartData | undefined
): Promise<AuraStartData | undefined> {
  return await withStorageLock(async () => {
    const loaded = await loadAuraDataUnlocked();
    if (loaded.status !== "ready") {
      return undefined;
    }
    const before = loaded.backgroundMigrationError || loaded.notesMigrationError ? validateAuraData(loaded.data) : undefined;
    const next = update(loaded.data);
    if (next && before && (
      (loaded.backgroundMigrationError && next.settings.background.customImageId !== undefined)
      || !sameSyncContent(before, next)
      || !sameSyncReplica(before, next)
    )) {
      // Connection changes (including disconnect) remain available. Remote
      // content cannot replace notes or an image whose only copy is still in
      // legacy UI storage.
      throw new Error(loaded.backgroundMigrationError ?? loaded.notesMigrationError);
    }
    return next ? await saveAuraDataUnlocked(next) : undefined;
  });
}

export async function clearAuraData(): Promise<void> {
  await withStorageLock(clearAuraDataUnlocked);
}
