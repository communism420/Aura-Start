import { STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { getExtensionStorageArea } from "./browserApi";
import { validateAuraData } from "./importJson";

export type StorageLoadResult =
  | { status: "missing"; fallback: boolean }
  | { status: "ready"; data: AuraStartData; fallback: boolean }
  | { status: "corrupt"; raw: string; message: string; fallback: boolean };

const STORAGE_LOCK_NAME = "aura-start-data-storage";

async function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    return await operation();
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

async function loadAuraDataUnlocked(): Promise<StorageLoadResult> {
  const storage = getExtensionStorageArea("local");
  const fallback = !storage;
  try {
    const rawValue = storage ? (await storage.get(STORAGE_KEY))[STORAGE_KEY] : localGet(STORAGE_KEY);
    if (rawValue === undefined) {
      return { status: "missing", fallback };
    }

    try {
      return { status: "ready", data: validateAuraData(rawValue), fallback };
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

export async function saveAuraData(data: AuraStartData): Promise<void> {
  await withStorageLock(async () => {
    await saveAuraDataUnlocked(data);
  });
}

export async function updateAuraData(
  update: (current: AuraStartData) => AuraStartData | undefined
): Promise<AuraStartData | undefined> {
  return await withStorageLock(async () => {
    const loaded = await loadAuraDataUnlocked();
    if (loaded.status !== "ready") {
      return undefined;
    }

    const next = update(loaded.data);
    return next ? await saveAuraDataUnlocked(next) : undefined;
  });
}

export async function clearAuraData(): Promise<void> {
  await withStorageLock(clearAuraDataUnlocked);
}
