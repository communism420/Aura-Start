import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const VALID_CLIENT_ID = "391557451047-aid8m01fhcbbbsqdbrqsjon58dp0q9kv.apps.googleusercontent.com";
const BUNDLED_WEB_CLIENT_ID = "391557451047-i97jn2iuqfoc0igquhgo2lpp3q4vabim.apps.googleusercontent.com";
const VALID_WEB_CLIENT_ID = "391557451047-safewebfallbackclient.apps.googleusercontent.com";
const VALID_DEVICE_CLIENT_ID = "391557451047-safedevicefallbackclient.apps.googleusercontent.com";
const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const VALID_MANIFEST = {
  manifest_version: 3,
  name: "__MSG_extensionName__",
  description: "__MSG_extensionDescription__",
  version: "2.0.0",
  default_locale: "en",
  chrome_url_overrides: { newtab: "newtab.html" },
  permissions: ["storage", "identity"],
  optional_permissions: ["tabs"],
  host_permissions: ["https://www.googleapis.com/*", "https://oauth2.googleapis.com/*"],
  oauth2: {
    client_id: VALID_CLIENT_ID,
    scopes: [DRIVE_APPDATA_SCOPE]
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'"
  }
};

async function writeFixtureDist(manifest: unknown, js = "console.log('ok');"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aura-start-store-validation-"));
  const dist = join(root, "dist");
  const requiredFiles = [
    "manifest.json",
    "newtab.html",
    "options.html",
    "popup.html",
    "logo.png",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
    "_locales/en/messages.json",
    "_locales/de/messages.json",
    "_locales/es/messages.json",
    "_locales/fr/messages.json",
    "_locales/pt_BR/messages.json",
    "_locales/ru/messages.json",
    "_locales/uk/messages.json",
    "assets/app.js"
  ];

  await Promise.all(requiredFiles.map((file) => mkdir(join(dist, file, ".."), { recursive: true })));
  await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await Promise.all(
    requiredFiles
      .filter((file) => file !== "manifest.json" && file !== "assets/app.js")
      .map((file) => writeFile(join(dist, file), file.endsWith(".json") ? "{}" : "", "utf8"))
  );
  await writeFile(join(dist, "assets/app.js"), js, "utf8");
  return root;
}

async function runValidateStore(manifest: unknown, js?: string, env?: NodeJS.ProcessEnv) {
  const root = await writeFixtureDist(manifest, js);
  try {
    return spawnSync(process.execPath, [join(process.cwd(), "scripts/validate-store.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env }
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("Chrome Web Store validation OAuth guards", () => {
  it("passes a valid least-privilege OAuth manifest", async () => {
    const result = await runValidateStore(VALID_MANIFEST);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Chrome Web Store validation passed.");
  });

  it("fails on placeholder OAuth client IDs", async () => {
    const result = await runValidateStore({
      ...VALID_MANIFEST,
      oauth2: { ...VALID_MANIFEST.oauth2, client_id: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com" }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("placeholder");
  });

  it("fails on OAuth client IDs without the Google suffix", async () => {
    const result = await runValidateStore({
      ...VALID_MANIFEST,
      oauth2: { ...VALID_MANIFEST.oauth2, client_id: "not-a-google-client" }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".apps.googleusercontent.com");
  });

  it("fails unless the only OAuth scope is drive.appdata", async () => {
    const result = await runValidateStore({
      ...VALID_MANIFEST,
      oauth2: {
        ...VALID_MANIFEST.oauth2,
        scopes: [DRIVE_APPDATA_SCOPE, "https://www.googleapis.com/auth/drive.file"]
      }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("drive.appdata");
    expect(result.stderr).toContain("drive.file");
  });

  it("fails when tabs is requested as a required permission", async () => {
    const result = await runValidateStore({
      ...VALID_MANIFEST,
      permissions: ["storage", "identity", "tabs"]
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("required permissions");
  });

  it("fails when a Web OAuth client ID is bundled into runtime code without explicit fallback", async () => {
    const result = await runValidateStore(
      VALID_MANIFEST,
      `const webClient = "${BUNDLED_WEB_CLIENT_ID}";`
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unexpected bundled OAuth Client ID");
  });

  it("allows the configured Web OAuth fallback client", async () => {
    const result = await runValidateStore(
      VALID_MANIFEST,
      `const webClient = "${VALID_WEB_CLIENT_ID}"; const url = "https://accounts.google.com/o/oauth2/v2/auth";`,
      {
        AURA_GOOGLE_WEB_OAUTH_CLIENT_ID: VALID_WEB_CLIENT_ID
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Chrome Web Store validation passed.");
  });

  it("fails when a Chrome Web Store build enables Web OAuth fallback", async () => {
    const result = await runValidateStore(
      VALID_MANIFEST,
      `const webClient = "${VALID_WEB_CLIENT_ID}"; const url = "https://accounts.google.com/o/oauth2/v2/auth";`,
      {
        AURA_STORE_BUILD: "true",
        AURA_GOOGLE_WEB_OAUTH_CLIENT_ID: VALID_WEB_CLIENT_ID
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Chrome Web Store builds must not enable Web OAuth fallback");
  });

  it("allows the configured Device OAuth fallback client", async () => {
    const result = await runValidateStore(
      VALID_MANIFEST,
      `const deviceClient = "${VALID_DEVICE_CLIENT_ID}"; const endpoint = "https://oauth2.googleapis.com/device/code"; const scope = "${DRIVE_FILE_SCOPE}";`,
      {
        AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID: VALID_DEVICE_CLIENT_ID,
        AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET: "device-secret"
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Chrome Web Store validation passed.");
  });

  it("fails when Device OAuth code is bundled without explicit fallback configuration", async () => {
    const result = await runValidateStore(
      VALID_MANIFEST,
      `const endpoint = "https://oauth2.googleapis.com/device/code"; const scope = "${DRIVE_FILE_SCOPE}";`
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Device OAuth fallback was not explicitly configured");
  });

  it("fails when Device OAuth fallback is missing its secret", async () => {
    const result = await runValidateStore(
      VALID_MANIFEST,
      `const deviceClient = "${VALID_DEVICE_CLIENT_ID}"; const endpoint = "https://oauth2.googleapis.com/device/code";`,
      {
        AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID: VALID_DEVICE_CLIENT_ID
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID and AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET");
  });
});
