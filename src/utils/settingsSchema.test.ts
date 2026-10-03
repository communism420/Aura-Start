import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../constants";
import type { AuraStartData } from "../types";
import { validateAuraData } from "./importJson";
import { createEmptyData } from "./sampleData";
import { commitLocalSyncChanges, ensureSyncReplica, mergeSyncData, normalizeSyncReplica, sameSyncReplica } from "./syncReplica";
import { copySettingsValue, normalizeSharedSettings, projectSharedSettings, restoreCompatibleSettings, SETTING_SCHEMA, SHARED_SETTING_PATHS } from "./settingsSchema";

function legacy(): AuraStartData {
  const result = structuredClone(createEmptyData());
  delete result.settingsCompatibility;
  delete result.syncReplica;
  result.settings.sync.deviceId = "legacy-device";
  result.updatedAt = "2026-09-12T00:00:00.000Z";
  return result;
}

describe("additive settings schema upgrades", () => {
  it("fills independently missing leaves and nested sections without changing saved false or zero", () => {
    const old = legacy() as any;
    old.settings.showDescriptions = false;
    old.settings.background.dim = 0;
    delete old.settings.showSearch;
    delete old.settings.background.position;
    delete old.settings.widgets;
    const result = validateAuraData(old);
    expect(result.settings).toMatchObject({ showDescriptions: false, showSearch: true,
      background: { dim: 0, position: "center" }, widgets: DEFAULT_SETTINGS.widgets });
    expect(result.settingsCompatibility?.defaulted).toEqual(expect.arrayContaining([
      "showSearch", "background.position", "widgets.clock", "widgets.notes", "widgets.pomodoro", "background.customImageId"
    ]));
    expect(result.syncReplica?.settings.showDescriptions.stamp.deviceId).toBe("legacy");
    expect(result.syncReplica?.settings.showSearch.stamp.deviceId).toBe("settings-default");
    expect(result.syncReplica?.clock).toBe(0);
    expect(validateAuraData(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it("gives explicit legacy values precedence over synthesized defaults in either merge order", () => {
    const raw = legacy() as any;
    delete raw.settings.showSearch;
    delete raw.settings.background;
    const missing = validateAuraData(raw);
    const explicit = legacy();
    explicit.settings.showSearch = false;
    explicit.settings.background.blur = 0;
    explicit.settings.background.dim = 0;
    for (const combined of [mergeSyncData(missing, explicit), mergeSyncData(explicit, missing)]) {
      expect(combined.settings.showSearch).toBe(false);
      expect(combined.settings.background.dim).toBe(0);
      expect(combined.syncReplica?.settings["background.blur"].stamp.deviceId).toBe("legacy");
      expect(combined.settingsCompatibility?.defaulted).not.toContain("background.blur");
    }
  });

  it("does not turn a schema upgrade into a logical edit even when old history is far ahead", () => {
    const source = legacy();
    source.settings.showSearch = false;
    source.syncReplica = ensureSyncReplica(source);
    source.syncReplica.clock = 888;
    delete source.syncReplica.settings.showSearch;
    delete source.syncReplica.settings["widgets.clock"];
    const upgraded = validateAuraData(source);
    expect(upgraded.syncReplica?.clock).toBe(888);
    expect(upgraded.syncReplica?.settings.showSearch).toEqual({ stamp: { counter: 0, deviceId: "legacy" }, value: false });
    expect(upgraded.syncReplica?.settings["widgets.clock"].stamp.counter).toBe(0);
    expect(commitLocalSyncChanges(upgraded, upgraded).syncReplica?.clock).toBe(888);
  });

  it("recovers absent known and unknown settings from existing history before rendering", () => {
    const source = validateAuraData(legacy()) as any;
    source.syncReplica.clock = 5;
    source.syncReplica.settings.showSearch = { stamp: { counter: 5, deviceId: "remote" }, value: false };
    source.syncReplica.settings["futureLayout.density"] = { stamp: { counter: 5, deviceId: "remote" }, value: "compact" };
    delete source.settings.showSearch;
    const result = validateAuraData(source);
    expect(result.settings.showSearch).toBe(false);
    expect((result.settings as any).futureLayout.density).toBe("compact");
    expect(result.settingsCompatibility?.defaulted).not.toContain("showSearch");
    expect(result.syncReplica?.clock).toBe(5);
    expect(validateAuraData(result)).toEqual(result);
    // In contrast, a present value carries a local editor's intent; a stale
    // causal register is not allowed to reset it during input validation.
    result.settings.showSearch = true;
    expect(validateAuraData(result).settings.showSearch).toBe(true);
  });

  it("preserves an unknown nested setting and JSON arrays without sharing mutable references", () => {
    const raw = legacy() as any;
    raw.settings.futureLayout = { density: "comfortable", sizes: [1, 2], widgets: [{ id: "weather", enabled: true }] };
    raw.settings.background.futureTint = "violet";
    const copy = structuredClone(raw);
    const normalized = validateAuraData(raw);
    const next = structuredClone(normalized);
    next.settings.theme = "dark";
    const result = commitLocalSyncChanges(normalized, next);
    expect((result.settings as any).futureLayout).toEqual(copy.settings.futureLayout);
    expect((result.settings.background as any).futureTint).toBe("violet");
    (result.settings as any).futureLayout.sizes[0] = 999;
    expect((normalized.settings as any).futureLayout.sizes).toEqual([1, 2]);
    expect(raw).toEqual(copy);
  });

  it("retains a future enum through fallback, export and an unrelated edit, then allows an explicit supported value", () => {
    const raw = legacy() as any;
    raw.settings.theme = "sepia";
    const initial = validateAuraData(raw);
    expect(initial.settings.theme).toBe("system");
    expect(initial.settingsCompatibility?.preserved.theme).toBe("sepia");
    const reloaded = validateAuraData(JSON.parse(JSON.stringify(initial)));
    const next = structuredClone(reloaded);
    next.settings.background.blur = 4;
    const committed = commitLocalSyncChanges(reloaded, next);
    expect(committed.syncReplica?.settings.theme.value).toBe("sepia");
    expect(committed.settingsCompatibility?.preserved.theme).toBe("sepia");
    const replacement = structuredClone(committed);
    replacement.settings.theme = "light";
    const edited = commitLocalSyncChanges(committed, replacement);
    expect(edited.settings.theme).toBe("light");
    expect(edited.syncReplica?.settings.theme.value).toBe("light");
    expect(edited.settingsCompatibility?.preserved).not.toHaveProperty("theme");
  });

  it("records explicit choices equal to an auto-filled default without inventing an edit for untouched defaults", () => {
    const raw = legacy() as any;
    delete raw.settings.showSearch;
    const initial = validateAuraData(raw);
    expect(sameSyncReplica(initial, commitLocalSyncChanges(initial, initial))).toBe(true);
    const explicit = structuredClone(initial);
    explicit.settingsCompatibility!.defaulted = explicit.settingsCompatibility!.defaulted.filter((path) => path !== "showSearch");
    const selected = commitLocalSyncChanges(initial, explicit);
    expect(selected.settings.showSearch).toBe(true);
    expect(selected.syncReplica?.settings.showSearch.stamp.counter).toBe(1);
    expect(selected.settingsCompatibility?.defaulted).not.toContain("showSearch");
  });

  it("activates a preserved enum when a subsequent schema starts supporting it", () => {
    const previous = normalizeSharedSettings({ ...legacy().settings, theme: "sepia" });
    expect(previous.settings.theme).toBe("system");
    const normalize = SETTING_SCHEMA.theme.normalize;
    try {
      // Simulate the next release adding an option to the registry. The stored
      // UI value still contains this release's fallback, not the future option.
      SETTING_SCHEMA.theme.normalize = (value) => value === "sepia" ? value as never : normalize(value);
      const upgraded = normalizeSharedSettings(previous.settings, previous.settingsCompatibility);
      expect(upgraded.settings.theme).toBe("sepia");
      expect(upgraded.settingsCompatibility.preserved).not.toHaveProperty("theme");
    } finally { SETTING_SCHEMA.theme.normalize = normalize; }
  });

  it("restores preferences a snapshot contains while keeping choices for preferences the snapshot predates", () => {
    const current = validateAuraData(legacy());
    current.settings.showSearch = false;
    current.settings.background.blur = 5;
    current.settings.captureOpenTabs = true;
    const raw = legacy() as any;
    raw.settings.theme = "dark";
    delete raw.settings.showSearch;
    delete raw.settings.background.blur;
    const snapshot = validateAuraData(raw);
    const restored = restoreCompatibleSettings(current, snapshot);
    expect(restored.settings).toMatchObject({ theme: "dark", showSearch: false, background: { blur: 5 }, captureOpenTabs: false });
    expect(restored.settings.sync).toEqual(current.settings.sync);
    expect(restored.settingsCompatibility.defaulted).not.toContain("showSearch");
  });

  it("keeps undefined image migration pending while explicit null stays a deliberate removal", () => {
    const absent = validateAuraData(legacy());
    expect(absent.settings.background).not.toHaveProperty("customImageId");
    expect(commitLocalSyncChanges(absent, absent).settings.background).not.toHaveProperty("customImageId");
    const removed = legacy();
    removed.settings.background.customImageId = null;
    const result = mergeSyncData(absent, removed);
    expect(result.settings.background.customImageId).toBeNull();
    expect(result.syncReplica?.settings["background.customImageId"].stamp.deviceId).toBe("legacy");
  });

  it("normalizes invalid known legacy values without weakening causal-history validation", () => {
    const raw = legacy() as any;
    raw.settings.background.blur = 300;
    raw.settings.pomodoro.focusMinutes = 0;
    raw.settings.showSearch = "yes";
    const result = validateAuraData(raw);
    expect(result.settings.background.blur).toBe(18);
    expect(result.settings.pomodoro.focusMinutes).toBe(5);
    expect(result.settings.showSearch).toBe(true);
    const invalid = ensureSyncReplica(result);
    invalid.settings.showSearch.value = "yes";
    expect(normalizeSyncReplica(invalid)).toBeUndefined();
  });

  it("allocates independent defaults for missing settings objects", () => {
    const first = normalizeSharedSettings(undefined);
    const second = normalizeSharedSettings(undefined);
    first.settings.background.dim = 80;
    expect(second.settings.background.dim).toBe(DEFAULT_SETTINGS.background.dim);
    expect(first.settingsCompatibility.defaulted).toHaveLength(SHARED_SETTING_PATHS.length);
    expect(Object.keys(projectSharedSettings(second))).toEqual(expect.arrayContaining(SHARED_SETTING_PATHS));
  });

  it("accepts the total path boundary but rejects overflow before producing unreadable storage", () => {
    const raw = legacy() as any;
    for (let index = 0; index < 512 - SHARED_SETTING_PATHS.length; index++) raw.settings[`future${index}`] = index;
    const result = validateAuraData(raw);
    expect(Object.keys(result.syncReplica!.settings)).toHaveLength(512);
    expect(validateAuraData(result)).toEqual(result);
    raw.settings.oneTooMany = true;
    expect(() => validateAuraData(raw)).toThrow("Too many settings paths");
    const partial = ensureSyncReplica(legacy());
    partial.settings = Object.fromEntries(Array.from({ length: 512 }, (_, index) => [`future${index}`, {
      stamp: { counter: 0, deviceId: "legacy" }, value: index
    }]));
    expect(normalizeSyncReplica(partial)).toBeUndefined();
  });
});

describe("untrusted future settings", () => {
  it.each(["sync.mode", "sync.accountEmail", "future.sync.mode", "future.credentials", "future.accessToken", "theme.nested", "background"])
    ("rejects local/private or conflicting opaque history path %s", (path) => {
      const replica = ensureSyncReplica(legacy());
      replica.settings[path] = { stamp: { counter: 0, deviceId: "legacy" }, value: "injected" };
      expect(normalizeSyncReplica(replica)).toBeUndefined();
    });

  it("never copies prototype keys or invokes a future value getter", () => {
    const get = () => { throw new Error("Getter must not run"); };
    const getter = Object.defineProperty({}, "value", { enumerable: true, get });
    expect(() => copySettingsValue(getter)).toThrow("accessors");
    for (const key of ["__proto__", "prototype", "constructor"]) {
      const value = Object.defineProperty({}, key, { enumerable: true, value: { injected: true } });
      expect(() => copySettingsValue(value)).toThrow("Unsafe settings key");
      const raw = legacy() as any;
      raw.settings.future = value;
      expect(() => validateAuraData(raw)).toThrow();
    }
    expect(({} as any).injected).toBeUndefined();
  });

  it("rejects cyclic, too deep, oversized and credential-bearing opaque values", () => {
    const cyclic: any = {};
    cyclic.self = cyclic;
    const deep = Array.from({ length: 15 }).reduce((value) => ({ child: value }), {});
    for (const value of [cyclic, deep, "x".repeat(65537), { items: new Array(4097).fill(0) }, { sync: { mode: "auto" } }]) {
      expect(() => copySettingsValue(value)).toThrow();
    }
    const raw = legacy() as any;
    raw.settings.future = cyclic;
    expect(() => validateAuraData(raw)).toThrow("cycles");
  });
});
