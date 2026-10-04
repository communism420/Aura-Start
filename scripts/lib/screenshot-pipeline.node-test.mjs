import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);

test("an explicitly supplied outdated build is rejected before browser startup or output publication", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "aura-stale-build-test-"));
  try {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const expected = pkg.extensionVersions?.chromium ?? pkg.version;
    const outdated = expected === "0.0.0" ? "0.0.1" : "0.0.0";
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ version: outdated }));
    // A valid executable which must never be launched as a browser: the manifest
    // check must reject before attempting DevTools startup or needing newtab.html.
    await assert.rejects(run(process.execPath, [path.join(root, "scripts/generate-store-photos.mjs"), "--dist", directory, "--browser-path", process.execPath], { cwd: tmpdir(), timeout: 15000 }), (error) => {
      assert.equal(error.code, 1);
      assert.ok(error.stderr.includes(`package.json requires ${expected}`));
      assert.ok(!error.stdout.includes("Captured") && !error.stdout.includes("Saved:"));
      return true;
    });
    assert.equal(JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")).version, outdated);
  } finally {
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), await realpath(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("aura-stale-build-test-"));
    await rm(resolved, { recursive: true, force: true });
  }
});
