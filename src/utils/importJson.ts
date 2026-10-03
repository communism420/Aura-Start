import { DATA_VERSION, DEFAULT_SETTINGS, MAX_RESTORE_POINTS } from "../constants";
import type {
  AuraRestorePointContext,
  AuraRestorePointEntity,
  AuraRestorePoint,
  AuraRestorePointReason,
  AuraSyncMode,
  AuraSyncSettings,
  AuraStartData,
  AuraStartDataWithoutRestorePoints,
  AuraStartGroup,
  AuraStartLink,
  AuraStartSettings
} from "../types";
import { nowIso } from "./dates";
import { groupsInTreeOrder, normalizeGroupOrders } from "./groupTree";
import { createId } from "./ids";
import { normalizeUrl } from "./validators";
import { ensureSyncReplica, normalizeSyncReplica } from "./syncReplica";
import { registerBackgroundImageBackup } from "./backgroundImageBackup";
import { registerTimerSoundBackup } from "./timerSoundBackup";
import { materializeSharedSettings, normalizeSharedSettings, projectSharedSettings } from "./settingsSchema";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }

  return value;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return asString(value, field);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeIso(value: unknown, fallback = nowIso()): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function normalizeOptionalIso(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function normalizeSyncMode(value: unknown): AuraSyncMode {
  if (value === "manual") return "auto";
  return value === "auto" || value === "off" ? value : "off";
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSyncSettings(value: unknown): AuraSyncSettings {
  const sync = isRecord(value) ? value : {};
  const mode = normalizeSyncMode(sync.mode);
  const deviceId = optionalTrimmedString(sync.deviceId) ?? createId("device");

  return {
    mode,
    deviceId,
    connectionId: optionalTrimmedString(sync.connectionId),
    lastSyncedAt: normalizeOptionalIso(sync.lastSyncedAt),
    lastSyncedLocalUpdatedAt: normalizeOptionalIso(sync.lastSyncedLocalUpdatedAt),
    lastCloudUpdatedAt: normalizeOptionalIso(sync.lastCloudUpdatedAt),
    accountEmail: optionalTrimmedString(sync.accountEmail),
    accountName: optionalTrimmedString(sync.accountName),
    accountAvatarUrl: optionalTrimmedString(sync.accountAvatarUrl),
    cloudFileId: optionalTrimmedString(sync.cloudFileId),
    // Pausing network activity is independent of retaining the account for a
    // deletion retry or an explicit reconnect after a cloud copy was removed.
    connected: asBoolean(sync.connected, false),
    reconnectRequired: asBoolean(sync.connected, false) && asBoolean(sync.reconnectRequired, false),
    ...(sync.lastDeletionLegacyUnchecked === true ? { lastDeletionLegacyUnchecked: true } : {}),
    deleteCloudFileOnDisconnect: asBoolean(sync.deleteCloudFileOnDisconnect, DEFAULT_SETTINGS.sync.deleteCloudFileOnDisconnect)
  };
}

function normalizeSettings(value: unknown, normalized: AuraStartSettings): AuraStartSettings {
  const source = isRecord(value) ? value : {};
  return {
    ...normalized,
    sync: {
      ...normalizeSyncSettings(source.sync),
      deleteCloudFileOnDisconnect: normalized.sync.deleteCloudFileOnDisconnect
    }
  };
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tags = value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean);
  return tags.length ? Array.from(new Set(tags)) : undefined;
}

function normalizeLink(value: unknown, fallbackOrder: number, usedIds: Set<string>): AuraStartLink {
  if (!isRecord(value)) {
    throw new Error("Every link must be an object.");
  }

  const title = asString(value.title, "Link title").trim();
  if (!title) {
    throw new Error("Link title is required.");
  }

  const normalizedUrl = normalizeUrl(asString(value.url, "Link URL"));
  if (!normalizedUrl.ok) {
    throw new Error(`Invalid link URL for "${title}": ${normalizedUrl.message}`);
  }

  const rawId = typeof value.id === "string" && value.id.trim() ? value.id.trim() : createId("link");
  const id = usedIds.has(rawId) ? createId("link") : rawId;
  usedIds.add(id);

  return {
    id,
    title,
    url: normalizedUrl.url,
    description: asOptionalString(value.description, "Link description")?.trim(),
    tags: normalizeTags(value.tags),
    order: asNumber(value.order, fallbackOrder),
    createdAt: normalizeIso(value.createdAt),
    updatedAt: normalizeIso(value.updatedAt)
  };
}

function normalizeGroup(
  value: unknown,
  fallbackOrder: number,
  usedIds: Set<string>,
  rawIdMap: Map<string, string>
): AuraStartGroup {
  if (!isRecord(value)) {
    throw new Error("Every group must be an object.");
  }

  const title = asString(value.title, "Group title").trim();
  if (!title) {
    throw new Error("Group title is required.");
  }

  const rawId = typeof value.id === "string" && value.id.trim() ? value.id.trim() : createId("group");
  const id = usedIds.has(rawId) ? createId("group") : rawId;
  usedIds.add(id);
  if (!rawIdMap.has(rawId)) {
    rawIdMap.set(rawId, id);
  }

  const linkIds = new Set<string>();
  const links = Array.isArray(value.links)
    ? value.links.map((link, index) => normalizeLink(link, index, linkIds))
    : [];

  return {
    id,
    title,
    parentId: optionalTrimmedString(value.parentId) ?? null,
    collapsed: asBoolean(value.collapsed, false),
    order: asNumber(value.order, fallbackOrder),
    links: links
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((link, index) => ({ ...link, order: index }))
  };
}

function normalizeGroupParentReferences(
  groups: AuraStartGroup[],
  rawIdMap: Map<string, string>
): AuraStartGroup[] {
  const resolved = groups.map((group) => ({
    ...group,
    parentId: group.parentId ? rawIdMap.get(group.parentId) ?? group.parentId : null
  }));
  const groupsById = new Map(resolved.map((group) => [group.id, group]));

  return resolved.map((group) => {
    const parent = group.parentId ? groupsById.get(group.parentId) : undefined;
    return {
      ...group,
      parentId: parent && parent.id !== group.id && parent.parentId === null ? parent.id : null
    };
  });
}

function normalizeCoreData(value: unknown): AuraStartDataWithoutRestorePoints {
  if (!isRecord(value)) {
    throw new Error("Backup root must be an object.");
  }

  if (value.version !== DATA_VERSION) {
    throw new Error("This backup version is not supported by this version of Aura Start.");
  }

  const groupIds = new Set<string>();
  const rawGroupIdMap = new Map<string, string>();
  const groups = Array.isArray(value.groups)
    ? value.groups.map((group, index) => normalizeGroup(group, index, groupIds, rawGroupIdMap))
    : [];
  const orderedGroups = normalizeGroupParentReferences(groups, rawGroupIdMap)
    .slice()
    .sort((a, b) => a.order - b.order);
  const normalizedSettings = normalizeSharedSettings(value.settings, value.settingsCompatibility);

  return {
    version: DATA_VERSION,
    updatedAt: normalizeIso(value.updatedAt),
    settings: normalizeSettings(value.settings, normalizedSettings.settings),
    settingsCompatibility: normalizedSettings.settingsCompatibility,
    groups: groupsInTreeOrder(normalizeGroupOrders(orderedGroups))
  };
}

function normalizeReason(value: unknown): AuraRestorePointReason {
  if (
    value === "manual" ||
    value === "before_bulk_delete" ||
    value === "before_cloud_restore" ||
    value === "before_demo_remove" ||
    value === "before_delete" ||
    value === "before_duplicate_delete" ||
    value === "before_group_delete" ||
    value === "before_group_move" ||
    value === "before_group_reorder" ||
    value === "before_import" ||
    value === "before_link_delete" ||
    value === "before_link_move" ||
    value === "before_tabs_save" ||
    value === "before_reset" ||
    value === "before_restore" ||
    value === "auto"
  ) {
    return value;
  }

  return "manual";
}

function normalizeRestorePointEntity(value: unknown): AuraRestorePointEntity | undefined {
  if (
    value === "data" ||
    value === "demo" ||
    value === "group" ||
    value === "groups" ||
    value === "import" ||
    value === "link" ||
    value === "links" ||
    value === "settings" ||
    value === "sync" ||
    value === "tabs"
  ) {
    return value;
  }

  return undefined;
}

function normalizeRestorePointContext(value: unknown): AuraRestorePointContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const context: AuraRestorePointContext = {
    entity: normalizeRestorePointEntity(value.entity),
    title: optionalTrimmedString(value.title),
    groupTitle: optionalTrimmedString(value.groupTitle),
    count: typeof value.count === "number" && Number.isFinite(value.count) && value.count > 0 ? Math.floor(value.count) : undefined,
    source: optionalTrimmedString(value.source),
    from: optionalTrimmedString(value.from),
    to: optionalTrimmedString(value.to),
    description: optionalTrimmedString(value.description)
  };

  return Object.values(context).some((item) => item !== undefined) ? context : undefined;
}

