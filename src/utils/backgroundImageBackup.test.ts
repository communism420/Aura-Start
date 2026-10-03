import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuraStartData } from "../types";
import { importBackgroundImageBackup, registerBackgroundImageBackup } from "./backgroundImageBackup";
import { loadBackgroundImage, storeBackgroundImage } from "./backgroundImageStorage";
import { createJsonBackup, createPortableJsonBackup, exportJsonBackup } from "./exportJson";
import { parseJsonBackup } from "./importJson";
import { createEmptyData } from "./sampleData";

const downloads = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./download", () => ({ downloadTextFile: downloads.save }));

const FIRST = "data:image/png;base64,YQ==";
const SECOND = "data:image/webp;base64,Yg==";

function backupWithImages(currentId: string, previousIds: string[] = []): AuraStartData {
  const data = createEmptyData();
  data.settings.background = { ...data.settings.background, preset: "custom", customImageId: currentId };
  data.restorePoints = previousIds.map((id, index) => ({
    id: `point-${index}`, name: `Image ${index}`, reason: "manual", createdAt: data.updatedAt,
    data: {
      version: 1, updatedAt: data.updatedAt, groups: [],
      settings: { ...structuredClone(data.settings), background: { ...data.settings.background, customImageId: id } }
    }
  }));
  return data;
}

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("portable custom background backups", () => {
  it("exports each current or Restore Point image once and imports into another profile", async () => {
    const firstId = await storeBackgroundImage(FIRST);
    const secondId = await storeBackgroundImage(SECOND);
    const data = backupWithImages(firstId, [firstId, secondId, secondId]);
    const json = await createPortableJsonBackup(data);
    const raw = JSON.parse(json);
    expect(raw.backgroundImages).toEqual({ [firstId]: FIRST, [secondId]: SECOND });
    expect(json.split(FIRST)).toHaveLength(2);
    expect(json.split(SECOND)).toHaveLength(2);
    expect(data).not.toHaveProperty("backgroundImages");

    vi.stubGlobal("indexedDB", new IDBFactory());
    const imported = parseJsonBackup(json);
    // parseJsonBackup attaches the bundle outside the persisted data model.
    expect(imported).not.toHaveProperty("backgroundImages");
    expect(JSON.stringify(imported)).not.toContain("data:image/");
    await importBackgroundImageBackup(imported);
    expect(await loadBackgroundImage(firstId)).toBe(FIRST);
    expect(await loadBackgroundImage(secondId)).toBe(SECOND);
    expect(imported.restorePoints[1].data.settings.background.customImageId).toBe(secondId);
  });

  it("keeps legacy JSON encoding and import behavior when there are no image references", async () => {
    const data = createEmptyData();
    expect(await createPortableJsonBackup(data)).toBe(createJsonBackup(data));
    await expect(importBackgroundImageBackup(parseJsonBackup(createJsonBackup(data)))).resolves.toBeUndefined();
    expect(downloads.save).not.toHaveBeenCalled();
  });

  it("accepts an unbundled reference already available locally", async () => {
    const id = await storeBackgroundImage(FIRST);
    const data = parseJsonBackup(createJsonBackup(backupWithImages(id)));
    await expect(importBackgroundImageBackup(data)).resolves.toBeUndefined();
    expect(await loadBackgroundImage(id)).toBe(FIRST);
  });

  it("rejects an unavailable unbundled image before modifying imported data", async () => {
    const data = backupWithImages("a".repeat(64));
    const before = structuredClone(data);
    await expect(importBackgroundImageBackup(data)).rejects.toThrow(/not included and is unavailable/);
    expect(data).toEqual(before);
  });

  it("checks historical references as well as the active image", async () => {
    const currentId = await storeBackgroundImage(FIRST);
    const data = backupWithImages(currentId, ["b".repeat(64)]);
    await expect(createPortableJsonBackup(data)).rejects.toThrow(/unavailable/);
    await expect(importBackgroundImageBackup(data)).rejects.toThrow(/not included and is unavailable/);
  });

  it("rejects malformed, oversized, or unrelated asset bundles during parsing", async () => {
    const id = await storeBackgroundImage(FIRST);
    const data = backupWithImages(id);
    const invalid = [
      null,
      [],
      { "../image": FIRST },
      { ["f".repeat(64)]: FIRST },
      { [id]: "data:text/html;base64,YQ==" },
      { [id]: FIRST + "x".repeat(2_500_000) }
    ];
    for (const bundle of invalid) {
      expect(() => parseJsonBackup(JSON.stringify({ ...data, backgroundImages: bundle }))).toThrow(/background image/i);
    }
  });

  it("verifies an imported image hash before publishing its content", async () => {
    const data = backupWithImages("a".repeat(64));
    registerBackgroundImageBackup(data, { ["a".repeat(64)]: FIRST });
    await expect(importBackgroundImageBackup(data)).rejects.toThrow(/does not match/);
    expect(await loadBackgroundImage("a".repeat(64))).toBeNull();
  });

  it("copies the pending bundle so later caller mutation cannot replace verified input", async () => {
    const id = await storeBackgroundImage(FIRST);
    vi.stubGlobal("indexedDB", new IDBFactory());
    const data = backupWithImages(id);
    const bundle = { [id]: FIRST };
    registerBackgroundImageBackup(data, bundle);
    bundle[id] = SECOND;
    await importBackgroundImageBackup(data);
    expect(await loadBackgroundImage(id)).toBe(FIRST);
  });

  it("does not download an incomplete backup when an image is missing", async () => {
    await expect(exportJsonBackup(backupWithImages("a".repeat(64)))).rejects.toThrow(/not exported/);
    expect(downloads.save).not.toHaveBeenCalled();
    const id = await storeBackgroundImage(FIRST);
    await exportJsonBackup(backupWithImages(id));
    expect(downloads.save).toHaveBeenCalledOnce();
    expect(JSON.parse(downloads.save.mock.calls[0][1]).backgroundImages).toEqual({ [id]: FIRST });
  });
});
