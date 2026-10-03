import { STORAGE_KEY } from "../constants";
import type { AuraStartData } from "../types";
import {
  addExtensionStorageChangeListener,
  removeExtensionStorageChangeListener
} from "../utils/browserApi";
import { validateAuraData } from "../utils/importJson";
import { requestGoogleDriveBackgroundPoll, requestGoogleDriveBackgroundSync } from "./googleDriveBackgroundSync";

export const GOOGLE_DRIVE_SYNC_ALARM_NAME = "aura-start:google-drive-poll";
export const GOOGLE_DRIVE_SYNC_ALARM_PERIOD_MINUTES = 1;
export const GOOGLE_DRIVE_VISIBLE_POLL_INTERVAL_MS = 5_000;

export function isGoogleDriveAutoSyncActive(value: unknown): boolean {
  try {
    const { sync } = validateAuraData(value).settings;
    // Keep silent authorization recovery scheduled for an enabled connection.
    // Disconnected, explicitly paused and remotely deleted accounts stay off.
    return sync.mode === "auto" && Boolean(sync.connected);
  } catch {
    return false;
  }
}

type GoogleDriveSyncPageLifecycleOptions = {
  canSync: () => boolean;
  canPollRemote?: () => boolean;
  onDataChanged: (data: AuraStartData) => void | Promise<void>;
};

/** Keeps each open entry page current without reloading its local UI state. */
export function installGoogleDriveSyncPageLifecycle({
  canSync,
  canPollRemote = () => false,
  onDataChanged
}: GoogleDriveSyncPageLifecycleOptions): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;

  let disposed = false;
  let running = false;
  let pollTimer: number | undefined;
  const scheduleNextPoll = (delay = GOOGLE_DRIVE_VISIBLE_POLL_INTERVAL_MS) => {
    if (!disposed) pollTimer = window.setTimeout(pollRemoteChanges, delay);
  };
  const retryPendingChanges = () => {
    if (disposed || running || !canSync()) return;
    running = true;
    void requestGoogleDriveBackgroundSync(false)
      .catch(() => undefined)
      .finally(() => { running = false; });
  };

  const pollRemoteChanges = () => {
    if (disposed || running || document.visibilityState !== "visible"
      || globalThis.navigator?.onLine === false || !canPollRemote()) {
      scheduleNextPoll();
      return;
    }
    running = true;
    let nextDelay = GOOGLE_DRIVE_VISIBLE_POLL_INTERVAL_MS;
    // The background shares one cooldown across all pages and joins an
    // existing sync. Checking metadata never starts the page's sync animation.
    void requestGoogleDriveBackgroundPoll()
      .then((result) => {
        // Follow the shared deadline after a recent upload or another page's
        // check. Waiting a fresh five seconds on a skipped tick doubles delay.
        if (typeof result?.pollAfterMs === "number" && Number.isFinite(result.pollAfterMs)) {
          nextDelay = Math.min(60_000, Math.max(1, result.pollAfterMs));
        }
      })
      .catch(() => undefined)
      .finally(() => { running = false; scheduleNextPoll(nextDelay); });
  };

  const applyData = (value: unknown) => {
    if (disposed) return;
    try {
      const data = validateAuraData(value);
      void Promise.resolve(onDataChanged(data)).catch(() => undefined);
    } catch {
      // A malformed or removed storage value must never replace an open page's valid data.
    }
  };
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName === "local" && changes[STORAGE_KEY]?.newValue !== undefined) {
      applyData(changes[STORAGE_KEY].newValue);
    }
  };
  const onLocalStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { applyData(JSON.parse(event.newValue)); } catch { /* Ignore malformed fallback storage. */ }
  };

  addExtensionStorageChangeListener(onStorageChanged);
  window.addEventListener("storage", onLocalStorage);
  window.addEventListener("online", retryPendingChanges);
  // Opening/focusing a page does not itself request network work. Only the
  // delayed cadence checks remote revisions while this page remains visible.
  scheduleNextPoll();

  return () => {
    disposed = true;
    removeExtensionStorageChangeListener(onStorageChanged);
    window.removeEventListener("storage", onLocalStorage);
    window.removeEventListener("online", retryPendingChanges);
    window.clearTimeout(pollTimer);
  };
}
