import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBackgroundImageId, loadBackgroundImage, normalizeCustomBackgroundImage, storeBackgroundImage } from "./backgroundImageStorage";

const IMAGE = "data:image/png;base64,aGVsbG8=";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function inspectImages<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<globalThis.IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("aura-start-background-images", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("images", "readwrite");
      const request = operation(transaction.objectStore("images"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

describe("content-addressed custom background storage", () => {
  it("retains all previously accepted image formats and rejects invalid or oversized data", () => {
    for (const format of ["png", "jpeg", "jpg", "webp", "gif", "svg+xml"]) {
      const image = `data:image/${format};base64,YQ==`;
      expect(normalizeCustomBackgroundImage(image)).toBe(image);
    }
    for (const invalid of [null, {}, "", "https://example.com/image.png", "data:text/html;test", IMAGE + "a".repeat(2_500_000)]) {
      expect(normalizeCustomBackgroundImage(invalid)).toBeNull();
    }
    expect(isBackgroundImageId("a".repeat(64))).toBe(true);
    expect(isBackgroundImageId("A".repeat(64))).toBe(false);
    expect(isBackgroundImageId("../image")).toBe(false);
  });

  it("stores exact bytes once per digest and survives separate database connections", async () => {
    const id = await storeBackgroundImage(IMAGE);
    expect(isBackgroundImageId(id)).toBe(true);
    expect(await loadBackgroundImage(id)).toBe(IMAGE);
    expect(await storeBackgroundImage(IMAGE, id)).toBe(id);
    expect(await inspectImages((store) => store.count())).toBe(1);
    const otherId = await storeBackgroundImage("data:image/webp;base64,b3RoZXI=");
    expect(otherId).not.toBe(id);
    expect(await inspectImages((store) => store.count())).toBe(2);
  });

  it("rejects mismatching downloaded identifiers before writing anything", async () => {
    const open = vi.spyOn(indexedDB, "open");
    await expect(storeBackgroundImage(IMAGE, "0".repeat(64))).rejects.toThrow(/does not match/);
    await expect(storeBackgroundImage("data:text/html;bad")).rejects.toThrow(/format or size/);
    expect(open).not.toHaveBeenCalled();
  });

  it("distinguishes a missing image from damaged stored bytes", async () => {
    expect(await loadBackgroundImage()).toBeNull();
    expect(await loadBackgroundImage(null)).toBeNull();
    expect(await loadBackgroundImage("0".repeat(64))).toBeNull();
    await expect(loadBackgroundImage("wrong-id")).rejects.toThrow(/identifier/);
    const id = await storeBackgroundImage(IMAGE);
    await inspectImages((store) => store.put("data:image/png;base64,Y29ycnVwdA==", id));
    await expect(loadBackgroundImage(id)).rejects.toThrow(/damaged/);
  });

  it("does not acknowledge an image when its write transaction aborts", async () => {
    await loadBackgroundImage("0".repeat(64));
    const originalTransaction = IDBDatabase.prototype.transaction;
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(function (this: IDBDatabase, ...args) {
      const transaction = originalTransaction.apply(this, args);
      const originalObjectStore = transaction.objectStore.bind(transaction);
      vi.spyOn(transaction, "objectStore").mockImplementation((name) => {
        const store = originalObjectStore(name);
        const originalPut = store.put.bind(store);
        vi.spyOn(store, "put").mockImplementation((...putArgs) => {
          const request = originalPut(...putArgs);
          transaction.abort();
          return request;
        });
        return store;
      });
      return transaction;
    });
    await expect(storeBackgroundImage(IMAGE)).rejects.toThrow(/could not be saved/);
    transactionSpy.mockRestore();
    expect(await inspectImages((store) => store.count())).toBe(0);
  });

  it("reports unavailable IndexedDB while leaving callers' source data untouched", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(storeBackgroundImage(IMAGE)).rejects.toThrow(/storage is unavailable/);
  });
});
