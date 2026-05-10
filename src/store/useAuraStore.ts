import { create } from "zustand";
import { MAX_RESTORE_POINTS } from "../constants";
import { t } from "../i18n";
import type {
  AuraRestorePoint,
  AuraRestorePointReason,
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

type AuraStore = {
  data: AuraStartData | null;
  status: AuraStoreStatus;
  error: string | null;
  corruptRaw: string | null;
  usingFallbackStorage: boolean;
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
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  removeToast: (toastId: string) => void;
};

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

async function safeCommit(set: (partial: Partial<AuraStore>) => void, data: AuraStartData): Promise<void> {
  const next = touch(data);
  await saveAuraData(next);
  set({ data: next, status: "ready", error: null });
}

async function optimisticCommit(
  set: (partial: Partial<AuraStore>) => void,
  previous: AuraStartData,
  data: AuraStartData
): Promise<void> {
  const next = touch(data);
  set({ data: next, status: "ready", error: null });

  try {
    await saveAuraData(next);
  } catch (error) {
    set({
      data: previous,
      status: "ready",
      error: error instanceof Error ? error.message : "Local storage could not be updated."
    });
    throw error;
  }
}

export const useAuraStore = create<AuraStore>((set, get) => ({
  data: null,
  status: "idle",
  error: null,
  corruptRaw: null,
  usingFallbackStorage: false,
  toasts: [],

  async load() {
    set({ status: "loading", error: null, corruptRaw: null });
    try {
      const result = await loadAuraData();
      if (result.status === "missing") {
        const empty = createEmptyData();
        await saveAuraData(empty);
        set({ data: empty, status: "ready", usingFallbackStorage: result.fallback });
        return;
      }

      if (result.status === "corrupt") {
        set({
          data: null,
          status: "corrupt",
          error: result.message,
          corruptRaw: result.raw,
          usingFallbackStorage: result.fallback
        });
        return;
      }

      set({ data: result.data, status: "ready", usingFallbackStorage: result.fallback });
    } catch (caught) {
      set({
        status: "error",
        error: caught instanceof Error ? caught.message : "Local storage could not be initialized."
      });
    }
  },

  async resetCorruptData() {
    const empty = createEmptyData();
    await clearAuraData();
    await saveAuraData(empty);
    set({ data: empty, status: "ready", error: null, corruptRaw: null });
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
        ? {
            ...imported,
            restorePoints: [withSafety.restorePoints[0], ...imported.restorePoints].slice(0, MAX_RESTORE_POINTS)
          }
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
