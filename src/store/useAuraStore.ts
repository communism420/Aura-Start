import { create } from "zustand";
import { MAX_RESTORE_POINTS } from "../constants";
import { t } from "../i18n";
import {
  backupToDrive,
  clearAuthToken,
  compareLocalAndCloud,
  deleteSyncFile,
  disconnectGoogleAccount as disconnectGoogleDriveAccount,
  downloadSyncFile,
  findSyncFile,
  getAuthToken,
  getCachedAuthToken,
  getConnectedAccountInfo,
  isGoogleDriveAuthorizationUnavailable,
  mapDriveError,
  restoreFromDrive,
  type GoogleDriveSyncDownload
} from "../services/googleDriveSync";
import type {
  AuraRestorePoint,
  AuraRestorePointContext,
  AuraRestorePointReason,
  AuraSyncConflict,
  AuraSyncConflictChoice,
  AuraSyncMode,
  AuraSyncSettings,
  AuraSyncStatus,
  AuraStartData,
  AuraStartGroup,
  AuraStartLink,
  AuraStartSettings,
  GroupTreeNode,
  ImportMode,
  RestoreTimelineDay
} from "../types";
import { getAuraStartVersion } from "../utils/appVersion";
import { nowIso } from "../utils/dates";
import { buildGroupTree, groupsInTreeOrder, groupTitlePath, normalizeGroupOrders } from "../utils/groupTree";
import { createId } from "../utils/ids";
import { mergeImportedData } from "../utils/importJson";
import { createEmptyData } from "../utils/sampleData";
import { searchAuraGroups, type SearchAuraGroupsResult, type SearchQuickFilter } from "../utils/search";
import { clearAuraData, loadAuraData, saveAuraData } from "../utils/storage";
import { getCurrentWindowTabsPreview } from "../utils/tabsCapture";
import { loadAuraUiState, saveAuraUiState, type DemoDataMarker } from "../utils/uiState";
import { normalizeUrl, parseTags, type UrlValidationResult } from "../utils/validators";

export type ToastMessage = {
  id: string;
  type: "info" | "success" | "error";
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
};

type LinkInput = {
  title: string;
  url: string;
  description?: string;
  tags?: string;
};

export type LinkDeleteTarget = {
  groupId: string;
  linkId: string;
};

type AuraStoreStatus = "idle" | "loading" | "ready" | "corrupt" | "error";
type GoogleDriveBackupOptions = { silent?: boolean; token?: string };
type GoogleDriveRestoreOptions = { requireExistingFile?: boolean };
type GoogleDriveSyncNowOptions = { silent?: boolean };
type CommitOptions = { skipAutoSync?: boolean };
type ImportBackupSource = "aura_json" | "a_fine_start";
export type GroupDeleteMode = "promote_children" | "delete_children";

const EMPTY_DEMO_DATA: DemoDataMarker = {
  groupIds: [],
  linkIds: []
};

type AuraStore = {
  data: AuraStartData | null;
  status: AuraStoreStatus;
  error: string | null;
  corruptRaw: string | null;
  usingFallbackStorage: boolean;
  syncStatus: AuraSyncStatus;
  syncMessage: string | null;
  syncConflict: AuraSyncConflict | null;
  onboardingCompleted: boolean;
  demoData: DemoDataMarker;
  searchQuery: string;
  searchFilter: SearchQuickFilter;
  customBackgroundImage: string | null;
  widgetNotes: string;
  toasts: ToastMessage[];
  load: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  resetCorruptData: () => Promise<void>;
  updateSettings: (settings: Partial<AuraStartSettings>) => Promise<void>;
  addGroup: (title: string, parentId?: string | null) => Promise<string | undefined>;
  saveCurrentTabsAsNewGroup: (customTitle?: string) => Promise<string | undefined>;
  updateGroupTitle: (groupId: string, title: string) => Promise<void>;
  toggleGroupCollapsed: (groupId: string) => Promise<void>;
  deleteGroup: (groupId: string, mode?: GroupDeleteMode) => Promise<void>;
  moveGroup: (groupId: string, newParentId: string | null) => Promise<void>;
  addLink: (groupId: string, input: LinkInput) => Promise<void>;
  updateLink: (groupId: string, linkId: string, input: LinkInput) => Promise<void>;
  deleteLink: (groupId: string, linkId: string) => Promise<void>;
  deleteLinksWithRestorePoint: (targets: LinkDeleteTarget[]) => Promise<void>;
  reorderGroups: (orderedGroupIds: string[], parentId?: string | null) => Promise<void>;
  moveLink: (linkId: string, targetGroupId: string, overLinkId?: string) => Promise<void>;
  getGroupTree: () => GroupTreeNode[];
  getSearchedGroups: () => AuraStartGroup[];
  getSearchView: () => SearchAuraGroupsResult;
  setSearchQuery: (query: string) => void;
  setSearchFilter: (filter: SearchQuickFilter) => void;
  setCustomBackgroundImage: (image: string | null) => void;
  setWidgetNotes: (notes: string) => void;
  addDemoData: () => Promise<void>;
  removeDemoData: () => Promise<void>;
  importBackup: (imported: AuraStartData, mode: ImportMode, source?: ImportBackupSource) => Promise<void>;
  resetAllData: () => Promise<void>;
  getRestoreTimeline: () => RestoreTimelineDay[];
  createManualRestorePoint: (name: string) => Promise<void>;
  restoreRestorePoint: (restorePointId: string) => Promise<void>;
  deleteRestorePoint: (restorePointId: string) => Promise<void>;
  deleteAllRestorePoints: () => Promise<void>;
  connectGoogleDrive: () => Promise<void>;
  disconnectGoogleDrive: () => Promise<void>;
  backupToGoogleDrive: (options?: GoogleDriveBackupOptions) => Promise<void>;
  restoreFromGoogleDrive: (options?: GoogleDriveRestoreOptions) => Promise<boolean>;
  syncNow: (options?: GoogleDriveSyncNowOptions) => Promise<void>;
  setSyncMode: (mode: AuraSyncMode) => Promise<void>;
  deleteGoogleDriveSyncFile: () => Promise<void>;
  deleteGoogleDriveBackupAndDisconnect: () => Promise<void>;
  resolveSyncConflict: (choice: AuraSyncConflictChoice) => Promise<void>;
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  removeToast: (toastId: string) => void;
};

const AUTO_SYNC_DELAY_MS = 2_000;
let autoSyncTimer: number | undefined;
let autoSyncDirty = false;

function cloneData(data: AuraStartData): AuraStartData {
  return JSON.parse(JSON.stringify(data)) as AuraStartData;
}

function text(data: AuraStartData | null, key: Parameters<typeof t>[1], values?: Parameters<typeof t>[2]): string {
  return t(data?.settings.language ?? "en", key, values);
}

function snapshot(data: AuraStartData): Omit<AuraStartData, "restorePoints"> {
  return {
    version: data.version,
    updatedAt: data.updatedAt,
    settings: data.settings,
    groups: data.groups
  };
}

