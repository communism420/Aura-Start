import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = process.env.AURA_FIREFOX_DIST_DIR?.trim() || "dist-firefox";
const manifestPath = join(root, dist, "manifest.json");
const firefoxExtensionId = process.env.AURA_FIREFOX_EXTENSION_ID?.trim() || "aura-start@example.com";
const firefoxDataCollectionMinVersion = "142.0";

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const driveSyncDataCollectionPermissions = ["browsingActivity", "technicalAndInteraction"];

manifest.browser_specific_settings = {
  ...(manifest.browser_specific_settings ?? {}),
  gecko: {
    ...(manifest.browser_specific_settings?.gecko ?? {}),
    id: firefoxExtensionId,
    strict_min_version: firefoxDataCollectionMinVersion,
    data_collection_permissions: {
      required: ["none"],
      optional: driveSyncDataCollectionPermissions
    }
  }
};

manifest.background = {
  scripts: ["background.js"],
  type: "module"
};

delete manifest.oauth2;

manifest.permissions = Array.from(new Set([...(manifest.permissions ?? [])].filter((permission) => permission !== "identity")));
manifest.optional_permissions = Array.from(new Set([...(manifest.optional_permissions ?? [])]));

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Finalized Firefox manifest at ${manifestPath}.`);
