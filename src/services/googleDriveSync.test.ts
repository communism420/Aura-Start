import { describe, expect, it } from "vitest";
import {
  detectGoogleDriveBrowserOAuthCapability,
  detectGoogleDriveChromiumVariant,
  detectGoogleDriveInstallSource,
  fallbackChromiumAppRedirectUrl,
  GoogleDriveSyncError,
  isGoogleDriveAuthorizationUnavailable,
  mapDriveError,
  selectGoogleDriveAuthFlow,
  webOAuthRedirectPath
} from "./googleDriveSync";

const CHROME_EXTENSION_CLIENT_ID = "391557451047-aid8m01fhcbbbsqdbrqsjon58dp0q9kv.apps.googleusercontent.com";
const WEB_CLIENT_ID = "391557451047-i97jn2iuqfoc0igquhgo2lpp3q4vabim.apps.googleusercontent.com";
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

  it("uses Web OAuth in ambiguous Chrome-like browsers when fallback is configured", () => {
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

  it("prefers Web OAuth for unpacked dev installs when fallback is configured", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        installSource: "unpacked",
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("web_oauth");
  });

  it("can still use manifest OAuth for unpacked installs without a Web OAuth fallback", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        installSource: "unpacked"
      })
    ).toBe("chrome_identity");
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

  it("detects Chrome Web Store installs from the Google update URL", () => {
    const originalChrome = globalThis.chrome;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          id: "abcdefghijklmnopabcdefghijklmnop",
          getManifest: () => ({
            update_url: "https://clients2.google.com/service/update2/crx"
          })
        }
      }
    });

    try {
      expect(detectGoogleDriveInstallSource()).toBe("chrome_web_store");
    } finally {
      Object.defineProperty(globalThis, "chrome", { configurable: true, value: originalChrome });
    }
  });

  it("does not classify a missing extension ID as an unpacked install", () => {
    const originalChrome = globalThis.chrome;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          getManifest: () => ({})
        }
      }
    });

    try {
      expect(detectGoogleDriveInstallSource()).toBe("unknown");
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
  it("identifies Google Chrome and uses Chrome identity", async () => {
    const navigatorValue = {
      vendor: "Google Inc.",
      userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      userAgentData: {
        brands: [
          { brand: "Chromium", version: "125" },
          { brand: "Google Chrome", version: "125" }
        ]
      }
    };
    const variant = await withNavigator(
      navigatorValue,
      () => detectGoogleDriveChromiumVariant()
    );
    const capability = await withNavigator(
      navigatorValue,
      () => detectGoogleDriveBrowserOAuthCapability()
    );

    expect(variant).toBe("google_chrome");
    expect(capability).toBe("chrome_identity");
  });

  it("identifies plain Chromium and uses Web OAuth", async () => {
    const navigatorValue = {
      userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chromium/125.0.0.0 Safari/537.36",
      userAgentData: {
        brands: [{ brand: "Chromium", version: "125" }]
      }
    };
    const variant = await withNavigator(
      navigatorValue,
      () => detectGoogleDriveChromiumVariant()
    );
    const capability = await withNavigator(
      navigatorValue,
      () => detectGoogleDriveBrowserOAuthCapability()
    );

    expect(variant).toBe("chromium");
    expect(capability).toBe("web_oauth");
  });

  it("identifies ungoogled Chromium variants such as Helium and uses Web OAuth", async () => {
    const navigatorValue = {
      userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Helium/125.0.0.0 Chromium/125.0.0.0 Safari/537.36",
      userAgentData: {
        brands: [
          { brand: "Chromium", version: "125" },
          { brand: "Helium", version: "125" }
        ]
      }
    };
    const variant = await withNavigator(
      navigatorValue,
      () => detectGoogleDriveChromiumVariant()
    );
    const capability = await withNavigator(
      navigatorValue,
      () => detectGoogleDriveBrowserOAuthCapability()
    );

    expect(variant).toBe("ungoogled_chromium");
    expect(capability).toBe("web_oauth");
  });

  it("uses high entropy browser brands when low entropy brands are masked", async () => {
    const variant = await withNavigator(
      {
        userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        userAgentData: {
          brands: [{ brand: "Not A;Brand", version: "99" }],
          getHighEntropyValues: async () => ({
            fullVersionList: [
              { brand: "Chromium", version: "125.0.0.0" },
              { brand: "Helium", version: "125.0.0.0" }
            ]
          })
        }
      },
      () => detectGoogleDriveChromiumVariant()
    );

    expect(variant).toBe("ungoogled_chromium");
  });

  it("treats Chrome-like non-Google vendors as Chromium forks", async () => {
    const variant = await withNavigator(
      {
        vendor: "The Chromium Authors",
        userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
      },
      () => detectGoogleDriveChromiumVariant()
    );

    expect(variant).toBe("chromium_fork");
  });

  it("does not trust Chrome-like user agents without an explicit Google Chrome brand", async () => {
    const navigatorValue = {
      vendor: "Google Inc.",
      userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    };
    const variant = await withNavigator(
      navigatorValue,
      () => detectGoogleDriveChromiumVariant()
    );
    const capability = await withNavigator(
      navigatorValue,
      () => detectGoogleDriveBrowserOAuthCapability()
    );

    expect(variant).toBe("unknown");
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

describe("Google Drive Web OAuth redirect URI", () => {
  it("uses the build-time Web OAuth redirect path when configured", () => {
    expect(webOAuthRedirectPath()).toBe(__AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH__.trim());
  });

  it("builds a root chromiumapp.org fallback URL without a trailing slash when no custom path is used", () => {
    const originalChrome = globalThis.chrome;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          id: "pdhhnnmcampmmklkbbtfbmnijmgjliabi"
        }
      }
    });

    try {
      expect(fallbackChromiumAppRedirectUrl("")).toBe("https://pdhhnnmcampmmklkbbtfbmnijmgjliabi.chromiumapp.org");
    } finally {
      Object.defineProperty(globalThis, "chrome", { configurable: true, value: originalChrome });
    }
  });
});