function isActiveSyncStatus(status: AuraSyncStatus): boolean {
  return status === "connecting" || status === "syncing";
}

function ensureSyncDevice(sync: AuraSyncSettings): AuraSyncSettings {
  return sync.deviceId ? sync : { ...sync, deviceId: createId("device") };
}

function mergeSyncSettings(data: AuraStartData, patch: Partial<AuraSyncSettings>): AuraSyncSettings {
  const current = ensureSyncDevice(data.settings.sync);
  return {
    ...current,
    ...patch,
    deviceId: patch.deviceId ?? current.deviceId
  };
}

function syncStatusFromData(data: AuraStartData): AuraSyncStatus {
  return data.settings.sync.mode !== "off" && data.settings.sync.connected ? "connected" : "idle";
}

async function getTokenForSync(sync: AuraSyncSettings, allowInteractive = true): Promise<string> {
  try {
    return await getAuthToken(!sync.connected && allowInteractive);
  } catch (error) {
    if (sync.connected && allowInteractive) {
      return await getAuthToken(true);
    }

    throw error;
  }
}

function normalizeOrders(groups: AuraStartGroup[]): AuraStartGroup[] {
  return groupsInTreeOrder(normalizeGroupOrders(groups));
}

function touch(data: AuraStartData): AuraStartData {
  return {
    ...data,
    updatedAt: nowIso(),
    groups: normalizeOrders(data.groups)
  };
}

function createRestorePoint(
  data: AuraStartData,
  name: string,
  reason: AuraRestorePointReason,
  context?: AuraRestorePointContext
): AuraRestorePoint {
  return {
    id: createId("restore"),
    name,
    createdAt: nowIso(),
    reason,
    context,
    data: snapshot(data)
  };
}

function snapshotLinkCount(data: Omit<AuraStartData, "restorePoints">): number {
  return data.groups.reduce((count, group) => count + group.links.length, 0);
}

function createDemoGroups(startOrder: number): { groups: AuraStartGroup[]; marker: DemoDataMarker } {
  const createdAt = nowIso();
  const specs = [
    {
      title: "Work",
      links: [
        ["GitHub", "https://github.com"],
        ["Chrome Developers", "https://developer.chrome.com"]
      ]
    },
    {
      title: "Social",
      links: [["Hacker News", "https://news.ycombinator.com"]]
    },
    {
      title: "Tools",
      links: [
        ["MDN Web Docs", "https://developer.mozilla.org"],
        ["web.dev", "https://web.dev"]
      ]
    },
    {
      title: "Reading",
      links: [["Wikipedia", "https://wikipedia.org"]]
    }
  ];
  const marker: DemoDataMarker = {
    groupIds: [],
    linkIds: []
  };

  const groups = specs.map((groupSpec, groupIndex): AuraStartGroup => {
    const groupId = createId("demo_group");
    marker.groupIds.push(groupId);

    return {
      id: groupId,
      title: groupSpec.title,
      parentId: null,
      collapsed: false,
      order: startOrder + groupIndex,
      links: groupSpec.links.map(([title, url], linkIndex): AuraStartLink => {
        const linkId = createId("demo_link");
        marker.linkIds.push(linkId);

        return {
          id: linkId,
          title,
          url,
          order: linkIndex,
          createdAt,
          updatedAt: createdAt
        };
      })
    };
  });

  return { groups, marker };
}

function mergeDemoDataMarker(current: DemoDataMarker, added: DemoDataMarker): DemoDataMarker {
  return {
    groupIds: Array.from(new Set([...current.groupIds, ...added.groupIds])),
    linkIds: Array.from(new Set([...current.linkIds, ...added.linkIds]))
  };
}

function hasMatchingDemoData(data: AuraStartData, marker: DemoDataMarker): boolean {
  const groupIds = new Set(marker.groupIds);
  const linkIds = new Set(marker.linkIds);

  return data.groups.some((group) => groupIds.has(group.id) || group.links.some((link) => linkIds.has(link.id)));
}

function withRestorePoint(
  data: AuraStartData,
  name: string,
  reason: AuraRestorePointReason,
  context?: AuraRestorePointContext
): AuraStartData {
  const point = createRestorePoint(data, name, reason, context);
  return {
    ...data,
    restorePoints: [point, ...data.restorePoints].slice(0, MAX_RESTORE_POINTS)
  };
}

function withAutomaticRestorePoint(
  data: AuraStartData,
  name: string,
  reason: AuraRestorePointReason,
  context?: AuraRestorePointContext
): AuraStartData {
  return data.settings.autoRestorePoints ? withRestorePoint(data, name, reason, context) : data;
}

function keepLocalSyncSettings(data: AuraStartData, current: AuraStartData): AuraStartData {
  return {
    ...data,
    settings: {
      ...data.settings,
      sync: ensureSyncDevice(current.settings.sync)
    }
  };
}

function findGroup(data: AuraStartData, groupId: string): AuraStartGroup {
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) {
    throw new Error(text(data, "groupNotFound"));
  }

  return group;
}

function groupChildren(data: AuraStartData, groupId: string): AuraStartGroup[] {
  return data.groups.filter((group) => group.parentId === groupId);
}

function existingLinkUrls(data: AuraStartData): string[] {
  return data.groups.flatMap((group) => group.links.map((link) => link.url));
}

function groupLabel(data: AuraStartData, groupId: string | null): string {
  if (!groupId) {
    return text(data, "topLevelGroup");
  }

  const group = data.groups.find((item) => item.id === groupId);
  return group ? groupTitlePath(data.groups, group) : text(data, "groupNotFound");
}

function resolveGroupParentId(data: AuraStartData, parentId?: string | null): string | null {
  if (!parentId) {
    return null;
  }

  const parent = findGroup(data, parentId);
  if (parent.parentId !== null) {
    throw new Error(text(data, "nestedGroupDepthLimit"));
  }

  return parent.id;
}

function canMoveGroupToParent(data: AuraStartData, groupId: string, parentId: string | null): void {
  const group = findGroup(data, groupId);
  if (parentId === group.id) {
    throw new Error(text(data, "groupCannotBeItsOwnParent"));
  }

  if (parentId) {
    const parent = findGroup(data, parentId);
    if (parent.parentId !== null) {
      throw new Error(text(data, "nestedGroupDepthLimit"));
    }

    if (groupChildren(data, group.id).length > 0) {
      throw new Error(text(data, "groupWithChildrenCannotBeNested"));
    }
  }
}

function urlValidationMessage(data: AuraStartData, result: Extract<UrlValidationResult, { ok: false }>): string {
  switch (result.code) {
    case "required":
      return text(data, "urlRequired");
    case "unsupported_protocol":
      return text(data, "urlHttpOnly");
    case "missing_host":
      return text(data, "urlHostRequired");
    case "invalid":
      return text(data, "urlInvalidExample");
  }
}

