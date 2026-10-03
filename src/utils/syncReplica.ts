import type {
  AuraStartData,
  AuraStartGroup,
  AuraSyncEntity,
  AuraSyncRegister,
  AuraSyncReplica,
  AuraSyncStamp,
  AuraSyncValue
} from "../types";
import { normalizeUrl } from "./validators";
import {
  isSettingWireValue, materializeSharedSettings,
  normalizeSharedSettings, projectSharedSettings
} from "./settingsSchema";

// Keep one representable increment available; a corrupt clock must never wrap.
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;
const LEGACY_STAMP: AuraSyncStamp = { counter: 0, deviceId: "legacy" };
// Auto-filled defaults are older than every explicit legacy choice, including
// false, zero and a choice that happens to equal the current default.
const DEFAULT_SETTING_STAMP: AuraSyncStamp = { counter: 0, deviceId: "settings-default" };
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const GROUP_FIELDS = ["title", "parentId", "collapsed", "order"] as const;
const LINK_FIELDS = ["title", "url", "description", "tags", "order", "createdAt", "updatedAt", "groupId"] as const;

type Fields = Record<string, AuraSyncValue>;
type Projection = {
  groups: Record<string, Fields>;
  links: Record<string, Fields>;
  settings: Fields;
};
type ValueValidator = (key: string, value: unknown) => value is AuraSyncValue;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function record<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length
    && ownKeys.every((key) => keys.includes(key))
    && ownKeys.every((key) => Object.getOwnPropertyDescriptor(value, key)?.get === undefined);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024
    && value.trim() === value && !UNSAFE_KEYS.has(value);
}

function validCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNTER;
}

function copyStamp(value: unknown): AuraSyncStamp | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["counter", "deviceId"])) return undefined;
  if (!validCounter(value.counter) || !validId(value.deviceId)) return undefined;
  return { counter: value.counter, deviceId: value.deviceId };
}

function finiteBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

function validIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function validGroupValue(key: string, value: unknown): value is AuraSyncValue {
  if (key === "title") return validTitle(value);
  if (key === "parentId") return value === null || validId(value);
  if (key === "collapsed") return typeof value === "boolean";
  return key === "order" && finiteBetween(value, 0, Number.MAX_SAFE_INTEGER) && Number.isInteger(value);
}

function validLinkValue(key: string, value: unknown): value is AuraSyncValue {
  if (key === "title") return validTitle(value);
  if (key === "url") {
    if (typeof value !== "string") return false;
    const normalized = normalizeUrl(value);
    return normalized.ok && normalized.url === value;
  }
  if (key === "description") return value === null || (typeof value === "string" && value === value.trim());
  if (key === "tags") {
    return value === null || (Array.isArray(value) && value.length > 0
      && value.every((tag) => validTitle(tag)) && new Set(value).size === value.length);
  }
  if (key === "createdAt" || key === "updatedAt") return validIso(value);
  if (key === "groupId") return validId(value);
  return key === "order" && finiteBetween(value, 0, Number.MAX_SAFE_INTEGER) && Number.isInteger(value);
}

function copyValue(value: AuraSyncValue): AuraSyncValue {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
  return value;
}

function copyRegister(value: unknown, key: string, validate: ValueValidator): AuraSyncRegister | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stamp", "value"])) return undefined;
  const stamp = copyStamp(value.stamp);
  return stamp && validate(key, value.value) ? { stamp, value: copyValue(value.value) } : undefined;
}

function copyFields(value: unknown, keys: readonly string[], validate: ValueValidator): Record<string, AuraSyncRegister> | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return undefined;
  const fields = record<AuraSyncRegister>();
  for (const key of keys) {
    const register = copyRegister(value[key], key, validate);
    if (!register) return undefined;
    fields[key] = register;
  }
  return fields;
}

