import { create } from "zustand";
import { MAX_RESTORE_POINTS } from "../constants";
import { t } from "../i18n";
import {
  backupToDrive,
  compareLocalAndCloud,
  deleteSyncFile,
  disconnectGoogleAccount as disconnectGoogleDriveAccount,
  downloadSyncFile,
  findSyncFile,
  getAuthToken,
  getCachedAuthToken,
  getConnectedAccountInfo,
  mapDriveError,
  restoreFromDrive,
  type GoogleDriveSyncDownload
} from "../services/googleDriveSync";
import type {
  AuraRestorePoint,
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
  ImportMode
} from "../types";
import { nowIso } from "../utils/dates";
import { createId } from "../utils/ids";
import { mergeImportedData } from "../utils/importJson";
import { createEmptyData } from "../utils/sampleData";
import { clearAuraData, loadAuraData, saveAuraData } from "../utils/storage";
import { normalizeUrl, parseTags, validateTitle } from "../utils/validators";

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

type AuraStoreStatus = "idle" | "loading" | "ready" | "corrupt" | "error";
type GoogleDriveBackupOptions = { silent?: boolean };
type GoogleDriveSyncNowOptions = { silent?: boolean };
type CommitOptions = { skipAutoSync?: boolean };

type AuraStore = {
  data: AuraStartData | null;
  status: AuraStoreStatus;
  error: string | null;
  corruptRaw: string | null;
  usingFallbackStorage: boolean;
  syncStatus: AuraSyncStatus;
  syncMessage: string | null;
  syncConflict: AuraSyncConflict | null;
  toasts: ToastMessage[];
  load: () => Promise<void>;
  resetCorruptData: () => Promise<void>;
  updateSettings: (settings: Partial<AuraStartSettings>) => Promise<void>;
  addGroup: (title: string) => Promise<string | undefined>;
  updateGroupTitle: (groupId: string, title: string) => Promise<void>;
  toggleGroupCollapsed: (groupId: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  addLink: (groupId: string, input: LinkInput) => Promise<void>;
  updateLink: (groupId: string, linkId: string, input: LinkInput) => Promise<void>;
  deleteLink: (groupId: string, linkId: string) => Promise<void>;
  reorderGroups: (orderedGroupIds: string[]) => Promise<void>;
  moveLink: (linkId: string, targetGroupId: string, overLinkId?: string) => Promise<void>;
  importBackup: (imported: AuraStartData, mode: ImportMode) => Promise<void>;
  resetAllData: () => Promise<void>;
  createManualRestorePoint: (name: string) => Promise<void>;
  restoreRestorePoint: (restorePointId: string) => Promise<void>;
  deleteRestorePoint: (restorePointId: string) => Promise<void>;
  connectGoogleDrive: () => Promise<void>;
  disconnectGoogleDrive: () => Promise<void>;
  backupToGoogleDrive: (options?: GoogleDriveBackupOptions) => Promise<void>;
  restoreFromGoogleDrive: () => Promise<void>;
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
  return groups.map((group, groupIndex) => ({
    ...group,
    order: groupIndex,
    links: group.links.map((link, linkIndex) => ({ ...link, order: linkIndex }))
  }));
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
  reason: AuraRestorePointReason
): AuraRestorePoint {
  return {
    id: createId("restore"),
    name,
    createdAt: nowIso(),
    reason,
    data: snapshot(data)
  };
}

function withRestorePoint(
  data: AuraStartData,
  name: string,
  reason: AuraRestorePointReason
): AuraStartData {
  const point = createRestorePoint(data, name, reason);
  return {
    ...data,
    restorePoints: [point, ...data.restorePoints].slice(0, MAX_RESTORE_POINTS)
  };
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

function prepareLinkInput(input: LinkInput): Pick<AuraStartLink, "title" | "url" | "description" | "tags"> {
  const normalizedUrl = normalizeUrl(input.url);
  if (!normalizedUrl.ok) {
    throw new Error(normalizedUrl.message);
  }

  const description = input.description?.trim();

  return {
    title: validateTitle(input.title, "Link"),
    url: normalizedUrl.url,
    description: description ? description : undefined,
    tags: input.tags ? parseTags(input.tags) : undefined
  };
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

async function applyCloudDownload(
  set: (partial: Partial<AuraStore>) => void,
  get: () => AuraStore,
  download: GoogleDriveSyncDownload,
  syncPatch: Partial<AuraSyncSettings> = {}
): Promise<void> {
  const current = get().data;
  if (!current) return;

  const point = createRestorePoint(current, "Before Google Drive restore", "before_import");
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
  toasts: [],

  async load() {
    set({ status: "loading", error: null, corruptRaw: null });
    try {
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
          syncConflict: null
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
          syncConflict: null
        });
        return;
      }

      set({
        data: result.data,
        status: "ready",
        usingFallbackStorage: result.fallback,
        syncStatus: syncStatusFromData(result.data),
        syncMessage: null,
        syncConflict: null
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

  async addGroup(title) {
    const data = get().data;
    if (!data) return undefined;

    const now = nowIso();
    const group: AuraStartGroup = {
      id: createId("group"),
      title: validateTitle(title, "Group"),
      collapsed: false,
      order: data.groups.length,
      links: []
    };

    await safeCommit(set, {
      ...data,
      updatedAt: now,
      groups: [...data.groups, group]
    });

    return group.id;
  },

  async updateGroupTitle(groupId, title) {
    const data = get().data;
    if (!data) return;
    const nextTitle = validateTitle(title, "Group");
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

  async deleteGroup(groupId) {
    const data = get().data;
    if (!data) return;
    const previous = cloneData(data);
    const group = findGroup(data, groupId);
    const withSafety = withRestorePoint(data, `Before deleting "${group.title}"`, "before_delete");
    await safeCommit(set, {
      ...withSafety,
      groups: withSafety.groups.filter((item) => item.id !== groupId)
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

  async addLink(groupId, input) {
    const data = get().data;
    if (!data) return;
    const normalized = prepareLinkInput(input);
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
    const normalized = prepareLinkInput(input);
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

    await safeCommit(set, {
      ...data,
      groups: data.groups.map((item) =>
        item.id === groupId ? { ...item, links: item.links.filter((candidate) => candidate.id !== linkId) } : item
      )
    });
    get().addToast({
      type: "info",
      title: text(data, "linkDeleted"),
      message: text(data, "removedMessage", { title: link.title }),
      actionLabel: text(data, "undo"),
      onAction: async () => {
        await safeCommit(set, previous);
      }
    });
  },

  async reorderGroups(orderedGroupIds) {
    const data = get().data;
    if (!data) return;

    const groupsById = new Map(data.groups.map((group) => [group.id, group]));
    const orderedIdSet = new Set(orderedGroupIds);
    const nextGroups = orderedGroupIds
      .map((groupId) => groupsById.get(groupId))
      .filter((group): group is AuraStartGroup => Boolean(group));
    const missingGroups = data.groups.filter((group) => !orderedIdSet.has(group.id));

    if (!nextGroups.length || nextGroups.length + missingGroups.length !== data.groups.length) {
      return;
    }

    const nextOrder = [...nextGroups, ...missingGroups];
    const changed = nextOrder.some((group, index) => group.id !== data.groups[index]?.id);
    if (!changed) return;

    await optimisticCommit(set, data, { ...data, groups: nextOrder });
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

    await optimisticCommit(set, data, {
      ...data,
      groups: data.groups.map((group) => {
        if (group.id === sourceGroup.id && group.id === targetGroup.id) {
          return { ...group, links: nextTargetLinks };
        }

        if (group.id === sourceGroup.id) {
          return { ...group, links: sourceLinks };
        }

        if (group.id === targetGroup.id) {
          return { ...group, links: nextTargetLinks };
        }

        return group;
      })
    });
  },

  async importBackup(imported, mode) {
    const data = get().data;
    if (!data) return;
    const withSafety = withRestorePoint(data, "Before import", "before_import");
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
      title: mode === "replace" ? text(data, "backupImported") : text(data, "backupMerged"),
      message: text(data, "importRestorePointMessage")
    });
  },

  async resetAllData() {
    const data = get().data;
    if (!data) return;
    const point = createRestorePoint(data, "Before reset", "before_reset");
    const empty = createEmptyData();
    await safeCommit(set, {
      ...empty,
      restorePoints: [point]
    });
  },

  async createManualRestorePoint(name) {
    const data = get().data;
    if (!data) return;
    await safeCommit(set, withRestorePoint(data, validateTitle(name, "Restore point"), "manual"));
  },

  async restoreRestorePoint(restorePointId) {
    const data = get().data;
    if (!data) return;
    const point = data.restorePoints.find((item) => item.id === restorePointId);
    if (!point) {
      throw new Error(text(data, "restorePointNotFound"));
    }

    await safeCommit(set, {
      ...point.data,
      restorePoints: data.restorePoints
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
      const token = await getTokenForSync(sync, !options.silent);
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
      driveFailure(set, get, error);
      throw error;
    }
  },

  async restoreFromGoogleDrive() {
    const data = get().data;
    if (!data) return;

    set({ syncStatus: "syncing", syncMessage: text(data, "googleDriveRestoring"), syncConflict: null });
    try {
      const token = await getTokenForSync(data.settings.sync);
      const download = await restoreFromDrive(token);
      if (!download) {
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
        return;
      }

      await applyCloudDownload(set, get, download);
      get().addToast({
        type: "success",
        title: text(get().data, "googleDriveRestoreSuccess"),
        message: text(get().data, "googleDriveRestoreSuccessDescription")
      });
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
        await get().backupToGoogleDrive({ silent: true });
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
        await get().backupToGoogleDrive({ silent: true });
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
        appVersion: "1.1.0",
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
