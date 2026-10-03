import { DEFAULT_SETTINGS, MAX_WIDGET_NOTES_CHARS } from "../constants";
import type { AuraSettingsCompatibility, AuraStartData, AuraStartSettings, AuraSyncValue } from "../types";
import { isBackgroundImageId } from "./backgroundImageStorage";
import { isTimerSoundId } from "./timerSoundStorage";

type SharedSettings = Omit<AuraStartSettings, "sync"> & {
  sync: Pick<AuraStartSettings["sync"], "deleteCloudFileOnDisconnect">;
};
type LeafPaths<T> = { [K in keyof T & string]-?: NonNullable<T[K]> extends readonly unknown[] ? K
  : NonNullable<T[K]> extends object ? `${K}.${LeafPaths<NonNullable<T[K]>>}` : K }[keyof T & string];
export type SharedSettingPath = LeafPaths<SharedSettings>;
type PathValue<T, P extends string> = P extends `${infer K}.${infer R}`
  ? K extends keyof T ? PathValue<NonNullable<T[K]>, R> : never
  : P extends keyof T ? Exclude<T[P], undefined> : never;
type SettingDefinition<T = AuraSyncValue> = {
  defaultValue: T;
  normalize: (value: unknown) => T;
  acceptsWire: (value: unknown) => boolean;
  optional?: boolean;
};

function boolean(defaultValue: boolean): SettingDefinition<boolean> {
  return { defaultValue, normalize: (value) => typeof value === "boolean" ? value : defaultValue,
    acceptsWire: (value) => typeof value === "boolean" };
}

function number(defaultValue: number, min: number, max: number, integer = false): SettingDefinition<number> {
  return {
    defaultValue,
    normalize: (value) => {
      const result = Math.min(max, Math.max(min, typeof value === "number" && Number.isFinite(value) ? value : defaultValue));
      return integer ? Math.round(result) : result;
    },
    acceptsWire: (value) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
      && (!integer || Number.isInteger(value))
  };
}

function enumeration<T extends string>(defaultValue: T, values: readonly T[]): SettingDefinition<T> {
  return { defaultValue,
    normalize: (value) => values.includes(value as T) ? value as T : defaultValue,
    // A future release can add an enum option. Retain its wire value while this
    // release renders its supported fallback, without creating a user edit.
    acceptsWire: (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value
  };
}

/** Every shared leaf in AuraStartSettings must be registered here. */
export const SETTING_SCHEMA = {
  theme: enumeration(DEFAULT_SETTINGS.theme, ["system", "light", "dark"]),
  language: enumeration(DEFAULT_SETTINGS.language, ["en", "ru", "es", "de", "fr", "pt", "uk"]),
  columns: {
    defaultValue: DEFAULT_SETTINGS.columns,
    normalize: (value: unknown) => value === "auto" || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6)
      ? value as AuraStartSettings["columns"] : DEFAULT_SETTINGS.columns,
    acceptsWire: (value: unknown) => (typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value)
      || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6)
  },
  compactMode: boolean(DEFAULT_SETTINGS.compactMode),
  openLinksInNewTab: boolean(DEFAULT_SETTINGS.openLinksInNewTab),
  showDescriptions: boolean(DEFAULT_SETTINGS.showDescriptions),
  showSearch: boolean(DEFAULT_SETTINGS.showSearch),
  showVersionInHeader: boolean(DEFAULT_SETTINGS.showVersionInHeader),
  captureOpenTabs: boolean(DEFAULT_SETTINGS.captureOpenTabs),
  "sync.deleteCloudFileOnDisconnect": boolean(DEFAULT_SETTINGS.sync.deleteCloudFileOnDisconnect),
  autoRestorePoints: boolean(DEFAULT_SETTINGS.autoRestorePoints),
  "background.preset": enumeration(DEFAULT_SETTINGS.background.preset, ["none", "aurora", "dawn", "forest", "custom"]),
  "background.blur": number(DEFAULT_SETTINGS.background.blur, 0, 18),
  "background.dim": number(DEFAULT_SETTINGS.background.dim, 0, 80),
  "background.position": enumeration(DEFAULT_SETTINGS.background.position, ["center", "top", "bottom", "left", "right"]),
  "background.customImageId": {
    defaultValue: null,
    normalize: (value: unknown): string | null => {
      if (value === undefined || value === null) return null;
      if (!isBackgroundImageId(value)) throw new Error("Custom background image reference is invalid.");
      return value;
    },
    acceptsWire: (value: unknown) => value === null || isBackgroundImageId(value),
    optional: true
  },
  "widgets.clock": boolean(DEFAULT_SETTINGS.widgets.clock),
  "widgets.notes": boolean(DEFAULT_SETTINGS.widgets.notes),
  "widgets.pomodoro": boolean(DEFAULT_SETTINGS.widgets.pomodoro),
  "widgets.timer": boolean(DEFAULT_SETTINGS.widgets.timer),
  "notes.text": {
    defaultValue: DEFAULT_SETTINGS.notes.text,
    normalize: (value: unknown): string => typeof value === "string" ? value.slice(0, MAX_WIDGET_NOTES_CHARS) : DEFAULT_SETTINGS.notes.text,
    acceptsWire: (value: unknown) => typeof value === "string" && value.length <= MAX_WIDGET_NOTES_CHARS
  },
  "timer.durationSeconds": number(DEFAULT_SETTINGS.timer.durationSeconds, 1, 86400, true),
  "timer.volume": number(DEFAULT_SETTINGS.timer.volume, 0, 100, true),
  "timer.customSoundId": {
    defaultValue: null,
    normalize: (value: unknown): string | null => {
      if (value === undefined || value === null) return null;
      if (!isTimerSoundId(value)) throw new Error("Custom timer sound reference is invalid.");
      return value;
    },
    acceptsWire: (value: unknown) => value === null || isTimerSoundId(value)
  },
  "pomodoro.focusMinutes": number(DEFAULT_SETTINGS.pomodoro.focusMinutes, 5, 90, true),
  "pomodoro.breakMinutes": number(DEFAULT_SETTINGS.pomodoro.breakMinutes, 1, 30, true)
} satisfies { [P in SharedSettingPath]: SettingDefinition<PathValue<SharedSettings, P>> };