function normalizeRestorePoint(value: unknown): AuraRestorePoint | undefined {
  if (!isRecord(value) || !("data" in value)) {
    return undefined;
  }

  try {
    return {
      id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : createId("restore"),
      name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Imported restore point",
      createdAt: normalizeIso(value.createdAt),
      reason: normalizeReason(value.reason),
      context: normalizeRestorePointContext(value.context),
      data: normalizeCoreData(value.data)
    };
  } catch {
    return undefined;
  }
}

export function validateAuraData(value: unknown): AuraStartData {
  const core = normalizeCoreData(value);
  const syncReplica = isRecord(value) ? normalizeSyncReplica(value.syncReplica, core) : undefined;
  if (isRecord(value) && value.syncReplica !== undefined && !syncReplica) {
    throw new Error("Sync replica metadata is invalid. Export the original data before resetting it.");
  }
  if (syncReplica) {
    const projected = projectSharedSettings(core);
    const defaulted = new Set(core.settingsCompatibility!.defaulted);
    let hydratedMissing = false;
    for (const [path, register] of Object.entries(syncReplica.settings)) {
      const defaultRegister = register.stamp.counter === 0 && register.stamp.deviceId === "settings-default";
      // History can know a preference which is absent from an older/partial
      // settings document. Recover it before UI rendering, not on a later poll.
      // Existing non-defaulted UI values remain local edit candidates.
      if (!Object.hasOwn(projected, path) || (defaulted.has(path) && !defaultRegister)) {
        projected[path] = register.value;
        if (defaultRegister) defaulted.add(path);
        else defaulted.delete(path);
        hydratedMissing = true;
      }
    }
    if (hydratedMissing) Object.assign(core, materializeSharedSettings(core, projected, [...defaulted]));
  }
  if (syncReplica && isRecord(value) && value.settingsCompatibility === undefined) {
    // Older forward-compatible files may carry a future enum only in causal
    // history. Hydrate its opaque value without applying stale history over a
    // caller's ordinary UI edits. Explicit metadata can intentionally clear it.
    const fromHistory = materializeSharedSettings(core,
      Object.fromEntries(Object.entries(syncReplica.settings).map(([path, register]) => [path, register.value])),
      Object.entries(syncReplica.settings).filter(([, register]) => register.stamp.counter === 0
        && register.stamp.deviceId === "settings-default").map(([path]) => path));
    const hydrated = normalizeSharedSettings(core.settings, {
      version: 1,
      defaulted: [...new Set([...core.settingsCompatibility!.defaulted, ...fromHistory.settingsCompatibility.defaulted])],
      preserved: { ...fromHistory.settingsCompatibility.preserved, ...core.settingsCompatibility!.preserved }
    });
    core.settingsCompatibility = hydrated.settingsCompatibility;
  }
  const restorePoints =
    isRecord(value) && Array.isArray(value.restorePoints)
      ? value.restorePoints
          .map(normalizeRestorePoint)
          .filter((point): point is AuraRestorePoint => point !== undefined)
          .slice(0, MAX_RESTORE_POINTS)
      : [];

  const data: AuraStartData = {
    ...core,
    ...(syncReplica ? { syncReplica } : {}),
    restorePoints
  };
  // Capture absence before normalized defaults are durably written. Future
  // reads and cloud merges can then distinguish migration from user intent.
  return { ...data, syncReplica: syncReplica ?? ensureSyncReplica(data) };
}

