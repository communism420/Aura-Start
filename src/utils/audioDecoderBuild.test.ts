import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { localAudioDecoderSdkPlugin, localizeAudioDecoderDefault, localizeAudioDecoderWorkerChunk } from "../../vite.config";

type Manifest = { content_security_policy?: { extension_pages: string } };
const validatorUrl = pathToFileURL(join(process.cwd(), "scripts/validate-audio-decoder.mjs")).href;
const { validateAudioDecoderBuild }: {
  validateAudioDecoderBuild: (directory: string, manifest: Manifest, options?: { expectedHashes?: Record<string, string> }) => Promise<string[]>
} = await import(/* @vite-ignore */ validatorUrl);

const MANIFEST = { content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none';" } };
const directoryRoots: string[] = [];
const fixtureCore = { "ffmpeg-core.js": "export default function createFFmpegCore() {}", "ffmpeg-core.wasm": "small binary fixture" };
const expectedHashes = Object.fromEntries(Object.entries(fixtureCore).map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")]));

afterEach(async () => {
  for (const directory of directoryRoots.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function createDistribution(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aura-audio-decoder-validation-"));
  directoryRoots.push(directory);
  const vendor = join(directory, "vendor", "ffmpeg");
  await mkdir(vendor, { recursive: true });
  await mkdir(join(directory, "assets"));
  for (const [name, bytes] of Object.entries(fixtureCore)) await writeFile(join(vendor, name), bytes);
  for (const name of ["NOTICE.txt", "FFMPEG-WASM-LICENSE.txt", "COPYING.GPLv2.txt"]) {
    await copyFile(join(process.cwd(), "public", "vendor", "ffmpeg", name), join(vendor, name));
  }
  await writeFile(join(directory, "assets", "worker-audio123.js"), "const FFMessageType = {}; self.onmessage = () => createFFmpegCore();");
  return directory;
}

describe("packaged audio decoder validation", () => {
  it("accepts a complete locally packaged distribution without allocating a full WASM fixture", async () => {
    const directory = await createDistribution();
    expect(await validateAudioDecoderBuild(directory, MANIFEST, { expectedHashes })).toEqual([]);
  });

  it("requires actual pinned hashes in release calls, never trusting filenames alone", async () => {
    const errors = await validateAudioDecoderBuild(await createDistribution(), MANIFEST);
    expect(errors.filter((message) => message.includes("pinned SHA-256"))).toHaveLength(2);
    expect(errors.join(" ")).not.toContain(fixtureCore["ffmpeg-core.js"]);
  });

  it("rejects a missing core or a changed WASM binary", async () => {
    const directory = await createDistribution();
    await rm(join(directory, "vendor", "ffmpeg", "ffmpeg-core.js"));
    await writeFile(join(directory, "vendor", "ffmpeg", "ffmpeg-core.wasm"), "corrupt bytes");
    const errors = await validateAudioDecoderBuild(directory, MANIFEST, { expectedHashes });
    expect(errors.some((message) => message.includes("missing") && message.includes("ffmpeg-core.js"))).toBe(true);
    expect(errors.some((message) => message.includes("ffmpeg-core.wasm") && message.includes("SHA-256"))).toBe(true);
  });

  it("rejects absent license material and a worker filename without a decoder implementation", async () => {
    const directory = await createDistribution();
    await rm(join(directory, "vendor", "ffmpeg", "COPYING.GPLv2.txt"));
    await writeFile(join(directory, "vendor", "ffmpeg", "NOTICE.txt"), "unrelated notice");
    await writeFile(join(directory, "assets", "worker-audio123.js"), "self.onmessage = () => {};");
    const errors = await validateAudioDecoderBuild(directory, MANIFEST, { expectedHashes });
    expect(errors.some((message) => message.includes("COPYING.GPLv2.txt"))).toBe(true);
    expect(errors.some((message) => message.includes("NOTICE.txt") && message.includes("incomplete"))).toBe(true);
    expect(errors.some((message) => message.includes("packaged FFmpeg worker"))).toBe(true);
  });

  it("allows WASM compilation while rejecting ordinary eval and remote script permission", async () => {
    const directory = await createDistribution();
    const manifest = { content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://example.org; object-src 'none';" } };
    const errors = await validateAudioDecoderBuild(directory, manifest, { expectedHashes });
    expect(errors.some((message) => message.includes("ordinary 'unsafe-eval'"))).toBe(true);
    expect(errors.some((message) => message.includes("unexpected source"))).toBe(true);
  });

  it("leaves legacy releases without the WASM CSP capability unchanged", async () => {
    const missingDirectory = join(tmpdir(), "aura-nonexistent-legacy-decoder-distribution");
    expect(await validateAudioDecoderBuild(missingDirectory, {})).toEqual([]);
    expect(await validateAudioDecoderBuild(missingDirectory, { content_security_policy: { extension_pages: "script-src 'self'; object-src 'none';" } })).toEqual([]);
  });

  it("rejects remote SDK defaults and variable code imports in a packaged worker", async () => {
    const directory = await createDistribution();
    await writeFile(join(directory, "assets", "worker-audio123.js"), 'const CORE_URL = "https://unpkg.com/@ffmpeg/core"; const FFMessageType = {}; self.onmessage = async () => { self.createFFmpegCore = (await import(_coreURL)).default; };');
    const errors = await validateAudioDecoderBuild(directory, MANIFEST, { expectedHashes });
    expect(errors.some((message) => message.includes("remote CORE_URL"))).toBe(true);
    expect(errors.some((message) => message.includes("literal local import"))).toBe(true);
  });

  it("localizes the pinned SDK and refuses unnoticed upstream loader changes", async () => {
    const id = join(process.cwd(), "node_modules/@ffmpeg/ffmpeg/dist/esm/const.js");
    const upstream = await readFile(id, "utf8");
    const localized = localizeAudioDecoderDefault(upstream, id);
    expect(localized).toContain('new URL("../vendor/ffmpeg/ffmpeg-core.js", self.location.href)');
    expect(localized).not.toContain("https://unpkg.com");
    expect(localizeAudioDecoderDefault(upstream, "/other/const.js")).toBeNull();
    expect(() => localizeAudioDecoderDefault(upstream.replace("export const CORE_URL", "export const DIFFERENT_URL"), id)).toThrow(/SDK default changed/);
    const worker = await readFile(join(process.cwd(), "node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js"), "utf8");
    const localizedWorker = localizeAudioDecoderWorkerChunk(worker);
    expect(localizedWorker).toContain('import("../vendor/ffmpeg/ffmpeg-core.js")');
    expect(localizedWorker).not.toContain("importScripts(_coreURL)");
    expect(localizedWorker).not.toMatch(/import\([\s\S]{0,40}_coreURL\)/);
    expect(() => localizeAudioDecoderWorkerChunk("changed SDK worker")).toThrow(/worker loader changed/);
  });

  it("bundles the real Vite worker URL proxy and worker implementation with a static local core import", async () => {
    const entry = "virtual:aura-audio-worker-check";
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [localAudioDecoderSdkPlugin(), {
        name: "audio-worker-validation-fixture",
        resolveId(id) { return id === entry ? `\0${entry}` : null; },
        load(id) { return id === `\0${entry}` ? 'export { default } from "@ffmpeg/ffmpeg/worker?worker&url";' : null; }
      }],
      worker: { format: "es", plugins: () => [localAudioDecoderSdkPlugin()] },
      build: { write: false, minify: false, rollupOptions: { input: entry } }
    });
    if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one Vite bundle.");
    const worker = result.output.find((file) => file.type === "asset" && String(file.source).includes("self.createFFmpegCore"));
    if (!worker || worker.type !== "asset") throw new Error("Expected emitted FFmpeg worker implementation.");
    const source = String(worker.source);
    expect(source).toContain('import("../vendor/ffmpeg/ffmpeg-core.js")');
    expect(source).not.toContain("https://unpkg.com");
    expect(source).not.toContain("importScripts(_coreURL)");
    expect(source).not.toMatch(/import\(\s*_coreURL\s*\)/);
  });
});