function requireTitle(data: AuraStartData, input: string, key: Parameters<typeof t>[1]): string {
  const title = input.trim();
  if (!title) {
    throw new Error(text(data, key));
  }

  return title;
}

function prepareLinkInput(data: AuraStartData, input: LinkInput): Pick<AuraStartLink, "title" | "url" | "description" | "tags"> {
  const normalizedUrl = normalizeUrl(input.url);
  if (!normalizedUrl.ok) {
    throw new Error(urlValidationMessage(data, normalizedUrl));
  }

  const description = input.description?.trim();

  return {
    title: requireTitle(data, input.title, "linkTitleRequired"),
    url: normalizedUrl.url,
    description: description ? description : undefined,
    tags: input.tags ? parseTags(input.tags) : undefined
  };
}

function saveCurrentUiState(
  state: Pick<AuraStore, "customBackgroundImage" | "demoData" | "onboardingCompleted" | "searchFilter" | "searchQuery" | "widgetNotes">
): void {
  void saveAuraUiState({
    onboardingCompleted: state.onboardingCompleted,
    demoData: state.demoData,
    lastSearchQuery: state.searchQuery,
    searchFilter: state.searchFilter,
    customBackgroundImage: state.customBackgroundImage,
    widgetNotes: state.widgetNotes
  }).catch(() => undefined);
}

function clearAutoSyncQueue(): void {
  autoSyncDirty = false;
  if (typeof window !== "undefined" && autoSyncTimer) {
    window.clearTimeout(autoSyncTimer);
  }
  autoSyncTimer = undefined;
}

function scheduleAutoSync(data: AuraStartData): void {
  if (typeof window === "undefined") return;
  const sync = data.settings.sync;
  if (sync.mode !== "auto" || !sync.connected) return;

  autoSyncDirty = true;
  if (autoSyncTimer) {
    window.clearTimeout(autoSyncTimer);
  }

  autoSyncTimer = window.setTimeout(() => {
    autoSyncTimer = undefined;
    const state = useAuraStore.getState();
    const current = state.data;
    if (!autoSyncDirty || !current || current.settings.sync.mode !== "auto" || !current.settings.sync.connected) {
      autoSyncDirty = false;
      return;
    }
    if (isActiveSyncStatus(state.syncStatus)) {
      scheduleAutoSync(current);
      return;
    }

    autoSyncDirty = false;
    void state.syncNow({ silent: true }).catch(() => {
      // The store records sync errors and keeps local work uninterrupted.
    });
  }, AUTO_SYNC_DELAY_MS);
}

async function safeCommit(
  set: (partial: Partial<AuraStore>) => void,
  data: AuraStartData,
  options: CommitOptions = {}
): Promise<void> {
  const next = touch(data);
  await saveAuraData(next);
  set({ data: next, status: "ready", error: null });
  if (!options.skipAutoSync) {
    scheduleAutoSync(next);
  }
}

async function optimisticCommit(
  set: (partial: Partial<AuraStore>) => void,
  previous: AuraStartData,
  data: AuraStartData,
  options: CommitOptions = {}
): Promise<void> {
  const next = touch(data);
  set({ data: next, status: "ready", error: null });

  try {
    await saveAuraData(next);
    if (!options.skipAutoSync) {
      scheduleAutoSync(next);
    }
  } catch (error) {
    set({
      data: previous,
      status: "ready",
      error: error instanceof Error ? error.message : "Local storage could not be updated."
    });
    throw error;
  }
}

async function commitSyncMetadata(
  set: (partial: Partial<AuraStore>) => void,
  data: AuraStartData,
  patch: Partial<AuraSyncSettings>,
  syncStatus: AuraSyncStatus,
  syncMessage: string | null,
  syncConflict: AuraSyncConflict | null = null
): Promise<AuraStartData> {
  const current = useAuraStore.getState().data;
  const base = current && current.updatedAt !== data.updatedAt ? current : data;
  const next: AuraStartData = {
    ...base,
    settings: {
      ...base.settings,
      sync: mergeSyncSettings(base, patch)
    }
  };

  await saveAuraData(next);
  set({
    data: next,
    status: "ready",
    error: null,
    syncStatus,
    syncMessage,
    syncConflict
  });
  return next;
}

function driveFailure(
  set: (partial: Partial<AuraStore>) => void,
  get: () => AuraStore,
  error: unknown
): string {
  const data = get().data;
  const message = mapDriveError(error);
  set({ syncStatus: "error", syncMessage: message });
  get().addToast({
    type: "error",
    title: text(data, "googleDriveSyncFailed"),
    message
  });
  return message;
}

async function markGoogleDriveSyncNeedsReconnect(
  set: (partial: Partial<AuraStore>) => void,
  get: () => AuraStore,
  error: unknown
): Promise<void> {
  clearAutoSyncQueue();
  await clearAuthToken().catch(() => undefined);

  const data = get().data;
  if (!data) {
    set({ syncStatus: "connected", syncMessage: mapDriveError(error), syncConflict: null });
    return;
  }

  set({
    syncStatus: "connected",
    syncMessage: text(data, "googleDriveNeedsReconnect"),
    syncConflict: null
  });
}

async function applyCloudDownload(
  set: (partial: Partial<AuraStore>) => void,
  get: () => AuraStore,
  download: GoogleDriveSyncDownload,
  syncPatch: Partial<AuraSyncSettings> = {}
): Promise<void> {
  const current = get().data;
  if (!current) return;

  const point = createRestorePoint(current, text(current, "restoreNameBeforeCloudRestore"), "before_cloud_restore", {
    entity: "sync",
    source: "Google Drive"
  });
  const syncedAt = nowIso();
  const currentSync = ensureSyncDevice(current.settings.sync);
  const nextSync: AuraSyncSettings = {
    ...currentSync,
    ...syncPatch,
    mode: "auto",
    connected: true,
    cloudFileId: download.metadata.id,
    lastSyncedAt: syncedAt,
    lastCloudUpdatedAt: download.cloudUpdatedAt
  };
  const next: AuraStartData = {
    ...download.data,
    settings: {
      ...download.data.settings,
      sync: nextSync
    },
    restorePoints: [point, ...download.data.restorePoints].slice(0, MAX_RESTORE_POINTS)
  };

  await saveAuraData(next);
  set({
    data: next,
    status: "ready",
    error: null,
    syncStatus: "connected",
    syncMessage: text(next, "googleDriveRestoreSuccess"),
    syncConflict: null
  });
}

