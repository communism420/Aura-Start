import type { AuraSettingsCompatibility, AuraStartData, AuraStartSettings } from "../types";
import { isSharedSettingPath, normalizeSharedSettings, SHARED_SETTING_PATHS } from "./settingsSchema";

type DeepSettingsPatch<T> = {
  [Key in keyof T]?: NonNullable<T[Key]> extends readonly unknown[]
    ? T[Key]
    : NonNullable<T[Key]> extends object ? DeepSettingsPatch<NonNullable<T[Key]>> : T[Key];
};

export type AuraSettingsPatch = DeepSettingsPatch<AuraStartSettings>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A control writes its changed leaf, preserving sibling settings from newer releases. */
export function mergeSettingsPatch(current: AuraStartSettings, patch: AuraSettingsPatch): AuraStartSettings {
  function merge(before: Record<string, unknown>, next: Record<string, unknown>, depth = 0): Record<string, unknown> {
    if (depth > 16) throw new Error("The settings patch is too deeply nested.");
    const result = { ...before };
    for (const key of Object.keys(next)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("The settings patch contains an unsafe key.");
      if (Object.getOwnPropertyDescriptor(next, key)?.get) throw new Error("The settings patch contains an accessor.");
      const value = next[key];
      if (value === undefined) continue;
      result[key] = isPlainRecord(value)
        ? merge(isPlainRecord(before[key]) ? before[key] : {}, value, depth + 1)
        : structuredClone(value);
    }
    return result;
  }
  return merge(current, patch) as AuraStartSettings;
}

/** Explicit control choices are distinct from defaults added by an upgrade. */
export function applyExplicitSettingsPatch(
  current: Pick<AuraStartData, "settings" | "settingsCompatibility">,
  patch: AuraSettingsPatch
): Pick<AuraStartData, "settings" | "settingsCompatibility"> {
  const settings = mergeSettingsPatch(current.settings, patch);
  const { settingsCompatibility } = normalizeSharedSettings(current.settings, current.settingsCompatibility);
  const changed = new Set<string>();
  function visit(value: Record<string, unknown>, prefix = ""): void {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (!isSharedSettingPath(path) && !SHARED_SETTING_PATHS.some((known) => known.startsWith(`${path}.`))) continue;
      if (isPlainRecord(child)) visit(child, path);
      else changed.add(path);
    }
  }
  // mergeSettingsPatch already validated the patch's keys and depth.
  visit(patch);
  settingsCompatibility.defaulted = settingsCompatibility.defaulted.filter((path) => !changed.has(path));
  for (const path of changed) delete settingsCompatibility.preserved[path];
  return { settings, settingsCompatibility };
}

/** A new Restore Point records the preferences visible when it was captured. */
export function snapshotSettingsCompatibility(
  data: Pick<AuraStartData, "settings" | "settingsCompatibility">
): AuraSettingsCompatibility {
  const { settingsCompatibility } = normalizeSharedSettings(data.settings, data.settingsCompatibility);
  settingsCompatibility.defaulted = settingsCompatibility.defaulted.filter((path) =>
    !SHARED_SETTING_PATHS.includes(path as typeof SHARED_SETTING_PATHS[number])
    || (path === "background.customImageId" && data.settings.background.customImageId === undefined));
  return settingsCompatibility;
}
