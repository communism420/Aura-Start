import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const zipPath = join(root, "Chrome Submit", `aura-start-${packageJson.version}-chrome-web-store.zip`);
const distDir = process.env.AURA_CHROME_DIST_DIR?.trim() || "dist";
const distManifestPath = join(root, distDir, "manifest.json");
const sourceManifestPath = join(root, "public", "manifest.json");
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
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

try {
  await stat(zipPath);
} catch {
  fail(`Chrome Submit ZIP not found: ${zipPath}`);
}

const entries = errors.length
  ? []
  : run("tar", ["-tf", zipPath])
      .split(/\r?\n/)
      .map((entry) => entry.replaceAll("\\", "/"))
      .filter(Boolean);

if (entries.length) {
  const entrySet = new Set(entries);
  const forbiddenPrefixes = [
    "dist/",
    "src/",
    "docs/",
    "Photo/",
    "Chrome Submit/",
    "node_modules/",
    ".git/",
    "release-artifacts/"
  ];

  if (!entrySet.has("manifest.json")) {
    fail("manifest.json must be at the ZIP root.");
  }

  for (const entry of entries) {
    if (entry === "." || entry === "./" || entry.startsWith("./")) {
      fail(`ZIP entry must not use a ./ prefix because Chrome Web Store may not treat it as root content: ${entry}`);
    }

    if (forbiddenPrefixes.some((prefix) => entry.startsWith(prefix))) {
      fail(`ZIP contains forbidden path: ${entry}`);
    }

    if (entry.includes(".env")) {
      fail(`ZIP contains an environment file or secret-like path: ${entry}`);
    }

    if (entry.endsWith(".map")) {
      fail(`ZIP contains a source map that should not be included in the Chrome Web Store package: ${entry}`);
    }
  }
}

async function readZipManifest() {
  if (errors.length) return undefined;

  const temp = await mkdtemp(join(tmpdir(), "aura-start-zip-"));
  try {
    run("tar", ["-xf", zipPath, "-C", temp, "manifest.json"]);
    if (errors.length) return undefined;
    return JSON.parse(await readFile(join(temp, "manifest.json"), "utf8"));
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}

const [sourceManifest, distManifest, zipManifest] = await Promise.all([
  readFile(sourceManifestPath, "utf8").then(JSON.parse),
  readFile(distManifestPath, "utf8").then(JSON.parse).catch(() => undefined),
  readZipManifest()
]);

if (zipManifest) {
  if (zipManifest.manifest_version !== 3) {
    fail("ZIP manifest_version must be 3.");
  }

  if (zipManifest.version !== packageJson.version) {
    fail(`ZIP manifest version ${zipManifest.version} does not match package.json version ${packageJson.version}.`);
  }

  if (zipManifest.version !== sourceManifest.version) {
    fail(`ZIP manifest version ${zipManifest.version} does not match public/manifest.json version ${sourceManifest.version}.`);
  }

  if (distManifest && JSON.stringify(zipManifest) !== JSON.stringify(distManifest)) {
    fail("ZIP manifest.json does not match dist/manifest.json. Rebuild or recreate the ZIP from current dist.");
  }

  if (zipManifest.background?.service_worker && !entries.includes(zipManifest.background.service_worker)) {
    fail(`ZIP manifest references missing background service worker: ${zipManifest.background.service_worker}`);
  }

  if (sourceManifest.background?.service_worker && zipManifest.background?.service_worker !== sourceManifest.background.service_worker) {
    fail("ZIP background service worker differs from public/manifest.json.");
  }

  if (JSON.stringify(zipManifest.commands ?? {}) !== JSON.stringify(sourceManifest.commands ?? {})) {
    fail("ZIP commands differ from public/manifest.json.");
  }

  const permissions = JSON.stringify(zipManifest.permissions ?? []);
  const hostPermissions = JSON.stringify(zipManifest.host_permissions ?? []);
  if (permissions !== JSON.stringify(sourceManifest.permissions ?? [])) {
    fail("ZIP permissions differ from public/manifest.json.");
  }
  if (hostPermissions !== JSON.stringify(sourceManifest.host_permissions ?? [])) {
    fail("ZIP host_permissions differ from public/manifest.json.");
  }

  const scopes = zipManifest.oauth2?.scopes ?? [];
  if (scopes.length !== 1 || scopes[0] !== "https://www.googleapis.com/auth/drive.appdata") {
    fail("ZIP must request only the Google Drive appDataFolder OAuth scope.");
  }

  if (String(zipManifest.oauth2?.client_id ?? "").includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")) {
    warn("ZIP contains the source OAuth placeholder. Rebuild with real AURA_GOOGLE_OAUTH_CLIENT_ID before Chrome Web Store upload.");
  }
}

if (warnings.length) {
  console.warn("Chrome Submit ZIP validation warnings:");
  for (const message of warnings) {
    console.warn(`- ${message}`);
  }
}

if (errors.length) {
  console.error("Chrome Submit ZIP validation failed:");
  for (const message of errors) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log(`Chrome Submit ZIP validation passed: ${resolve(zipPath)}`);
