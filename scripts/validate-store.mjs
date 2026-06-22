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
  "https://www.googleapis.com/*",
  "https://oauth2.googleapis.com/*"
]);
const expectedLocaleDirs = new Set(["de", "en", "es", "fr", "pt_BR", "ru", "uk"]);
const oauthClientIdPattern = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const exampleOAuthClientIds = new Set([
  "123-example.apps.googleusercontent.com",
  "1234567890-abcdef.apps.googleusercontent.com"
]);
const webOAuthFallbackDisabled = process.env.AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK === "false";
const configuredWebOAuthClientId = process.env.AURA_GOOGLE_WEB_OAUTH_CLIENT_ID?.trim() ?? "";
const deviceOAuthFallbackDisabled = process.env.AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK === "false";
const configuredDeviceOAuthClientId = process.env.AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID?.trim() ?? "";
const configuredDeviceOAuthClientSecret = process.env.AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET?.trim() ?? "";
const hardFailures = [];
const warnings = [];

async function readEnvValue(name) {
  if (process.env[name]?.trim()) {
    return process.env[name].trim();
  }

  for (const file of [".env.local", ".env.production", ".env"]) {
    const path = join(root, file);
    if (!await exists(path)) {
      continue;
    }

    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || match[1] !== name) {
        continue;
      }

      return match[2].replace(/^["']|["']$/g, "").trim();
    }
  }

  return "";
}

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

function looksLikeExampleOAuthClientId(clientId) {
  const normalized = String(clientId).toLowerCase();
  return exampleOAuthClientIds.has(normalized)
    || normalized.includes("your_google_oauth_client_id")
    || normalized.includes("your-real-client-id")
    || normalized.includes("paste_real_client_id_here")
    || normalized.includes("placeholder")
    || normalized.includes("example");
}

const allowedRuntimeOAuthClientIds = new Set();
let configuredDeviceOAuthEnabled = false;
if (!webOAuthFallbackDisabled) {
  const webOAuthClientId = configuredWebOAuthClientId || await readEnvValue("AURA_GOOGLE_WEB_OAUTH_CLIENT_ID");
  if (webOAuthClientId && (!oauthClientIdPattern.test(webOAuthClientId) || looksLikeExampleOAuthClientId(webOAuthClientId))) {
    fail("AURA_GOOGLE_WEB_OAUTH_CLIENT_ID must be a real Google OAuth Web Client ID ending with .apps.googleusercontent.com.");
  } else if (webOAuthClientId) {
    allowedRuntimeOAuthClientIds.add(webOAuthClientId);
  }
}
if (!deviceOAuthFallbackDisabled) {
  const deviceOAuthClientId = configuredDeviceOAuthClientId || await readEnvValue("AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID");
  const deviceOAuthClientSecret = configuredDeviceOAuthClientSecret || await readEnvValue("AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET");
  if (deviceOAuthClientId || deviceOAuthClientSecret) {
    if (!deviceOAuthClientId || !deviceOAuthClientSecret) {
      fail("AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID and AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET must both be set when the Device OAuth fallback is enabled.");
    } else if (!oauthClientIdPattern.test(deviceOAuthClientId) || looksLikeExampleOAuthClientId(deviceOAuthClientId)) {
      fail("AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID must be a real Google OAuth Device Client ID ending with .apps.googleusercontent.com.");
    } else {
      allowedRuntimeOAuthClientIds.add(deviceOAuthClientId);
      configuredDeviceOAuthEnabled = true;
    }
  }
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

  const oauthClientId = typeof manifest.oauth2?.client_id === "string" ? manifest.oauth2.client_id.trim() : "";
  const oauthScopes = Array.isArray(manifest.oauth2?.scopes) ? manifest.oauth2.scopes : [];
  if (!oauthClientId) {
    fail("oauth2.client_id is required for optional Google Drive sync.");
  } else if (oauthClientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID") || looksLikeExampleOAuthClientId(oauthClientId)) {
    fail("oauth2.client_id is a placeholder, example, or demo value. Set AURA_GOOGLE_OAUTH_CLIENT_ID to a real Chrome Extension OAuth Client ID before building the store package.");
  } else if (!oauthClientIdPattern.test(oauthClientId)) {
    fail("oauth2.client_id must be a Google OAuth Client ID ending with .apps.googleusercontent.com.");
  }
  if (oauthScopes.length !== 1 || oauthScopes[0] !== "https://www.googleapis.com/auth/drive.appdata") {
    fail("Google Drive sync must request only the drive.appdata OAuth scope.");
  }
  if (oauthScopes.includes("https://www.googleapis.com/auth/drive") || oauthScopes.includes("https://www.googleapis.com/auth/drive.file")) {
    fail("Do not request full Google Drive or drive.file OAuth scopes in manifest.oauth2.");
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
  "${extensionId}.chromiumapp.org",
  "accounts.google.com/o/oauth2/v2/auth",
  "www.googleapis.com",
  "oauth2.googleapis.com",
  "googleapis.com/auth/drive.appdata",
  "googleapis.com/auth/drive.file",
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
  const isManifest = displayPath.replaceAll("\\", "/") === "dist/manifest.json";
  for (const { pattern, label } of remoteCodePatterns) {
    if (pattern.test(text)) {
      fail(`${displayPath} contains ${label}.`);
    }
  }

  if (!isManifest) {
    const webOAuthRedirectPathMatch = text.match(/WEB_OAUTH_REDIRECT_PATH\s*=\s*"([^"]*)"\.trim\(\)/);
    if (webOAuthRedirectPathMatch?.[1]) {
      fail(`${displayPath} contains a non-root Web OAuth redirect path (${webOAuthRedirectPathMatch[1]}). Chrome Web Store builds must use the root chromiumapp.org redirect.`);
    }

    const bundledOAuthClientIds = Array.from(new Set(text.match(/\b[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com\b/gi) ?? []));
    const unexpectedOAuthClientIds = bundledOAuthClientIds.filter((clientId) => !allowedRuntimeOAuthClientIds.has(clientId));
    if (unexpectedOAuthClientIds.length) {
      fail(`${displayPath} contains unexpected bundled OAuth Client ID(s): ${unexpectedOAuthClientIds.join(", ")}. Store runtime code may only embed explicitly configured fallback OAuth client IDs.`);
    }

    if (text.includes("accounts.google.com/o/oauth2/v2/auth") && unexpectedOAuthClientIds.length) {
      fail(`${displayPath} contains manual Google OAuth URL construction with an unexpected bundled OAuth Client ID.`);
    }

    if (text.includes("oauth2.googleapis.com/device/code") && !configuredDeviceOAuthEnabled) {
      fail(`${displayPath} contains Google Device OAuth code, but the Device OAuth fallback was not explicitly configured for validation.`);
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
