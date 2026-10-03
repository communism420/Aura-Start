import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../constants";
import { createEmptyData } from "../utils/sampleData";
import { installGoogleDriveSyncPageLifecycle, isGoogleDriveAutoSyncActive } from "./googleDriveSyncLifecycle";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  poll: vi.fn(),
  addStorageListener: vi.fn((_listener: unknown) => true),
  removeStorageListener: vi.fn()
}));
vi.mock("./googleDriveBackgroundSync", () => ({
  requestGoogleDriveBackgroundSync: mocks.request, requestGoogleDriveBackgroundPoll: mocks.poll
}));
vi.mock("../utils/browserApi", () => ({
  addExtensionStorageChangeListener: mocks.addStorageListener,
  removeExtensionStorageChangeListener: mocks.removeStorageListener
}));

let pageWindow: EventTarget;
let pageDocument: EventTarget & { visibilityState: string };
let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ status: "in_sync" });
  mocks.poll.mockResolvedValue({ status: "in_sync", quiet: true });
  pageWindow = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  pageDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", pageWindow);
  vi.stubGlobal("document", pageDocument);
  vi.stubGlobal("navigator", { onLine: true, language: "en", languages: ["en"] });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Google Drive page lifecycle", () => {
  it("never requests dirty recovery on mount, focus, visibility changes, or elapsed page time", async () => {
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => true, onDataChanged: vi.fn() });
    pageWindow.dispatchEvent(new Event("focus"));
    pageDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(300_000);
    pageDocument.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(300_000);
    pageDocument.visibilityState = "visible";
    pageDocument.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.request).not.toHaveBeenCalled();

    cleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    pageWindow.dispatchEvent(new Event("focus"));
    pageWindow.dispatchEvent(new Event("online"));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.removeStorageListener).toHaveBeenCalledWith(mocks.addStorageListener.mock.calls[0][0]);
  });

  it("quietly polls a clean visible page after five seconds, without opening/focus requests", async () => {
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => false, canPollRemote: () => true, onDataChanged: vi.fn() });
    pageWindow.dispatchEvent(new Event("focus"));
    pageDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mocks.poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.poll).toHaveBeenCalledTimes(3);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("suspends fast checks while hidden, offline, or disconnected and does not poll immediately on return", async () => {
    let connected = true;
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => false, canPollRemote: () => connected, onDataChanged: vi.fn() });
    pageDocument.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(10_000);
    pageDocument.visibilityState = "visible";
    pageDocument.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.poll).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.poll).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
    connected = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.poll).not.toHaveBeenCalled();
    connected = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.poll).toHaveBeenCalledTimes(1);
  });

  it("waits for a slow check, then schedules five seconds from completion without overlapping", async () => {
    let finish: (() => void) | undefined;
    mocks.poll.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => false, canPollRemote: () => true, onDataChanged: vi.fn() });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(mocks.poll).toHaveBeenCalledTimes(1);
    finish?.();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mocks.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.poll).toHaveBeenCalledTimes(2);
  });

  it("uses the remaining shared cooldown instead of adding another five-second delay", async () => {
    mocks.poll.mockResolvedValueOnce({ status: "skipped", reason: "not_dirty", pollAfterMs: 1_234 });
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => false, canPollRemote: () => true, onDataChanged: vi.fn() });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_233);
    expect(mocks.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.poll).toHaveBeenCalledTimes(2);
  });

  it("honors background failure backoff without sending a page message every five seconds", async () => {
    mocks.poll.mockResolvedValueOnce({ status: "failed", message: "Try later", pollAfterMs: 60_000 });
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => false, canPollRemote: () => true, onDataChanged: vi.fn() });
    await vi.advanceTimersByTimeAsync(64_999);
    expect(mocks.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.poll).toHaveBeenCalledTimes(2);
  });

  it("keeps scheduling after a failed message but cancels pending or in-flight work on teardown", async () => {
    mocks.poll.mockRejectedValueOnce(new Error("Background restarting"));
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => false, canPollRemote: () => true, onDataChanged: vi.fn() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.poll).toHaveBeenCalledTimes(2);
    let finish: (() => void) | undefined;
    mocks.poll.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(5_000);
    cleanup();
    finish?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.poll).toHaveBeenCalledTimes(3);
  });

  it("requests only eligible dirty online recovery without overlapping slow requests", async () => {
    let pendingLocalChanges = false;
    let finish: (() => void) | undefined;
    mocks.request.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => pendingLocalChanges, onDataChanged: vi.fn() });
    pageWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.request).not.toHaveBeenCalled();
    pendingLocalChanges = true;
    pageWindow.dispatchEvent(new Event("online"));
    pageWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).not.toBe(true);
    finish?.();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    pageWindow.dispatchEvent(new Event("online"));
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it("retries dirty online recovery after a transient error without scheduling a page poll", async () => {
    mocks.request.mockRejectedValueOnce(new Error("offline"));
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => true, onDataChanged: vi.fn() });
    pageWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    pageWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it("delivers valid shared storage changes without reloading or scheduling sync", () => {
    const onDataChanged = vi.fn();
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => false, onDataChanged });
    const listener = mocks.addStorageListener.mock.calls[0][0] as unknown as (
      changes: Record<string, { newValue?: unknown }>, area: string
    ) => void;
    const data = createEmptyData();
    listener({ [STORAGE_KEY]: { newValue: data } }, "session");
    listener({ [STORAGE_KEY]: { newValue: { invalid: true } } }, "local");
    listener({ [STORAGE_KEY]: {} }, "local");
    expect(onDataChanged).not.toHaveBeenCalled();
    listener({ [STORAGE_KEY]: { newValue: data } }, "local");
    expect(onDataChanged).toHaveBeenCalledTimes(1);
    expect(onDataChanged.mock.calls[0][0].updatedAt).toBe(data.updatedAt);
    expect(mocks.request).not.toHaveBeenCalled();
    cleanup();
    listener({ [STORAGE_KEY]: { newValue: data } }, "local");
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("projects fallback storage updates without requesting network work", () => {
    const onDataChanged = vi.fn();
    cleanup = installGoogleDriveSyncPageLifecycle({ canSync: () => true, onDataChanged });
    const data = createEmptyData();
    const dispatch = (key: string, newValue: string | null) => {
      pageWindow.dispatchEvent(Object.assign(new Event("storage"), { key, newValue }));
    };
    dispatch("aura-start-ui-state-v1", JSON.stringify({ widgetNotes: "legacy local UI" }));
    dispatch(STORAGE_KEY, "broken JSON");
    dispatch(STORAGE_KEY, null);
    expect(onDataChanged).not.toHaveBeenCalled();
    dispatch(STORAGE_KEY, JSON.stringify(data));
    expect(onDataChanged).toHaveBeenCalledTimes(1);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("schedules silent recovery for enabled connections while respecting explicit pauses", () => {
    const data = createEmptyData();
    expect(isGoogleDriveAutoSyncActive(data)).toBe(false);
    data.settings.sync = { ...data.settings.sync, mode: "auto", connected: true };
    expect(isGoogleDriveAutoSyncActive(data)).toBe(true);
    data.settings.sync.reconnectRequired = true;
    expect(isGoogleDriveAutoSyncActive(data)).toBe(true);
    data.settings.sync.mode = "off";
    expect(isGoogleDriveAutoSyncActive(data)).toBe(false);
    expect(isGoogleDriveAutoSyncActive(undefined)).toBe(false);
  });
});