function copySettings(
  value: unknown, fallback?: Pick<AuraStartData, "settings" | "settingsCompatibility">
): Record<string, AuraSyncRegister> | undefined {
  if (!isRecord(value) || Object.keys(value).length > 512) return undefined;
  const fields = record<AuraSyncRegister>();
  for (const key of Object.keys(value)) {
    if (Object.getOwnPropertyDescriptor(value, key)?.get !== undefined) return undefined;
    const register = copyRegister(value[key], key, isSettingWireValue);
    if (!register) return undefined;
    fields[key] = register;
  }
  const source = fallback ?? normalizeSharedSettings(undefined);
  const projected = projectSharedSettings(source);
  const defaulted = new Set(normalizeSharedSettings(source.settings, source.settingsCompatibility).settingsCompatibility.defaulted);
  // Backfill every additive setting at clock zero. A value explicitly present
  // in a legacy snapshot is meaningful even if its register was not yet known.
  for (const [key, item] of Object.entries(projected)) {
    if (fields[key]) continue;
    fields[key] = { stamp: { ...(defaulted.has(key) ? DEFAULT_SETTING_STAMP : LEGACY_STAMP) }, value: copyValue(item) };
  }
  if (Object.keys(fields).length > 512) return undefined;
  return fields;
}

function copyEntities(value: unknown, fields: readonly string[], validate: ValueValidator): Record<string, AuraSyncEntity> | undefined {
  if (!isRecord(value)) return undefined;
  const entities = record<AuraSyncEntity>();
  for (const id of Object.keys(value).sort(compareText)) {
    if (!validId(id) || Object.getOwnPropertyDescriptor(value, id)?.get !== undefined) return undefined;
    const entity = value[id];
    if (!isRecord(entity) || !hasOnlyKeys(entity, ["presence", "fields"])) return undefined;
    const presence = copyRegister(entity.presence, "presence", (_key, item): item is boolean => typeof item === "boolean");
    const copiedFields = copyFields(entity.fields, fields, validate);
    if (!presence || !copiedFields) return undefined;
    entities[id] = { presence: { stamp: presence.stamp, value: presence.value as boolean }, fields: copiedFields };
  }
  return entities;
}

/** Validate the entire causal state. Never drop malformed entries or tombstones. */
export function normalizeSyncReplica(
  value: unknown, fallback?: Pick<AuraStartData, "settings" | "settingsCompatibility">
): AuraSyncReplica | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "clock", "groups", "links", "settings"])) return undefined;
  if (value.version !== 1 || !validCounter(value.clock)) return undefined;
  const groups = copyEntities(value.groups, GROUP_FIELDS, validGroupValue);
  const links = copyEntities(value.links, LINK_FIELDS, validLinkValue);
  const settings = copySettings(value.settings, fallback);
  if (!groups || !links || !settings) return undefined;
  const stamps = [
    ...Object.values(settings).map((field) => field.stamp),
    ...[...Object.values(groups), ...Object.values(links)]
      .flatMap((entity) => [entity.presence.stamp, ...Object.values(entity.fields).map((field) => field.stamp)])
  ];
  if (stamps.some((stamp) => stamp.counter > (value.clock as number))) return undefined;
  // A deleted group's fields stay available for deterministic orphan recovery.
  if (Object.values(links).some((link) => !Object.hasOwn(groups, link.fields.groupId.value as string))) return undefined;
  return { version: 1, clock: value.clock, groups, links, settings };
}

