import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../constants";
import { mergeSettingsPatch, type AuraSettingsPatch } from "./settingsPatch";

describe("settings leaf updates", () => {
  it("retains nested sibling preferences, including fields added in a future release", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.background = { ...settings.background, blur: 6, dim: 35, position: "top" };
    Object.assign(settings.background, { futureAlignment: { x: 0.25, y: 0.75 } });
    const before = structuredClone(settings);
    const next = mergeSettingsPatch(settings, { background: { blur: 0 }, widgets: { clock: true } });
    expect(next.background).toEqual({ ...before.background, blur: 0 });
    expect(next.widgets).toEqual({ ...before.widgets, clock: true });
    expect(settings).toEqual(before);
  });

  it("preserves explicit false and null, ignores undefined, and keeps the local session", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.compactMode = true;
    settings.background.customImageId = "a".repeat(64);
    settings.sync.connectionId = "keep-connection";
    const next = mergeSettingsPatch(settings, {
      compactMode: false, theme: undefined, background: { customImageId: null }, sync: { deleteCloudFileOnDisconnect: false }
    });
    expect(next.compactMode).toBe(false);
    expect(next.theme).toBe(settings.theme);
    expect(next.background.customImageId).toBeNull();
    expect(next.sync).toEqual({ ...settings.sync, deleteCloudFileOnDisconnect: false });
  });

  it("rejects prototype-mutating keys without changing the original settings", () => {
    const patch = JSON.parse('{"background":{"__proto__":{"polluted":true}}}') as AuraSettingsPatch;
    expect(() => mergeSettingsPatch(DEFAULT_SETTINGS, patch)).toThrow(/unsafe key/);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
