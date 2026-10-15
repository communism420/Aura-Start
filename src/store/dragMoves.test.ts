import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import type { AuraStartData, AuraStartGroup, AuraStartLink } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData } from "../utils/storage";
import { commitLocalSyncChanges } from "../utils/syncReplica";
import { installAuraStoreSyncLifecycle, useAuraStore } from "./useAuraStore";

const ISO = "2026-10-15T12:00:00.000Z";
let stored: Record<string, unknown>;
let write: ReturnType<typeof vi.fn>;
let storageListeners: Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>;

function publish(items: Record<string, unknown>) {
  Object.assign(stored, structuredClone(items));
  const changes = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }]));
  storageListeners.forEach((listener) => listener(changes, "local"));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function link(id: string, order: number): AuraStartLink {
  return { id, title: id, url: `https://example.com/${id}`, order, createdAt: ISO, updatedAt: ISO };
}

function group(id: string, order: number, parentId: string | null = null, links: AuraStartLink[] = []): AuraStartGroup {
  return { id, title: id, parentId, order, collapsed: false, links };
}

function seed(groups: AuraStartGroup[]): AuraStartData {
  const data = structuredClone(createEmptyData());
  data.updatedAt = ISO;
  data.groups = groups;
  data.settings.sync.connected = false;
  useAuraStore.setState({ data, status: "ready", error: null, toasts: [] });
  return data;
}

function siblings(parentId: string | null): string[] {
  return useAuraStore.getState().data!.groups.filter((item) => (item.parentId ?? null) === parentId)
    .sort((a, b) => a.order - b.order).map((item) => item.id);
}

function links(groupId: string): string[] {
  return useAuraStore.getState().data!.groups.find((item) => item.id === groupId)!.links.map((item) => item.id);
}

beforeEach(() => {
  stored = {};
  storageListeners = new Set();
  write = vi.fn(async (items: Record<string, unknown>) => { publish(items); });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", {
    storage: {
      onChanged: {
        addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => storageListeners.add(listener),
        removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => storageListeners.delete(listener)
      },
      local: {
        get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
        set: write,
        remove: async (key: string) => { delete stored[key]; }
      }
    }
  });
});

afterEach(() => {
  useAuraStore.setState({ data: null, status: "idle", error: null, toasts: [] });
  vi.unstubAllGlobals();
});

