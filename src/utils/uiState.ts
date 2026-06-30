import { UI_STATE_STORAGE_KEY } from "../constants";
import { getExtensionStorageArea } from "./browserApi";
import { isSearchQuickFilter, type SearchQuickFilter } from "./search";

export type DemoDataMarker = {
  groupIds: string[];
  linkIds: string[];
};

export type AuraUiState = {
  onboardingCompleted: boolean;
  demoData: DemoDataMarker;
  lastSearchQuery: string;
  searchFilter: SearchQuickFilter;
  customBackgroundImage: string | null;
  widgetNotes: string;
};

const EMPTY_DEMO_DATA: DemoDataMarker = {
  groupIds: [],
  linkIds: []
};

const DEFAULT_UI_STATE: AuraUiState = {
  onboardingCompleted: false,
  demoData: EMPTY_DEMO_DATA,
  lastSearchQuery: "",
  searchFilter: "all",
  customBackgroundImage: null,
  widgetNotes: ""
};

const MAX_CUSTOM_BACKGROUND_IMAGE_CHARS = 2_500_000;
const MAX_WIDGET_NOTES_CHARS = 12_000;

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

function normalizeCustomBackgroundImage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  if (value.length > MAX_CUSTOM_BACKGROUND_IMAGE_CHARS) {
    return null;
  }

  return /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);/i.test(value) ? value : null;
}

function normalizeUiState(value: unknown): AuraUiState {
  if (!isRecord(value)) {
    return DEFAULT_UI_STATE;
  }

  return {
    onboardingCompleted: value.onboardingCompleted === true,
    demoData: normalizeDemoData(value.demoData),
    lastSearchQuery: typeof value.lastSearchQuery === "string" ? value.lastSearchQuery.slice(0, 300) : "",
    searchFilter: isSearchQuickFilter(value.searchFilter) ? value.searchFilter : "all",
    customBackgroundImage: normalizeCustomBackgroundImage(value.customBackgroundImage),
    widgetNotes: typeof value.widgetNotes === "string" ? value.widgetNotes.slice(0, MAX_WIDGET_NOTES_CHARS) : ""
  };
}

export async function loadAuraUiState(): Promise<AuraUiState> {
  try {
    const storage = getExtensionStorageArea("local");
    const rawValue = storage ? (await storage.get(UI_STATE_STORAGE_KEY))[UI_STATE_STORAGE_KEY] : localGet(UI_STATE_STORAGE_KEY);
    return normalizeUiState(rawValue);
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export async function saveAuraUiState(state: AuraUiState): Promise<void> {
  const normalized = normalizeUiState(state);
  const storage = getExtensionStorageArea("local");
  if (storage) {
    await storage.set({ [UI_STATE_STORAGE_KEY]: normalized });
  } else {
    localSet(UI_STATE_STORAGE_KEY, normalized);
  }
}