export const SHARED_SETTING_PATHS = Object.keys(SETTING_SCHEMA) as SharedSettingPath[];
const DEFINITIONS: Record<string, SettingDefinition> = Object.assign(Object.create(null), SETTING_SCHEMA);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
// Unknown future preferences may travel through older releases. Device-local
// capabilities and authentication never become shared merely by being unknown.
const PRIVATE_SEGMENTS = new Set([
  "sync", "captureopentabs", "auth", "oauth", "tokens", "credentials", "private", "local",
  "deviceid", "connectionid", "accountemail", "accountname", "accountavatarurl", "cloudfileid",
  "accesstoken", "refreshtoken", "clientsecret"
]);
const MAX_DEPTH = 12;
const MAX_NODES = 4096;
const MAX_STRING_LENGTH = 65536;
const MAX_PATHS = 512;

function record<T>(): Record<string, T> { return Object.create(null) as Record<string, T>; }

export function isPlainSettingsObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor?.get || descriptor?.set) throw new Error("Settings must not contain accessors.");
  return descriptor?.value;
}

export function isSharedSettingPath(path: string): boolean {
  // Only explicitly registered preferences may cross a normally private scope.
  // In particular, no other sync/auth fields become opaque future settings.
  if (Object.hasOwn(DEFINITIONS, path)) return true;
  const parts = path.split(".");
  return path.length <= 256 && parts.length <= MAX_DEPTH && parts.every((part) =>
    part.length > 0 && !/[\u0000-\u001f]/.test(part) && !UNSAFE_KEYS.has(part) && !PRIVATE_SEGMENTS.has(part.toLowerCase()));
}

/** Bounded plain JSON only: no accessors, cycles, prototype keys or functions. */
export function copySettingsValue(value: unknown): AuraSyncValue {
  let nodes = 0;
  const seen = new Set<object>();
  const copy = (item: unknown, depth: number): AuraSyncValue => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error("Settings value exceeds compatibility limits.");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item === "string" && item.length <= MAX_STRING_LENGTH) return item;
    if (typeof item !== "object" || item === null || seen.has(item)) throw new Error("Settings must contain safe JSON values.");
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > MAX_NODES) throw new Error("Settings array exceeds compatibility limits.");
        return Array.from({ length: item.length }, (_, index) => copy(ownValue(item as unknown as Record<string, unknown>, String(index)), depth + 1));
      }
      if (!isPlainSettingsObject(item)) throw new Error("Settings must contain plain objects.");
      const result = record<AuraSyncValue>();
      for (const key of Object.keys(item)) {
        if (UNSAFE_KEYS.has(key) || PRIVATE_SEGMENTS.has(key.toLowerCase()) || key.length > 256) throw new Error("Unsafe settings key.");
        result[key] = copy(ownValue(item, key), depth + 1);
      }
      return result;
    } finally { seen.delete(item); }
  };
  return copy(value, 0);
}

