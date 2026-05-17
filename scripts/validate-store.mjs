import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
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
  "_locales/pt_BR/messages.json"
];

const allowedPermissions = new Set(["storage", "identity"]);
const allowedHostPermissions = new Set([
  "https://www.googleapis.com/*"
]);
const expectedLocaleDirs = new Set(["de", "en", "es", "fr", "pt_BR", "ru", "uk"]);
const exampleOAuthClientIds = new Set([
  "123-example.apps.googleusercontent.com",
  "1234567890-abcdef.apps.googleusercontent.com"
]);
const hardFailures = [];
const warnings = [];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function fail(message) {
  hardFailures.push(message);
}

function warn(message) {
  warnings.push(message);
}

for (const file of requiredFiles) {
  if (!await exists(join(dist, file))) {
    fail(`Missing required dist file: ${file}`);
  }
}

const localesDir = join(dist, "_locales");
if (await exists(localesDir)) {
  const localeDirs = (await readdir(localesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const locale of expectedLocaleDirs) {
    if (!localeDirs.includes(locale)) {
      fail(`Missing expected Chrome Web Store locale directory: _locales/${locale}`);
    }
  }

  for (const locale of localeDirs) {
    if (!expectedLocaleDirs.has(locale)) {
      fail(`Unexpected locale directory in dist: _locales/${locale}`);
    }
  }
}

const manifestPath = join(dist, "manifest.json");
if (await exists(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.manifest_version !== 3) {
    fail("manifest_version must be 3.");
  }

  if (manifest.default_locale !== "en") {
    fail("default_locale must be present and set to en when localized __MSG_* manifest strings are used.");
  }

  if (manifest.chrome_url_overrides?.newtab !== "newtab.html") {
    fail("chrome_url_overrides.newtab must point to newtab.html.");
  }

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of permissions) {
    if (!allowedPermissions.has(permission)) {
      fail(`Unexpected permission requested: ${permission}`);
    }
  }

  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  for (const hostPermission of hostPermissions) {
    if (!allowedHostPermissions.has(hostPermission)) {
      fail(`Unexpected host permission requested: ${hostPermission}`);
    }
  }

  if (manifest.optional_host_permissions?.length) {
    fail("optional_host_permissions must be empty or omitted.");
  }

  if (manifest.permissions?.includes("bookmarks") || manifest.permissions?.includes("history") || manifest.permissions?.includes("tabs")) {
    fail("Do not request bookmarks, history, or tabs permissions for this local-first bookmark database.");
  }

  const oauthScopes = Array.isArray(manifest.oauth2?.scopes) ? manifest.oauth2.scopes : [];
  if (!manifest.oauth2?.client_id) {
    fail("oauth2.client_id is required for optional Google Drive sync.");
  } else if (manifest.oauth2.client_id.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")) {
    warn("oauth2.client_id still contains the source placeholder. Set AURA_GOOGLE_OAUTH_CLIENT_ID before npm run build:store for a publishable package.");
  } else if (exampleOAuthClientIds.has(String(manifest.oauth2.client_id).toLowerCase())) {
    fail("oauth2.client_id is an example value. Set AURA_GOOGLE_OAUTH_CLIENT_ID to a real Google OAuth Client ID before building the store package.");
  }
  if (oauthScopes.length !== 1 || oauthScopes[0] !== "https://www.googleapis.com/auth/drive.appdata") {
    fail("Google Drive sync must request only the drive.appdata OAuth scope.");
  }
  if (oauthScopes.includes("https://www.googleapis.com/auth/drive") || oauthScopes.includes("https://www.googleapis.com/auth/drive.file")) {
    fail("Do not request full Google Drive or drive.file OAuth scopes.");
  }

  const csp = manifest.content_security_policy?.extension_pages ?? "";
  if (!csp.includes("script-src 'self'")) {
    fail("content_security_policy.extension_pages must restrict scripts to 'self'.");
  }
  if (!csp.includes("object-src 'none'")) {
    fail("content_security_policy.extension_pages must block object sources.");
  }
}

const codeFiles = (await walk(dist)).filter((file) => /\.(html|js|css|json)$/i.test(file));
const remoteCodePatterns = [
  { pattern: /<script[^>]+src=["']https?:\/\//i, label: "remote script tag" },
  { pattern: /import\s*\(\s*["']https?:\/\//i, label: "remote dynamic import" },
  { pattern: /fetch\s*\(\s*["']https?:\/\//i, label: "direct remote fetch" },
  { pattern: /\beval\s*\(/i, label: "eval call" },
  { pattern: /\bnew\s+Function\s*\(/i, label: "Function constructor" }
];

const benignUrlFragments = [
  "example.com",
  "afinestart.me/bookmarks",
  "reactjs.org/docs/error-decoder.html",
  "www.w3.org/1999/xlink",
  "www.w3.org/XML/1998/namespace",
  "www.w3.org/2000/svg",
  "www.w3.org/1998/Math/MathML",
  "www.w3.org/1999/xhtml",
  "${trimmed}",
  "accounts.google.com/o/oauth2/v2/auth",
  "www.googleapis.com",
  "oauth2.googleapis.com",
  "googleapis.com/auth/drive.appdata",
  "github.com",
  "developer.chrome.com",
  "news.ycombinator.com",
  "developer.mozilla.org",
  "web.dev",
  "wikipedia.org"
];

for (const file of codeFiles) {
  const text = await readFile(file, "utf8");
  const displayPath = relative(root, file);
  for (const { pattern, label } of remoteCodePatterns) {
    if (pattern.test(text)) {
      fail(`${displayPath} contains ${label}.`);
    }
  }

  const urls = text.match(/https?:\/\/[^\s"'`<>)]+/g) ?? [];
  const reviewRelevantUrls = urls.filter((url) => !benignUrlFragments.some((fragment) => url.includes(fragment)));
  if (reviewRelevantUrls.length) {
    warn(`${displayPath} contains URL strings that should be reviewed manually: ${Array.from(new Set(reviewRelevantUrls)).join(", ")}`);
  }
}

if (warnings.length) {
  console.warn("Chrome Web Store validation warnings:");
  for (const message of warnings) {
    console.warn(`- ${message}`);
  }
}

if (hardFailures.length) {
  console.error("Chrome Web Store validation failed:");
  for (const message of hardFailures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log("Chrome Web Store validation passed.");