describe("committed drag positions", () => {
  it("moves a nested group into the selected slot of another parent in one storage write", async () => {
    seed([
      group("left", 0), group("right", 1),
      group("left-one", 0, "left"), group("moving", 1, "left", [link("kept", 0)]), group("left-two", 2, "left"),
      group("right-one", 0, "right"), group("right-two", 1, "right")
    ]);

    await useAuraStore.getState().moveGroup("moving", "right", "right-two");

    expect(siblings("left")).toEqual(["left-one", "left-two"]);
    expect(siblings("right")).toEqual(["right-one", "moving", "right-two"]);
    expect(links("moving")).toEqual(["kept"]);
    expect(useAuraStore.getState().data!.restorePoints).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
    const persisted = await loadAuraData();
    expect(persisted.status).toBe("ready");
    if (persisted.status === "ready") expect(persisted.data.groups).toEqual(useAuraStore.getState().data!.groups);
  });

  it("promotes a nested group into an exact top-level position", async () => {
    seed([group("first", 0), group("second", 1), group("child", 0, "first")]);
    await useAuraStore.getState().moveGroup("child", null, "second");
    expect(siblings(null)).toEqual(["first", "child", "second"]);
    expect(siblings("first")).toEqual([]);
  });

  it("reorders within a parent and supports an explicit end position", async () => {
    seed([group("parent", 0), group("a", 0, "parent"), group("b", 1, "parent"), group("c", 2, "parent")]);
    await useAuraStore.getState().moveGroup("c", "parent", "a");
    expect(siblings("parent")).toEqual(["c", "a", "b"]);
    await useAuraStore.getState().moveGroup("c", "parent");
    expect(siblings("parent")).toEqual(["a", "b", "c"]);
  });

  it("preserves children when reordering their top-level parent", async () => {
    seed([group("first", 0), group("second", 1), group("child", 0, "first")]);
    await useAuraStore.getState().moveGroup("first", null);
    expect(siblings(null)).toEqual(["second", "first"]);
    expect(siblings("first")).toEqual(["child"]);
  });

  it("does not save, sync, or create history for an unchanged group position", async () => {
    const original = seed([group("a", 0), group("b", 1), group("c", 2)]);
    await useAuraStore.getState().moveGroup("a", null, "b");
    await useAuraStore.getState().moveGroup("b", null, "b");
    await useAuraStore.getState().moveGroup("c", null);
    expect(useAuraStore.getState().data).toBe(original);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not turn a stale group anchor into an unintended append", async () => {
    const original = seed([group("a", 0), group("b", 1), group("child", 0, "b")]);
    await useAuraStore.getState().moveGroup("a", null, "deleted-anchor");
    await useAuraStore.getState().moveGroup("a", null, "child");
    expect(useAuraStore.getState().data).toBe(original);
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps nesting depth and self-parent protections", async () => {
    const original = seed([group("first", 0), group("second", 1), group("child", 0, "first")]);
    await expect(useAuraStore.getState().moveGroup("first", "first")).rejects.toThrow();
    await expect(useAuraStore.getState().moveGroup("first", "second")).rejects.toThrow();
    await expect(useAuraStore.getState().moveGroup("second", "child")).rejects.toThrow();
    expect(useAuraStore.getState().data).toBe(original);
    expect(write).not.toHaveBeenCalled();
  });

  it("commits the selected link slot upward, downward, and at the end", async () => {
    seed([group("list", 0, null, [link("a", 0), link("b", 1), link("c", 2), link("d", 3)])]);
    await useAuraStore.getState().moveLink("c", "list", "a");
    expect(links("list")).toEqual(["c", "a", "b", "d"]);
    await useAuraStore.getState().moveLink("c", "list", "d");
    expect(links("list")).toEqual(["a", "b", "c", "d"]);
    await useAuraStore.getState().moveLink("a", "list");
    expect(links("list")).toEqual(["b", "c", "d", "a"]);
  });

  it("moves links between groups in displayed order even when backing arrays are unsorted", async () => {
    seed([
      group("source", 0, null, [link("c", 2), link("a", 0), link("b", 1)]),
      group("target", 1, null, [link("z", 2), link("x", 0), link("y", 1)])
    ]);
    await useAuraStore.getState().moveLink("b", "target", "y");
    expect(links("source")).toEqual(["a", "c"]);
    expect(links("target")).toEqual(["x", "b", "y", "z"]);
    expect(useAuraStore.getState().data!.groups.flatMap((item) => item.links).map((item) => item.id).sort())
      .toEqual(["a", "b", "c", "x", "y", "z"]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("moves a link into an empty group without losing its metadata", async () => {
    const moving = { ...link("a", 0), description: "Keep this description", tags: ["keep"] };
    seed([group("source", 0, null, [moving]), group("target", 1)]);
    await useAuraStore.getState().moveLink("a", "target");
    expect(links("source")).toEqual([]);
    expect(useAuraStore.getState().data!.groups.find((item) => item.id === "target")!.links[0])
      .toMatchObject(moving);
  });

  it("does not save, sync, or create history for an unchanged or stale link position", async () => {
    const original = seed([group("list", 0, null, [link("a", 0), link("b", 1), link("c", 2)])]);
    await useAuraStore.getState().moveLink("a", "list", "b");
    await useAuraStore.getState().moveLink("b", "list", "b");
    await useAuraStore.getState().moveLink("c", "list");
    await useAuraStore.getState().moveLink("a", "list", "deleted-anchor");
    expect(useAuraStore.getState().data).toBe(original);
    expect(write).not.toHaveBeenCalled();
    expect(stored[STORAGE_KEY]).toBeUndefined();
  });
});

describe("rapid drag persistence", () => {
  it("keeps the latest optimistic order while an older storage write finishes", async () => {
    stored[STORAGE_KEY] = structuredClone(seed([group("list", 0, null, [link("a", 0), link("b", 1), link("c", 2)])]));
    const firstStarted = deferred();
    const firstGate = deferred();
    const secondStarted = deferred();
    const secondGate = deferred();
    write.mockImplementationOnce(async (items) => { firstStarted.resolve(); await firstGate.promise; publish(items); });
    write.mockImplementationOnce(async (items) => { secondStarted.resolve(); await secondGate.promise; publish(items); });
    const first = useAuraStore.getState().moveLink("a", "list");
    await firstStarted.promise;
    const second = useAuraStore.getState().moveLink("c", "list", "b");
    const latest = useAuraStore.getState().data;
    expect(links("list")).toEqual(["c", "b", "a"]);
    firstGate.resolve();
    await first;
    await secondStarted.promise;
    expect(useAuraStore.getState().data).toBe(latest);
    expect(links("list")).toEqual(["c", "b", "a"]);
    secondGate.resolve();
    await second;
    expect(links("list")).toEqual(["c", "b", "a"]);
    const durable = await loadAuraData();
    if (durable.status !== "ready") throw new Error("Drag result was not persisted");
    expect(durable.data.groups).toEqual(useAuraStore.getState().data!.groups);
  });

  it("does not roll back a newer optimistic drag when the older save fails", async () => {
    stored[STORAGE_KEY] = structuredClone(seed([group("list", 0, null, [link("a", 0), link("b", 1), link("c", 2)])]));
    const firstStarted = deferred();
    const firstGate = deferred();
    const secondStarted = deferred();
    const secondGate = deferred();
    write.mockImplementationOnce(async () => { firstStarted.resolve(); await firstGate.promise; throw new Error("First write failed"); });
    write.mockImplementationOnce(async (items) => { secondStarted.resolve(); await secondGate.promise; publish(items); });
    const first = useAuraStore.getState().moveLink("a", "list").catch((error: unknown) => error);
    await firstStarted.promise;
    const second = useAuraStore.getState().moveLink("c", "list", "b");
    const latest = useAuraStore.getState().data;
    firstGate.resolve();
    expect(await first).toBeInstanceOf(Error);
    await secondStarted.promise;
    expect(useAuraStore.getState().data).toBe(latest);
    expect(links("list")).toEqual(["c", "b", "a"]);
    secondGate.resolve();
    await second;
    const durable = await loadAuraData();
    if (durable.status !== "ready") throw new Error("Latest successful drag was not persisted");
    expect(durable.data.groups).toEqual(useAuraStore.getState().data!.groups);
  });

  it("still restores durable data when the latest drag cannot be saved", async () => {
    const original = seed([group("list", 0, null, [link("a", 0), link("b", 1)])]);
    stored[STORAGE_KEY] = structuredClone(original);
    write.mockRejectedValueOnce(new Error("Disk write failed"));
    await expect(useAuraStore.getState().moveLink("a", "list")).rejects.toThrow("Disk write failed");
    expect(links("list")).toEqual(["a", "b"]);
    expect(useAuraStore.getState().error).toBe("Disk write failed");
  });

  it("defers intermediate own-storage events and applies the final durable merge", async () => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout, clearTimeout });
    vi.stubGlobal("document", { visibilityState: "hidden" });
    stored[STORAGE_KEY] = structuredClone(seed([group("list", 0, null, [link("a", 0), link("b", 1), link("c", 2)])]));
    const cleanup = installAuraStoreSyncLifecycle();
    const firstStarted = deferred();
    const firstGate = deferred();
    const secondStarted = deferred();
    const secondGate = deferred();
    write.mockImplementationOnce(async (items) => { firstStarted.resolve(); await firstGate.promise; publish(items); });
    write.mockImplementationOnce(async (items) => {
      secondStarted.resolve();
      await secondGate.promise;
      publish(items);
      // Simulate another page's durable preference change just after this
      // write, before its promise returns to the optimistic caller.
      const saved = items[STORAGE_KEY] as AuraStartData;
      const external = commitLocalSyncChanges(saved, { ...saved, settings: { ...saved.settings, theme: "light" } }, saved);
      publish({ [STORAGE_KEY]: external });
    });
    try {
      const first = useAuraStore.getState().moveLink("a", "list");
      await firstStarted.promise;
      const second = useAuraStore.getState().moveLink("c", "list", "b");
      const latest = useAuraStore.getState().data;
      firstGate.resolve();
      await first;
      await secondStarted.promise;
      expect(useAuraStore.getState().data).toBe(latest);
      expect(links("list")).toEqual(["c", "b", "a"]);
      secondGate.resolve();
      await second;
      await vi.waitFor(() => expect(useAuraStore.getState().data!.settings.theme).toBe("light"));
      expect(links("list")).toEqual(["c", "b", "a"]);
      const durable = await loadAuraData();
      if (durable.status !== "ready") throw new Error("Final drag was not persisted");
      expect(useAuraStore.getState().data!.groups).toEqual(durable.data.groups);
    } finally {
      firstGate.resolve();
      secondGate.resolve();
      cleanup();
    }
  });
});
