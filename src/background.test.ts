import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "./constants";
import type { AuraStartData } from "./types";
import { createEmptyData } from "./utils/sampleData";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  getAlarm: vi.fn(),
  createAlarm: vi.fn(),
  clearAlarm: vi.fn(),
  storage: vi.fn((_listener: unknown) => true),
  alarm: vi.fn((_listener: unknown) => true),
  startup: vi.fn((_listener: unknown) => true),
  runtime: vi.fn((_listener: unknown) => true),
  load: vi.fn(),
  publish: vi.fn(async () => undefined)
}));
vi.mock("./services/googleDriveBackgroundSync", () => ({
  GOOGLE_DRIVE_BACKGROUND_SYNC_EVENT: "sync-result",
  isGoogleDriveBackgroundSyncRequest: (message: { type?: string }) => message?.type === "sync-request",
  runGoogleDriveBackgroundSync: mocks.run,
  requestGoogleDriveBackgroundSync: vi.fn(),
  shouldQueueGoogleDriveBackgroundSync: (value: AuraStartData | undefined) => Boolean(
    value?.settings.sync.connected && value.settings.sync.mode === "auto"
    && !value.settings.sync.reconnectRequired && value.updatedAt !== value.settings.sync.lastSyncedLocalUpdatedAt
  )
}));
vi.mock("./utils/browserApi", () => ({
  addExtensionCommandListener: vi.fn(),
  addExtensionRuntimeMessageListener: mocks.runtime,
  addExtensionRuntimeStartupListener: mocks.startup,
  addExtensionStorageChangeListener: mocks.storage,
  removeExtensionStorageChangeListener: vi.fn(),
  addExtensionAlarmListener: mocks.alarm,
  clearExtensionAlarm: mocks.clearAlarm,
  createExtensionAlarm: mocks.createAlarm,
  getExtensionAlarm: mocks.getAlarm,
  sendExtensionRuntimeMessage: mocks.publish
}));
vi.mock("./utils/storage", () => ({ loadAuraData: mocks.load }));

const alarmName = "aura-start:google-drive-poll";
let data: AuraStartData;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  data = createEmptyData();
  data.settings.sync = {
    ...data.settings.sync, mode: "auto", connected: true,
    lastSyncedLocalUpdatedAt: data.updatedAt
  };
  mocks.load.mockImplementation(async () => ({ status: "ready", data }));
  mocks.run.mockResolvedValue({ status: "in_sync" });
  mocks.getAlarm.mockResolvedValue(undefined);
  mocks.createAlarm.mockResolvedValue(undefined);
  mocks.clearAlarm.mockResolvedValue(true);
});

afterEach(() => { vi.useRealTimers(); });

function requestPoll() {
  const listener = mocks.runtime.mock.calls[0][0] as (
    message: unknown, sender: unknown, sendResponse: (result: unknown) => void
  ) => void;
  const reply = vi.fn();
  listener({ type: "sync-request", force: true, poll: true }, {}, reply);
  return reply;
}

async function flush() {
  for (let turn = 0; turn < 15; turn += 1) await Promise.resolve();
}

function storageChanged(previous: AuraStartData) {
  const listener = mocks.storage.mock.calls[0][0] as (
    changes: Record<string, chrome.storage.StorageChange>, area: string
  ) => void;
  listener({ [STORAGE_KEY]: { oldValue: previous, newValue: data } }, "local");
}

