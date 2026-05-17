import { UI_STATE_STORAGE_KEY } from "../constants";

export type DemoDataMarker = {
  groupIds: string[];
  linkIds: string[];
};

export type AuraUiState = {
  onboardingCompleted: boolean;
  demoData: DemoDataMarker;
};

const EMPTY_DEMO_DATA: DemoDataMarker = {
  groupIds: [],
  linkIds: []
};

const DEFAULT_UI_STATE: AuraUiState = {
  onboardingCompleted: false,
  demoData: EMPTY_DEMO_DATA
};

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

function localGet(key: string): unknown {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : undefined;
}

function localSet(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

function normalizeDemoData(value: unknown): DemoDataMarker {
  if (!isRecord(value)) {
    return EMPTY_DEMO_DATA;
  }

  return {
    groupIds: normalizeStringList(value.groupIds),
    linkIds: normalizeStringList(value.linkIds)
  };
}

function normalizeUiState(value: unknown): AuraUiState {
  if (!isRecord(value)) {
    return DEFAULT_UI_STATE;
  }

  return {
    onboardingCompleted: value.onboardingCompleted === true,
    demoData: normalizeDemoData(value.demoData)
  };
}

export async function loadAuraUiState(): Promise<AuraUiState> {
  try {
    const rawValue = hasChromeStorage() ? await chromeGet(UI_STATE_STORAGE_KEY) : localGet(UI_STATE_STORAGE_KEY);
    return normalizeUiState(rawValue);
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export async function saveAuraUiState(state: AuraUiState): Promise<void> {
  const normalized = normalizeUiState(state);
  if (hasChromeStorage()) {
    await chromeSet(UI_STATE_STORAGE_KEY, normalized);
  } else {
    localSet(UI_STATE_STORAGE_KEY, normalized);
  }
}