export function isSettingWireValue(path: string, value: unknown): value is AuraSyncValue {
  if (!isSharedSettingPath(path)) return false;
  if (!DEFINITIONS[path] && SHARED_SETTING_PATHS.some((known) => known.startsWith(`${path}.`) || path.startsWith(`${known}.`))) return false;
  try {
    copySettingsValue(value);
    return !DEFINITIONS[path] || DEFINITIONS[path].acceptsWire(value);
  } catch { return false; }
}

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function getPath(value: unknown, path: string): { present: boolean; value: unknown } {
  let current = value;
  for (const key of path.split(".")) {
    if (!isPlainSettingsObject(current) || !Object.hasOwn(current, key)) return { present: false, value: undefined };
    current = ownValue(current, key);
  }
  return { present: current !== undefined, value: current };
}

function setPath(target: Record<string, unknown>, path: string, value: AuraSyncValue): void {
  const parts = path.split(".");
  let current = target;
  for (const key of parts.slice(0, -1)) {
    if (!isPlainSettingsObject(current[key])) current[key] = record<unknown>();
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = copySettingsValue(value);
}

/** Flatten unknown nested preferences as independent leaves, just like known ones. */
function flatten(value: unknown): Record<string, AuraSyncValue> {
  const result = record<AuraSyncValue>();
  let count = 0;
  const ancestors = new Set<object>();
  const visit = (object: Record<string, unknown>, prefix = "") => {
    if (ancestors.has(object)) throw new Error("Settings must not contain cycles.");
    ancestors.add(object);
    try {
    for (const key of Object.keys(object)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!isSharedSettingPath(path)) {
        if (PRIVATE_SEGMENTS.has(key.toLowerCase())) continue;
        throw new Error("Unsafe or unsupported settings path.");
      }
      if (key.includes(".")) throw new Error("Settings keys must not contain path separators.");
      if (++count > MAX_NODES) throw new Error("Settings exceed compatibility limits.");
      const value = ownValue(object, key);
      if (value === undefined) continue;
      // Known leaves are normalized separately; wrong legacy types remain a
      // local normalization concern, never an opaque shared object.
      if (DEFINITIONS[path]) continue;
      const isKnownContainer = SHARED_SETTING_PATHS.some((known) => known.startsWith(`${path}.`));
      if (isPlainSettingsObject(value) && (Object.keys(value).length > 0 || isKnownContainer)) visit(value, path);
      else if (!isKnownContainer) result[path] = copySettingsValue(value);
      if (Object.keys(result).length > MAX_PATHS) throw new Error("Too many settings paths.");
    }
    } finally { ancestors.delete(object); }
  };
  if (isPlainSettingsObject(value)) visit(value);
  return result;
}

function normalizeCompatibility(value: unknown): AuraSettingsCompatibility {
  if (value === undefined) return { version: 1, defaulted: [], preserved: record<AuraSyncValue>() };
  if (!isPlainSettingsObject(value) || ownValue(value, "version") !== 1) throw new Error("Settings compatibility metadata is invalid.");
  const defaults = ownValue(value, "defaulted");
  const preserved = ownValue(value, "preserved");
  if (!Array.isArray(defaults) || defaults.length > MAX_PATHS || !isPlainSettingsObject(preserved)
    || Object.keys(preserved).length > MAX_PATHS) throw new Error("Settings compatibility metadata is invalid.");
  const defaulted: string[] = [];
  for (let index = 0; index < defaults.length; index++) {
    const path = ownValue(defaults as unknown as Record<string, unknown>, String(index));
    if (typeof path !== "string" || !isSharedSettingPath(path)) throw new Error("Settings compatibility path is invalid.");
    defaulted.push(path);
  }
  const copied = record<AuraSyncValue>();
  for (const path of Object.keys(preserved)) {
    const item = ownValue(preserved, path);
    if (!isSettingWireValue(path, item)) throw new Error("Preserved settings value is invalid.");
    copied[path] = copySettingsValue(item);
  }
  return { version: 1, defaulted: [...new Set(defaulted)].sort(), preserved: copied };
}

export type NormalizedSharedSettings = {
  settings: AuraStartSettings;
  settingsCompatibility: AuraSettingsCompatibility;
};

