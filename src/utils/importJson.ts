import { DATA_VERSION, DEFAULT_SETTINGS, MAX_RESTORE_POINTS } from "../constants";
import type {
  AuraBackgroundPosition,
  AuraBackgroundPreset,
  AuraColumns,
  AuraLanguage,
  AuraPomodoroSettings,
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
  AuraStartSettings,
  AuraTheme,
  AuraWidgetSettings
} from "../types";
import { isAuraLanguage } from "../i18n";
import { nowIso } from "./dates";
import { groupsInTreeOrder, normalizeGroupOrders } from "./groupTree";
import { createId } from "./ids";
import { normalizeUrl } from "./validators";

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

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
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

function normalizeTheme(value: unknown): AuraTheme {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_SETTINGS.theme;
}

function normalizeLanguage(value: unknown): AuraLanguage {
  return isAuraLanguage(value) ? value : DEFAULT_SETTINGS.language;
}

function normalizeColumns(value: unknown): AuraColumns {
  if (value === "auto" || value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6) {
    return value;
  }

  return DEFAULT_SETTINGS.columns;
}

function normalizeSyncMode(value: unknown): AuraSyncMode {
  if (value === "manual") return "auto";
  return value === "auto" || value === "off" ? value : "off";
}

function normalizeBackgroundPreset(value: unknown): AuraBackgroundPreset {
  return value === "none" || value === "aurora" || value === "dawn" || value === "forest" || value === "custom"
    ? value
    : DEFAULT_SETTINGS.background.preset;
}

function normalizeBackgroundPosition(value: unknown): AuraBackgroundPosition {
  return value === "center" || value === "top" || value === "bottom" || value === "left" || value === "right"
    ? value
    : DEFAULT_SETTINGS.background.position;
}

function normalizeBackgroundSettings(value: unknown): AuraStartSettings["background"] {
  const background = isRecord(value) ? value : {};
  return {
    preset: normalizeBackgroundPreset(background.preset),
    blur: clampNumber(background.blur, DEFAULT_SETTINGS.background.blur, 0, 18),
    dim: clampNumber(background.dim, DEFAULT_SETTINGS.background.dim, 0, 80),
    position: normalizeBackgroundPosition(background.position)
  };
}

function normalizeWidgetSettings(value: unknown): AuraWidgetSettings {
  const widgets = isRecord(value) ? value : {};
  return {
    clock: asBoolean(widgets.clock, DEFAULT_SETTINGS.widgets.clock),
    notes: asBoolean(widgets.notes, DEFAULT_SETTINGS.widgets.notes),
    pomodoro: asBoolean(widgets.pomodoro, DEFAULT_SETTINGS.widgets.pomodoro)
  };
}

function normalizePomodoroSettings(value: unknown): AuraPomodoroSettings {
  const pomodoro = isRecord(value) ? value : {};
  return {
    focusMinutes: Math.round(clampNumber(pomodoro.focusMinutes, DEFAULT_SETTINGS.pomodoro.focusMinutes, 5, 90)),
    breakMinutes: Math.round(clampNumber(pomodoro.breakMinutes, DEFAULT_SETTINGS.pomodoro.breakMinutes, 1, 30))
  };
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
    lastSyncedAt: normalizeOptionalIso(sync.lastSyncedAt),
    lastCloudUpdatedAt: normalizeOptionalIso(sync.lastCloudUpdatedAt),
    accountEmail: optionalTrimmedString(sync.accountEmail),
    accountName: optionalTrimmedString(sync.accountName),
    accountAvatarUrl: optionalTrimmedString(sync.accountAvatarUrl),
    cloudFileId: optionalTrimmedString(sync.cloudFileId),
    connected: mode !== "off" && asBoolean(sync.connected, false),
    deleteCloudFileOnDisconnect: asBoolean(sync.deleteCloudFileOnDisconnect, DEFAULT_SETTINGS.sync.deleteCloudFileOnDisconnect)
  };
}

function normalizeSettings(value: unknown): AuraStartSettings {
  if (!isRecord(value)) {
    return {
      ...DEFAULT_SETTINGS,
      sync: normalizeSyncSettings(undefined)
    };
  }

  return {
    theme: normalizeTheme(value.theme),
    language: normalizeLanguage(value.language),
    columns: normalizeColumns(value.columns),
    compactMode: asBoolean(value.compactMode, DEFAULT_SETTINGS.compactMode),
    openLinksInNewTab: asBoolean(value.openLinksInNewTab, DEFAULT_SETTINGS.openLinksInNewTab),
    showDescriptions: asBoolean(value.showDescriptions, DEFAULT_SETTINGS.showDescriptions),
    showSearch: asBoolean(value.showSearch, DEFAULT_SETTINGS.showSearch),
    showVersionInHeader: asBoolean(value.showVersionInHeader, DEFAULT_SETTINGS.showVersionInHeader),
    captureOpenTabs: asBoolean(value.captureOpenTabs, DEFAULT_SETTINGS.captureOpenTabs),
    background: normalizeBackgroundSettings(value.background),
    widgets: normalizeWidgetSettings(value.widgets),
    pomodoro: normalizePomodoroSettings(value.pomodoro),
    autoRestorePoints: asBoolean(value.autoRestorePoints, DEFAULT_SETTINGS.autoRestorePoints),
    sync: normalizeSyncSettings(value.sync)
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

  return {
    version: DATA_VERSION,
    updatedAt: normalizeIso(value.updatedAt),
    settings: normalizeSettings(value.settings),
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
  const restorePoints =
    isRecord(value) && Array.isArray(value.restorePoints)
      ? value.restorePoints
          .map(normalizeRestorePoint)
          .filter((point): point is AuraRestorePoint => point !== undefined)
          .slice(0, MAX_RESTORE_POINTS)
      : [];

  return {
    ...core,
    restorePoints
  };
}

export function parseJsonBackup(text: string): AuraStartData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  return validateAuraData(parsed);
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