export function parseJsonBackup(text: string): AuraStartData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  const data = validateAuraData(parsed);
  registerBackgroundImageBackup(data, isRecord(parsed) ? parsed.backgroundImages : undefined);
  registerTimerSoundBackup(data, isRecord(parsed) ? parsed.timerSounds : undefined);
  return data;
}

export function mergeImportedData(current: AuraStartData, imported: AuraStartData): AuraStartData {
  const now = nowIso();
  const existingGroupIds = new Set(current.groups.map((group) => group.id));
  const existingLinkIds = new Set(current.groups.flatMap((group) => group.links.map((link) => link.id)));
  const importedGroupIdMap = new Map<string, string>();
  const appendedGroups = imported.groups.map((group, groupIndex) => {
    const groupId = existingGroupIds.has(group.id) ? createId("group") : group.id;
    existingGroupIds.add(groupId);
    importedGroupIdMap.set(group.id, groupId);

    return {
      ...group,
      id: groupId,
      order: current.groups.length + groupIndex,
      links: group.links.map((link, linkIndex) => {
        const linkId = existingLinkIds.has(link.id) ? createId("link") : link.id;
        existingLinkIds.add(linkId);
        return {
          ...link,
          id: linkId,
          order: linkIndex
        };
      })
    };
  });
  const appendedGroupsWithParents = appendedGroups.map((group) => ({
    ...group,
    parentId: group.parentId ? importedGroupIdMap.get(group.parentId) ?? null : null
  }));

  return {
    ...current,
    updatedAt: now,
    groups: groupsInTreeOrder(normalizeGroupOrders([...current.groups, ...appendedGroupsWithParents]))
  };
}