/** Complete current UI settings, retaining provenance and unsupported wire values. */
export function normalizeSharedSettings(value: unknown, compatibility?: unknown): NormalizedSharedSettings {
  const previous = normalizeCompatibility(compatibility);
  const values = flatten(value);
  const defaulted = new Set(previous.defaulted.filter((path) => !DEFINITIONS[path]));
  const preserved = record<AuraSyncValue>();
  for (const path of SHARED_SETTING_PATHS) {
    const definition: SettingDefinition = DEFINITIONS[path];
    const actual = getPath(value, path);
    let raw = actual.value;
    const retained = previous.preserved[path];
    if (retained !== undefined && (!actual.present || same(actual.value, definition.normalize(retained))
      || same(actual.value, definition.defaultValue))) raw = retained;
    const normalized = definition.normalize(raw);
    const wire = definition.acceptsWire(raw) ? copySettingsValue(raw) : normalized;
    const isDefault = !actual.present && retained === undefined
      || (previous.defaulted.includes(path) && same(wire, definition.defaultValue));
    if (isDefault) defaulted.add(path);
    if (!same(wire, normalized)) preserved[path] = wire;
    if (!definition.optional || actual.present || retained !== undefined) values[path] = normalized;
  }
  // A future release may have needed an opaque representation for an unknown
  // field. Do not discard it just because this release has no UI for it.
  for (const [path, retained] of Object.entries(previous.preserved)) {
    if (!DEFINITIONS[path]) {
      if (!Object.hasOwn(values, path)) values[path] = copySettingsValue(retained);
      preserved[path] = copySettingsValue(retained);
    }
  }
  const settings = record<unknown>();
  if (new Set([...Object.keys(values), ...SHARED_SETTING_PATHS]).size > MAX_PATHS) {
    throw new Error("Too many settings paths.");
  }
  for (const [path, item] of Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) setPath(settings, path, item);
  return {
    settings: settings as AuraStartSettings,
    settingsCompatibility: { version: 1, defaulted: [...defaulted].sort(), preserved }
  };
}

/** Shared values as stored, including future values hidden by a UI fallback. */
export function projectSharedSettings(data: Pick<AuraStartData, "settings" | "settingsCompatibility">): Record<string, AuraSyncValue> {
  const normalized = normalizeSharedSettings(data.settings, data.settingsCompatibility);
  const values = flatten(normalized.settings);
  for (const path of SHARED_SETTING_PATHS) {
    const actual = getPath(normalized.settings, path);
    values[path] = normalized.settingsCompatibility.preserved[path]
      ?? (actual.present ? copySettingsValue(actual.value) : copySettingsValue(DEFINITIONS[path].defaultValue));
  }
  return values;
}

export function isDefaultedSetting(data: Pick<AuraStartData, "settings" | "settingsCompatibility">, path: string): boolean {
  return normalizeSharedSettings(data.settings, data.settingsCompatibility).settingsCompatibility.defaulted.includes(path);
}

export function materializeSharedSettings(
  local: Pick<AuraStartData, "settings" | "settingsCompatibility">,
  values: Record<string, AuraSyncValue>,
  defaultedPaths: string[]
): NormalizedSharedSettings {
  const raw = record<unknown>();
  for (const [path, value] of Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!isSettingWireValue(path, value)) throw new Error("Shared settings value is invalid.");
    // An unresolved legacy image must stay undefined until asset migration is
    // durable. An explicit null register is a removal and is never omitted.
    if (path === "background.customImageId" && defaultedPaths.includes(path)
      && local.settings.background.customImageId === undefined) continue;
    setPath(raw, path, value);
  }
  const normalized = normalizeSharedSettings(raw, { version: 1, defaulted: defaultedPaths, preserved: {} });
  return { ...normalized, settings: {
    ...normalized.settings,
    sync: {
      ...local.settings.sync,
      deleteCloudFileOnDisconnect: normalized.settings.sync.deleteCloudFileOnDisconnect
    }
  } };
}

/** A snapshot cannot reset a setting it predates, including nested additions. */
export function restoreCompatibleSettings(
  current: Pick<AuraStartData, "settings" | "settingsCompatibility">,
  snapshot: Pick<AuraStartData, "settings" | "settingsCompatibility">
): NormalizedSharedSettings {
  const before = normalizeSharedSettings(current.settings, current.settingsCompatibility);
  const source = normalizeSharedSettings(snapshot.settings, snapshot.settingsCompatibility);
  const values = projectSharedSettings(before);
  const defaults = new Set(before.settingsCompatibility.defaulted);
  for (const [path, value] of Object.entries(projectSharedSettings(source))) {
    if (source.settingsCompatibility.defaulted.includes(path)) continue;
    values[path] = copySettingsValue(value);
    defaults.delete(path);
  }
  return materializeSharedSettings(current, values, [...defaults]);
}
