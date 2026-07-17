import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIREFOX_VERSION = "9.8.7";

function firefoxManifest(background: Record<string, unknown>) {
  return {
    manifest_version: 3,
    name: "Aura Start test",
    version: FIREFOX_VERSION,
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

async function runFirefoxValidator(background: Record<string, unknown>) {
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
  await writeFile(join(dist, "manifest.json"), `${JSON.stringify(firefoxManifest(background), null, 2)}\n`, "utf8");
  await writeFile(join(dist, "background.js"), 'import "./assets/shared.js";\n', "utf8");
  await writeFile(join(dist, "assets/shared.js"), "export {};\n", "utf8");

  try {
    return spawnSync(process.execPath, [join(process.cwd(), "scripts/validate-firefox-build.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, AURA_FIREFOX_DIST_DIR: "dist-firefox" }
    });
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
