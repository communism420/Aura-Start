import type { AuraSyncSettings } from "../types";
import { getExtensionStorageArea } from "../utils/browserApi";
import { loadAuraData, updateAuraData } from "../utils/storage";
import { getAuthToken, getConnectedAccountInfo } from "./googleDriveSync";

const ATTEMPT_KEY = "aura-start-google-drive-account-attempt-v1";
const RETRY_MS = 60_000;
const REFRESH_MS = 24 * 60 * 60_000;
type Attempt = { connection: string; attemptedAt: number };
let lastAttempt: Attempt | undefined;
let fallbackLock: Promise<unknown> = Promise.resolve();

function connectionKey(sync: AuraSyncSettings): string {
  return JSON.stringify([sync.deviceId, sync.connectionId, sync.mode, Boolean(sync.connected), Boolean(sync.reconnectRequired)]);
}

function isRecent(timestamp: number, interval: number): boolean {
  const elapsed = Date.now() - timestamp;
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < interval;
}

async function readAttempt(): Promise<Attempt | undefined> {
  try {
    const area = getExtensionStorageArea("local");
    const stored = area ? (await area.get(ATTEMPT_KEY))[ATTEMPT_KEY]
      : typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? "null") : undefined;
    if (stored && typeof stored.connection === "string" && typeof stored.attemptedAt === "number") return stored;
  } catch { /* An optional retry cursor must not break synchronization. */ }
  return lastAttempt;
}

async function refresh(started?: AuraSyncSettings, token?: string): Promise<void> {
  const loaded = await loadAuraData();
  if (loaded.status !== "ready" || !loaded.data.settings.sync.connected) return;
  const sync = loaded.data.settings.sync;
  const connection = connectionKey(sync);
  if (started && connectionKey(started) !== connection) return;
  if ((sync.accountEmail || sync.accountName) && sync.accountInfoUpdatedAt
    && isRecent(Date.parse(sync.accountInfoUpdatedAt), REFRESH_MS)) return;
  const attempt = await readAttempt();
  if ([lastAttempt, attempt].some((item) => item?.connection === connection && isRecent(item.attemptedAt, RETRY_MS))) return;

  lastAttempt = { connection, attemptedAt: Date.now() };
  try {
    const area = getExtensionStorageArea("local");
    if (area) await area.set({ [ATTEMPT_KEY]: lastAttempt });
    else if (typeof localStorage !== "undefined") localStorage.setItem(ATTEMPT_KEY, JSON.stringify(lastAttempt));
  } catch { /* The in-memory cooldown still prevents rapid local retries. */ }

  const account = await getConnectedAccountInfo(token ?? await getAuthToken(false));
  if (!account?.email && !account?.name) return;
  await updateAuraData((current) => {
    if (!current.settings.sync.connected || connectionKey(current.settings.sync) !== connection) return undefined;
    return { ...current, settings: { ...current.settings, sync: {
      ...current.settings.sync,
      accountEmail: account.email, accountName: account.name, accountAvatarUrl: undefined,
      accountInfoUpdatedAt: new Date().toISOString()
    } } };
  });
}

/** Optional, local-only identity hydration. Never starts consent or a file sync,
 * marks content dirty, changes connection status, or blocks sync on failure. */
export async function refreshGoogleDriveAccountInfo(started?: AuraSyncSettings, token?: string): Promise<void> {
  try {
    if (globalThis.navigator?.onLine === false) return;
    if (globalThis.navigator?.locks) {
      await navigator.locks.request("aura-start-drive-account", () => refresh(started, token));
    } else {
      const pending = fallbackLock.then(() => refresh(started, token));
      fallbackLock = pending.catch(() => undefined);
      await pending;
    }
  } catch { /* Retain cached account details and retry quietly on a later check. */ }
}