function project(data: AuraStartData): Projection {
  const groups = record<Fields>();
  const links = record<Fields>();
  for (const group of data.groups.slice().sort((a, b) => compareText(a.id, b.id))) {
    if (!validId(group.id)) throw new Error("Invalid group ID in sync data.");
    groups[group.id] = { title: group.title, parentId: group.parentId, collapsed: group.collapsed, order: group.order };
    for (const link of group.links) {
      if (!validId(link.id)) throw new Error("Invalid link ID in sync data.");
      // Older imports permitted the same link ID in different groups. Give
      // secondary occurrences a reproducible identity instead of losing them.
      let id = link.id;
      let suffix = 0;
      while (Object.hasOwn(links, id)) {
        id = `${link.id}~${group.id}~${++suffix}`;
      }
      if (!validId(id)) throw new Error("Duplicate link IDs are too long to synchronize.");
      links[id] = {
        title: link.title,
        url: link.url,
        description: link.description ?? null,
        tags: link.tags?.length ? link.tags.slice() : null,
        order: link.order,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        groupId: group.id
      };
    }
  }
  return { groups, links, settings: projectSharedSettings(data) };
}

function seedFields(fields: Fields): Record<string, AuraSyncRegister> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, {
    stamp: { ...LEGACY_STAMP }, value: copyValue(value)
  }]));
}

function seedEntity(fields: Fields): AuraSyncEntity {
  return { presence: { stamp: { ...LEGACY_STAMP }, value: true }, fields: seedFields(fields) };
}

/** Legacy snapshots always start below real edits, regardless of device time. */
export function ensureSyncReplica(data: AuraStartData): AuraSyncReplica {
  if (data.syncReplica !== undefined) {
    const existing = normalizeSyncReplica(data.syncReplica, data);
    if (!existing) throw new Error("Invalid Aura Start sync history.");
    return existing;
  }
  const projection = project(data);
  const defaulted = new Set(normalizeSharedSettings(data.settings, data.settingsCompatibility).settingsCompatibility.defaulted);
  return {
    version: 1,
    clock: 0,
    groups: Object.fromEntries(Object.entries(projection.groups).map(([id, fields]) => [id, seedEntity(fields)])),
    links: Object.fromEntries(Object.entries(projection.links).map(([id, fields]) => [id, seedEntity(fields)])),
    settings: Object.fromEntries(Object.entries(projection.settings).map(([key, value]) => [key, {
      stamp: { ...(defaulted.has(key) ? DEFAULT_SETTING_STAMP : LEGACY_STAMP) }, value: copyValue(value)
    }]))
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameValue(a: AuraSyncValue, b: AuraSyncValue): boolean {
  return stable(a) === stable(b);
}

function compareStamps(a: AuraSyncStamp, b: AuraSyncStamp): number {
  if (a.counter === 0 && b.counter === 0) {
    const aDefault = a.deviceId === DEFAULT_SETTING_STAMP.deviceId;
    const bDefault = b.deviceId === DEFAULT_SETTING_STAMP.deviceId;
    if (aDefault !== bDefault) return aDefault ? -1 : 1;
  }
  return a.counter - b.counter || compareText(a.deviceId, b.deviceId);
}

function mergeRegister(a: AuraSyncRegister, b: AuraSyncRegister, presence = false): AuraSyncRegister {
  const comparison = compareStamps(a.stamp, b.stamp);
  // Identical stamps normally imply identical values. A deterministic fallback
  // also handles legacy snapshots and duplicated installation identifiers.
  const winner = comparison > 0 ? a : comparison < 0 ? b
    : presence && a.value !== b.value ? (a.value === false ? a : b)
      : compareText(stable(a.value), stable(b.value)) >= 0 ? a : b;
  return { stamp: { ...winner.stamp }, value: copyValue(winner.value) };
}

function mergeEntities(a: Record<string, AuraSyncEntity>, b: Record<string, AuraSyncEntity>): Record<string, AuraSyncEntity> {
  const merged = record<AuraSyncEntity>();
  for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareText)) {
    const left = a[id];
    const right = b[id];
    if (!left || !right) {
      const entity = left ?? right;
      merged[id] = {
        presence: { stamp: { ...entity.presence.stamp }, value: entity.presence.value },
        fields: Object.fromEntries(Object.entries(entity.fields).map(([key, field]) => [key, {
          stamp: { ...field.stamp }, value: copyValue(field.value)
        }]))
      };
      continue;
    }
    const presence = mergeRegister(left.presence, right.presence, true);
    merged[id] = {
      presence: { stamp: presence.stamp, value: presence.value as boolean },
      fields: Object.fromEntries(Object.keys(left.fields).map((key) => [key, mergeRegister(left.fields[key], right.fields[key])]))
    };
  }
  return merged;
}

