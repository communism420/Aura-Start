import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIREFOX_VERSION = "9.8.7";

function firefoxManifest(background: Record<string, unknown>) {
  return {
    manifest_version: 3,
    name: "Aura Start test",
    version: FIREFOX_VERSION,
    chrome_url_overrides: { newtab: "newtab.html" },
    chrome_settings_overrides: { homepage: "newtab.html" },
    background,
    permissions: ["storage"],
    optional_permissions: ["tabs"],
    browser_specific_settings: {
      gecko: {
        id: "aura-start-test@example.com",
        strict_min_version: "142.0",
        data_collection_permissions: {
          required: ["none"],
          optional: ["browsingActivity", "technicalAndInteraction"]
        }
      }
    }
  };
}

async function runFirefoxValidator(background: Record<string, unknown>, overrides: Record<string, unknown> = {}, finalize = false) {
  const root = await mkdtemp(join(tmpdir(), "aura-start-firefox-validation-"));
  const dist = join(root, "dist-firefox");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    version: FIREFOX_VERSION,
    extensionVersions: {
      chromium: "1.0.0",
      firefox: FIREFOX_VERSION
    }
  }, null, 2)}\n`, "utf8");
  await writeFile(join(dist, "manifest.json"), `${JSON.stringify({ ...firefoxManifest(background), ...overrides }, null, 2)}\n`, "utf8");
  await writeFile(join(dist, "newtab.html"), "<!doctype html><title>Aura Start</title>", "utf8");
  await writeFile(join(dist, "background.js"), 'import "./assets/shared.js";\n', "utf8");
  await writeFile(join(dist, "assets/shared.js"), "export {};\n", "utf8");

  try {
    if (finalize) {
      const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/finalize-firefox-build.mjs")], {
        cwd: root, encoding: "utf8", env: { ...process.env, AURA_FIREFOX_DIST_DIR: "dist-firefox", AURA_FIREFOX_EXTENSION_ID: "aura-start-test@example.com" }
      });
      expect(result.status, result.stderr).toBe(0);
    }
    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/validate-firefox-build.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, AURA_FIREFOX_DIST_DIR: "dist-firefox" }
    });
    return { ...result, manifest: JSON.parse(await readFile(join(dist, "manifest.json"), "utf8")) };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("Firefox build background validation", () => {
  it("accepts Vite background imports when Firefox loads the entry as a module", async () => {
    const result = await runFirefoxValidator({ scripts: ["background.js"], type: "module" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Firefox build validation passed");
  });

  it("rejects a classic Firefox background before release packaging", async () => {
    const result = await runFirefoxValidator({ scripts: ["background.js"] });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("type: module");
  });
});

describe("Firefox home and new-window build configuration", () => {
  it("finalizes a shared Chromium manifest with both Firefox page overrides and no new permissions", async () => {
    const result = await runFirefoxValidator({ service_worker: "background.js", type: "module" }, {
      chrome_settings_overrides: undefined,
      permissions: ["storage", "identity", "alarms"],
      oauth2: { client_id: "placeholder.apps.googleusercontent.com" }
    }, true);
    expect(result.status, result.stderr).toBe(0);
    expect(result.manifest.chrome_settings_overrides).toEqual({ homepage: "newtab.html" });
    expect(result.manifest.chrome_url_overrides).toEqual({ newtab: "newtab.html" });
    expect(result.manifest.permissions).toEqual(["storage", "alarms"]);
    expect(result.manifest.optional_permissions).toEqual(["tabs"]);
    expect(result.manifest.oauth2).toBeUndefined();
  });

  it.each([undefined, { homepage: "https://example.com" }, { homepage: "newtab.html", search_provider: {} }])("rejects a missing, remote, or unrelated settings override: %j", async (chrome_settings_overrides) => {
    const result = await runFirefoxValidator({ scripts: ["background.js"], type: "module" }, { chrome_settings_overrides });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/homepage|settings overrides/);
  });
});
