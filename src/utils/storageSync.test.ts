import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import type { AuraRestorePoint, AuraStartData } from "../types";
import { createEmptyData } from "./sampleData";
import { loadAuraData, saveAuraData, updateAuraData } from "./storage";
import { commitLocalSyncChanges, mergeSyncData } from "./syncReplica";

const ISO = "2026-09-12T10:00:00.000Z";
let stored: Record<string, unknown>;
let write: ReturnType<typeof vi.fn>;

function fixture(): AuraStartData {
  const data = structuredClone(createEmptyData());
  data.updatedAt = ISO;
  data.settings.sync = { ...data.settings.sync, mode: "auto", connected: true, deviceId: "local-device" };
  data.groups = [{
    id: "group-work", title: "Work", parentId: null, collapsed: false, order: 0,
    links: ["one", "two"].map((id, order) => ({
      id: `link-${id}`, title: id, url: `https://www.${id}.com/`, order, createdAt: ISO, updatedAt: ISO
    }))
  }];
  return data;
}

function point(data: AuraStartData, id: string): AuraRestorePoint {
  return {
    id, name: id, createdAt: ISO, reason: "manual",
    data: { version: data.version, updatedAt: data.updatedAt, settings: structuredClone(data.settings), groups: structuredClone(data.groups) }
  };
}

async function persisted(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error(`Unexpected storage state: ${loaded.status}`);
  return loaded.data;
}

beforeEach(() => {
  stored = {};
  write = vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, structuredClone(items)); });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", {
    storage: {
      local: {
        get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
        set: write,
        remove: async (key: string) => { delete stored[key]; }
      }
    }
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("persisted sync data across open Aura Start pages", () => {
  it("rebases simultaneous stale-page edits onto durable data and returns the canonical result", async () => {
    const baseline = await saveAuraData(fixture());
    const pageOne = structuredClone(baseline);
    pageOne.groups[0].title = "Renamed on page one";
    const pageTwo = structuredClone(baseline);
    pageTwo.groups[0].links[0].title = "Edited on page two";
    pageTwo.settings.theme = "light";

    const [, lastWrite] = await Promise.all([
      saveAuraData(pageOne, { baseline }),
      saveAuraData(pageTwo, { baseline })
    ]);
    const durable = await persisted();
    expect(durable.groups[0].title).toBe("Renamed on page one");
    expect(durable.groups[0].links[0].title).toBe("Edited on page two");
    expect(durable.settings.theme).toBe("light");
    expect(lastWrite).toEqual(durable);
    expect(new Date(durable.updatedAt).getTime()).toBeGreaterThan(new Date(baseline.updatedAt).getTime());
  });

  it("keeps downloaded additions and tombstones when an older page saves an unrelated edit", async () => {
    const baseline = await saveAuraData(fixture());
    const remoteBaseline = structuredClone(baseline);
    remoteBaseline.settings.sync.deviceId = "remote-device";
    const remoteEdit = structuredClone(remoteBaseline);
    remoteEdit.groups[0].links = [remoteEdit.groups[0].links[0]];
    remoteEdit.groups.push({ id: "group-remote", title: "Remote folder", parentId: null, collapsed: false, order: 1, links: [] });
    const remote = commitLocalSyncChanges(remoteBaseline, remoteEdit, remoteBaseline);
    await updateAuraData((current) => mergeSyncData(current, remote));

    const stalePage = structuredClone(baseline);
    stalePage.groups[0].links[0].description = "Local note after cloud delivery";
    const result = await saveAuraData(stalePage, { baseline });
    expect(result.groups.map((group) => group.id)).toEqual(["group-work", "group-remote"]);
    expect(result.groups[0].links.map((link) => link.id)).toEqual(["link-one"]);
    expect(result.groups[0].links[0].description).toBe("Local note after cloud delivery");
    expect(result.syncReplica?.links["link-two"].presence.value).toBe(false);
    expect(result.settings.sync.deviceId).toBe("local-device");
    expect(await persisted()).toEqual(result);
  });

  it("preserves shared preferences, background connection metadata and history while applying only local page changes", async () => {
    const initial = fixture();
    initial.restorePoints = [point(initial, "remove-me")];
    const baseline = await saveAuraData(initial);
    await updateAuraData((current) => {
      const preference = commitLocalSyncChanges(current, {
        ...current, settings: { ...current.settings, captureOpenTabs: true }
      });
      return {
        ...preference,
        settings: {
          ...preference.settings,
          sync: { ...current.settings.sync, cloudFileId: "own-replica", lastSyncedAt: ISO, connectionId: "new-connection", accountEmail: "local@invalid.test" }
        },
        restorePoints: [point(current, "background-point"), ...current.restorePoints]
      };
    });
    const stalePage = structuredClone(baseline);
    stalePage.groups[0].title = "Local rename";
    stalePage.restorePoints = [point(stalePage, "page-point")];
    const result = await saveAuraData(stalePage, { baseline });
    expect(result.settings.sync).toMatchObject({
      deviceId: "local-device", cloudFileId: "own-replica", connectionId: "new-connection", accountEmail: "local@invalid.test", lastSyncedAt: ISO
    });
    expect(result.settings.captureOpenTabs).toBe(true);
    expect(result.syncReplica!.settings.captureOpenTabs.stamp.counter).toBeGreaterThan(0);
    expect(result.restorePoints.map((item) => item.id)).toEqual(["page-point", "background-point"]);
    expect(result.groups[0].title).toBe("Local rename");
  });

  it("does not revert another page or create a new revision for a stale no-op save", async () => {
    const baseline = await saveAuraData(fixture());
    const edit = structuredClone(baseline);
    edit.groups[0].title = "Durable edit";
    const latest = await saveAuraData(edit, { baseline });
    const result = await saveAuraData(baseline, { baseline });
    expect(result).toEqual(latest);
  });

  it("leaves durable data intact when a local save or atomic update fails validation", async () => {
    const baseline = await saveAuraData(fixture());
    const serialized = JSON.stringify(stored[STORAGE_KEY]);
    const writes = write.mock.calls.length;
    const invalid = structuredClone(baseline);
    invalid.groups[0].links[0].url = "javascript:alert(1)";
    await expect(saveAuraData(invalid, { baseline })).rejects.toThrow(/Invalid link URL/);
    await expect(updateAuraData(() => invalid)).rejects.toThrow(/Invalid link URL/);
    expect(JSON.stringify(stored[STORAGE_KEY])).toBe(serialized);
    expect(write).toHaveBeenCalledTimes(writes);
    expect(await persisted()).toEqual(baseline);
  });
});
