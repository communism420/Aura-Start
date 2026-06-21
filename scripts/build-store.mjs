import { spawnSync } from "node:child_process";

const CHROME_WEB_STORE_WEB_OAUTH_CLIENT_ID = "391557451047-i97jn2iuqfoc0igquhgo2lpp3q4vabim.apps.googleusercontent.com";

const steps = [
  ["node", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["node", ["node_modules/vite/bin/vite.js", "build"]],
  ["node", ["scripts/validate-store.mjs"]]
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AURA_STORE_BUILD: "true",
      AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK: "true",
      AURA_GOOGLE_WEB_OAUTH_CLIENT_ID: process.env.AURA_GOOGLE_WEB_OAUTH_CLIENT_ID?.trim()
        || CHROME_WEB_STORE_WEB_OAUTH_CLIENT_ID,
      AURA_GOOGLE_WEB_OAUTH_REDIRECT_PATH: ""
    },
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
