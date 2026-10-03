import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Unmodified @ffmpeg/core 0.12.10 ESM files; also recorded in vendor NOTICE.txt. */
export const AUDIO_DECODER_SHA256 = Object.freeze({
  "ffmpeg-core.js": "67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3",
  "ffmpeg-core.wasm": "9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7"
});

const LICENSE_FILES = ["NOTICE.txt", "FFMPEG-WASM-LICENSE.txt", "COPYING.GPLv2.txt"];

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Validate directory builds and extracted archives identically. The optional
 * hash map allows small fixture distributions in tests; release callers always
 * use the pinned defaults above. No source code or credentials enter errors.
 */
export async function validateAudioDecoderBuild(directory, manifest, { expectedHashes = AUDIO_DECODER_SHA256 } = {}) {
  const csp = typeof manifest?.content_security_policy?.extension_pages === "string"
    ? manifest.content_security_policy.extension_pages : "";
  // Earlier Aura Start releases and their validator fixtures have no decoder.
  if (!csp.split(/[\s;]+/).includes("'wasm-unsafe-eval'")) return [];

  const errors = [];
  const scriptSources = csp.match(/(?:^|;)\s*script-src\s+([^;]+)/i)?.[1]?.trim().split(/\s+/) ?? [];
  if (!scriptSources.includes("'self'") || !scriptSources.includes("'wasm-unsafe-eval'")) {
    errors.push("Audio decoder requires script-src 'self' 'wasm-unsafe-eval' in the extension CSP.");
  }
  if (csp.split(/[\s;]+/).includes("'unsafe-eval'")) {
    errors.push("Audio decoder CSP must not allow ordinary 'unsafe-eval'; only 'wasm-unsafe-eval' is needed.");
  }
  if (scriptSources.some((source) => !["'self'", "'wasm-unsafe-eval'", "'unsafe-eval'"].includes(source))) {
    errors.push("Audio decoder scripts must be packaged locally; extension script-src contains an unexpected source.");
  }

  const vendor = join(directory, "vendor", "ffmpeg");
  for (const name of Object.keys(AUDIO_DECODER_SHA256)) {
    try {
      const info = await stat(join(vendor, name));
      if (!info.isFile() || info.size === 0) throw new Error("Missing file");
      if (!/^[a-f0-9]{64}$/.test(expectedHashes[name] ?? "") || await hashFile(join(vendor, name)) !== expectedHashes[name]) {
        errors.push(`Audio decoder vendor/ffmpeg/${name} does not match the pinned SHA-256.`);
      }
    } catch {
      errors.push(`Audio decoder is missing or cannot read vendor/ffmpeg/${name}.`);
    }
  }

  for (const name of LICENSE_FILES) {
    try {
      const info = await stat(join(vendor, name));
      if (!info.isFile() || info.size === 0 || info.size > 200_000) throw new Error("Invalid notice");
      const notice = await readFile(join(vendor, name), "utf8");
      const valid = name === "NOTICE.txt"
        ? notice.includes("@ffmpeg/core 0.12.10") && notice.includes("@ffmpeg/ffmpeg 0.12.15")
          && Object.values(AUDIO_DECODER_SHA256).every((hash) => notice.includes(hash))
        : name === "FFMPEG-WASM-LICENSE.txt" ? notice.includes("MIT License") && notice.includes("Jerome Wu")
          : notice.includes("GNU GENERAL PUBLIC LICENSE") && notice.includes("Version 2, June 1991");
      if (!valid) errors.push(`Audio decoder notice vendor/ffmpeg/${name} is incomplete or does not describe the pinned distribution.`);
    } catch {
      errors.push(`Audio decoder is missing or cannot read vendor/ffmpeg/${name}.`);
    }
  }

  let localWorker = false;
  try {
    const assets = join(directory, "assets");
    const entries = await readdir(assets, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^worker-[a-z0-9_-]+\.js$/i.test(entry.name)) continue;
      const worker = await readFile(join(assets, entry.name), "utf8");
      if (worker.includes("createFFmpegCore") && worker.includes("FFMessageType") && worker.includes("onmessage")) {
        localWorker = true;
        if (/\bCORE_URL\s*=\s*[^;\n]*https?:\/\//i.test(worker)) {
          errors.push("Audio decoder worker still contains a remote CORE_URL fallback.");
        }
        if (/\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)?_coreURL\s*\)/.test(worker) || /\bimportScripts\(_coreURL\)/.test(worker)) {
          errors.push("Audio decoder worker must load its packaged core with a literal local import.");
        }
      }
    }
  } catch { /* Report a stable artifact error below. */ }
  if (!localWorker) errors.push("Audio decoder is missing its packaged FFmpeg worker in assets/worker-*.js.");
  return errors;
}
