import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addExtensionAlarmListener,
  addExtensionStorageChangeListener,
  clearExtensionAlarm,
  createExtensionAlarm,
  getExtensionAlarm,
  removeExtensionStorageChangeListener,
  requestExtensionDataCollectionPermissions,
  requestExtensionPermission
} from "./browserApi";

type TestBrowserApi = {
  permissions: {
    contains: (permissions: Record<string, unknown>) => Promise<boolean>;
    request: (permissions: Record<string, unknown>) => Promise<boolean>;
  };
};

const globalWithBrowser = globalThis as typeof globalThis & {
  browser?: TestBrowserApi;
  chrome?: unknown;
};

function setBrowserApi(api: TestBrowserApi): void {
  Object.defineProperty(globalWithBrowser, "browser", {
    configurable: true,
    value: api
  });
  Object.defineProperty(globalWithBrowser, "chrome", {
    configurable: true,
    value: undefined
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(globalWithBrowser, "browser", {
    configurable: true,
    value: undefined
  });
});

describe("browser sync lifecycle APIs", () => {
  it("uses promise-based Firefox alarm APIs", async () => {
    const alarm = { name: "sync", scheduledTime: 100, periodInMinutes: 1 };
    const alarms = { get: vi.fn(async () => alarm), create: vi.fn(async () => undefined), clear: vi.fn(async () => true) };
    vi.stubGlobal("browser", { alarms });
    vi.stubGlobal("chrome", undefined);

    await expect(getExtensionAlarm("sync")).resolves.toEqual(alarm);
    await createExtensionAlarm("sync", { periodInMinutes: 1 });
    await expect(clearExtensionAlarm("sync")).resolves.toBe(true);
    expect(alarms.get).toHaveBeenCalledWith("sync");
    expect(alarms.create).toHaveBeenCalledWith("sync", { periodInMinutes: 1 });
  });

  it("uses Chromium alarm callbacks and accepts older synchronous alarm creation", async () => {
    const alarm = { name: "sync", scheduledTime: 100 };
    const alarms = {
      get: vi.fn((_name: string, callback: (value: typeof alarm) => void) => callback(alarm)),
      create: vi.fn(() => undefined),
      clear: vi.fn((_name: string, callback: (value: boolean) => void) => callback(true))
    };
    vi.stubGlobal("browser", undefined);
    vi.stubGlobal("chrome", { alarms });

    await expect(getExtensionAlarm("sync")).resolves.toEqual(alarm);
    await expect(createExtensionAlarm("sync", { periodInMinutes: 1 })).resolves.toBeUndefined();
    await expect(clearExtensionAlarm("sync")).resolves.toBe(true);
  });

  it("registers alarm listeners and removes storage listeners with the same callback", () => {
    const onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
    const onAlarm = { addListener: vi.fn() };
    const listener = vi.fn();
    vi.stubGlobal("browser", { storage: { onChanged }, alarms: { onAlarm } });

    expect(addExtensionAlarmListener(listener)).toBe(true);
    expect(addExtensionStorageChangeListener(listener)).toBe(true);
    removeExtensionStorageChangeListener(listener);
    expect(onAlarm.addListener).toHaveBeenCalledWith(listener);
    expect(onChanged.removeListener).toHaveBeenCalledWith(listener);
  });
});

describe("browser permission requests", () => {
  it("requests optional permissions without an async contains preflight", async () => {
    const calls: string[] = [];
    setBrowserApi({
      permissions: {
        contains: async () => {
          calls.push("contains");
          return false;
        },
        request: async () => {
          calls.push("request");
          return true;
        }
      }
    });

    await expect(requestExtensionPermission("tabs")).resolves.toBe(true);
    expect(calls).toEqual(["request"]);
  });

  it("requests Firefox data collection permissions without an async contains preflight", async () => {
    const calls: string[] = [];
    setBrowserApi({
      permissions: {
        contains: async () => {
          calls.push("contains");
          return false;
        },
        request: async () => {
          calls.push("request");
          return true;
        }
      }
    });

    await expect(requestExtensionDataCollectionPermissions(["browsingActivity"])).resolves.toBe(true);
    expect(calls).toEqual(["request"]);
  });
});
