import { DATA_VERSION, DEFAULT_SETTINGS, MAX_RESTORE_POINTS } from "../constants";
import type {
  AuraColumns,
  AuraLanguage,
  AuraRestorePoint,
  AuraRestorePointReason,
  AuraStartData,
  AuraStartDataWithoutRestorePoints,
  AuraStartGroup,
  AuraStartLink,
  AuraStartSettings,
  AuraTheme
} from "../types";
import { isAuraLanguage } from "../i18n";
import { nowIso } from "./dates";
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

function normalizeIso(value: unknown, fallback = nowIso()): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
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

function normalizeSettings(value: unknown): AuraStartSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS;
  }

  return {
    theme: normalizeTheme(value.theme),
    language: normalizeLanguage(value.language),
    columns: normalizeColumns(value.columns),
    compactMode: asBoolean(value.compactMode, DEFAULT_SETTINGS.compactMode),
    openLinksInNewTab: false,
    showDescriptions: asBoolean(value.showDescriptions, DEFAULT_SETTINGS.showDescriptions),
    showSearch: asBoolean(value.showSearch, DEFAULT_SETTINGS.showSearch),
    autoRestorePoints: asBoolean(value.autoRestorePoints, DEFAULT_SETTINGS.autoRestorePoints)
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

function normalizeGroup(value: unknown, fallbackOrder: number, usedIds: Set<string>): AuraStartGroup {
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

  const linkIds = new Set<string>();
  const links = Array.isArray(value.links)
    ? value.links.map((link, index) => normalizeLink(link, index, linkIds))
    : [];

  return {
    id,
    title,
    collapsed: asBoolean(value.collapsed, false),
    order: asNumber(value.order, fallbackOrder),
    links: links
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((link, index) => ({ ...link, order: index }))
  };
}

function normalizeCoreData(value: unknown): AuraStartDataWithoutRestorePoints {
  if (!isRecord(value)) {
    throw new Error("Backup root must be an object.");
  }

  if (value.version !== DATA_VERSION) {
    throw new Error("This backup version is not supported by this version of Aura Start.");
  }

  const groupIds = new Set<string>();
  const groups = Array.isArray(value.groups)
    ? value.groups.map((group, index) => normalizeGroup(group, index, groupIds))
    : [];

  return {
    version: DATA_VERSION,
    updatedAt: normalizeIso(value.updatedAt),
    settings: normalizeSettings(value.settings),
    groups: groups
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((group, index) => ({ ...group, order: index }))
  };
}

function normalizeReason(value: unknown): AuraRestorePointReason {
  if (
    value === "manual" ||
    value === "before_import" ||
    value === "before_delete" ||
    value === "before_reset" ||
    value === "auto"
  ) {
    return value;
  }

  return "manual";
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
  const appendedGroups = imported.groups.map((group, groupIndex) => {
    const groupId = existingGroupIds.has(group.id) ? createId("group") : group.id;
    existingGroupIds.add(groupId);

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

  return {
    ...current,
    updatedAt: now,
    groups: [...current.groups, ...appendedGroups].map((group, index) => ({ ...group, order: index }))
  };
}
