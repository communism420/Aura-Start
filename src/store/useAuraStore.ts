import { create } from "zustand";
import { MAX_RESTORE_POINTS, MAX_WIDGET_NOTES_CHARS } from "../constants";
import { t } from "../i18n";
import {
  deleteSyncFile,
  disconnectGoogleAccount as disconnectGoogleDriveAccount,
  getAuthToken,
  getGoogleDriveDeletionAuthToken,
  getConnectedAccountInfo,
  isGoogleDriveAuthorizationUnavailable,
  isGoogleDriveScopeError,
  listSyncFiles,
  mapDriveError,
  restoreFromDrive,
  type GoogleDriveSyncDownload
} from "../services/googleDriveSync";
import {
  hasPendingGoogleDriveLocalChanges,
  requestGoogleDriveBackgroundSync,
  runGoogleDriveBackgroundSync,
  withGoogleDriveSyncLock,
  type GoogleDriveBackgroundSyncResult
} from "../services/googleDriveBackgroundSync";
import { installGoogleDriveSyncPageLifecycle } from "../services/googleDriveSyncLifecycle";
import { clearGoogleDrivePollCache } from "../services/googleDrivePollCache";
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
import { hasExtensionRuntime } from "../utils/browserApi";
import { loadBackgroundImage, storeBackgroundImage } from "../utils/backgroundImageStorage";
import { importBackgroundImageBackup } from "../utils/backgroundImageBackup";
import { importTimerSoundBackup } from "../utils/timerSoundBackup";
import { prepareTimerSound } from "../utils/timerSoundImport";
import { storeTimerSound } from "../utils/timerSoundStorage";
import { nowIso } from "../utils/dates";
import { buildGroupTree, groupsInTreeOrder, groupTitlePath, normalizeGroupOrders } from "../utils/groupTree";
import { createId } from "../utils/ids";
import { mergeImportedData } from "../utils/importJson";
import { createEmptyData } from "../utils/sampleData";
import { searchAuraGroups, type SearchAuraGroupsResult, type SearchQuickFilter } from "../utils/search";
import { applyExplicitSettingsPatch, snapshotSettingsCompatibility, type AuraSettingsPatch } from "../utils/settingsPatch";
import { isDefaultedSetting, restoreCompatibleSettings } from "../utils/settingsSchema";
import { clearAuraData, loadAuraData, nextStorageRevision, saveAuraData, StorageStateChangedError, updateAuraData } from "../utils/storage";
import { commitLocalSyncChanges, mergeSyncData, sameSyncContent, sameSyncReplica } from "../utils/syncReplica";
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
type GoogleDriveSyncNowOptions = { foreground?: boolean; silent?: boolean };
type CommitOptions = { skipAutoSync?: boolean; baseline?: AuraStartData; guard?: (current: AuraStartData) => boolean };
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
  updateSettings: (settings: AuraSettingsPatch) => Promise<void>;
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
  setCustomBackgroundImage: (image: string | null) => Promise<void>;
  setCustomTimerSound: (file: File | null) => Promise<void>;
  setWidgetNotes: (notes: string) => Promise<void>;
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
  handleBackgroundGoogleDriveSyncResult: (result: GoogleDriveBackgroundSyncResult) => Promise<void>;
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  removeToast: (toastId: string) => void;
};

const AUTO_SYNC_DELAY_MS = 2_000;
let autoSyncTimer: number | undefined;
let autoSyncDirty = false;
const handledSyncResults = new Set<string>();
let backgroundImageChangeRequest = 0;
let timerSoundChangeRequest = 0;
let timerSoundImportController: AbortController | undefined;
let pendingNotesWrites = 0;
let notesWriteRequest = 0;
let unsavedNotes = false;
let pendingLegacyNotes: string | undefined;

/** A retained editor draft must not be mistaken for a successfully backed-up note. */
export function hasUnsavedWidgetNotes(): boolean {
  return unsavedNotes;
}

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
    settingsCompatibility: snapshotSettingsCompatibility(data),
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
  const sync = data.settings.sync;
  if (!sync.connected) return "idle";
  if (sync.reconnectRequired) return "reconnect_required";
  return sync.mode === "off" ? "idle" : "connected";
}

async function getTokenForSync(sync: AuraSyncSettings, allowInteractive = true): Promise<string> {
  try {
    return await getAuthToken(!sync.connected && allowInteractive);
  } catch (error) {
    if (sync.connected && allowInteractive && isGoogleDriveAuthorizationUnavailable(error)) {
      return await getAuthToken(true);
    }

    throw error;
  }
}

function normalizeOrders(groups: AuraStartGroup[]): AuraStartGroup[] {
  return groupsInTreeOrder(normalizeGroupOrders(groups));
}

function sameStoredSyncConnection(current: AuraSyncSettings, started: AuraSyncSettings): boolean {
  return current.deviceId === started.deviceId && current.connectionId === started.connectionId
    && current.mode === started.mode && Boolean(current.connected) === Boolean(started.connected)
    && Boolean(current.reconnectRequired) === Boolean(started.reconnectRequired);
}

async function requireStoredSyncConnection(started: AuraSyncSettings): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready" || !sameStoredSyncConnection(loaded.data.settings.sync, started)) {
    throw new StorageStateChangedError();
  }
  return loaded.data;
}

function nextUpdatedAt(previous: string): string {
  const previousTime = new Date(previous).getTime();
  const nextTime = Number.isFinite(previousTime)
    ? Math.max(Date.now(), previousTime + 1)
    : Date.now();
  return new Date(nextTime).toISOString();
}

