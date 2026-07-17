import { STORAGE_KEY } from "./constants";
import {
  GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT,
  isGoogleDriveBackgroundSyncRequest,
  runGoogleDriveBackgroundSync,
  shouldQueueGoogleDriveBackgroundSync,
  type GoogleDriveBackgroundSyncResult
} from "./services/googleDriveBackgroundSync";
import {
  addExtensionCommandListener,
  addExtensionRuntimeMessageListener,
  addExtensionRuntimeStartupListener,
  addExtensionStorageChangeListener,
  sendExtensionRuntimeMessage
} from "./utils/browserApi";

const TOGGLE_COMMAND_PALETTE_COMMAND = "toggle-command-palette";
const TOGGLE_COMMAND_PALETTE_MESSAGE = "aura-start:toggle-command-palette";

addExtensionCommandListener((command) => {
  if (command !== TOGGLE_COMMAND_PALETTE_COMMAND) return;
  void sendExtensionRuntimeMessage({ type: TOGGLE_COMMAND_PALETTE_MESSAGE });
});

let runningSync: Promise<GoogleDriveBackgroundSyncResult> | undefined;
let rerunRequested = false;
let forceRequested = false;

async function publishSyncResult(result: GoogleDriveBackgroundSyncResult): Promise<void> {
  if (result.status === "skipped") return;
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

addExtensionStorageChangeListener((changes, areaName) => {
  if (areaName !== "local") return;
  const changed = changes[STORAGE_KEY];
  if (!changed || !shouldQueueGoogleDriveBackgroundSync(changed.newValue)) return;
  void queueGoogleDriveSync();
});

addExtensionRuntimeStartupListener(() => {
  void queueGoogleDriveSync();
});

addExtensionRuntimeMessageListener((message, _sender, sendResponse) => {
  if (!isGoogleDriveBackgroundSyncRequest(message)) return;
  void queueGoogleDriveSync(Boolean(message.force)).then((result) => {
    try {
      sendResponse(result);
    } catch {
      // The initiating Aura Start page may have closed while the background task continued.
    }
  });
  return true;
});

// Resume a pending local revision whenever the background context itself restarts.
void queueGoogleDriveSync();

export {};