describe("Google Drive background polling", () => {
  it("coalesces simultaneous page checks and shares the cooldown with alarms", async () => {
    let finish: ((result: unknown) => void) | undefined;
    mocks.run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await import("./background");
    await flush();
    const first = requestPoll();
    const second = requestPoll();
    const third = requestPoll();
    const onAlarm = mocks.alarm.mock.calls[0][0] as (alarm: { name: string }) => void;
    onAlarm({ name: alarmName });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    finish?.({ status: "in_sync", quiet: true });
    await flush();
    for (const reply of [first, second, third]) expect(reply).toHaveBeenCalledWith({ status: "in_sync", quiet: true, pollAfterMs: 5_000 });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    const earlyReply = requestPoll();
    onAlarm({ name: alarmName });
    await flush();
    expect(earlyReply).toHaveBeenCalledWith({ status: "skipped", reason: "not_dirty", quiet: true, pollAfterMs: 1 });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    requestPoll();
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it("backs off passive failures without delaying a genuine local edit and resets after recovery", async () => {
    mocks.run.mockResolvedValue({ status: "failed", message: "Network unavailable", quiet: true });
    await import("./background");
    await flush();
    requestPoll();
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    requestPoll();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    requestPoll();
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(19_999);
    requestPoll();
    expect(mocks.run).toHaveBeenCalledTimes(2);
    mocks.run.mockResolvedValue({ status: "uploaded", reason: "updated" });
    const previous = structuredClone(data);
    data.updatedAt = "2027-01-01T00:00:00.000Z";
    storageChanged(previous);
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(3);
    expect(mocks.run).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(5_000);
    requestPoll();
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(4);
  });

  it("retains an edit made during a slow poll while joining other passive requests", async () => {
    let finish: ((result: unknown) => void) | undefined;
    mocks.run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await import("./background");
    await flush();
    requestPoll();
    const previous = structuredClone(data);
    data.updatedAt = "2027-01-01T00:00:00.000Z";
    storageChanged(previous);
    requestPoll();
    finish?.({ status: "in_sync", quiet: true });
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run).toHaveBeenNthCalledWith(1, true);
    expect(mocks.run).toHaveBeenNthCalledWith(2, false);
  });

  it("resets a previous connection's cooldown when the account connection changes", async () => {
    mocks.run.mockResolvedValue({ status: "needs_reconnect", message: "Previous grant expired" });
    await import("./background");
    await flush();
    requestPoll();
    await flush();
    const previous = structuredClone(data);
    data.settings.sync.connectionId = "replacement-connection";
    storageChanged(previous);
    requestPoll();
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it("publishes silent recovery so open pages can clear an old error after worker restart", async () => {
    mocks.run.mockResolvedValue({ status: "in_sync", quiet: true });
    await import("./background");
    await flush();
    const onAlarm = mocks.alarm.mock.calls[0][0] as (alarm: { name: string }) => void;
    onAlarm({ name: alarmName });
    await flush();
    expect(mocks.publish).toHaveBeenCalledWith({ type: "sync-result", result: { status: "in_sync", quiet: true } });
  });

  it("recreates a missing alarm without forcing startup sync and leaves remote checks to the alarm", async () => {
    await import("./background");
    await flush();
    expect(mocks.createAlarm).toHaveBeenCalledWith(alarmName, { delayInMinutes: 1, periodInMinutes: 1 });
    expect(mocks.run).not.toHaveBeenCalled();

    const onAlarm = mocks.alarm.mock.calls[0][0] as (alarm: { name: string }) => void;
    onAlarm({ name: "unrelated" });
    expect(mocks.run).not.toHaveBeenCalled();
    onAlarm({ name: alarmName });
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenLastCalledWith(true);
  });

  it("preserves a running alarm schedule and ignores metadata-only storage writes", async () => {
    mocks.getAlarm.mockResolvedValue({ name: alarmName, scheduledTime: Date.now() + 45_000, periodInMinutes: 1 });
    await import("./background");
    await flush();
    expect(mocks.createAlarm).not.toHaveBeenCalled();
    const previous = structuredClone(data);
    data.settings.sync.lastSyncedAt = "2026-09-12T10:00:00.000Z";
    storageChanged(previous);
    await flush();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.createAlarm).not.toHaveBeenCalled();
  });

  it("keeps silent recovery scheduled until the user explicitly pauses or disconnects", async () => {
    data.settings.sync.mode = "off";
    await import("./background");
    await flush();
    expect(mocks.createAlarm).not.toHaveBeenCalled();

    const disconnected = structuredClone(data);
    data.settings.sync.mode = "auto";
    storageChanged(disconnected);
    await flush();
    expect(mocks.createAlarm).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenLastCalledWith(true);

    mocks.getAlarm.mockResolvedValue({ name: alarmName, periodInMinutes: 1 });
    const connected = structuredClone(data);
    data.settings.sync.reconnectRequired = true;
    storageChanged(connected);
    await flush();
    expect(mocks.clearAlarm).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    const awaitingRecovery = structuredClone(data);
    data.settings.sync.mode = "off";
    storageChanged(awaitingRecovery);
    await flush();
    expect(mocks.clearAlarm).toHaveBeenCalledWith(alarmName);
  });

  it("recovers an unsent local revision after context restart without forcing a clean pull", async () => {
    data.settings.sync.lastSyncedLocalUpdatedAt = "2026-01-01T00:00:00.000Z";
    await import("./background");
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0]).not.toBe(true);
  });

  it("lets the service skip clean startup recovery without forcing a network check", async () => {
    await import("./background");
    await flush();
    const onStartup = mocks.startup.mock.calls[0][0] as () => void;
    onStartup();
    await flush();
    expect(mocks.run).not.toHaveBeenCalled();
    data.settings.sync.lastSyncedLocalUpdatedAt = "2026-01-01T00:00:00.000Z";
    onStartup();
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0]).not.toBe(true);
  });

  it("queues new shared revisions but ignores UI storage and clean recovery history changes", async () => {
    await import("./background");
    await flush();
    const listener = mocks.storage.mock.calls[0][0] as (
      changes: Record<string, chrome.storage.StorageChange>, area: string
    ) => void;
    listener({ "aura-start-ui-state-v1": { newValue: { lastSearchQuery: "local query" } } }, "local");
    const previous = structuredClone(data);
    data.restorePoints.push({ id: "local-point", name: "Recovery", createdAt: data.updatedAt, reason: "manual",
      data: { version: 1, updatedAt: data.updatedAt, settings: structuredClone(data.settings), groups: [] } });
    storageChanged(previous);
    await flush();
    expect(mocks.run).not.toHaveBeenCalled();
    const beforeEdit = structuredClone(data);
    data.updatedAt = "2027-01-01T00:00:00.000Z";
    data.settings.theme = "dark";
    storageChanged(beforeEdit);
    await flush();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0]).not.toBe(true);
  });
});