function touch(data: AuraStartData): AuraStartData {
  return {
    ...data,
    updatedAt: nextUpdatedAt(data.updatedAt),
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
  const compatible = restoreCompatibleSettings(current, data);
  return {
    ...data,
    ...compatible,
    syncReplica: current.syncReplica,
    settings: {
      ...compatible.settings,
      sync: ensureSyncDevice(compatible.settings.sync)
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

function groupParentId(group: AuraStartGroup): string | null {
  return group.parentId ?? null;
}

function groupHasParent(group: AuraStartGroup, parentId: string | null): boolean {
  return groupParentId(group) === parentId;
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
  if (groupParentId(parent) !== null) {
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
    if (groupParentId(parent) !== null) {
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
    customBackgroundImage: null,
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

function schedulePageAutoSync(data: AuraStartData): void {
  if (typeof window === "undefined") return;
  const sync = data.settings.sync;
  if (sync.mode !== "auto" || !sync.connected || sync.reconnectRequired || !hasPendingGoogleDriveLocalChanges(data)) return;

  autoSyncDirty = true;
  if (autoSyncTimer) {
    window.clearTimeout(autoSyncTimer);
  }

  autoSyncTimer = window.setTimeout(() => {
    autoSyncTimer = undefined;
    const state = useAuraStore.getState();
    const current = state.data;
    if (
      !autoSyncDirty
      || !current
      || current.settings.sync.mode !== "auto"
      || !current.settings.sync.connected
      || current.settings.sync.reconnectRequired
      || !hasPendingGoogleDriveLocalChanges(current)
    ) {
      autoSyncDirty = false;
      return;
    }
    if (isActiveSyncStatus(state.syncStatus)) {
      schedulePageAutoSync(current);
      return;
    }

    autoSyncDirty = false;
    void state.syncNow({ foreground: true, silent: true }).catch(() => {
      // The store records sync errors and keeps local work uninterrupted.
    });
  }, AUTO_SYNC_DELAY_MS);
}

function scheduleAutoSync(data: AuraStartData): void {
  const sync = data.settings.sync;
  if (sync.mode !== "auto" || !sync.connected || sync.reconnectRequired || !hasPendingGoogleDriveLocalChanges(data)) return;

  if (!hasExtensionRuntime()) {
    schedulePageAutoSync(data);
    return;
  }

  useAuraStore.setState({
    syncStatus: "syncing",
    syncMessage: text(data, "googleDriveSyncing"),
    syncConflict: null
  });
  void requestGoogleDriveBackgroundSync()
    .then((result) => {
      if (!result) {
        throw new Error("Extension background sync is unavailable.");
      }
      if (result.status === "skipped") {
        const current = useAuraStore.getState().data ?? data;
        useAuraStore.setState({
          syncStatus: syncStatusFromData(current),
          syncMessage: null,
          syncConflict: null
        });
      } else {
        return useAuraStore.getState().handleBackgroundGoogleDriveSyncResult(result);
      }
    })
    .catch(() => {
      const current = useAuraStore.getState().data ?? data;
      useAuraStore.setState({
        syncStatus: syncStatusFromData(current),
        syncMessage: null,
        syncConflict: null
      });
      schedulePageAutoSync(current);
    });
}

async function safeCommit(
  set: (partial: Partial<AuraStore>) => void,
  data: AuraStartData,
  options: CommitOptions = {}
): Promise<void> {
  const baseline = options.baseline ?? useAuraStore.getState().data ?? undefined;
  const next = await saveAuraData(touch(data), { baseline, guard: options.guard });
  set({ data: next, status: "ready", error: null });
  await refreshCustomBackgroundImage(next);
  if (!options.skipAutoSync && (!baseline || !sameSyncContent(baseline, next) || !sameSyncReplica(baseline, next))) {
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
    const persisted = await saveAuraData(next, { baseline: previous });
    set({ data: persisted, status: "ready", error: null });
    if (!options.skipAutoSync && (!sameSyncContent(previous, persisted) || !sameSyncReplica(previous, persisted))) {
      scheduleAutoSync(persisted);
    }
  } catch (error) {
    const durable = await loadAuraData().catch(() => undefined);
    set({
      data: durable?.status === "ready" ? durable.data : previous,
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
  syncConflict: AuraSyncConflict | null = null,
  expectedConnection?: AuraSyncSettings
): Promise<AuraStartData> {
  const next = await updateAuraData((current) => {
    if (expectedConnection && !sameStoredSyncConnection(current.settings.sync, expectedConnection)) {
      throw new StorageStateChangedError();
    }
    return { ...current, settings: { ...current.settings, sync: mergeSyncSettings(current, patch) } };
  });
  if (!next && expectedConnection) throw new StorageStateChangedError();
  if (!next) throw new Error("Local data is unavailable for sync metadata.");
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

async function driveFailure(
  set: (partial: Partial<AuraStore>) => void,
  get: () => AuraStore,
  error: unknown,
  expectedConnection?: AuraSyncSettings
): Promise<string> {
  const data = get().data;
  const message = mapDriveError(error);
  if (expectedConnection) {
    try { await requireStoredSyncConnection(expectedConnection); }
    catch (changed) { if (changed instanceof StorageStateChangedError) return message; throw changed; }
  }
  if (data?.settings.sync.connected && isGoogleDriveAuthorizationUnavailable(error)) {
    try { await markGoogleDriveSyncNeedsReconnect(set, get, error, expectedConnection); }
    catch (changed) { if (changed instanceof StorageStateChangedError) return message; throw changed; }
    get().addToast({
      type: "error",
      title: text(data, "googleDriveNeedsReconnect"),
      message
    });
    return message;
  }

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
  error: unknown,
  expectedConnection?: AuraSyncSettings
): Promise<void> {
  clearAutoSyncQueue();

  const data = get().data;
  if (!data) {
    set({ syncStatus: "reconnect_required", syncMessage: mapDriveError(error), syncConflict: null });
    return;
  }

  try {
    await commitSyncMetadata(
      set,
      data,
      { reconnectRequired: true },
      "reconnect_required",
      text(data, "googleDriveNeedsReconnect"),
      null,
      expectedConnection
    );
  } catch (caught) {
    if (caught instanceof StorageStateChangedError) throw caught;
    set({
      syncStatus: "reconnect_required",
      syncMessage: text(data, "googleDriveNeedsReconnect"),
      syncConflict: null
    });
  }
}

async function applyCloudDownload(
  set: (partial: Partial<AuraStore>) => void,
  get: () => AuraStore,
  download: GoogleDriveSyncDownload,
  expectedConnection?: AuraSyncSettings
): Promise<void> {
  const loaded = await loadAuraData();
  if (loaded.status === "ready" && (loaded.backgroundMigrationError || loaded.notesMigrationError)) {
    throw new Error(text(loaded.data, loaded.notesMigrationError ? "notesMigrationFailed" : "backgroundMigrationFailed"));
  }
  const current = loaded.status === "ready" ? loaded.data : get().data;
  if (!current) return;
  const started = expectedConnection ?? current.settings.sync;
  if (!sameStoredSyncConnection(current.settings.sync, started)) throw new StorageStateChangedError();

  const point = createRestorePoint(current, text(current, "restoreNameBeforeCloudRestore"), "before_cloud_restore", {
    entity: "sync",
    source: "Google Drive"
  });
  const currentSync = ensureSyncDevice(current.settings.sync);
  const nextSync: AuraSyncSettings = {
    ...currentSync,
    mode: "auto",
    connected: true,
    reconnectRequired: false,
    connectionId: currentSync.mode === "auto" && currentSync.connected ? currentSync.connectionId : createId("connection"),
    lastCloudUpdatedAt: download.cloudUpdatedAt
  };
  const compatible = restoreCompatibleSettings(current, download.data);
  const next: AuraStartData = {
    ...download.data,
    ...compatible,
    syncReplica: current.syncReplica,
    settings: {
      ...compatible.settings,
      sync: { ...nextSync, deleteCloudFileOnDisconnect: compatible.settings.sync.deleteCloudFileOnDisconnect }
    },
    restorePoints: [point, ...current.restorePoints].slice(0, MAX_RESTORE_POINTS)
  };

  const empty = createEmptyData();
  const pristine = sameSyncContent(current, empty) && sameSyncReplica(current, empty);
  // A clean installation receives the cloud's causal history. Treating every
  // restored field as a new local edit would immediately rewrite that same
  // backup and could outvote real edits from another connected device.
  const persisted = pristine ? await updateAuraData((durable) => {
    if (!sameStoredSyncConnection(durable.settings.sync, started)) throw new StorageStateChangedError();
    const merged = mergeSyncData(durable, download.data);
    const recovery = createRestorePoint(durable, text(durable, "restoreNameBeforeCloudRestore"), "before_cloud_restore", {
      entity: "sync", source: "Google Drive"
    });
    return {
      ...merged,
      updatedAt: nextStorageRevision(durable.updatedAt),
      settings: { ...merged.settings, sync: {
        ...nextSync, deleteCloudFileOnDisconnect: merged.settings.sync.deleteCloudFileOnDisconnect
      } },
      restorePoints: [recovery, ...durable.restorePoints].slice(0, MAX_RESTORE_POINTS)
    };
  }) : await saveAuraData(next, {
    baseline: current,
    guard: (durable) => sameStoredSyncConnection(durable.settings.sync, started)
  });
  if (!persisted) throw new StorageStateChangedError();
  set({
    data: persisted,
    status: "ready",
    error: null,
    syncStatus: "connected",
    syncMessage: text(persisted, "googleDriveRestoreSuccess"),
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
        // Preserve a legacy UI-only note even if the main document was missing.
        const saved = await saveAuraData(uiState.widgetNotes
          ? { ...empty, ...applyExplicitSettingsPatch(empty, { notes: { text: uiState.widgetNotes } }) }
          : empty);
        set({
          data: saved,
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
          widgetNotes: saved.settings.notes.text
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

      const data = {
        ...result.data,
        groups: normalizeOrders(result.data.groups)
      };
      const customBackgroundImage = data.settings.background.customImageId === undefined
        ? uiState.customBackgroundImage
        : get().data?.settings.background.customImageId === data.settings.background.customImageId
          ? get().customBackgroundImage : null;

      // Publish the loaded document before awaiting media. A storage event can
      // apply newer links, notes or connection state while IndexedDB is busy.
      // Only the guarded image projection may finish after that newer document.
      pendingLegacyNotes = result.notesMigrationError ? uiState.widgetNotes : undefined;
      set({
        data,
        status: "ready",
        usingFallbackStorage: result.fallback,
        syncStatus: syncStatusFromData(data),
        syncMessage: null,
        syncConflict: null,
        onboardingCompleted: uiState.onboardingCompleted,
        demoData: uiState.demoData,
        searchQuery: uiState.lastSearchQuery,
        searchFilter: uiState.searchFilter,
        customBackgroundImage,
        widgetNotes: result.notesMigrationError ? uiState.widgetNotes : data.settings.notes.text
      });
      if (result.backgroundMigrationError || result.notesMigrationError) {
        if (result.notesMigrationError) set({ widgetNotes: uiState.widgetNotes });
        const message = text(data, result.notesMigrationError ? "notesMigrationFailed" : "backgroundMigrationFailed");
        set({ syncStatus: data.settings.sync.connected ? "error" : "idle", syncMessage: message });
        get().addToast({ type: "error", title: message });
        return;
      }
      await refreshCustomBackgroundImage(data);
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
      customBackgroundImage: null,
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
      ...applyExplicitSettingsPatch(data, settings)
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
      order: data.groups.filter((item) => groupHasParent(item, normalizedParentId)).length,
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
      order: data.groups.filter((item) => groupHasParent(item, null)).length,
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
    }, { baseline: data });
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
              parentId: groupParentId(group),
              order: data.groups.filter((candidate) => groupHasParent(candidate, groupParentId(group))).length + item.order
            }
          : item
      );
    const postDeleteIntent = touch({ ...withSafety, groups });
    await safeCommit(set, postDeleteIntent, { baseline: data });
    get().addToast({
      type: "info",
      title: text(data, "groupDeleted"),
      message: text(data, "removedMessage", { title: group.title }),
      actionLabel: text(data, "undo"),
      onAction: async () => {
        const current = get().data;
        await safeCommit(set, current ? { ...previous, restorePoints: current.restorePoints } : previous, { baseline: postDeleteIntent });
      }
    });
  },

  async moveGroup(groupId, newParentId) {
    const data = get().data;
    if (!data) return;

    const normalizedParentId = resolveGroupParentId(data, newParentId);
    canMoveGroupToParent(data, groupId, normalizedParentId);
    const group = findGroup(data, groupId);
    if (groupHasParent(group, normalizedParentId)) return;

    const targetSiblingCount = data.groups.filter((item) => groupHasParent(item, normalizedParentId)).length;
    const withSafety = withAutomaticRestorePoint(data, text(data, "restoreNameBeforeMovingGroup", { title: group.title }), "before_group_move", {
      entity: "group",
      title: group.title,
      from: groupLabel(data, groupParentId(group)),
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
    const postDeleteIntent = touch({
      ...withSafety,
      groups: withSafety.groups.map((item) =>
        item.id === groupId ? { ...item, links: item.links.filter((candidate) => candidate.id !== linkId) } : item
      )
    });
    await safeCommit(set, postDeleteIntent, { baseline: data });
    get().addToast({
      type: "info",
      title: text(data, "linkDeleted"),
      message: text(data, "removedMessage", { title: link.title }),
      actionLabel: text(data, "undo"),
      onAction: async () => {
        const current = get().data;
        await safeCommit(set, current ? { ...previous, restorePoints: current.restorePoints } : previous, { baseline: postDeleteIntent });
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

    const postDeleteIntent = touch({ ...withSafety, groups });
    await safeCommit(set, postDeleteIntent, { baseline: data });
    get().addToast({
      type: "info",
      title: text(data, "duplicateLinksDeleted", { count: deletedCount }),
      message: text(data, "restorePointCreatedBeforeDeletingDuplicates"),
      actionLabel: text(data, "undo"),
      onAction: async () => {
        const current = get().data;
        await safeCommit(set, current ? { ...previous, restorePoints: current.restorePoints } : previous, { baseline: postDeleteIntent });
      }
    });
  },

  async reorderGroups(orderedGroupIds, parentId = null) {
    const data = get().data;
    if (!data) return;

    const normalizedParentId = parentId ?? null;
    const siblings = data.groups.filter((group) => groupHasParent(group, normalizedParentId)).sort((a, b) => a.order - b.order);
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
        groupHasParent(group, normalizedParentId) ? { ...group, parentId: normalizedParentId, order: orderById.get(group.id) ?? group.order } : group
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

  async setCustomBackgroundImage(image) {
    const request = ++backgroundImageChangeRequest;
    // Finish saving the bytes before publishing their reference, both locally
    // and to Drive. Read the latest settings after the asynchronous asset write.
    const customImageId = image === null ? null : await storeBackgroundImage(image);
    if (request !== backgroundImageChangeRequest) return;
    const loaded = await loadAuraData();
    if (request !== backgroundImageChangeRequest || loaded.status !== "ready") return;
    if (loaded.backgroundMigrationError) throw new Error(loaded.backgroundMigrationError);
    const data = loaded.data;
    if (data.settings.background.customImageId === customImageId
      && (image === null || data.settings.background.preset === "custom")) return;
    const next = withRestorePoint(data, text(data, "restoreNameBeforeBackgroundChange"), "before_restore", {
      entity: "settings", title: text(data, "backgroundImage")
    });
    try {
      await safeCommit(set, {
        ...next,
        settings: { ...next.settings, background: {
          ...next.settings.background,
          customImageId,
          preset: image !== null ? "custom"
            : next.settings.background.preset === "custom" ? "none" : next.settings.background.preset
        } }
      }, { baseline: data, guard: () => request === backgroundImageChangeRequest });
    } catch (error) {
      if (error instanceof StorageStateChangedError && request !== backgroundImageChangeRequest) return;
      throw error;
    }
  },

  async setCustomTimerSound(file) {
    const request = ++timerSoundChangeRequest;
    timerSoundImportController?.abort();
    const controller = new AbortController();
    timerSoundImportController = controller;
    try {
      const asset = file === null ? null : await prepareTimerSound(file, { signal: controller.signal });
      if (request !== timerSoundChangeRequest) return;
      // Publish only a reference whose original audio and playable copy are durable.
      const customSoundId = asset === null ? null : await storeTimerSound(asset);
      if (request !== timerSoundChangeRequest) return;
      const loaded = await loadAuraData();
      if (request !== timerSoundChangeRequest) return;
      if (loaded.status !== "ready") throw new Error("Settings are unavailable. The timer sound was not changed.");
      const data = loaded.data;
      if (data.settings.timer.customSoundId === customSoundId && !isDefaultedSetting(data, "timer.customSoundId")) return;
      const next = withRestorePoint(data, text(data, "restoreNameBeforeTimerSoundChange"), "before_restore", {
        entity: "settings", title: text(data, "timerSignal")
      });
      await safeCommit(set, {
        ...next,
        ...applyExplicitSettingsPatch(next, { timer: { customSoundId } })
      }, { baseline: data, guard: () => request === timerSoundChangeRequest });
    } catch (error) {
      if (request !== timerSoundChangeRequest) return;
      throw error;
    } finally {
      if (timerSoundImportController === controller) timerSoundImportController = undefined;
    }
  },

  async setWidgetNotes(notes) {
    const nextNotes = notes.slice(0, MAX_WIDGET_NOTES_CHARS);
    const expectedNotes = get().widgetNotes;
    const request = ++notesWriteRequest;
    pendingNotesWrites += 1;
    unsavedNotes = true;
    set({ widgetNotes: nextNotes });
    try {
      // Queue the durable write immediately, inside the shared storage lock.
      // Reading the current value here also handles rapid typing followed by
      // clearing, without rebasing the clear onto an obsolete empty value.
      let changed = false;
      const saved = await updateAuraData((current) => {
        const before = current.settings.notes.text !== expectedNotes && current.settings.notes.text !== nextNotes
          ? withRestorePoint(current, text(current, "restoreNameBeforeNotesChange"), "before_restore", {
            entity: "settings", title: text(current, "widgetNotes"), source: "concurrent_notes_edit"
          }) : current;
        const patched = { ...before, ...applyExplicitSettingsPatch(before, { notes: { text: nextNotes } }) };
        const committed = commitLocalSyncChanges(current, patched, current);
        changed = !sameSyncContent(current, committed) || !sameSyncReplica(current, committed);
        if (!changed) return current;
        return { ...committed, restorePoints: before.restorePoints,
          updatedAt: nextStorageRevision(current.updatedAt) };
      });
      if (!saved) throw new Error(text(get().data, "localStorageCouldNotInitialize"));
      set({ data: saved, status: "ready", error: null });
      if (changed) scheduleAutoSync(saved);
      if (request === notesWriteRequest) {
        unsavedNotes = false;
        set({ widgetNotes: saved.settings.notes.text });
      }
    } catch (error) {
      if (request === notesWriteRequest) {
        get().addToast({ type: "error", title: text(get().data, "notesSaveFailed"),
          message: error instanceof Error ? error.message : undefined,
          actionLabel: text(get().data, "notesRetry"), onAction: () => get().setWidgetNotes(get().widgetNotes) });
      }
    } finally {
      pendingNotesWrites -= 1;
    }
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
      customBackgroundImage: null,
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
        customBackgroundImage: null,
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
      customBackgroundImage: null,
      widgetNotes: get().widgetNotes
    });
    set({ demoData: nextMarker });
  },

  async importBackup(imported, mode, source = "aura_json") {
    await importBackgroundImageBackup(imported);
    await importTimerSoundBackup(imported);
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
    await safeCommit(set, keepLocalSyncSettings({
      ...point.data,
      restorePoints: withSafety.restorePoints
    }, data), { baseline: data });
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
    const reconnectRequired = data.settings.sync.connected
      && (data.settings.sync.reconnectRequired || get().syncStatus === "reconnect_required");
    set({ syncStatus: "connecting", syncMessage: text(data, "googleDriveConnecting"), syncConflict: null });
    try {
      await requireStoredSyncConnection(data.settings.sync);
      // Waiting for consent must not block an explicit disconnect in another
      // page. The auth service fences late replies; commit checks this intent.
      let token = await getTokenForSync(data.settings.sync);
      if (reconnectRequired) {
        try {
          await listSyncFiles(token);
        } catch (error) {
          if (!isGoogleDriveScopeError(error)) throw error;
          await requireStoredSyncConnection(data.settings.sync);
          token = await getAuthToken(true, { forceReauthorize: true });
        }
      }
      await withGoogleDriveSyncLock(async () => {
        // The auth service owns credential generation fencing. Two pages
        // can legitimately reuse the same token; a stale metadata commit
        // must not erase the grant used by the page that connected first.
        await requireStoredSyncConnection(data.settings.sync);
        const account = await getConnectedAccountInfo().catch(() => undefined);
        await commitSyncMetadata(set, get().data ?? data, {
          accountEmail: account?.email,
          accountName: account?.name,
          accountAvatarUrl: account?.avatarUrl,
          mode: "auto", connected: true, reconnectRequired: false,
          connectionId: createId("connection"),
          cloudFileId: undefined, lastSyncedAt: undefined,
          lastSyncedLocalUpdatedAt: undefined, lastCloudUpdatedAt: undefined
        }, "syncing", text(data, "googleDriveSyncing"), null, data.settings.sync);
        await clearGoogleDrivePollCache().catch(() => undefined);
      });
      await get().syncNow({ silent: true });
      if (get().syncStatus === "connected") {
        get().addToast({ type: "success", title: text(get().data, "googleDriveConnected") });
      }
    } catch (error) {
      if (error instanceof StorageStateChangedError) return;
      const loaded = await loadAuraData().catch(() => undefined);
      if (loaded?.status === "ready" && !sameStoredSyncConnection(loaded.data.settings.sync, data.settings.sync)) return;
      await driveFailure(set, get, error, data.settings.sync);
      throw error;
    }
  },
  async disconnectGoogleDrive() {
    const data = get().data;
    if (!data) return;

    clearAutoSyncQueue();
    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveDisconnecting"), syncConflict: null });
    let operation = data.settings.sync;
    try {
      const paused = await commitSyncMetadata(set, data, { mode: "off", connectionId: createId("connection") },
        "syncing", text(data, "googleDriveDisconnecting"), null, operation);
      operation = paused.settings.sync;
      const { result, next } = await withGoogleDriveSyncLock(async () => {
        await requireStoredSyncConnection(operation);
        const result = await disconnectGoogleDriveAccount();
        const next = await commitSyncMetadata(set, paused, {
          mode: "off", connected: false, reconnectRequired: false,
          accountEmail: undefined, accountName: undefined, accountAvatarUrl: undefined,
          cloudFileId: undefined, lastSyncedAt: undefined,
          lastSyncedLocalUpdatedAt: undefined, lastCloudUpdatedAt: undefined
        }, "idle", text(data, "googleDriveAccountDisconnected"), null, operation);
        await clearGoogleDrivePollCache().catch(() => undefined);
        return { result, next };
      });

      get().addToast({
        type: result.revokeError ? "info" : "success",
        title: text(next, "googleDriveAccountDisconnected"),
        message: result.revokeError
          ? text(next, "googleDriveTokenRevokeFailed", { message: result.revokeError })
          : text(next, "googleDriveAccountDisconnectedDescription")
      });
    } catch (error) {
      if (error instanceof StorageStateChangedError) return;
      const loaded = await loadAuraData().catch(() => undefined);
      if (loaded?.status === "ready" && !sameStoredSyncConnection(loaded.data.settings.sync, operation)) return;
      await driveFailure(set, get, error, operation);
      throw error;
    }
  },

  async backupToGoogleDrive(options = {}) {
    // Manual and automatic sync share one serialized merge/upload path.
    await get().syncNow({ silent: options.silent });
  },
  async restoreFromGoogleDrive(options = {}) {
    const data = get().data;
    if (!data) return false;

    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveRestoring"), syncConflict: null });
    try {
      const token = await getTokenForSync(data.settings.sync);
      const download = await restoreFromDrive(token);
      const loaded = await loadAuraData();
      if (loaded.status !== "ready" || !sameStoredSyncConnection(loaded.data.settings.sync, data.settings.sync)) {
        return false;
      }
      if (!download) {
        set({ syncStatus: syncStatusFromData(loaded.data), syncMessage: text(data, "googleDriveNoSyncFileFound"), syncConflict: null });
        if (!options.requireExistingFile) get().addToast({
          type: "info",
          title: text(data, "googleDriveNoSyncFileFound")
        });
        return false;
      }

      await applyCloudDownload(set, get, download, data.settings.sync);
      get().addToast({
        type: "success",
        title: text(get().data, "googleDriveRestoreSuccess"),
        message: text(get().data, "googleDriveRestoreSuccessDescription")
      });
      return true;
    } catch (error) {
      if (error instanceof StorageStateChangedError) return false;
      const loaded = await loadAuraData().catch(() => undefined);
      if (loaded?.status === "ready" && !sameStoredSyncConnection(loaded.data.settings.sync, data.settings.sync)) return false;
      await driveFailure(set, get, error, data.settings.sync);
      throw error;
    }
  },

  async syncNow(options = {}) {
    const data = get().data;
    if (!data || (options.silent && !hasPendingGoogleDriveLocalChanges(data))) return;
    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveSyncing"), syncConflict: null });
    let result: GoogleDriveBackgroundSyncResult | undefined;
    if (!options.foreground && hasExtensionRuntime()) {
      try { result = await requestGoogleDriveBackgroundSync(!options.silent); } catch { /* Use the same locked runner locally. */ }
    }
    result ??= await runGoogleDriveBackgroundSync(!options.silent);
    await get().handleBackgroundGoogleDriveSyncResult(result);
    if (result.status === "skipped") {
      set({ syncStatus: syncStatusFromData(get().data ?? data), syncMessage: null, syncConflict: null });
    } else if (!options.silent && result.quiet && result.status === "in_sync") {
      get().addToast({ type: "success", title: text(get().data, "googleDriveAlreadySynced") });
    } else if (!options.silent && result.quiet && result.status === "failed") {
      get().addToast({ type: "error", title: text(get().data, "googleDriveSyncFailed"), message: result.message });
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
    // Keep older callers on the same verified deletion path. Leaving automatic
    // sync connected after clearing its file would immediately recreate it.
    await get().deleteGoogleDriveBackupAndDisconnect();
  },

  async deleteGoogleDriveBackupAndDisconnect() {
    const data = get().data;
    if (!data) return;

    clearAutoSyncQueue();
    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveDeleteBackupAndDisconnecting"), syncConflict: null });
    let operation = data.settings.sync;
    try {
      const paused = await commitSyncMetadata(set, data, {
        mode: "off", connectionId: createId("connection")
      }, "syncing", text(data, "googleDriveDeleteBackupAndDisconnecting"), null, operation);
      operation = paused.settings.sync;
      const { deletion, result, next } = await withGoogleDriveSyncLock(async () => {
        // Drain any upload started before the pause, then delete its completed
        // snapshot too. No queued sync may write under the paused connection.
        await requireStoredSyncConnection(operation);
        const token = await getGoogleDriveDeletionAuthToken(true);
        await requireStoredSyncConnection(operation);
        const deletion = await deleteSyncFile(token);
        await requireStoredSyncConnection(operation);
        const legacyUnchecked = deletion.legacyAppData === "unavailable";
        // Keep the scope limitation durable before removing credentials. It
        // must remain visible after disconnect/reload, not just in a toast.
        // A receipt from an earlier account must not be cleared by verified
        // cleanup of a different account. Without an account identity, retain it.
        const receipt = legacyUnchecked ? await commitSyncMetadata(set, get().data ?? paused, {
          lastDeletionLegacyUnchecked: true
        }, "syncing", null, null, operation) : paused;
        // Every file in the authorized spaces has been verified absent. An
        // inaccessible hidden Chrome store has its own explicit receipt.
        const result = await disconnectGoogleDriveAccount(token);
        const next = await commitSyncMetadata(set, receipt, {
          mode: "off", connected: false, reconnectRequired: false,
          accountEmail: undefined, accountName: undefined, accountAvatarUrl: undefined,
          cloudFileId: undefined, lastSyncedAt: undefined,
          lastSyncedLocalUpdatedAt: undefined, lastCloudUpdatedAt: undefined
        }, "idle", text(data, legacyUnchecked ? "googleDriveBackupDeletedLegacyUncheckedTitle"
          : "googleDriveBackupDeletedAndAccountDisconnected"), null, operation);
        await clearGoogleDrivePollCache().catch(() => undefined);
        return { deletion, result, next };
      });
      const legacyUnchecked = deletion.legacyAppData === "unavailable";
      const description = text(next, legacyUnchecked ? "googleDriveBackupDeletedLegacyUncheckedDescription"
        : deletion.deleted ? "googleDriveBackupDeletedAndAccountDisconnectedDescription"
          : "googleDriveNoBackupFoundAccountDisconnectedDescription");
      get().addToast({
        type: result.revokeError || legacyUnchecked ? "info" : "success",
        title: text(next, legacyUnchecked ? "googleDriveBackupDeletedLegacyUncheckedTitle"
          : "googleDriveBackupDeletedAndAccountDisconnected"),
        message: result.revokeError
          ? `${description} ${text(next, "googleDriveTokenRevokeFailed", { message: result.revokeError })}`
          : description
      });
    } catch (error) {
      if (error instanceof StorageStateChangedError) return;
      const loaded = await loadAuraData().catch(() => undefined);
      if (loaded?.status === "ready" && !sameStoredSyncConnection(loaded.data.settings.sync, operation)) return;
      if (isGoogleDriveAuthorizationUnavailable(error)) {
        try { await markGoogleDriveSyncNeedsReconnect(set, get, error, operation); }
        catch (changed) { if (changed instanceof StorageStateChangedError) return; throw changed; }
      }
      const message = text(get().data, "googleDriveBackupDeleteFailedRetry", { message: mapDriveError(error) });
      set({ syncStatus: isGoogleDriveAuthorizationUnavailable(error) ? "reconnect_required" : "error", syncMessage: message });
      get().addToast({ type: "error", title: text(get().data, "googleDriveBackupDeleteFailed"), message });
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

  async handleBackgroundGoogleDriveSyncResult(result) {
    if (result.status === "skipped") return;
    if (result.resultId) {
      if (handledSyncResults.has(result.resultId)) return;
      handledSyncResults.add(result.resultId);
      if (handledSyncResults.size > 50) handledSyncResults.delete(handledSyncResults.values().next().value!);
    }

    const loaded = await loadAuraData();
    const data = loaded.status === "ready" ? loaded.data : get().data;
    if (!data) return;
    if (result.syncDeviceId !== undefined && (
      result.syncDeviceId !== data.settings.sync.deviceId || result.syncConnectionId !== data.settings.sync.connectionId
    )) return;
    if (result.status === "needs_reconnect" && data.settings.sync.connected && data.settings.sync.reconnectRequired) {
      clearAutoSyncQueue();
      set({ data, status: "ready", syncStatus: "reconnect_required", syncMessage: result.message, syncConflict: null });
      return;
    }
    if (data.settings.sync.mode === "off" || !data.settings.sync.connected) {
      set({ data, syncStatus: "idle", syncMessage: null, syncConflict: null });
      return;
    }

    if (result.status === "downloaded") {
      set({ data, status: "ready", syncStatus: "connected", syncMessage: text(data, "googleDriveUpdatesApplied"), syncConflict: null });
      if (!result.quiet) get().addToast({ type: "success", title: text(data, "googleDriveUpdatesApplied") });
      return;
    }

    if (result.status === "uploaded") {
      const title = text(data, result.reason === "replica_created" ? "googleDriveSyncCompleted" : "googleDriveBackupSuccess");
      set({
        data,
        status: "ready",
        syncStatus: "connected",
        syncMessage: title,
        syncConflict: null
      });
      if (!result.quiet) get().addToast({
        type: "success",
        title,
        message: text(data, result.reason === "replica_created" ? "googleDriveSyncCompletedDescription"
          : result.reason === "created" ? "googleDriveNoFileUploadedLocal" : "googleDriveLocalUploaded")
      });
      return;
    }

    if (result.status === "in_sync") {
      if (result.quiet && ["connected", "connecting"].includes(get().syncStatus)) return;
      set({
        data,
        status: "ready",
        syncStatus: "connected",
        syncMessage: text(data, "googleDriveAlreadySynced"),
        syncConflict: null
      });
      if (!result.quiet) get().addToast({ type: "success", title: text(data, "googleDriveAlreadySynced") });
      return;
    }

    if (result.status === "cloud_newer") {
      set({
        data,
        status: "ready",
        syncStatus: "connected",
        syncMessage: text(data, "googleDriveCloudNewer"),
        syncConflict: null
      });
      get().addToast({
        type: "info",
        title: text(data, "googleDriveCloudNewer"),
        message: text(data, "googleDriveCloudNewerDescription")
      });
      return;
    }

    if (result.status === "conflict") {
      set({
        data,
        status: "ready",
        syncStatus: "conflict",
        syncMessage: text(data, "googleDriveConflictDetected"),
        syncConflict: result.conflict
      });
      get().addToast({
        type: "error",
        title: text(data, "googleDriveConflictDetected"),
        message: text(data, "googleDriveConflictDescription")
      });
      return;
    }

    if (result.status === "needs_reconnect") {
      clearAutoSyncQueue();
      set({
        data,
        status: "ready",
        syncStatus: "reconnect_required",
        syncMessage: text(data, "googleDriveNeedsReconnect"),
        syncConflict: null
      });
      return;
    }

    set({ data, status: "ready", syncStatus: "error", syncMessage: result.message, syncConflict: null });
    if (!result.quiet) get().addToast({
      type: "error",
      title: text(data, "googleDriveSyncFailed"),
      message: result.message
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

let pendingBackgroundRead: { id: string; promise: Promise<void> } | undefined;

async function refreshCustomBackgroundImage(data: AuraStartData): Promise<void> {
  const id = data.settings.background.customImageId;
  // Until migration succeeds the legacy UI image remains the display source.
  if (id === undefined) return;
  if (id === null) {
    if (useAuraStore.getState().data?.settings.background.customImageId === null) {
      useAuraStore.setState({ customBackgroundImage: null });
    }
    return;
  }
  if (pendingBackgroundRead?.id === id) return await pendingBackgroundRead.promise;
  const promise = (async () => {
    try {
      const image = await loadBackgroundImage(id);
      if (!image) throw new Error("The saved background image is unavailable.");
      if (useAuraStore.getState().data?.settings.background.customImageId === id) {
        useAuraStore.setState({ customBackgroundImage: image });
      }
    } catch {
      const current = useAuraStore.getState();
      if (current.data?.settings.background.customImageId === id) {
        const title = text(current.data, "backgroundImageLoadFailed");
        if (!current.toasts.some((toast) => toast.title === title)) {
          current.addToast({ type: "error", title });
        }
      }
    }
  })();
  pendingBackgroundRead = { id, promise };
  await promise;
  if (pendingBackgroundRead?.promise === promise) pendingBackgroundRead = undefined;
}

// Every data path (local edit, Restore, background result, another open page)
// drives the same image projection. A late read cannot replace a newer image.
useAuraStore.subscribe((state, previous) => {
  if (!state.data && !pendingNotesWrites) {
    unsavedNotes = false;
    pendingLegacyNotes = undefined;
  }
  if (state.data && state.data !== previous.data) {
    void refreshCustomBackgroundImage(state.data);
    if (pendingLegacyNotes !== undefined && state.data.restorePoints.some((point) =>
      point.context?.source === "legacy_notes_migration" && point.data.settings.notes.text === pendingLegacyNotes)) {
      pendingLegacyNotes = undefined;
    }
    if (!pendingNotesWrites && !unsavedNotes && pendingLegacyNotes === undefined
      && state.widgetNotes !== state.data.settings.notes.text) {
      useAuraStore.setState({ widgetNotes: state.data.settings.notes.text });
    }
  }
});

export function installAuraStoreSyncLifecycle(): () => void {
  return installGoogleDriveSyncPageLifecycle({
    canPollRemote: () => {
      const state = useAuraStore.getState();
      const sync = state.data?.settings.sync;
      // Clean pages still need remote updates. The background coalesces polls
      // with an existing transfer; reconnect recovery stays on the slower alarm.
      return state.status === "ready" && Boolean(sync?.connected) && sync?.mode === "auto"
        && !sync.reconnectRequired && state.syncStatus !== "connecting";
    },
    canSync: () => {
      const state = useAuraStore.getState();
      const sync = state.data?.settings.sync;
      return state.status === "ready" && Boolean(sync?.connected) && sync?.mode === "auto"
        && !sync.reconnectRequired && !isActiveSyncStatus(state.syncStatus)
        && Boolean(state.data && hasPendingGoogleDriveLocalChanges(state.data));
    },
    onDataChanged: (data) => {
      const state = useAuraStore.getState();
      const sameConnection = state.data && sameStoredSyncConnection(data.settings.sync, state.data.settings.sync);
      useAuraStore.setState({
        data,
        status: "ready",
        error: null,
        syncStatus: sameConnection && isActiveSyncStatus(state.syncStatus)
          ? state.syncStatus : syncStatusFromData(data),
        ...(state.data?.settings.sync.reconnectRequired && !data.settings.sync.reconnectRequired
          ? { syncMessage: null } : {}),
        syncConflict: null
      });
    }
  });
}
