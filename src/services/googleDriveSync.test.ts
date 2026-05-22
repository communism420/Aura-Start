import { describe, expect, it } from "vitest";
import { selectGoogleDriveAuthFlow } from "./googleDriveSync";

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

  it("allows explicit Web OAuth fallback when chrome.identity is known to be unsupported", () => {
    expect(
      selectGoogleDriveAuthFlow({
        hasIdentityApi: true,
        hasGetAuthToken: true,
        manifestClientId: CHROME_EXTENSION_CLIENT_ID,
        manifestScopes: [DRIVE_APPDATA_SCOPE],
        preferWebOAuth: true,
        webOAuthClientId: WEB_CLIENT_ID
      })
    ).toBe("web_oauth");
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
