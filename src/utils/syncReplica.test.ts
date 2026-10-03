import { describe, expect, it } from "vitest";
import type { AuraStartData, AuraStartLink } from "../types";
import { createEmptyData } from "./sampleData";
import { validateAuraData } from "./importJson";
import {
  commitLocalSyncChanges,
  ensureSyncReplica,
  mergeSyncData,
  normalizeSyncReplica,
  sameSyncContent,
  sameSyncReplica
} from "./syncReplica";

const TIME = "2026-09-12T10:00:00.000Z";

function link(id: string, title = id): AuraStartLink {
  return { id, title, url: `https://example.com/${id}`, order: 0, createdAt: TIME, updatedAt: TIME };
}

function data(deviceId = "device-a"): AuraStartData {
  const result = structuredClone(createEmptyData());
  result.updatedAt = TIME;
  result.settings.sync.deviceId = deviceId;
  result.groups = [
    { id: "group-a", title: "First", parentId: null, collapsed: false, order: 0, links: [link("link-a", "Original")] },
    { id: "group-b", title: "Second", parentId: null, collapsed: false, order: 1, links: [] }
  ];
  return result;
}

function onDevice(source: AuraStartData, deviceId: string): AuraStartData {
  const copy = structuredClone(source);
  copy.settings.sync.deviceId = deviceId;
  return copy;
}

function edit(source: AuraStartData, deviceId: string, update: (next: AuraStartData) => void): AuraStartData {
  const current = onDevice(source, deviceId);
  const next = structuredClone(current);
  update(next);
  return commitLocalSyncChanges(current, next);
}

function expectConverged(a: AuraStartData, b: AuraStartData): void {
  expect(sameSyncContent(a, b)).toBe(true);
  expect(sameSyncReplica(a, b)).toBe(true);
}