export const useAuraStore = create<AuraStore>((set, get) => ({
  data: null,
  status: "idle",
  error: null,
  corruptRaw: null,
  usingFallbackStorage: false,
  syncStatus: "idle",
  syncMessage: null,
  syncConflict: null,
  onboardingCompleted: false,
  demoData: EMPTY_DEMO_DATA,
  searchQuery: "",
  searchFilter: "all",
  customBackgroundImage: null,
  widgetNotes: "",
  toasts: [],

  async load() {
    set({ status: "loading", error: null, corruptRaw: null });
    try {
      const uiState = await loadAuraUiState();
      const result = await loadAuraData();
      if (result.status === "missing") {
        const empty = createEmptyData();
        await saveAuraData(empty);
        set({
          data: empty,
          status: "ready",
          usingFallbackStorage: result.fallback,
          syncStatus: "idle",
          syncMessage: null,
          syncConflict: null,
          onboardingCompleted: uiState.onboardingCompleted,
          demoData: uiState.demoData,
          searchQuery: uiState.lastSearchQuery,
          searchFilter: uiState.searchFilter,
          customBackgroundImage: uiState.customBackgroundImage,
          widgetNotes: uiState.widgetNotes
        });
        return;
      }

      if (result.status === "corrupt") {
        set({
          data: null,
          status: "corrupt",
          error: result.message,
          corruptRaw: result.raw,
          usingFallbackStorage: result.fallback,
          syncStatus: "idle",
          syncMessage: null,
          syncConflict: null,
          onboardingCompleted: uiState.onboardingCompleted,
          demoData: uiState.demoData,
          searchQuery: uiState.lastSearchQuery,
          searchFilter: uiState.searchFilter,
          customBackgroundImage: uiState.customBackgroundImage,
          widgetNotes: uiState.widgetNotes
        });
        return;
      }

      set({
        data: result.data,
        status: "ready",
        usingFallbackStorage: result.fallback,
        syncStatus: syncStatusFromData(result.data),
        syncMessage: null,
        syncConflict: null,
        onboardingCompleted: uiState.onboardingCompleted,
        demoData: uiState.demoData,
        searchQuery: uiState.lastSearchQuery,
        searchFilter: uiState.searchFilter,
        customBackgroundImage: uiState.customBackgroundImage,
        widgetNotes: uiState.widgetNotes
      });
    } catch (caught) {
      set({
        status: "error",
        error: caught instanceof Error ? caught.message : "Local storage could not be initialized.",
        syncStatus: "idle",
        syncMessage: null,
        syncConflict: null
      });
    }
  },

  async completeOnboarding() {
    const next = {
      onboardingCompleted: true,
      demoData: get().demoData,
      lastSearchQuery: get().searchQuery,
      searchFilter: get().searchFilter,
      customBackgroundImage: get().customBackgroundImage,
      widgetNotes: get().widgetNotes
    };
    await saveAuraUiState(next);
    set({ onboardingCompleted: true });
  },

  async resetCorruptData() {
    const empty = createEmptyData();
    await clearAuraData();
    await saveAuraData(empty);
    set({
      data: empty,
      status: "ready",
      error: null,
      corruptRaw: null,
      syncStatus: "idle",
      syncMessage: null,
      syncConflict: null
    });
  },

  async updateSettings(settings) {
    const data = get().data;
    if (!data) return;
    await safeCommit(set, {
      ...data,
      settings: { ...data.settings, ...settings }
    });
  },

  async addGroup(title, parentId = null) {
    const data = get().data;
    if (!data) return undefined;

    const now = nowIso();
    const normalizedParentId = resolveGroupParentId(data, parentId);
    const group: AuraStartGroup = {
      id: createId("group"),
      title: requireTitle(data, title, "groupTitleRequired"),
      parentId: normalizedParentId,
      collapsed: false,
      order: data.groups.filter((item) => item.parentId === normalizedParentId).length,
      links: []
    };

    await safeCommit(set, {
      ...data,
      updatedAt: now,
      groups: [...data.groups, group]
    });

    return group.id;
  },

  async saveCurrentTabsAsNewGroup(customTitle) {
    const data = get().data;
    if (!data) return undefined;
    if (!data.settings.captureOpenTabs) {
      throw new Error(text(data, "openTabsCaptureDisabled"));
    }

    const preview = await getCurrentWindowTabsPreview(existingLinkUrls(data));
    if (!preview.links.length) {
      throw new Error(text(data, "noOpenTabsToSave"));
    }

    const createdAt = nowIso();
    const groupTitle = requireTitle(data, customTitle?.trim() || text(data, "openTabsDefaultGroupTitle"), "groupTitleRequired");
    const group: AuraStartGroup = {
      id: createId("group"),
      title: groupTitle,
      parentId: null,
      collapsed: false,
      order: data.groups.filter((item) => item.parentId === null).length,
      links: preview.links.map((link, index): AuraStartLink => ({
        id: createId("link"),
        title: link.title,
        url: link.url,
        order: index,
        createdAt,
        updatedAt: createdAt
      }))
    };
    const withSafety = withRestorePoint(data, text(data, "restoreNameBeforeSavingTabs"), "before_tabs_save", {
      entity: "tabs",
      title: groupTitle,
      count: group.links.length,
      description: text(data, "openTabsSkippedSummary", {
        duplicates: preview.duplicateCount,
        existing: preview.existingCount,
        skipped: preview.skippedCount
      })
    });

    await safeCommit(set, {
      ...withSafety,
      groups: [...withSafety.groups, group]
    });
    get().addToast({
      type: "success",
      title: text(data, "openTabsSaved"),
      message: text(data, "openTabsSavedMessage", { count: group.links.length, title: group.title })
    });

    return group.id;
  },

  async updateGroupTitle(groupId, title) {
    const data = get().data;
    if (!data) return;
    const nextTitle = requireTitle(data, title, "groupTitleRequired");
    await safeCommit(set, {
      ...data,
      groups: data.groups.map((group) => (group.id === groupId ? { ...group, title: nextTitle } : group))
    });
  },

  async toggleGroupCollapsed(groupId) {
    const data = get().data;
    if (!data) return;
    await safeCommit(set, {
      ...data,
      groups: data.groups.map((group) =>
        group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
      )
    });
  },

  async deleteGroup(groupId, mode = "promote_children") {
    const data = get().data;
    if (!data) return;
    const previous = cloneData(data);
    const group = findGroup(data, groupId);
    const children = groupChildren(data, groupId);
    const withSafety = withRestorePoint(data, text(data, "restoreNameBeforeDeletingGroup", { title: group.title }), "before_group_delete", {
      entity: "group",
      title: group.title,
      count: children.length
    });
    const deleteIds = new Set([groupId, ...(mode === "delete_children" ? children.map((child) => child.id) : [])]);
    const groups = withSafety.groups
      .filter((item) => !deleteIds.has(item.id))
      .map((item) =>
        item.parentId === groupId
          ? {
              ...item,
              parentId: group.parentId,
              order: data.groups.filter((candidate) => candidate.parentId === group.parentId).length + item.order
            }
          : item
      );
    await safeCommit(set, {
      ...withSafety,
      groups
    });
    get().addToast({
      type: "info",
      title: text(data, "groupDeleted"),
      message: text(data, "removedMessage", { title: group.title }),
      actionLabel: text(data, "undo"),
      onAction: async () => {
        const current = get().data;
        await safeCommit(set, current ? { ...previous, restorePoints: current.restorePoints } : previous);
      }
    });
  },

  async moveGroup(groupId, newParentId) {
    const data = get().data;
    if (!data) return;

    const normalizedParentId = resolveGroupParentId(data, newParentId);
    canMoveGroupToParent(data, groupId, normalizedParentId);
    const group = findGroup(data, groupId);
    if (group.parentId === normalizedParentId) return;

    const targetSiblingCount = data.groups.filter((item) => item.parentId === normalizedParentId).length;
    const withSafety = withAutomaticRestorePoint(data, text(data, "restoreNameBeforeMovingGroup", { title: group.title }), "before_group_move", {
      entity: "group",
      title: group.title,
      from: groupLabel(data, group.parentId),
      to: groupLabel(data, normalizedParentId)
    });
    await optimisticCommit(set, data, {
      ...withSafety,
      groups: withSafety.groups.map((item) =>
        item.id === groupId ? { ...item, parentId: normalizedParentId, order: targetSiblingCount } : item
      )
    });
  },

  async addLink(groupId, input) {
    const data = get().data;
    if (!data) return;
    const normalized = prepareLinkInput(data, input);
    const now = nowIso();
    await safeCommit(set, {
      ...data,
      groups: data.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              collapsed: false,
              links: [
                ...group.links,
                {
                  id: createId("link"),
                  ...normalized,
                  order: group.links.length,
                  createdAt: now,
                  updatedAt: now
                }
              ]
            }
          : group
      )
    });
  },

  async updateLink(groupId, linkId, input) {
    const data = get().data;
    if (!data) return;
    const normalized = prepareLinkInput(data, input);
    await safeCommit(set, {
      ...data,
      groups: data.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              links: group.links.map((link) =>
                link.id === linkId ? { ...link, ...normalized, updatedAt: nowIso() } : link
              )
            }
          : group
      )
    });
  },

  async deleteLink(groupId, linkId) {
    const data = get().data;
    if (!data) return;
    const previous = cloneData(data);
    const group = findGroup(data, groupId);
    const link = group.links.find((item) => item.id === linkId);
    if (!link) {
      throw new Error(text(data, "linkNotFound"));
    }

    const withSafety = withRestorePoint(data, text(data, "restoreNameBeforeDeletingLink", { title: link.title }), "before_link_delete", {
      entity: "link",
      title: link.title,
      groupTitle: groupTitlePath(data.groups, group)
    });
    await safeCommit(set, {
      ...withSafety,
      groups: withSafety.groups.map((item) =>
        item.id === groupId ? { ...item, links: item.links.filter((candidate) => candidate.id !== linkId) } : item
      )
    });
    get().addToast({
      type: "info",
      title: text(data, "linkDeleted"),
      message: text(data, "removedMessage", { title: link.title }),
      actionLabel: text(data, "undo"),
      onAction: async () => {
        const current = get().data;
        await safeCommit(set, current ? { ...previous, restorePoints: current.restorePoints } : previous);
      }
    });
  },

  async deleteLinksWithRestorePoint(targets) {
    const data = get().data;
    if (!data) return;
    const uniqueTargets = Array.from(new Set(targets.map((target) => `${target.groupId}::${target.linkId}`)));
    if (!uniqueTargets.length) {
      throw new Error(text(data, "noDuplicateLinksSelected"));
    }

    const previous = cloneData(data);
    const targetIds = new Set(uniqueTargets);
    let deletedCount = 0;
    const withSafety = withRestorePoint(data, text(data, "restoreNameBeforeDeletingDuplicates"), "before_duplicate_delete", {
      entity: "links",
      count: uniqueTargets.length
    });
    const groups = withSafety.groups.map((group) => ({
      ...group,
      links: group.links.filter((link) => {
        const deleteLink = targetIds.has(`${group.id}::${link.id}`);
        if (deleteLink) {
          deletedCount += 1;
        }
        return !deleteLink;
      })
    }));

    if (!deletedCount) {
      throw new Error(text(data, "noDuplicateLinksSelected"));
    }

    await safeCommit(set, {
      ...withSafety,
      groups
    });
    get().addToast({
      type: "info",
      title: text(data, "duplicateLinksDeleted", { count: deletedCount }),
      message: text(data, "restorePointCreatedBeforeDeletingDuplicates"),
      actionLabel: text(data, "undo"),
      onAction: async () => {
        const current = get().data;
        await safeCommit(set, current ? { ...previous, restorePoints: current.restorePoints } : previous);
      }
    });
  },

  async reorderGroups(orderedGroupIds, parentId = null) {
    const data = get().data;
    if (!data) return;

    const normalizedParentId = parentId ?? null;
    const siblings = data.groups.filter((group) => group.parentId === normalizedParentId).sort((a, b) => a.order - b.order);
    const siblingIds = new Set(siblings.map((group) => group.id));
    const orderedSiblings = orderedGroupIds
      .map((groupId) => data.groups.find((group) => group.id === groupId))
      .filter((group): group is AuraStartGroup => Boolean(group && siblingIds.has(group.id)));

    if (orderedSiblings.length !== siblings.length) {
      return;
    }

    const changed = orderedSiblings.some((group, index) => group.id !== siblings[index]?.id);
    if (!changed) return;

    const orderById = new Map(orderedSiblings.map((group, index) => [group.id, index]));
    const withSafety = withAutomaticRestorePoint(data, text(data, "restoreNameBeforeReorderingGroups"), "before_group_reorder", {
      entity: "groups",
      groupTitle: groupLabel(data, normalizedParentId),
      count: siblings.length
    });
    await optimisticCommit(set, data, {
      ...withSafety,
      groups: withSafety.groups.map((group) =>
        group.parentId === normalizedParentId ? { ...group, order: orderById.get(group.id) ?? group.order } : group
      )
    });
  },

  async moveLink(linkId, targetGroupId, overLinkId) {
    const data = get().data;
    if (!data) return;

    const sourceGroup = data.groups.find((group) => group.links.some((link) => link.id === linkId));
    const targetGroup = data.groups.find((group) => group.id === targetGroupId);
    if (!sourceGroup || !targetGroup) return;

    const link = sourceGroup.links.find((item) => item.id === linkId);
    if (!link) return;

    const sourceLinks = sourceGroup.links.filter((item) => item.id !== linkId);
    const targetWithoutMoved =
      sourceGroup.id === targetGroup.id ? sourceLinks : targetGroup.links.filter((item) => item.id !== linkId);
    const foundOverIndex = overLinkId ? targetWithoutMoved.findIndex((item) => item.id === overLinkId) : -1;
    const insertIndex = foundOverIndex >= 0 ? foundOverIndex : targetWithoutMoved.length;
    const nextTargetLinks = targetWithoutMoved.slice();
    nextTargetLinks.splice(insertIndex, 0, link);
    const orderedSourceLinks = sourceLinks.map((item, index) => ({ ...item, order: index }));
    const orderedTargetLinks = nextTargetLinks.map((item, index) => ({ ...item, order: index }));
    const withSafety = withAutomaticRestorePoint(data, text(data, "restoreNameBeforeMovingLink", { title: link.title }), "before_link_move", {
      entity: "link",
      title: link.title,
      from: groupTitlePath(data.groups, sourceGroup),
      to: groupTitlePath(data.groups, targetGroup)
    });

    await optimisticCommit(set, data, {
      ...withSafety,
      groups: withSafety.groups.map((group) => {
        if (group.id === sourceGroup.id && group.id === targetGroup.id) {
          return { ...group, links: orderedTargetLinks };
        }

        if (group.id === sourceGroup.id) {
          return { ...group, links: orderedSourceLinks };
        }

        if (group.id === targetGroup.id) {
          return { ...group, links: orderedTargetLinks };
        }

        return group;
      })
    });
  },

  getGroupTree() {
    const data = get().data;
    return data ? buildGroupTree(data.groups) : [];
  },

  getSearchView() {
    const data = get().data;
    return data
      ? searchAuraGroups(data, get().searchQuery, get().searchFilter)
      : { groups: [], highlights: { groups: {}, links: {} }, highlightTerms: [], results: [] };
  },

  getSearchedGroups() {
    return get().getSearchView().groups;
  },

  setSearchQuery(query) {
    const nextQuery = query.slice(0, 300);
    set({ searchQuery: nextQuery });
    saveCurrentUiState({ ...get(), searchQuery: nextQuery });
  },

  setSearchFilter(filter) {
    set({ searchFilter: filter });
    saveCurrentUiState({ ...get(), searchFilter: filter });
  },

  setCustomBackgroundImage(image) {
    set({ customBackgroundImage: image });
    saveCurrentUiState({ ...get(), customBackgroundImage: image });
  },

  setWidgetNotes(notes) {
    const nextNotes = notes.slice(0, 12_000);
    set({ widgetNotes: nextNotes });
    saveCurrentUiState({ ...get(), widgetNotes: nextNotes });
  },

  async addDemoData() {
    const data = get().data;
    if (!data) return;

    const demo = createDemoGroups(data.groups.length);
    const nextMarker = mergeDemoDataMarker(get().demoData, demo.marker);

    await safeCommit(set, {
      ...data,
      groups: [...data.groups, ...demo.groups]
    });
    await saveAuraUiState({
      onboardingCompleted: get().onboardingCompleted,
      demoData: nextMarker,
      lastSearchQuery: get().searchQuery,
      searchFilter: get().searchFilter,
      customBackgroundImage: get().customBackgroundImage,
      widgetNotes: get().widgetNotes
    });
    set({ demoData: nextMarker });
  },

  async removeDemoData() {
    const data = get().data;
    if (!data) return;

    const marker = get().demoData;
    const groupIds = new Set(marker.groupIds);
    const linkIds = new Set(marker.linkIds);
    if (!hasMatchingDemoData(data, marker)) {
      await saveAuraUiState({
        onboardingCompleted: get().onboardingCompleted,
        demoData: EMPTY_DEMO_DATA,
        lastSearchQuery: get().searchQuery,
        searchFilter: get().searchFilter,
        customBackgroundImage: get().customBackgroundImage,
        widgetNotes: get().widgetNotes
      });
      set({ demoData: EMPTY_DEMO_DATA });
      return;
    }

    const withSafety = withRestorePoint(data, text(data, "restoreNameBeforeRemovingDemoData"), "before_demo_remove", {
      entity: "demo",
      count: groupIds.size + linkIds.size
    });
    const nextGroups = withSafety.groups
      .map((group): AuraStartGroup | null => {
        const links = group.links.filter((link) => !linkIds.has(link.id));
        if (groupIds.has(group.id) && links.length === 0) {
          return null;
        }

        return { ...group, links };
      })
      .filter((group): group is AuraStartGroup => group !== null);
    const nextMarker: DemoDataMarker = {
      groupIds: nextGroups.filter((group) => groupIds.has(group.id)).map((group) => group.id),
      linkIds: nextGroups.flatMap((group) => group.links.filter((link) => linkIds.has(link.id)).map((link) => link.id))
    };

    await safeCommit(set, {
      ...withSafety,
      groups: nextGroups
    });
    await saveAuraUiState({
      onboardingCompleted: get().onboardingCompleted,
      demoData: nextMarker,
      lastSearchQuery: get().searchQuery,
      searchFilter: get().searchFilter,
      customBackgroundImage: get().customBackgroundImage,
      widgetNotes: get().widgetNotes
    });
    set({ demoData: nextMarker });
  },

  async importBackup(imported, mode, source = "aura_json") {
    const data = get().data;
    if (!data) return;
    const importedLinkCount = imported.groups.reduce((count, group) => count + group.links.length, 0);
    const withSafety = withRestorePoint(data, text(data, "restoreNameBeforeImport"), "before_import", {
      entity: "import",
      source: source === "a_fine_start" ? "A Fine Start" : "Aura JSON",
      count: imported.groups.length,
      description: text(data, "restoreContextImportCounts", { groups: imported.groups.length, links: importedLinkCount })
    });
    const next =
      mode === "replace"
        ? keepLocalSyncSettings(
            {
              ...imported,
              restorePoints: [withSafety.restorePoints[0], ...imported.restorePoints].slice(0, MAX_RESTORE_POINTS)
            },
            data
          )
        : mergeImportedData(withSafety, imported);

    await safeCommit(set, next);
    get().addToast({
      type: "success",
      title:
        source === "a_fine_start"
          ? text(data, "aFineStartImported", { groups: imported.groups.length, links: importedLinkCount })
          : mode === "replace"
            ? text(data, "backupImported")
            : text(data, "backupMerged"),
      message: text(data, "importRestorePointMessage")
    });
  },

  async resetAllData() {
    const data = get().data;
    if (!data) return;
    const point = createRestorePoint(data, text(data, "restoreNameBeforeReset"), "before_reset", {
      entity: "data"
    });
    const empty = createEmptyData();
    await safeCommit(set, {
      ...empty,
      restorePoints: [point]
    });
  },

  getRestoreTimeline() {
    const data = get().data;
    if (!data) return [];

    const days = new Map<string, RestoreTimelineDay>();
    data.restorePoints
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .forEach((point) => {
        const day = point.createdAt.slice(0, 10);
        const current = days.get(day) ?? { day, entries: [] };
        current.entries.push({
          point,
          groupCount: point.data.groups.length,
          linkCount: snapshotLinkCount(point.data)
        });
        days.set(day, current);
      });

    return Array.from(days.values());
  },

  async createManualRestorePoint(name) {
    const data = get().data;
    if (!data) return;
    await safeCommit(set, withRestorePoint(data, requireTitle(data, name, "restorePointNameRequired"), "manual", {
      entity: "data"
    }));
  },

  async restoreRestorePoint(restorePointId) {
    const data = get().data;
    if (!data) return;
    const point = data.restorePoints.find((item) => item.id === restorePointId);
    if (!point) {
      throw new Error(text(data, "restorePointNotFound"));
    }

    const withSafety = withRestorePoint(data, text(data, "restoreNameBeforeRestore"), "before_restore", {
      entity: "data",
      title: point.name
    });
    await safeCommit(set, {
      ...point.data,
      restorePoints: withSafety.restorePoints
    });
    get().addToast({
      type: "success",
      title: text(data, "restorePointRestored"),
      message: text(data, "restoreCurrentDataFirst")
    });
  },

  async deleteRestorePoint(restorePointId) {
    const data = get().data;
    if (!data) return;
    await safeCommit(set, {
      ...data,
      restorePoints: data.restorePoints.filter((point) => point.id !== restorePointId)
    });
  },

  async deleteAllRestorePoints() {
    const data = get().data;
    if (!data) return;
    await safeCommit(set, {
      ...data,
      restorePoints: []
    });
    get().addToast({
      type: "success",
      title: text(data, "allRestorePointsDeleted")
    });
  },

  async connectGoogleDrive() {
    const data = get().data;
    if (!data) return;

    set({ syncStatus: "connecting", syncMessage: text(data, "googleDriveConnecting"), syncConflict: null });
    try {
      const sync = ensureSyncDevice(data.settings.sync);
      const token = await getAuthToken(true);
      const metadata = await findSyncFile(token);
      const account = await getConnectedAccountInfo().catch(() => undefined);
      const accountPatch: Partial<AuraSyncSettings> = {
        accountEmail: account?.email,
        accountName: account?.name,
        accountAvatarUrl: account?.avatarUrl
      };

      if (metadata) {
        const download = await downloadSyncFile(metadata.id, token);
        if (download) {
          await applyCloudDownload(set, get, download, accountPatch);
          get().addToast({
            type: "success",
            title: text(get().data, "googleDriveConnected"),
            message: text(get().data, "googleDriveSyncFileFoundAndRestored")
          });
          return;
        }
      }

      const nextSync = mergeSyncSettings(data, {
        ...accountPatch,
        mode: "auto",
        connected: true
      });
      const uploadData: AuraStartData = {
        ...data,
        settings: {
          ...data.settings,
          sync: nextSync
        }
      };
      const createdMetadata = await backupToDrive(uploadData, {
        deviceId: nextSync.deviceId,
        token
      });
      const next = await commitSyncMetadata(
        set,
        data,
        {
          ...accountPatch,
          mode: "auto",
          connected: true,
          cloudFileId: createdMetadata.id,
          lastSyncedAt: nowIso(),
          lastCloudUpdatedAt: data.updatedAt
        },
        "connected",
        text(data, "googleDriveNoSyncFileCreated")
      );

      get().addToast({
        type: "success",
        title: text(next, "googleDriveConnected"),
        message: text(next, "googleDriveNoSyncFileCreated")
      });
    } catch (error) {
      driveFailure(set, get, error);
      throw error;
    }
  },

  async disconnectGoogleDrive() {
    const data = get().data;
    if (!data) return;

    clearAutoSyncQueue();
    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveDisconnecting"), syncConflict: null });
    try {
      const result = await disconnectGoogleDriveAccount();
      const next = await commitSyncMetadata(
        set,
        data,
        {
          mode: "off",
          connected: false,
          accountEmail: undefined,
          accountName: undefined,
          accountAvatarUrl: undefined,
          cloudFileId: undefined,
          lastSyncedAt: undefined,
          lastCloudUpdatedAt: undefined
        },
        "idle",
        text(data, "googleDriveAccountDisconnected")
      );

      get().addToast({
        type: result.revokeError ? "info" : "success",
        title: text(next, "googleDriveAccountDisconnected"),
        message: result.revokeError
          ? text(next, "googleDriveTokenRevokeFailed", { message: result.revokeError })
          : text(next, "googleDriveAccountDisconnectedDescription")
      });
    } catch (error) {
      driveFailure(set, get, error);
      throw error;
    }
  },

  async backupToGoogleDrive(options = {}) {
    const data = get().data;
    if (!data) return;

    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveBackingUp"), syncConflict: null });
    try {
      const sync = ensureSyncDevice(data.settings.sync);
      const token = options.token ?? await getTokenForSync(sync, !options.silent);
      const metadata = await backupToDrive(data, {
        deviceId: sync.deviceId,
        fileId: sync.cloudFileId,
        token
      });
      const syncedAt = nowIso();
      const next = await commitSyncMetadata(
        set,
        data,
        {
          mode: "auto",
          connected: true,
          cloudFileId: metadata.id,
          lastSyncedAt: syncedAt,
          lastCloudUpdatedAt: data.updatedAt
        },
        "connected",
        text(data, "googleDriveBackupSuccess")
      );

      if (!options.silent) {
        get().addToast({
          type: "success",
          title: text(next, "googleDriveBackupSuccess"),
          message: text(next, "googleDriveBackupSuccessDescription")
        });
      }
    } catch (error) {
      if (options.silent && isGoogleDriveAuthorizationUnavailable(error)) {
        await markGoogleDriveSyncNeedsReconnect(set, get, error);
        return;
      }

      driveFailure(set, get, error);
      throw error;
    }
  },

  async restoreFromGoogleDrive(options = {}) {
    const data = get().data;
    if (!data) return false;

    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveRestoring"), syncConflict: null });
    try {
      const token = await getTokenForSync(data.settings.sync);
      const download = await restoreFromDrive(token);
      if (!download) {
        if (options.requireExistingFile) {
          set({ syncStatus: "idle", syncMessage: text(data, "googleDriveNoSyncFileFound"), syncConflict: null });
          return false;
        }

        await commitSyncMetadata(
          set,
          data,
          {
            connected: true,
            cloudFileId: undefined,
            lastCloudUpdatedAt: undefined
          },
          "connected",
          text(data, "googleDriveNoSyncFileFound")
        );
        get().addToast({
          type: "info",
          title: text(data, "googleDriveNoSyncFileFound")
        });
        return false;
      }

      await applyCloudDownload(set, get, download);
      get().addToast({
        type: "success",
        title: text(get().data, "googleDriveRestoreSuccess"),
        message: text(get().data, "googleDriveRestoreSuccessDescription")
      });
      return true;
    } catch (error) {
      driveFailure(set, get, error);
      throw error;
    }
  },

  async syncNow(options = {}) {
    const data = get().data;
    if (!data) return;

    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveSyncing"), syncConflict: null });
    try {
      const sync = ensureSyncDevice(data.settings.sync);
      const token = await getTokenForSync(sync, !options.silent);
      const download = await downloadSyncFile(sync.cloudFileId, token);
      const comparison = compareLocalAndCloud(data, download, sync);

      if (comparison === "no_cloud_file") {
        await get().backupToGoogleDrive({ silent: true, token });
        if (!options.silent) {
          get().addToast({
            type: "success",
            title: text(get().data, "googleDriveBackupSuccess"),
            message: text(get().data, "googleDriveNoFileUploadedLocal")
          });
        }
        return;
      }

      if (!download) return;

      if (comparison === "in_sync") {
        const next = await commitSyncMetadata(
          set,
          data,
          {
            mode: "auto",
            connected: true,
            cloudFileId: download.metadata.id,
            lastSyncedAt: nowIso(),
            lastCloudUpdatedAt: download.cloudUpdatedAt
          },
          "connected",
          text(data, "googleDriveAlreadySynced")
        );
        if (!options.silent) {
          get().addToast({ type: "success", title: text(next, "googleDriveAlreadySynced") });
        }
        return;
      }

      if (comparison === "local_newer") {
        await get().backupToGoogleDrive({ silent: true, token });
        if (!options.silent) {
          get().addToast({
            type: "success",
            title: text(get().data, "googleDriveBackupSuccess"),
            message: text(get().data, "googleDriveLocalUploaded")
          });
        }
        return;
      }

      if (comparison === "cloud_newer") {
        await commitSyncMetadata(
          set,
          data,
          {
            mode: "auto",
            connected: true,
            cloudFileId: download.metadata.id,
            lastCloudUpdatedAt: download.cloudUpdatedAt
          },
          "connected",
          text(data, "googleDriveCloudNewer")
        );
        get().addToast({
          type: "info",
          title: text(data, "googleDriveCloudNewer"),
          message: text(data, "googleDriveCloudNewerDescription")
        });
        return;
      }

      set({
        syncStatus: "conflict",
        syncMessage: text(data, "googleDriveConflictDetected"),
        syncConflict: {
          detectedAt: nowIso(),
          localUpdatedAt: data.updatedAt,
          cloudUpdatedAt: download.cloudUpdatedAt,
          cloudFileId: download.metadata.id,
          cloudData: download.data
        }
      });
      get().addToast({
        type: "error",
        title: text(data, "googleDriveConflictDetected"),
        message: text(data, "googleDriveConflictDescription")
      });
    } catch (error) {
      if (options.silent && isGoogleDriveAuthorizationUnavailable(error)) {
        await markGoogleDriveSyncNeedsReconnect(set, get, error);
        return;
      }

      driveFailure(set, get, error);
      throw error;
    }
  },

  async setSyncMode(mode) {
    const data = get().data;
    if (!data) return;

    const nextMode: AuraSyncMode = mode === "off" ? "off" : "auto";

    if (nextMode === "off") {
      clearAutoSyncQueue();
    }
    const patch: Partial<AuraSyncSettings> = { mode: nextMode };

    await commitSyncMetadata(
      set,
      data,
      patch,
      nextMode === "off" ? "idle" : syncStatusFromData({ ...data, settings: { ...data.settings, sync: mergeSyncSettings(data, patch) } }),
      nextMode === "off" ? text(data, "googleDriveSyncDisabled") : text(data, "googleDriveSyncModeUpdated")
    );
  },

  async deleteGoogleDriveSyncFile() {
    const data = get().data;
    if (!data) return;

    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveDeletingSyncFile"), syncConflict: null });
    try {
      const token = await getTokenForSync(data.settings.sync);
      const deleted = await deleteSyncFile(token);
      const next = await commitSyncMetadata(
        set,
        data,
        {
          connected: true,
          cloudFileId: undefined,
          lastCloudUpdatedAt: undefined,
          lastSyncedAt: undefined
        },
        "connected",
        deleted ? text(data, "googleDriveSyncFileDeleted") : text(data, "googleDriveNoSyncFileFound")
      );

      get().addToast({
        type: deleted ? "success" : "info",
        title: deleted ? text(next, "googleDriveSyncFileDeleted") : text(next, "googleDriveNoSyncFileFound"),
        message: deleted ? text(next, "googleDriveSyncFileDeletedDescription") : undefined
      });
    } catch (error) {
      driveFailure(set, get, error);
      throw error;
    }
  },

  async deleteGoogleDriveBackupAndDisconnect() {
    const data = get().data;
    if (!data) return;

    clearAutoSyncQueue();
    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveDeleteBackupAndDisconnecting"), syncConflict: null });
    try {
      const token = await getCachedAuthToken();
      let deleted = false;
      let deleteError: string | undefined;
      if (token) {
        try {
          deleted = await deleteSyncFile(token);
        } catch (error) {
          deleteError = mapDriveError(error);
        }
      }

      const result = await disconnectGoogleDriveAccount(token);
      const next = await commitSyncMetadata(
        set,
        data,
        {
          mode: "off",
          connected: false,
          accountEmail: undefined,
          accountName: undefined,
          accountAvatarUrl: undefined,
          cloudFileId: undefined,
          lastSyncedAt: undefined,
          lastCloudUpdatedAt: undefined
        },
        "idle",
        text(data, "googleDriveBackupDeletedAndAccountDisconnected")
      );

      let toastMessage: string;
      if (deleteError) {
        toastMessage = text(next, "googleDriveBackupDeleteFailedAccountDisconnected", { message: deleteError });
      } else if (result.revokeError) {
        toastMessage = text(next, "googleDriveTokenRevokeFailed", { message: result.revokeError });
      } else if (!token) {
        toastMessage = text(next, "googleDriveDisconnectedWithoutGoogleWindow");
      } else if (deleted) {
        toastMessage = text(next, "googleDriveBackupDeletedAndAccountDisconnectedDescription");
      } else {
        toastMessage = text(next, "googleDriveNoBackupFoundAccountDisconnectedDescription");
      }

      get().addToast({
        type: deleteError || result.revokeError || !token ? "info" : "success",
        title: text(next, "googleDriveBackupDeletedAndAccountDisconnected"),
        message: toastMessage
      });
    } catch (error) {
      driveFailure(set, get, error);
      throw error;
    }
  },

  async resolveSyncConflict(choice) {
    const conflict = get().syncConflict;
    if (!conflict) return;

    if (choice === "keep_local") {
      await get().backupToGoogleDrive();
      set({ syncConflict: null, syncStatus: "connected", syncMessage: text(get().data, "googleDriveLocalUploaded") });
      return;
    }

    await applyCloudDownload(set, get, {
      metadata: {
        id: conflict.cloudFileId ?? "",
        name: "aura-start-sync.json"
      },
      payload: {
        schemaVersion: 1,
        app: "Aura Start",
        appVersion: getAuraStartVersion(),
        updatedAt: conflict.cloudUpdatedAt,
        deviceId: conflict.cloudData.settings.sync.deviceId,
        data: conflict.cloudData
      },
      data: conflict.cloudData,
      cloudUpdatedAt: conflict.cloudUpdatedAt
    });
    get().addToast({
      type: "success",
      title: text(get().data, "googleDriveRestoreSuccess"),
      message: text(get().data, "googleDriveRestoreSuccessDescription")
    });
  },

  addToast(toast) {
    const id = createId("toast");
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    window.setTimeout(() => {
      get().removeToast(id);
    }, toast.type === "error" ? 8000 : 5000);
  },

  removeToast(toastId) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== toastId) }));
  }
}));
