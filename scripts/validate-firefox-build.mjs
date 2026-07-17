import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveExtensionVersion } from "./extension-versions.mjs";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const firefoxVersion = resolveExtensionVersion(packageJson, "firefox");
const distDir = process.env.AURA_FIREFOX_DIST_DIR?.trim() || "dist-firefox";
const args = process.argv.slice(2);
const submitZipPath = join("Firefox Submit", `aura-start-${firefoxVersion}-firefox.zip`);
const zipArgIndex = args.indexOf("--zip");
const zipArgPath = zipArgIndex >= 0 ? args[zipArgIndex + 1]?.trim() ?? "" : "";
const zipPath = process.env.AURA_FIREFOX_ZIP_PATH?.trim()
  || zipArgPath
  || (args.includes("--submit-zip") ? submitZipPath : "");
const manifestPath = join(root, distDir, "manifest.json");
const errors = [];
const requiredOptionalDataCollection = ["browsingActivity", "technicalAndInteraction"];
const firefoxDataCollectionMinVersion = 142;
const unsafeHtmlPatterns = [
  {
    label: "assignment to innerHTML",
    pattern: /(?:\.innerHTML|\[\s*["']innerHTML["']\s*\])\s*(?:[+\-*/%]?=)/g
  },
  {
    label: "assignment to outerHTML",
    pattern: /(?:\.outerHTML|\[\s*["']outerHTML["']\s*\])\s*(?:[+\-*/%]?=)/g
  },
  {
    label: "call to insertAdjacentHTML",
    pattern: /(?:\.insertAdjacentHTML|\[\s*["']insertAdjacentHTML["']\s*\])\s*\(/g
  }
];

function fail(message) {
  errors.push(message);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false
  });

  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
    return "";
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    return "";
  }

  return result.stdout;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function lineNumberForIndex(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

async function listScannableFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listScannableFiles(path));
    } else if (entry.isFile() && /\.(?:js|mjs|cjs|html)$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

async function validateNoUnsafeHtmlSinks(directory, sourceLabel) {
  if (!await exists(directory)) {
    return;
  }

  for (const filePath of await listScannableFiles(directory)) {
    const source = await readFile(filePath, "utf8");
    for (const { label, pattern } of unsafeHtmlPatterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const relativePath = filePath.slice(directory.length + 1).replaceAll("\\", "/");
        fail(`${sourceLabel}/${relativePath}:${lineNumberForIndex(source, match.index ?? 0)} contains unsafe HTML sink: ${label}.`);
      }
    }
  }
}

function validateManifest(manifest, sourceLabel) {
  if (manifest.manifest_version !== 3) {
    fail(`${sourceLabel}: manifest_version must be 3.`);
  }

  if (manifest.version !== firefoxVersion) {
    fail(`${sourceLabel}: manifest version ${manifest.version} does not match configured Firefox extension version ${firefoxVersion}.`);
  }

  if (manifest.oauth2) {
    fail(`${sourceLabel}: Firefox manifest must not contain Chrome-only oauth2.`);
  }

  if ((manifest.permissions ?? []).includes("identity")) {
    fail(`${sourceLabel}: Firefox manifest must not request Chrome-only identity permission.`);
  }

  if (!manifest.background?.scripts?.includes("background.js")) {
    fail(`${sourceLabel}: Firefox manifest must use background.scripts with background.js.`);
  }

  if (manifest.background?.service_worker) {
    fail(`${sourceLabel}: Firefox manifest must not contain Chromium-only background.service_worker.`);
  }

  if (manifest.background?.type !== "module") {
    fail(`${sourceLabel}: Firefox background.scripts must use type: module because the Vite background entry contains ES module imports.`);
  }

  if (!manifest.optional_permissions?.includes("tabs")) {
    fail(`${sourceLabel}: Firefox optional tabs permission is missing.`);
  }

  const gecko = manifest.browser_specific_settings?.gecko;
  if (!gecko?.id) {
    fail(`${sourceLabel}: browser_specific_settings.gecko.id is required.`);
  }

  const strictMinVersion = typeof gecko?.strict_min_version === "string" ? Number(gecko.strict_min_version.split(".")[0]) : 0;
  if (!Number.isFinite(strictMinVersion) || strictMinVersion < firefoxDataCollectionMinVersion) {
    fail(`${sourceLabel}: strict_min_version must be 142.0 or newer because Firefox for Android added data_collection_permissions support in 142.`);
  }

  const dataCollection = gecko?.data_collection_permissions;
  if (!dataCollection) {
    fail(`${sourceLabel}: browser_specific_settings.gecko.data_collection_permissions is required by Firefox Add-ons validation.`);
    return;
  }

  if (!Array.isArray(dataCollection.required)) {
    fail(`${sourceLabel}: data_collection_permissions.required must be an array.`);
  } else if (dataCollection.required.length < 1) {
    fail(`${sourceLabel}: data_collection_permissions.required must contain at least one item. Use ["none"] when no data collection is required at install time.`);
  } else if (dataCollection.required.length !== 1 || dataCollection.required[0] !== "none") {
    fail(`${sourceLabel}: data_collection_permissions.required must be ["none"] because Aura Start has no required data collection at install time.`);
  }

  if (!Array.isArray(dataCollection.optional)) {
    fail(`${sourceLabel}: data_collection_permissions.optional must be an array.`);
  } else {
    for (const permission of requiredOptionalDataCollection) {
      if (!dataCollection.optional.includes(permission)) {
        fail(`${sourceLabel}: data_collection_permissions.optional must include ${permission}.`);
      }
    }
  }
}

if (!await exists(manifestPath)) {
  fail(`Firefox dist manifest not found: ${manifestPath}`);
} else {
  validateManifest(JSON.parse(await readFile(manifestPath, "utf8")), `${distDir}/manifest.json`);
  await validateNoUnsafeHtmlSinks(join(root, distDir), distDir);
}

if (zipPath) {
  if (!await exists(zipPath)) {
    fail(`Firefox ZIP not found: ${zipPath}`);
  } else {
    const entries = run("tar", ["-tf", zipPath])
      .split(/\r?\n/)
      .map((entry) => entry.replaceAll("\\", "/"))
      .filter(Boolean);
    if (!entries.includes("manifest.json")) {
      fail("Firefox ZIP manifest.json must be at archive root.");
    }
    for (const entry of entries) {
      if (entry.startsWith("dist-firefox/") || entry.startsWith("src/") || entry.startsWith("docs/") || entry.startsWith("node_modules/") || entry.startsWith(".git/")) {
        fail(`Firefox ZIP contains forbidden path: ${entry}`);
      }
      if (entry.includes(".env")) {
        fail(`Firefox ZIP contains environment/secret-like path: ${entry}`);
      }
      if (entry.endsWith(".map")) {
        fail(`Firefox ZIP contains source map: ${entry}`);
      }
    }

    const temp = await mkdtemp(join(tmpdir(), "aura-start-firefox-zip-"));
    try {
      run("tar", ["-xf", zipPath, "-C", temp]);
      if (!errors.length) {
        validateManifest(JSON.parse(await readFile(join(temp, "manifest.json"), "utf8")), "Firefox ZIP manifest.json");
        await validateNoUnsafeHtmlSinks(temp, "Firefox ZIP");
      }
    } finally {
      await rm(temp, { force: true, recursive: true });
    }
  }
}

if (errors.length) {
  console.error("Firefox build validation failed:");
  for (const message of errors) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

const validatedTargets = [resolve(join(root, distDir))];
if (zipPath) {
  validatedTargets.push(resolve(zipPath));
}

console.log(`Firefox build validation passed: ${validatedTargets.join(", ")}`);
