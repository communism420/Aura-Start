import { describe, expect, it } from "vitest";
import { createEmptyData } from "../utils/sampleData";
import {
  GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT,
  GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST,
  hasPendingGoogleDriveLocalChanges,
  isGoogleDriveBackgroundSyncEvent,
  isGoogleDriveBackgroundSyncRequest,
  shouldQueueGoogleDriveBackgroundSync
} from "./googleDriveBackgroundSync";

function connectedData() {
  const data = createEmptyData();
  data.updatedAt = "2026-07-17T10:00:00.000Z";
  data.settings.sync = {
    ...data.settings.sync,
    mode: "auto",
    connected: true,
    deviceId: "device-test"
  };
  return data;
}

describe("Google Drive background sync scheduling", () => {
  it("queues connected auto sync when the local revision has not been uploaded", () => {
    const data = connectedData();
    data.settings.sync.lastSyncedLocalUpdatedAt = "2026-07-17T09:00:00.000Z";

    expect(hasPendingGoogleDriveLocalChanges(data)).toBe(true);
    expect(shouldQueueGoogleDriveBackgroundSync(data)).toBe(true);
  });

  it("does not queue metadata-only storage updates after the local revision was uploaded", () => {
    const data = connectedData();
    data.settings.sync.lastSyncedAt = "2026-07-17T10:00:05.000Z";
    data.settings.sync.lastSyncedLocalUpdatedAt = data.updatedAt;

    expect(hasPendingGoogleDriveLocalChanges(data)).toBe(false);
    expect(shouldQueueGoogleDriveBackgroundSync(data)).toBe(false);
  });

  it("does not retry automatic sync while an explicit OAuth reconnect is required", () => {
    const data = connectedData();
    data.settings.sync.reconnectRequired = true;
    data.settings.sync.lastSyncedLocalUpdatedAt = "2026-07-17T09:00:00.000Z";

    expect(hasPendingGoogleDriveLocalChanges(data)).toBe(true);
    expect(shouldQueueGoogleDriveBackgroundSync(data)).toBe(false);
  });

  it("migrates legacy sync state using lastSyncedAt until a local revision marker exists", () => {
    const data = connectedData();
    data.settings.sync.lastSyncedAt = "2026-07-17T10:00:05.000Z";

    expect(hasPendingGoogleDriveLocalChanges(data)).toBe(false);
    data.updatedAt = "2026-07-17T10:00:06.000Z";
    expect(hasPendingGoogleDriveLocalChanges(data)).toBe(true);
  });

  it("recognizes only the background sync protocol messages", () => {
    expect(isGoogleDriveBackgroundSyncRequest({ type: GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST, force: true })).toBe(true);
    expect(isGoogleDriveBackgroundSyncRequest({ type: GOOGLE_DRIVE_BACKGROUND_SYNC_REQUEST, force: "yes" })).toBe(false);
    expect(isGoogleDriveBackgroundSyncRequest({ type: "other" })).toBe(false);
    expect(isGoogleDriveBackgroundSyncEvent({
      type: GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT,
      result: { status: "in_sync" }
    })).toBe(true);
    expect(isGoogleDriveBackgroundSyncEvent({
      type: GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT,
      result: { status: "failed" }
    })).toBe(false);
    expect(isGoogleDriveBackgroundSyncEvent({ type: GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT })).toBe(false);
  });
});
