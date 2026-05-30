import { describe, expect, it } from "vitest";
import {
  detectGoogleDriveBrowserOAuthCapability,
  detectGoogleDriveInstallSource,
  GoogleDriveSyncError,
  isGoogleDriveAuthorizationUnavailable,
  mapDriveError,
  selectGoogleDriveAuthFlow
} from "./googleDriveSync";

const CHROME_EXTENSION_CLIENT_ID = "391557451047-aid8m01fhcbbbsqdbrqsjon58dp0q9kv.apps.googleusercontent.com";
const WEB_CLIENT_ID = "391557451047-rdtft86g9hcbst7mcs38h6t2jgkvrnm3.apps.googleusercontent.com";
const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

describe("Google Drive OAuth flow selection", () => {
  it("uses chrome.identity.getAuthToken when manifest OAuth is valid", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE]
      })
    ).toBe("chrome_identity");
  });

  it("does not let configured Web OAuth override valid manifest OAuth", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("chrome_identity");
  });

  it("does not use launchWebAuthFlow as the normal extension flow", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).not.toBe("web_oauth");
  });

  it("allows Web OAuth only when chrome.identity.getAuthToken is unavailable", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: false,
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("web_oauth");
  });

  it("uses Web OAuth in known non-Chrome Chromium browsers when fallback is configured", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        chromeIdentityUnsupported: true,
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("web_oauth");
  });

  it("keeps Chrome Web Store installs on manifest OAuth in supported Chrome identity environments", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        installSource: "chrome_web_store",
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("chrome_identity");
  });

  it("uses Web OAuth for Chrome Web Store installs when Chrome identity is unsupported", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        chromeIdentityUnsupported: true,
        installSource: "chrome_web_store",
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("web_oauth");
  });

  it("uses Web OAuth for Chrome Web Store installs without getAuthToken when fallback is configured", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: false,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        installSource: "chrome_web_store",
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("web_oauth");
  });

  it("does not use Web OAuth for Chrome Web Store installs without identity API", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: false,
        hasGetAuthToken: false,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        installSource: "chrome_web_store",
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("unavailable");
  });

  it("does not open Chrome identity OAuth in known unsupported browsers without Web OAuth fallback", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        chromeIdentityUnsupported: true
      })
    ).toBe("unavailable");
  });

  it("does not prefer Web OAuth over valid manifest OAuth", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("chrome_identity");
  });

  it("rejects manifest OAuth with a placeholder client or wrong scopes", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("unavailable");

    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: ["https://www.googleapis.com/auth/drive.file"],
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("unavailable");
  });
});

describe("Google Drive install source detection", () => {
  it("detects the published Chrome Web Store extension ID", () => {
    const originalChrome = globalThis.chrome;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          id: "pdhhnnmcampmmklkbbtfbmnijmgjliabi",
          getManifest: () => ({})
        }
      }
    });

    try {
      expect(detectGoogleDriveInstallSource()).toBe("chrome_web_store");
    } finally {
      Object.defineProperty(globalThis, "chrome", { configurable: true, value: originalChrome });
    }
  });

  it("detects unpacked installs when no store update URL is present", () => {
    const originalChrome = globalThis.chrome;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          id: "abcdefghijklmnopabcdefghijklmnop",
          getManifest: () => ({})
        }
      }
    });

    try {
      expect(detectGoogleDriveInstallSource()).toBe("unpacked");
    } finally {
      Object.defineProperty(globalThis, "chrome", { configurable: true, value: originalChrome });
    }
  });
});

function withNavigator<T>(navigatorValue: unknown, run: () => T): T {
  const originalNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigatorValue
  });

  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  }
}

describe("Google Drive browser OAuth capability detection", () => {
  it("uses Chrome identity for Google Chrome", async () => {
    const capability = await withNavigator(
      {
        userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        userAgentData: {
          brands: [
            { brand: "Chromium", version: "125" },
            { brand: "Google Chrome", version: "125" }
          ]
        }
      },
      () => detectGoogleDriveBrowserOAuthCapability()
    );

    expect(capability).toBe("chrome_identity");
  });

  it("uses Web OAuth for plain Chromium without the Google Chrome brand", async () => {
    const capability = await withNavigator(
      {
        userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chromium/125.0.0.0 Safari/537.36",
        userAgentData: {
          brands: [{ brand: "Chromium", version: "125" }]
        }
      },
      () => detectGoogleDriveBrowserOAuthCapability()
    );

    expect(capability).toBe("web_oauth");
  });

  it("uses Web OAuth for ungoogled Chromium variants such as Helium", async () => {
    const capability = await withNavigator(
      {
        userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Helium/125.0.0.0 Chromium/125.0.0.0 Safari/537.36",
        userAgentData: {
          brands: [
            { brand: "Chromium", version: "125" },
            { brand: "Helium", version: "125" }
          ]
        }
      },
      () => detectGoogleDriveBrowserOAuthCapability()
    );

    expect(capability).toBe("web_oauth");
  });
});

describe("Google Drive OAuth error handling", () => {
  it("recognizes revoked Chrome identity authorization", () => {
    const error = new GoogleDriveSyncError("auth_cancelled", "OAuth2 not granted or revoked.");

    expect(isGoogleDriveAuthorizationUnavailable(error)).toBe(true);
    expect(mapDriveError(error)).toBe("Google authorization expired or was revoked. Reconnect Google Drive to resume sync.");
  });

  it("does not treat an interactive cancellation as a revoked authorization", () => {
    const error = new GoogleDriveSyncError("auth_cancelled", "The user did not approve access.");

    expect(isGoogleDriveAuthorizationUnavailable(error)).toBe(false);
    expect(mapDriveError(error)).toBe("The user did not approve access.");
  });
});