function mergeReplicas(a: AuraSyncReplica, b: AuraSyncReplica): AuraSyncReplica {
  return {
    version: 1,
    clock: Math.max(a.clock, b.clock),
    groups: mergeEntities(a.groups, b.groups),
    links: mergeEntities(a.links, b.links),
    settings: Object.fromEntries([...new Set([...Object.keys(a.settings), ...Object.keys(b.settings)])].sort(compareText).map((key) => {
      const left = a.settings[key];
      const right = b.settings[key];
      const register = left && right ? mergeRegister(left, right) : left ?? right;
      return [key, { stamp: { ...register.stamp }, value: copyValue(register.value) }];
    }))
  };
}

function materialize(local: AuraStartData, replica: AuraSyncReplica): AuraStartData {
  const groups = new Map<string, AuraStartGroup>();
  const liveLinks = Object.entries(replica.links).filter(([, link]) => link.presence.value);
  const linkedGroupIds = new Set(liveLinks.map(([, link]) => link.fields.groupId.value as string));
  for (const [id, group] of Object.entries(replica.groups)) {
    // A concurrent new/moved link survives deletion of a group which had not
    // seen that link. Recover its original container without changing clocks.
    if (!group.presence.value && !linkedGroupIds.has(id)) continue;
    groups.set(id, {
      id,
      title: group.fields.title.value as string,
      parentId: group.presence.value ? group.fields.parentId.value as string | null : null,
      collapsed: group.fields.collapsed.value as boolean,
      order: group.fields.order.value as number,
      links: []
    });
  }
  // Only an existing live root can be a parent. Missing/deleted parents and
  // concurrent cycles/deeper nesting are repaired without mutating registers.
  const originalParents = new Map([...groups.values()].map((group) => [group.id, group.parentId]));
  for (const group of groups.values()) {
    const parent = group.parentId ? groups.get(group.parentId) : undefined;
    if (!parent || parent.id === group.id || originalParents.get(parent.id) !== null
      || !replica.groups[parent.id].presence.value) group.parentId = null;
  }
  for (const [id, entity] of liveLinks) {
    const fields = entity.fields;
    const group = groups.get(fields.groupId.value as string);
    if (!group) continue;
    group.links.push({
      id,
      title: fields.title.value as string,
      url: fields.url.value as string,
      description: fields.description.value === null ? undefined : fields.description.value as string,
      tags: fields.tags.value === null ? undefined : (fields.tags.value as string[]).slice(),
      order: fields.order.value as number,
      createdAt: fields.createdAt.value as string,
      updatedAt: fields.updatedAt.value as string
    });
  }
  const byOrder = (a: { order: number; id: string }, b: { order: number; id: string }) => a.order - b.order || compareText(a.id, b.id);
  for (const group of groups.values()) {
    group.links = group.links.sort(byOrder).map((link, order) => ({ ...link, order }));
  }
  const roots = [...groups.values()].filter((group) => group.parentId === null).sort(byOrder);
  const orderedGroups = roots.flatMap((root, order) => [
    { ...root, order },
    ...[...groups.values()].filter((group) => group.parentId === root.id).sort(byOrder).map((child, childOrder) => ({ ...child, order: childOrder }))
  ]);
  const settings = materializeSharedSettings(local,
    Object.fromEntries(Object.entries(replica.settings).map(([key, register]) => [key, register.value])),
    Object.entries(replica.settings).filter(([, register]) => register.stamp.counter === 0
      && register.stamp.deviceId === DEFAULT_SETTING_STAMP.deviceId).map(([key]) => key)
  );
  return { ...local, ...settings, groups: orderedGroups, syncReplica: replica };
}

