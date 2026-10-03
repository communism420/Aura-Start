import { MAX_WIDGET_NOTES_CHARS, STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import { getExtensionStorageArea } from "./browserApi";
import { isBackgroundImageId, normalizeCustomBackgroundImage } from "./backgroundImageStorage";
import { isSearchQuickFilter, type SearchQuickFilter } from "./search";
import { withStorageLock } from "./storage";

export { normalizeCustomBackgroundImage } from "./backgroundImageStorage";

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
  await withStorageLock(async () => {
    const normalized = normalizeUiState(state);
    const storage = getExtensionStorageArea("local");
    const main = storage ? (await storage.get(STORAGE_KEY))[STORAGE_KEY] : localGet(STORAGE_KEY);
    const current = storage ? (await storage.get(UI_STATE_STORAGE_KEY))[UI_STATE_STORAGE_KEY] : localGet(UI_STATE_STORAGE_KEY);
    const settings = isRecord(main) && isRecord(main.settings) ? main.settings : undefined;
    const background = settings && isRecord(settings.background) ? settings.background : undefined;
    normalized.customBackgroundImage = background?.customImageId === null || isBackgroundImageId(background?.customImageId)
      ? null
      : (isRecord(current) ? normalizeCustomBackgroundImage(current.customBackgroundImage) : null) ?? normalized.customBackgroundImage;
    const currentNotes = isRecord(current) && typeof current.widgetNotes === "string" ? current.widgetNotes.slice(0, MAX_WIDGET_NOTES_CHARS) : "";
    const notes = settings && isRecord(settings.notes) ? settings.notes : undefined;
    // A legacy copy is cleared by migration only after its shared value and
    // recovery snapshot are durable. Stale UI writes must neither erase that
    // last copy before migration nor resurrect it once the shared field exists.
    normalized.widgetNotes = currentNotes || (typeof notes?.text === "string" ? "" : normalized.widgetNotes);
    if (storage) await storage.set({ [UI_STATE_STORAGE_KEY]: normalized });
    else localSet(UI_STATE_STORAGE_KEY, normalized);
  });
}