describe("Google Drive sync causal merge", () => {
  it("seeds legacy data deterministically without using wall clocks or local metadata", () => {
    const first = data();
    const second = data("other-device");
    second.updatedAt = "2099-01-01T00:00:00.000Z";
    second.settings.sync.lastSyncedAt = second.updatedAt;
    second.settings.sync.connected = true;

    expect(ensureSyncReplica(first).clock).toBe(0);
    expect(sameSyncReplica(first, second)).toBe(true);
    expect(sameSyncContent(first, second)).toBe(true);
    expect(normalizeSyncReplica(ensureSyncReplica(first))).toEqual(ensureSyncReplica(first));
    second.settings.captureOpenTabs = true;
    expect(sameSyncReplica(first, second)).toBe(false);
    expect(sameSyncContent(first, second)).toBe(false);
  });

  it("preserves independent edits to the same link and separate nested settings", () => {
    const base = data();
    const first = edit(base, "device-a", (next) => {
      next.groups[0].links[0].title = "Renamed";
      next.settings.background.blur = 5;
    });
    const second = edit(base, "device-b", (next) => {
      next.groups[0].links[0].url = "https://example.org/new";
      next.settings.background.dim = 40;
    });
    const merged = mergeSyncData(first, second);

    expect(merged.groups[0].links[0]).toMatchObject({ title: "Renamed", url: "https://example.org/new" });
    expect(merged.settings.background).toMatchObject({ blur: 5, dim: 40 });
    expectConverged(merged, mergeSyncData(second, first));
  });

  it("resolves concurrent edits to the same field independently of device clock skew", () => {
    const base = data();
    const first = edit(base, "device-a", (next) => {
      next.groups[0].links[0].title = "Alpha";
      next.updatedAt = "2099-01-01T00:00:00.000Z";
    });
    const second = edit(base, "device-b", (next) => {
      next.groups[0].links[0].title = "Beta";
      next.updatedAt = "2000-01-01T00:00:00.000Z";
    });
    const merged = mergeSyncData(first, second);

    expect(merged.groups[0].links[0].title).toBe("Beta");
    expectConverged(merged, mergeSyncData(second, first));
    const later = edit(merged, "device-a", (next) => { next.groups[0].links[0].title = "After seeing Beta"; });
    expect(mergeSyncData(second, later).groups[0].links[0].title).toBe("After seeing Beta");
  });

  it("merges independent additions and deterministically orders equal positions", () => {
    const first = edit(data(), "device-a", (next) => { next.groups[1].links.push(link("new-a")); });
    const second = edit(data(), "device-b", (next) => { next.groups[1].links.push(link("new-b")); });
    const merged = mergeSyncData(first, second);

    expect(merged.groups[1].links.map((item) => item.id)).toEqual(["new-a", "new-b"]);
    expect(merged.groups[1].links.map((item) => item.order)).toEqual([0, 1]);
    expectConverged(merged, mergeSyncData(second, first));
  });

  it("retains deletes against an offline legacy copy and later concurrent field edits", () => {
    const base = data();
    const removed = edit(base, "device-a", (next) => { next.groups[0].links = []; });
    let offline = base;
    for (let index = 0; index < 12; index++) {
      offline = edit(offline, "device-b", (next) => { next.groups[0].links[0].title = `Offline edit ${index}`; });
    }
    const merged = mergeSyncData(removed, offline);

    expect(merged.groups[0].links).toEqual([]);
    expect(merged.syncReplica?.links["link-a"].presence.value).toBe(false);
    expect(merged.syncReplica?.links["link-a"].fields.title.value).toBe("Offline edit 11");
    expectConverged(merged, mergeSyncData(offline, removed));
    expectConverged(merged, mergeSyncData(merged, base));
  });

  it("allows an explicit restoration to revive a deleted ID at a later logical version", () => {
    const base = data();
    const removed = edit(base, "device-a", (next) => { next.groups[0].links = []; });
    const restored = edit(removed, "device-a", (next) => { next.groups[0].links = structuredClone(base.groups[0].links); });

    expect(restored.groups[0].links[0].title).toBe("Original");
    expect(restored.syncReplica?.links["link-a"].presence.value).toBe(true);
    expectConverged(restored, mergeSyncData(restored, removed));
  });

  it("combines a link move with an edit from another device without duplicating the link", () => {
    const base = data();
    const moved = edit(base, "device-a", (next) => {
      next.groups[1].links = next.groups[0].links;
      next.groups[0].links = [];
    });
    const renamed = edit(base, "device-b", (next) => { next.groups[0].links[0].title = "Edited while moving"; });
    const merged = mergeSyncData(moved, renamed);

    expect(merged.groups[0].links).toEqual([]);
    expect(merged.groups[1].links).toHaveLength(1);
    expect(merged.groups[1].links[0].title).toBe("Edited while moving");
    expectConverged(merged, mergeSyncData(renamed, moved));
  });

  it("promotes a concurrently added child after deletion of its parent", () => {
    const base = data();
    const removed = edit(base, "device-a", (next) => { next.groups = next.groups.filter((group) => group.id !== "group-a"); });
    const nested = edit(base, "device-b", (next) => {
      next.groups.push({ id: "child", title: "Child", parentId: "group-a", collapsed: false, order: 0, links: [link("child-link")] });
    });
    const merged = mergeSyncData(removed, nested);

    expect(merged.groups.find((group) => group.id === "group-a")).toBeUndefined();
    expect(merged.groups.find((group) => group.id === "child")).toMatchObject({ parentId: null, links: [{ id: "child-link" }] });
    expectConverged(merged, mergeSyncData(nested, removed));
  });

  it("recovers orphaned new links without minting stamps and permits subsequent edits and deletion", () => {
    const base = data();
    const removed = edit(base, "device-a", (next) => { next.groups = next.groups.filter((group) => group.id !== "group-a"); });
    const added = edit(base, "device-b", (next) => { next.groups[0].links.push(link("surviving-link")); });
    const recovered = mergeSyncData(removed, added);
    const recoveredGroup = recovered.groups.find((group) => group.id === "group-a");

    expect(recoveredGroup?.links.map((item) => item.id)).toEqual(["surviving-link"]);
    expect(recoveredGroup?.parentId).toBeNull();
    expect(recovered.syncReplica?.groups["group-a"].presence.value).toBe(false);
    expect(recovered.syncReplica?.clock).toBe(1);
    expectConverged(recovered, mergeSyncData(recovered, added));
    const renamed = edit(recovered, "device-a", (next) => {
      next.groups.find((group) => group.id === "group-a")!.title = "Recovered and renamed";
    });
    expect(renamed.groups.find((group) => group.id === "group-a")?.title).toBe("Recovered and renamed");
    const deletedAgain = edit(renamed, "device-a", (next) => { next.groups = next.groups.filter((group) => group.id !== "group-a"); });
    expect(mergeSyncData(deletedAgain, added).groups.find((group) => group.id === "group-a")).toBeUndefined();
  });

  it("repairs concurrent nesting cycles deterministically", () => {
    const first = edit(data(), "device-a", (next) => { next.groups[0].parentId = "group-b"; });
    const second = edit(data(), "device-b", (next) => { next.groups[1].parentId = "group-a"; });
    const merged = mergeSyncData(first, second);

    expect(merged.groups.every((group) => group.parentId === null)).toBe(true);
    expectConverged(merged, mergeSyncData(second, first));
    expectConverged(merged, mergeSyncData(merged, second));
  });

  it("is associative, commutative and idempotent across three replicas", () => {
    const base = data();
    const a = edit(base, "a", (next) => { next.groups[0].title = "A rename"; });
    const b = edit(base, "b", (next) => { next.groups[1].links.push(link("b-new")); });
    const c = edit(base, "c", (next) => { next.groups[0].links = []; next.settings.theme = "dark"; });
    const left = mergeSyncData(mergeSyncData(a, b), c);
    const right = mergeSyncData(a, mergeSyncData(b, c));

    expectConverged(left, right);
    expectConverged(left, mergeSyncData(c, mergeSyncData(b, a)));
    expectConverged(left, mergeSyncData(left, left));
    expect(left.syncReplica?.clock).toBe(1);
  });

  it("rebases an in-flight UI edit over remote changes instead of overwriting unrelated fields", () => {
    const baseline = data();
    const current = mergeSyncData(baseline, edit(baseline, "device-b", (next) => {
      next.groups[0].links[0].url = "https://remote.example/";
      next.groups[1].links.push(link("remote-new"));
      next.settings.theme = "dark";
    }));
    const next = structuredClone(baseline);
    next.groups[0].links[0].title = "Local draft completed";
    const committed = commitLocalSyncChanges(current, next, baseline);

    expect(committed.groups[0].links[0]).toMatchObject({ title: "Local draft completed", url: "https://remote.example/" });
    expect(committed.groups[1].links[0].id).toBe("remote-new");
    expect(committed.settings.theme).toBe("dark");
    expect(committed.syncReplica?.clock).toBe(2);
    expectConverged(committed, commitLocalSyncChanges(committed, committed));
  });

  it("keeps local account metadata, timestamps and Restore Points while sharing the tab-capture preference", () => {
    const local = data();
    local.settings.captureOpenTabs = true;
    local.settings.sync = { ...local.settings.sync, connected: true, accountEmail: "local@example.test", cloudFileId: "local-file" };
    local.restorePoints = [{ id: "local-restore", name: "Local", reason: "manual", createdAt: TIME, data: {
      version: local.version, updatedAt: TIME, settings: structuredClone(local.settings), groups: []
    } }];
    const remote = edit(data("device-b"), "device-b", (next) => { next.settings.theme = "dark"; });
    remote.settings.sync.accountEmail = "remote@example.test";
    remote.updatedAt = "2099-01-01T00:00:00.000Z";
    const merged = mergeSyncData(local, remote);

    expect(merged.settings.captureOpenTabs).toBe(true);
    expect(merged.settings.sync).toEqual(local.settings.sync);
    expect(merged.restorePoints).toBe(local.restorePoints);
    expect(merged.updatedAt).toBe(local.updatedAt);
    expect(merged.settings.theme).toBe("dark");
    const preferenceChange = structuredClone(merged);
    preferenceChange.settings.captureOpenTabs = false;
    const committed = commitLocalSyncChanges(merged, preferenceChange);
    expect(committed.settings.captureOpenTabs).toBe(false);
    expect(sameSyncReplica(committed, merged)).toBe(false);
    expect(committed.syncReplica!.settings.captureOpenTabs).toEqual({
      stamp: { counter: merged.syncReplica!.clock + 1, deviceId: "device-a" }, value: false
    });
    expect(committed.settings.sync).toEqual(local.settings.sync);
  });

  it("synchronizes explicit removal of optional link fields", () => {
    const base = data();
    base.groups[0].links[0].description = "Old description";
    base.groups[0].links[0].tags = ["old"];
    const first = edit(base, "a", (next) => { delete next.groups[0].links[0].description; });
    const second = edit(base, "b", (next) => { delete next.groups[0].links[0].tags; });
    const merged = mergeSyncData(first, second);

    expect(merged.groups[0].links[0].description).toBeUndefined();
    expect(merged.groups[0].links[0].tags).toBeUndefined();
    expectConverged(merged, mergeSyncData(second, first));
  });

  it("does not silently drop legacy duplicate IDs across groups", () => {
    const legacy = data();
    legacy.groups[1].links.push(link("link-a", "A distinct saved copy"));
    const merged = mergeSyncData(legacy, legacy);

    expect(merged.groups.flatMap((group) => group.links)).toHaveLength(2);
    expect(new Set(merged.groups.flatMap((group) => group.links.map((item) => item.id))).size).toBe(2);
    expect(merged.groups[1].links[0].title).toBe("A distinct saved copy");
    expectConverged(merged, mergeSyncData(merged, legacy));
  });

  it("does not mutate caller-owned snapshots or causal registers", () => {
    const original = data();
    const first = edit(original, "a", (next) => { next.groups[0].title = "Changed"; });
    const savedOriginal = structuredClone(original);
    const savedFirst = structuredClone(first);
    mergeSyncData(first, original);
    commitLocalSyncChanges(first, first);

    expect(original).toEqual(savedOriginal);
    expect(first).toEqual(savedFirst);
  });

  it("converges after delayed, duplicated and reordered delivery across four devices", () => {
    const base = data();
    const devices = ["a", "b", "c", "d"];
    const replicas = devices.map((id) => onDevice(base, id));
    const delayed: AuraStartData[] = [];
    for (let step = 0; step < 24; step++) {
      const actor = step % devices.length;
      replicas[actor] = edit(replicas[actor], devices[actor], (next) => {
        if (step % 3 === 0) next.groups[1].links.push(link(`new-${step}`));
        if (step % 3 === 1) next.groups[0].title = `Rename ${step}`;
        if (step % 3 === 2) {
          next.groups[0].links = [];
          next.settings.background.dim = step;
        }
      });
      delayed.push(structuredClone(replicas[actor]));
      if (step % 2 === 0) {
        const receiver = (actor + 1) % devices.length;
        replicas[receiver] = mergeSyncData(replicas[receiver], delayed[Math.floor(step / 2)]);
      }
    }
    const expected = replicas.reduce(mergeSyncData);
    for (let receiver = 0; receiver < devices.length; receiver++) {
      for (const packet of [...delayed].reverse().concat(replicas, delayed.slice(0, 4), replicas)) {
        replicas[receiver] = mergeSyncData(replicas[receiver], packet);
      }
      expectConverged(replicas[receiver], expected);
      expect(replicas[receiver].groups[0].links).toEqual([]);
      expect(replicas[receiver].groups[1].links).toHaveLength(8);
    }
  });

  it("does not mint logical edits for repeated metadata-only commits", () => {
    const current = data();
    current.syncReplica = ensureSyncReplica(current);
    current.syncReplica.clock = Number.MAX_SAFE_INTEGER - 1;
    const next = structuredClone(current);
    next.updatedAt = "2027-01-01T00:00:00.000Z";
    next.settings.sync.lastSyncedAt = next.updatedAt;
    expectConverged(commitLocalSyncChanges(current, next), current);
    next.groups[0].title = "Actual edit";
    expect(() => commitLocalSyncChanges(current, next)).toThrow("counter is exhausted");
  });
});

