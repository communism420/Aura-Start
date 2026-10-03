import { STORAGE_KEY } from "./constants";
import {
  GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT,
  isGoogleDriveBackgroundSyncRequest,
  runGoogleDriveBackgroundSync,
  shouldQueueGoogleDriveBackgroundSync,
  type GoogleDriveBackgroundSyncResult
} from "./services/googleDriveBackgroundSync";
import {
  addExtensionAlarmListener,
  addExtensionCommandListener,
  addExtensionRuntimeMessageListener,
  addExtensionRuntimeStartupListener,
  addExtensionStorageChangeListener,
  clearExtensionAlarm,
  createExtensionAlarm,
  getExtensionAlarm,
  sendExtensionRuntimeMessage
} from "./utils/browserApi";
import { loadAuraData } from "./utils/storage";
import {
  GOOGLE_DRIVE_SYNC_ALARM_NAME,
  GOOGLE_DRIVE_SYNC_ALARM_PERIOD_MINUTES,
  GOOGLE_DRIVE_VISIBLE_POLL_INTERVAL_MS,
  isGoogleDriveAutoSyncActive
} from "./services/googleDriveSyncLifecycle";

const TOGGLE_COMMAND_PALETTE_COMMAND = "toggle-command-palette";
const TOGGLE_COMMAND_PALETTE_MESSAGE = "aura-start:toggle-command-palette";

addExtensionCommandListener((command) => {
  if (command !== TOGGLE_COMMAND_PALETTE_COMMAND) return;
  void sendExtensionRuntimeMessage({ type: TOGGLE_COMMAND_PALETTE_MESSAGE });
});

let runningSync: Promise<GoogleDriveBackgroundSyncResult> | undefined;
let rerunRequested = false;
let forceRequested = false;
let alarmRefresh: Promise<void> = Promise.resolve();
let nextPollAt = 0;
let pollFailures = 0;

function recordPollCooldown(result: GoogleDriveBackgroundSyncResult): void {
  const failed = result.status === "failed" || result.status === "needs_reconnect";
  pollFailures = failed ? Math.min(pollFailures + 1, 4) : 0;
  nextPollAt = Date.now() + Math.min(60_000, GOOGLE_DRIVE_VISIBLE_POLL_INTERVAL_MS * 2 ** pollFailures);
}

function refreshGoogleDriveSyncAlarm(): Promise<void> {
  // Serialize changes so a completed disconnect cannot race an earlier alarm creation.
  alarmRefresh = alarmRefresh.catch(() => undefined).then(async () => {
    const loaded = await loadAuraData();
    const active = loaded.status === "ready" && isGoogleDriveAutoSyncActive(loaded.data);
    const alarm = await getExtensionAlarm(GOOGLE_DRIVE_SYNC_ALARM_NAME);
    if (!active) {
      if (alarm) await clearExtensionAlarm(GOOGLE_DRIVE_SYNC_ALARM_NAME);
    } else if (alarm?.periodInMinutes !== GOOGLE_DRIVE_SYNC_ALARM_PERIOD_MINUTES) {
      await createExtensionAlarm(GOOGLE_DRIVE_SYNC_ALARM_NAME, {
        delayInMinutes: GOOGLE_DRIVE_SYNC_ALARM_PERIOD_MINUTES,
        periodInMinutes: GOOGLE_DRIVE_SYNC_ALARM_PERIOD_MINUTES
      });
    }
  });
  return alarmRefresh;
}

async function publishSyncResult(result: GoogleDriveBackgroundSyncResult): Promise<void> {
  // A quiet successful check also clears a previous transient error in open
  // pages, including after a worker restart. Pages already connected ignore it.
  if (result.status === "skipped" || (result.status === "needs_reconnect" && result.quiet)) return;
  await sendExtensionRuntimeMessage({
    type: GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT,
    result
  });
}

