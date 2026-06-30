import { STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { getExtensionStorageArea } from "./browserApi";
import { validateAuraData } from "./importJson";

export type StorageLoadResult =
  | { status: "missing"; fallback: boolean }
  | { status: "ready"; data: AuraStartData; fallback: boolean }
  | { status: "corrupt"; raw: string; message: string; fallback: boolean };

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

export async function loadAuraData(): Promise<StorageLoadResult> {
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

export async function saveAuraData(data: AuraStartData): Promise<void> {
  const validated = validateAuraData(data);
  const storage = getExtensionStorageArea("local");
  if (storage) {
    await storage.set({ [STORAGE_KEY]: validated });
  } else {
    localSet(STORAGE_KEY, validated);
  }
}

export async function clearAuraData(): Promise<void> {
  const storage = getExtensionStorageArea("local");
  if (storage) {
    await storage.remove(STORAGE_KEY);
  } else {
    localRemove(STORAGE_KEY);
  }
}
