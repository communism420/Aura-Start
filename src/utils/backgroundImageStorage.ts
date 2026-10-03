const DATABASE_NAME = "aura-start-background-images";
const DATABASE_VERSION = 1;
const IMAGE_STORE = "images";
const MAX_CUSTOM_BACKGROUND_IMAGE_CHARS = 2_500_000;

/** Accept the same image formats and limit as the 2.0.5 local UI storage. */
export function normalizeCustomBackgroundImage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_CUSTOM_BACKGROUND_IMAGE_CHARS) return null;
  return /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);/i.test(value) ? value : null;
}

export function isBackgroundImageId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function imageId(image: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure image storage is unavailable.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(image));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function openImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Background image storage is unavailable."));
      return;
    }
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_STORE)) request.result.createObjectStore(IMAGE_STORE);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error("Background image storage could not be opened."));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("Close older Aura Start pages and retry saving the background image."));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

/** Content addressing keeps repeated uploads and Restore Points from duplicating image bytes. */
export async function storeBackgroundImage(dataUrl: string, expectedId?: string): Promise<string> {
  const image = normalizeCustomBackgroundImage(dataUrl);
  if (!image) throw new Error("The background image format or size is invalid.");
  const id = await imageId(image);
  if (expectedId !== undefined && (!isBackgroundImageId(expectedId) || expectedId !== id)) {
    throw new Error("The downloaded background image does not match its identifier.");
  }
  const database = await openImageDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("The background image could not be saved."));
      transaction.onerror = () => reject(transaction.error ?? new Error("The background image could not be saved."));
      transaction.objectStore(IMAGE_STORE).put(image, id);
    });
  } finally {
    database.close();
  }
  return id;
}

export async function loadBackgroundImage(id?: string | null): Promise<string | null> {
  if (id === undefined || id === null) return null;
  if (!isBackgroundImageId(id)) throw new Error("The background image identifier is invalid.");
  const database = await openImageDatabase();
  let value: unknown;
  try {
    value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_STORE, "readonly");
      const request = transaction.objectStore(IMAGE_STORE).get(id);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error("The background image could not be loaded."));
      transaction.onerror = () => reject(transaction.error ?? new Error("The background image could not be loaded."));
    });
  } finally {
    database.close();
  }
  if (value === undefined) return null;
  const image = normalizeCustomBackgroundImage(value);
  if (!image || await imageId(image) !== id) throw new Error("The saved background image is damaged.");
  return image;
}