async function drainSyncQueue(): Promise<GoogleDriveBackgroundSyncResult> {
  let result: GoogleDriveBackgroundSyncResult = { status: "skipped", reason: "not_dirty" };
  do {
    const force = forceRequested;
    rerunRequested = false;
    forceRequested = false;
    try {
      result = await runGoogleDriveBackgroundSync(force);
    } catch (error) {
      result = {
        status: "failed",
        message: error instanceof Error ? error.message : "Unexpected background sync failure."
      };
    }
    recordPollCooldown(result);
    await publishSyncResult(result);
  } while (rerunRequested);
  return result;
}

function queueGoogleDriveSync(force = false): Promise<GoogleDriveBackgroundSyncResult> {
  rerunRequested = true;
  forceRequested ||= force;
  if (!runningSync) {
    runningSync = drainSyncQueue().finally(() => {
      runningSync = undefined;
      if (rerunRequested) {
        void queueGoogleDriveSync(forceRequested);
      }
    });
  }
  return runningSync;
}

function queueGoogleDrivePoll(): Promise<GoogleDriveBackgroundSyncResult> {
  const withNextPoll = (result: GoogleDriveBackgroundSyncResult): GoogleDriveBackgroundSyncResult => ({
    ...result, pollAfterMs: Math.max(1, nextPollAt - Date.now())
  });
  // A timer must not set rerunRequested while an upload/download is running.
  // Local changes still use the ordinary queue and cannot be lost this way.
  if (runningSync) return runningSync.then(withNextPoll);
  if (Date.now() < nextPollAt) return Promise.resolve(withNextPoll({ status: "skipped", reason: "not_dirty", quiet: true }));
  return queueGoogleDriveSync(true).then(withNextPoll);
}

addExtensionStorageChangeListener((changes, areaName) => {
  if (areaName !== "local") return;
  const changed = changes[STORAGE_KEY];
  if (!changed) return;
  const active = isGoogleDriveAutoSyncActive(changed.newValue);
  const previouslyActive = isGoogleDriveAutoSyncActive(changed.oldValue);
  if (active !== previouslyActive
    || changed.newValue?.settings?.sync?.connectionId !== changed.oldValue?.settings?.sync?.connectionId) {
    nextPollAt = 0;
    pollFailures = 0;
  }
  if (active !== previouslyActive) void refreshGoogleDriveSyncAlarm().catch(() => undefined);
  if (active && !previouslyActive) void queueGoogleDriveSync(true);
  else if (shouldQueueGoogleDriveBackgroundSync(changed.newValue)) void queueGoogleDriveSync();
});

addExtensionRuntimeStartupListener(() => {
  void refreshGoogleDriveSyncAlarm().catch(() => undefined);
  void recoverPendingGoogleDriveChanges().catch(() => undefined);
});

addExtensionAlarmListener((alarm) => {
  if (alarm.name !== GOOGLE_DRIVE_SYNC_ALARM_NAME) return;
  void queueGoogleDrivePoll();
});

addExtensionRuntimeMessageListener((message, _sender, sendResponse) => {
  if (!isGoogleDriveBackgroundSyncRequest(message)) return;
  void (message.poll ? queueGoogleDrivePoll() : queueGoogleDriveSync(Boolean(message.force))).then((result) => {
    try {
      sendResponse(result);
    } catch {
      // The initiating Aura Start page may have closed while the background task continued.
    }
  });
  return true;
});

async function recoverPendingGoogleDriveChanges(): Promise<void> {
  const loaded = await loadAuraData();
  if (loaded.status === "ready" && shouldQueueGoogleDriveBackgroundSync(loaded.data)) {
    await queueGoogleDriveSync();
  }
}

// Recreate missing alarms and retry unsent edits without syncing clean data on context startup.
void refreshGoogleDriveSyncAlarm().catch(() => undefined);
void recoverPendingGoogleDriveChanges().catch(() => undefined);

export {};
