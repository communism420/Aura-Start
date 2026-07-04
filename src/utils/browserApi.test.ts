import { afterEach, describe, expect, it } from "vitest";
import {
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
  Object.defineProperty(globalWithBrowser, "browser", {
    configurable: true,
    value: undefined
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