/** Merge remote causal history while retaining local permissions and metadata. */
export function mergeSyncData(local: AuraStartData, remote: AuraStartData): AuraStartData {
  return materialize(local, mergeReplicas(ensureSyncReplica(local), ensureSyncReplica(remote)));
}

function applyEntityChanges(
  entities: Record<string, AuraSyncEntity>, before: Record<string, Fields>, after: Record<string, Fields>, stamp: AuraSyncStamp
): boolean {
  let changed = false;
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[id];
    const next = after[id];
    if (!previous && next) {
      entities[id] = {
        presence: { stamp: { ...stamp }, value: true },
        fields: Object.fromEntries(Object.entries(next).map(([key, value]) => [key, {
          stamp: { ...stamp }, value: copyValue(value)
        }]))
      };
      // Creation is an intentional complete entity replacement (including
      // restoring a deleted entity), unlike editing a concurrently deleted one.
      changed = true;
    } else if (previous && !next) {
      const entity = entities[id] ?? seedEntity(previous);
      entities[id] = { ...entity, presence: { stamp: { ...stamp }, value: false } };
      changed = true;
    } else if (previous && next) {
      const entity = entities[id] ?? seedEntity(previous);
      for (const key of Object.keys(next)) {
        if (sameValue(previous[key], next[key])) continue;
        entity.fields[key] = { stamp: { ...stamp }, value: copyValue(next[key]) };
        entities[id] = entity;
        changed = true;
      }
    }
  }
  return changed;
}

/** Rebase only the user's baseline-to-next changes onto the latest local state. */
export function commitLocalSyncChanges(current: AuraStartData, next: AuraStartData, baseline = current): AuraStartData {
  const replica = ensureSyncReplica(current);
  const before = project(baseline);
  const after = project(next);
  const previousDefaults = new Set(normalizeSharedSettings(baseline.settings, baseline.settingsCompatibility).settingsCompatibility.defaulted);
  const nextDefaults = new Set(normalizeSharedSettings(next.settings, next.settingsCompatibility).settingsCompatibility.defaulted);
  const explicitDefaults = new Set([...previousDefaults].filter((path) => !nextDefaults.has(path)));
  if (stable(before) === stable(after) && explicitDefaults.size === 0) return materialize(current, replica);
  if (replica.clock >= MAX_COUNTER) throw new Error("Aura Start sync history counter is exhausted.");
  if (!validId(current.settings.sync.deviceId)) throw new Error("Aura Start sync requires a local device ID.");
  const stamp = { counter: replica.clock + 1, deviceId: current.settings.sync.deviceId };
  let changed = applyEntityChanges(replica.groups, before.groups, after.groups, stamp);
  changed = applyEntityChanges(replica.links, before.links, after.links, stamp) || changed;
  for (const key of Object.keys(after.settings)) {
    // An older page or snapshot may not know a new preference. Missing paths
    // are never deletions; an explicit null is the wire representation of one.
    if (sameValue(before.settings[key], after.settings[key]) && !explicitDefaults.has(key)) continue;
    if (nextDefaults.has(key)) continue;
    replica.settings[key] = { stamp: { ...stamp }, value: copyValue(after.settings[key]) };
    changed = true;
  }
  if (changed) replica.clock = stamp.counter;
  return materialize(current, replica);
}

/** Excludes root timestamps, Restore Points, OAuth state and local permissions. */
export function sameSyncContent(a: AuraStartData, b: AuraStartData): boolean {
  return stable(project(a)) === stable(project(b));
}

export function sameSyncReplica(a: AuraStartData, b: AuraStartData): boolean {
  return stable(ensureSyncReplica(a)) === stable(ensureSyncReplica(b));
}
