import { spawnSync } from "node:child_process";

const deviceOAuthClientId =
  process.env.AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID?.trim()
  || process.env.AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID?.trim()
  || "";
const deviceOAuthClientSecret =
  process.env.AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET?.trim()
  || process.env.AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET?.trim()
  || "";
const allowMissingDeviceOAuth = process.env.AURA_FIREFOX_ALLOW_MISSING_DEVICE_OAUTH === "true";

if ((!deviceOAuthClientId || !deviceOAuthClientSecret) && !allowMissingDeviceOAuth) {
  console.error("Firefox builds require AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID and AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET so Google Drive sync can use Device OAuth. Set AURA_FIREFOX_ALLOW_MISSING_DEVICE_OAUTH=true only for local UI-only smoke builds.");
  process.exit(1);
}

const env = {
  ...process.env,
  AURA_STORE_BUILD: "false",
  AURA_TARGET_BROWSER: "firefox",
  AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK: "false",
  AURA_GOOGLE_WEB_OAUTH_CLIENT_ID: "",
  AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH: "",
  AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK: deviceOAuthClientId && deviceOAuthClientSecret ? "true" : "false",
  AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID: deviceOAuthClientId,
  AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET: deviceOAuthClientSecret,
  AURA_FIREFOX_DIST_DIR: "dist-firefox"
};

const steps = [
  ["node", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["node", ["node_modules/vite/bin/vite.js", "build", "--mode", "firefox", "--outDir", "dist-firefox"]],
  ["node", ["scripts/sanitize-firefox-js.mjs"]],
  ["node", ["scripts/finalize-firefox-build.mjs"]],
  ["node", ["scripts/validate-firefox-build.mjs"]]
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