describe("Google Drive causal metadata validation", () => {
  it.each([
    ["unsupported version", (value: any) => { value.version = 2; }],
    ["unsafe counter", (value: any) => { value.clock = Number.MAX_SAFE_INTEGER; }],
    ["negative stamp", (value: any) => { value.groups["group-a"].presence.stamp.counter = -1; }],
    ["stamp ahead of clock", (value: any) => { value.links["link-a"].fields.title.stamp.counter = 2; }],
    ["unknown field", (value: any) => { value.groups["group-a"].fields.extra = value.groups["group-a"].fields.title; }],
    ["invalid URL", (value: any) => { value.links["link-a"].fields.url.value = "javascript:alert(1)"; }],
    ["invalid title", (value: any) => { value.groups["group-a"].fields.title.value = ""; }],
    ["invalid tab-capture preference type", (value: any) => { value.settings.captureOpenTabs.value = "true"; }],
    ["private connection state", (value: any) => { value.settings["sync.connected"] = value.settings.showSearch; }],
    ["unknown link container", (value: any) => { value.links["link-a"].fields.groupId.value = "missing"; }],
    ["missing field", (value: any) => { delete value.links["link-a"].fields.description; }],
    ["malformed presence", (value: any) => { value.links["link-a"].presence.value = "false"; }],
    ["invalid setting type", (value: any) => { value.settings.theme.value = true; }],
    ["invalid date", (value: any) => { value.links["link-a"].fields.createdAt.value = "not-a-date"; }]
  ])("rejects %s without partially accepting the replica", (_name, mutate) => {
    const value = structuredClone(ensureSyncReplica(data()));
    mutate(value);
    expect(normalizeSyncReplica(value)).toBeUndefined();
  });

  it("rejects prototype-related keys and inherited metadata", () => {
    const original = ensureSyncReplica(data());
    for (const key of ["__proto__", "prototype", "constructor"]) {
      const value = JSON.parse(JSON.stringify(original));
      Object.defineProperty(value.groups, key, { enumerable: true, value: value.groups["group-a"] });
      expect(normalizeSyncReplica(value)).toBeUndefined();
    }
    const inherited = Object.assign(Object.create({ injected: true }), original);
    expect(normalizeSyncReplica(inherited)).toBeUndefined();
    expect(({} as Record<string, unknown>).injected).toBeUndefined();
  });

  it("does not invoke getters in untrusted metadata", () => {
    const value = ensureSyncReplica(data());
    Object.defineProperty(value, "clock", { enumerable: true, get: () => { throw new Error("Getter invoked"); } });
    expect(normalizeSyncReplica(value)).toBeUndefined();
  });

  it("refuses invalid existing history rather than silently replacing tombstones with legacy data", () => {
    const value = data();
    value.syncReplica = { ...ensureSyncReplica(value), clock: -1 };
    expect(() => ensureSyncReplica(value)).toThrow("Invalid Aura Start sync history");
  });
});

