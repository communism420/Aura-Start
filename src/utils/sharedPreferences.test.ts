import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../constants";
import { validateAuraData } from "./importJson";
import { createEmptyData } from "./sampleData";
import { applyExplicitSettingsPatch } from "./settingsPatch";
import { isSharedSettingPath, projectSharedSettings, restoreCompatibleSettings } from "./settingsSchema";
import { commitLocalSyncChanges, mergeSyncData, normalizeSyncReplica } from "./syncReplica";

function device(id: string) {
  const data = createEmptyData();
  data.settings.sync = { ...data.settings.sync, deviceId: id, connected: true, mode: "auto",
    connectionId: `connection-${id}`, accountEmail: `${id}@example.invalid`, cloudFileId: `file-${id}` };
  return validateAuraData(data);
}

describe("shared user preferences with local connection state", () => {
  it("shares the two preferences in both directions while retaining each device's connection", () => {
    const a = device("a");
    const b = device("b");
    const edited = commitLocalSyncChanges(a, { ...a, ...applyExplicitSettingsPatch(a, {
      captureOpenTabs: true, sync: { deleteCloudFileOnDisconnect: false }
    }) });
    const received = mergeSyncData(b, edited);
    expect(received.settings.captureOpenTabs).toBe(true);
    expect(received.settings.sync).toEqual({ ...b.settings.sync, deleteCloudFileOnDisconnect: false });
    const reversed = commitLocalSyncChanges(received, { ...received, ...applyExplicitSettingsPatch(received, {
      captureOpenTabs: false, sync: { deleteCloudFileOnDisconnect: true }
    }) });
    const returned = mergeSyncData(edited, reversed);
    expect(returned.settings.captureOpenTabs).toBe(false);
    expect(returned.settings.sync).toEqual({ ...a.settings.sync, deleteCloudFileOnDisconnect: true });
    expect(returned.syncReplica!.settings["sync.deleteCloudFileOnDisconnect"].stamp.counter).toBe(2);
  });

  it("promotes an explicitly selected default under the private sync parent", () => {
    const initial = device("a");
    const patch = applyExplicitSettingsPatch(initial, { sync: { deleteCloudFileOnDisconnect: true } });
    expect(patch.settingsCompatibility?.defaulted).not.toContain("sync.deleteCloudFileOnDisconnect");
    const committed = commitLocalSyncChanges(initial, { ...initial, ...patch });
    expect(committed.syncReplica!.settings["sync.deleteCloudFileOnDisconnect"]).toEqual({
      stamp: { counter: 1, deviceId: "a" }, value: true
    });
    expect(committed.settings.sync).toEqual(initial.settings.sync);
  });

  it("does not admit other local/private fields through the explicit allowlist", () => {
    const data = device("a");
    const values = projectSharedSettings(data);
    expect(Object.keys(values).filter((path) => path.startsWith("sync."))).toEqual(["sync.deleteCloudFileOnDisconnect"]);
    expect(values.captureOpenTabs).toBe(false);
    for (const path of ["sync", "sync.mode", "sync.accountEmail", "sync.futurePreference", "future.sync.deleteCloudFileOnDisconnect",
      "future.captureOpenTabs", "captureOpenTabs.nested", "sync.deleteCloudFileOnDisconnect.secret"]) {
      expect(isSharedSettingPath(path)).toBe(false);
      const replica = structuredClone(data.syncReplica!);
      replica.settings[path] = { stamp: { counter: 0, deviceId: "legacy" }, value: true };
      expect(normalizeSyncReplica(replica)).toBeUndefined();
    }
  });

  it("keeps genuine local legacy preferences and restores them without copying accounts", () => {
    const old = device("old");
    delete old.syncReplica;
    delete old.settingsCompatibility;
    old.settings.captureOpenTabs = true;
    old.settings.sync.deleteCloudFileOnDisconnect = false;
    const validated = validateAuraData(old);
    expect(validated.syncReplica!.settings.captureOpenTabs).toEqual({ stamp: { counter: 0, deviceId: "legacy" }, value: true });
    expect(validated.syncReplica!.settings["sync.deleteCloudFileOnDisconnect"]).toEqual({ stamp: { counter: 0, deviceId: "legacy" }, value: false });
    const current = device("new");
    const restored = restoreCompatibleSettings(current, validated);
    expect(restored.settings.captureOpenTabs).toBe(true);
    expect(restored.settings.sync).toEqual({ ...current.settings.sync, deleteCloudFileOnDisconnect: false });
    const predating = structuredClone(old) as unknown as { settings: Record<string, any> };
    delete predating.settings.captureOpenTabs;
    delete predating.settings.sync.deleteCloudFileOnDisconnect;
    const oldMissing = validateAuraData(predating);
    const unchanged = restoreCompatibleSettings(validated, oldMissing);
    expect(unchanged.settings.captureOpenTabs).toBe(true);
    expect(unchanged.settings.sync.deleteCloudFileOnDisconnect).toBe(false);
    expect(DEFAULT_SETTINGS.sync.deleteCloudFileOnDisconnect).toBe(true);
  });
});
