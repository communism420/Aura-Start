import { STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { validateAuraData } from "./importJson";

export type StorageLoadResult =
  | { status: "missing"; fallback: boolean }
  | { status: "ready"; data: AuraStartData; fallback: boolean }
  | { status: "corrupt"; raw: string; message: string; fallback: boolean };

function hasChromeStorage(): boolean {
  return Boolean(globalThis.chrome?.storage?.local);
}

async function chromeGet(key: string): Promise<unknown> {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

async function chromeSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

async function chromeRemove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
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

export async function loadAuraData(): Promise<StorageLoadResult> {
  const fallback = !hasChromeStorage();
  try {
    const rawValue = fallback ? localGet(STORAGE_KEY) : await chromeGet(STORAGE_KEY);
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
  if (hasChromeStorage()) {
    await chromeSet(STORAGE_KEY, validated);
  } else {
    localSet(STORAGE_KEY, validated);
  }
}

export async function clearAuraData(): Promise<void> {
  if (hasChromeStorage()) {
    await chromeRemove(STORAGE_KEY);
  } else {
    localRemove(STORAGE_KEY);
  }
}