describe("Custom background replica migration", () => {
  const firstImage = "a".repeat(64);
  const secondImage = "b".repeat(64);

  it("accepts pre-image 2.1.0 history and seeds only the missing image register at clock zero", () => {
    const old = edit(data(), "device-a", (next) => { next.groups[0].title = "Already synced"; });
    delete old.syncReplica!.settings["background.customImageId"];
    const normalized = ensureSyncReplica(old);
    expect(normalized.settings["background.customImageId"]).toEqual({ stamp: { counter: 0, deviceId: "settings-default" }, value: null });
    expect(normalized.clock).toBe(1);
    expect(normalized.groups["group-a"].fields.title.stamp.counter).toBe(1);
  });

  it("keeps a migrated image when merging a 2.0.5 backup or earlier 2.1.0 replica", () => {
    const image = edit(data(), "device-a", (next) => { next.settings.background.customImageId = firstImage; });
    const oldReplica = edit(data(), "device-b", (next) => { next.groups[0].title = "Remote title"; });
    delete oldReplica.syncReplica!.settings["background.customImageId"];
    for (const old of [data(), oldReplica]) {
      const merged = mergeSyncData(image, old);
      expect(merged.settings.background.customImageId).toBe(firstImage);
      expectConverged(merged, mergeSyncData(old, image));
    }
  });

  it("does not treat legacy absence as removal of an imported image without causal metadata", () => {
    const imported = data();
    imported.settings.background.customImageId = firstImage;
    const absent = data("device-b");
    const merged = mergeSyncData(imported, absent);
    expect(merged.settings.background.customImageId).toBe(firstImage);
    expectConverged(merged, mergeSyncData(absent, imported));
    const removed = edit(merged, "device-b", (next) => { next.settings.background.customImageId = null; });
    expect(mergeSyncData(removed, imported).settings.background.customImageId).toBeNull();
  });

  it("merges concurrent image replacement independently of appearance changes", () => {
    const initial = edit(data(), "device-a", (next) => { next.settings.background.customImageId = firstImage; });
    const image = edit(initial, "device-a", (next) => { next.settings.background.customImageId = secondImage; });
    const appearance = edit(initial, "device-b", (next) => { next.settings.background.blur = 11; next.settings.background.preset = "forest"; });
    const merged = mergeSyncData(image, appearance);
    expect(merged.settings.background).toMatchObject({ customImageId: secondImage, blur: 11, preset: "forest" });
    expectConverged(merged, mergeSyncData(appearance, image));
  });

  it("retains explicit removal against old image snapshots and allows intentional restoration", () => {
    const image = edit(data(), "device-a", (next) => { next.settings.background.customImageId = firstImage; });
    const removed = edit(image, "device-a", (next) => { next.settings.background.customImageId = null; });
    expect(mergeSyncData(removed, image).settings.background.customImageId).toBeNull();
    const restored = edit(removed, "device-a", (next) => { next.settings.background.customImageId = firstImage; });
    expect(mergeSyncData(removed, restored).settings.background.customImageId).toBe(firstImage);
    expectConverged(mergeSyncData(removed, restored), mergeSyncData(restored, removed));
  });

  it("resolves simultaneous image choices deterministically without storing bytes in causal history", () => {
    const left = edit(data(), "device-a", (next) => { next.settings.background.customImageId = firstImage; });
    const right = edit(data(), "device-b", (next) => { next.settings.background.customImageId = secondImage; });
    const merged = mergeSyncData(left, right);
    expect(merged.settings.background.customImageId).toBe(secondImage);
    expect(merged.syncReplica!.settings["background.customImageId"].value).toBe(secondImage);
    expectConverged(merged, mergeSyncData(right, left));
  });

  it.each(["A".repeat(64), "a".repeat(63), "data:image/png;base64,AA==", "", 42, false, {}])("rejects malformed image references (%j) in data and replica history", (reference) => {
    const source = data();
    const invalid = { ...source, settings: { ...source.settings, background: { ...source.settings.background, customImageId: reference } } };
    expect(() => validateAuraData(invalid)).toThrow("reference is invalid");
    const history = ensureSyncReplica(source);
    history.settings["background.customImageId"].value = reference as never;
    expect(normalizeSyncReplica(history)).toBeUndefined();
  });

  it("preserves a missing legacy image reference while accepting explicit null or a valid hash", () => {
    expect(validateAuraData(data()).settings.background).not.toHaveProperty("customImageId");
    for (const customImageId of [null, firstImage]) {
      const source = data();
      source.settings.background.customImageId = customImageId;
      expect(validateAuraData(source).settings.background.customImageId).toBe(customImageId);
    }
  });
});
