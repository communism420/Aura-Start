import { describe, expect, it } from "vitest";
import {
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
