import { spawnSync } from "node:child_process";

const steps = [
  ["node", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["node", ["node_modules/vite/bin/vite.js", "build"]],
  ["node", ["scripts/validate-store.mjs"]]
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
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
