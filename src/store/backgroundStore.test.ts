import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, UI_STATE_STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import { createEmptyData } from "../utils/sampleData";
import { loadAuraData, saveAuraData } from "../utils/storage";
import { useAuraStore } from "./useAuraStore";

const images = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock("../utils/backgroundImageStorage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../utils/backgroundImageStorage")>(),
  storeBackgroundImage: images.save,
  loadBackgroundImage: images.load
}));

const FIRST_ID = "a".repeat(64);
const SECOND_ID = "b".repeat(64);
const FIRST = "data:image/png;base64,YQ==";
const SECOND = "data:image/png;base64,Yg==";
let stored: Record<string, unknown>;
let rejectMainWrite: boolean;
let mainWriteGate: Promise<void> | undefined;
let mainWriteStarted: boolean;

async function seed(): Promise<AuraStartData> {
  const data = structuredClone(createEmptyData());
  data.settings.background.customImageId = null;
  data.settings.sync.deviceId = "image-device";
  const saved = await saveAuraData(data);
  useAuraStore.setState({ data: saved, status: "ready", customBackgroundImage: null });
  return saved;
}

async function durable(): Promise<AuraStartData> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready") throw new Error("Expected valid data");
  return loaded.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuraStore.setState({ data: null, status: "idle", customBackgroundImage: null, toasts: [] });
  stored = {};
  rejectMainWrite = false;
  mainWriteGate = undefined;
  mainWriteStarted = false;
  images.save.mockImplementation(async (image: string) => image === FIRST ? FIRST_ID : SECOND_ID);
  images.load.mockImplementation(async (id?: string | null) => id === FIRST_ID ? FIRST : id === SECOND_ID ? SECOND : null);
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"], language: "en" });
  vi.stubGlobal("chrome", undefined);
  vi.stubGlobal("browser", { storage: { local: {
    get: async (key: string) => stored[key] === undefined ? {} : { [key]: structuredClone(stored[key]) },
    set: async (items: Record<string, unknown>) => {
      if (rejectMainWrite && STORAGE_KEY in items) throw new Error("Storage quota exceeded");
      if (mainWriteGate && STORAGE_KEY in items) {
        mainWriteStarted = true;
        await mainWriteGate;
      }
      Object.assign(stored, structuredClone(items));
    },
    remove: async (key: string) => { delete stored[key]; }
  } } });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("custom background store integration", () => {
  it("saves the image and custom preset together and makes a small recoverable snapshot", async () => {
    await seed();
    await useAuraStore.getState().setCustomBackgroundImage(FIRST);
    const first = await durable();
    expect(first.settings.background).toMatchObject({ preset: "custom", customImageId: FIRST_ID });
    expect(first.syncReplica?.settings["background.customImageId"].stamp.counter).toBeGreaterThan(0);
    expect(useAuraStore.getState().customBackgroundImage).toBe(FIRST);
    await useAuraStore.getState().setCustomBackgroundImage(SECOND);
    const next = await durable();
    const point = next.restorePoints[0];
    expect(point.data.settings.background.customImageId).toBe(FIRST_ID);
    expect(JSON.stringify(stored)).not.toContain("data:image/");
    await useAuraStore.getState().restoreRestorePoint(point.id);
    expect((await durable()).settings.background.customImageId).toBe(FIRST_ID);
    expect(useAuraStore.getState().customBackgroundImage).toBe(FIRST);
  });

  it("removes an image with a causal deletion that can be restored", async () => {
    await seed();
    await useAuraStore.getState().setCustomBackgroundImage(FIRST);
    const before = await durable();
    await useAuraStore.getState().setCustomBackgroundImage(null);
    const removed = await durable();
    expect(removed.settings.background).toMatchObject({ preset: "none", customImageId: null });
    expect(removed.syncReplica?.settings["background.customImageId"].stamp.counter)
      .toBeGreaterThan(before.syncReplica!.settings["background.customImageId"].stamp.counter);
    expect(useAuraStore.getState().customBackgroundImage).toBeNull();
    await useAuraStore.getState().restoreRestorePoint(removed.restorePoints[0].id);
    expect(useAuraStore.getState().customBackgroundImage).toBe(FIRST);
  });

  it.each(["asset", "settings"] as const)("keeps the previous image if the %s write fails", async (failure) => {
    await seed();
    await useAuraStore.getState().setCustomBackgroundImage(FIRST);
    const before = await durable();
    if (failure === "asset") images.save.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    else rejectMainWrite = true;
    await expect(useAuraStore.getState().setCustomBackgroundImage(SECOND)).rejects.toThrow();
    rejectMainWrite = false;
    expect(await durable()).toEqual(before);
    expect(useAuraStore.getState().customBackgroundImage).toBe(FIRST);
  });

  it("does not let a late image read replace the current remote background", async () => {
    const data = await seed();
    let resolveFirst!: (image: string) => void;
    images.load.mockImplementation((id: string) => id === FIRST_ID
      ? new Promise<string>((resolve) => { resolveFirst = resolve; }) : Promise.resolve(SECOND));
    useAuraStore.setState({ data: { ...data, settings: { ...data.settings,
      background: { ...data.settings.background, preset: "custom", customImageId: FIRST_ID } } } });
    useAuraStore.setState({ data: { ...data, settings: { ...data.settings,
      background: { ...data.settings.background, preset: "custom", customImageId: SECOND_ID } } } });
    await vi.waitFor(() => expect(useAuraStore.getState().customBackgroundImage).toBe(SECOND));
    resolveFirst(FIRST);
    await Promise.resolve();
    expect(useAuraStore.getState().customBackgroundImage).toBe(SECOND);
  });

  it.each([SECOND, null])("keeps the latest selection when an earlier image write finishes late (%s)", async (latest) => {
    await seed();
    let resolveFirst!: (id: string) => void;
    images.save.mockImplementation((image: string) => image === FIRST
      ? new Promise<string>((resolve) => { resolveFirst = resolve; }) : Promise.resolve(SECOND_ID));
    const pending = useAuraStore.getState().setCustomBackgroundImage(FIRST);
    await useAuraStore.getState().setCustomBackgroundImage(latest);
    resolveFirst(FIRST_ID);
    await pending;
    expect((await durable()).settings.background.customImageId).toBe(latest === null ? null : SECOND_ID);
    expect(useAuraStore.getState().customBackgroundImage).toBe(latest);
  });

  it("refreshes the image on an incoming sync result without reopening the page", async () => {
    const data = await seed();
    const updated = await saveAuraData({ ...data, settings: { ...data.settings,
      background: { ...data.settings.background, preset: "custom", customImageId: SECOND_ID } } }, { baseline: data });
    await useAuraStore.getState().handleBackgroundGoogleDriveSyncResult({ status: "downloaded" });
    await vi.waitFor(() => expect(useAuraStore.getState().customBackgroundImage).toBe(SECOND));
    expect(useAuraStore.getState().data).toEqual(updated);
  });

  it("honors removal while an earlier settings write is already in progress", async () => {
    await seed();
    let releaseWrite!: () => void;
    mainWriteGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const pending = useAuraStore.getState().setCustomBackgroundImage(FIRST);
    await vi.waitFor(() => expect(mainWriteStarted).toBe(true));
    const removal = useAuraStore.getState().setCustomBackgroundImage(null);
    releaseWrite();
    await Promise.all([pending, removal]);
    expect((await durable()).settings.background.customImageId).toBeNull();
    expect(useAuraStore.getState().customBackgroundImage).toBeNull();
  });

  it("retains the current image when restoring a 2.0.5 point without image metadata", async () => {
    await seed();
    await useAuraStore.getState().setCustomBackgroundImage(FIRST);
    const data = await durable();
    const oldSettings = structuredClone(data.settings);
    delete oldSettings.background.customImageId;
    const withPoint = await saveAuraData({ ...data, restorePoints: [{
      id: "legacy", name: "2.0.5", reason: "manual", createdAt: data.updatedAt,
      data: { version: 1, updatedAt: data.updatedAt, groups: [], settings: oldSettings }
    }] });
    useAuraStore.setState({ data: withPoint });
    await useAuraStore.getState().restoreRestorePoint("legacy");
    expect((await durable()).settings.background.customImageId).toBe(FIRST_ID);
    expect(useAuraStore.getState().customBackgroundImage).toBe(FIRST);
  });

  it("keeps showing the 2.0.5 image and preserves bytes if migration fails", async () => {
    const old = structuredClone(createEmptyData());
    old.settings.background.preset = "custom";
    stored[STORAGE_KEY] = old;
    stored[UI_STATE_STORAGE_KEY] = { customBackgroundImage: FIRST, widgetNotes: "Private note" };
    images.save.mockRejectedValue(new Error("IndexedDB unavailable"));
    await useAuraStore.getState().load();
    expect(useAuraStore.getState().status).toBe("ready");
    expect(useAuraStore.getState().customBackgroundImage).toBe(FIRST);
    expect(useAuraStore.getState().toasts).toHaveLength(1);
    expect(stored[UI_STATE_STORAGE_KEY]).toMatchObject({ customBackgroundImage: FIRST });
    expect((stored[STORAGE_KEY] as AuraStartData).settings.background.customImageId).toBeUndefined();
  });
});
