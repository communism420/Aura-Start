import { Inflate, zipSync } from "fflate";
import { MAX_RESTORE_POINTS } from "../constants";
import type { AuraStartData } from "../types";
import { getAuraStartVersion } from "./appVersion";
import { collectBackgroundImageBackup } from "./backgroundImageBackup";
import { isBackgroundImageId, normalizeCustomBackgroundImage } from "./backgroundImageStorage";
import { loadTimerSound, MAX_TIMER_PLAYBACK_BYTES, MAX_TIMER_SOUND_BYTES, timerSoundBytesToDataUrl, validateTimerSoundAsset, type TimerSoundAsset } from "./timerSoundStorage";
import { validateAuraData } from "./importJson";
import { PortableJsonBudget } from "./portableJsonSize";
import { normalizeSharedSettings } from "./settingsSchema";

export const MAX_ZIP_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_ZIP_BACKUP_FILES = 128;
const MAX_DATA_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const DATA_FILE = "aura-start.json";
const MANIFEST_FILE = "manifest.json";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type ImageEntry = { path: string; mimeType: string; dataUrlHeader: string; dataUrlEncoding: "base64" | "percent"; sourceDataUrlPath?: string };
type SoundEntry = { name: string; path: string; mimeType: string; playbackPath: string; sourceDataUrlPath?: string; playbackSourceDataUrlPath?: string };
type OriginalSoundEntry = { name: string; path: string; mimeType: string; sha256: string };
export type ZipBackupManifest = {
  format: "aura-start-full-backup"; createdAt: string; appVersion: string; dataFile: typeof DATA_FILE;
  backgroundImages: Record<string, ImageEntry>;
} & ({ version: 1; timerSounds: Record<string, SoundEntry> } | { version: 2; timerSounds: Record<string, OriginalSoundEntry> });
export type ParsedZipBackup = { data: AuraStartData; backgroundImages: Record<string, string>; timerSounds: Record<string, TimerSoundAsset>;
  originalTimerSound?: { sourceId: string; name: string; mimeType: string; bytes: Uint8Array } };
type Files = Record<string, Uint8Array>;
function fail(message: string): never { throw new Error(`Invalid Aura Start ZIP backup: ${message}`); }
const sizeError = (): never => { throw new Error("The ZIP backup exceeds the 256 MiB size limit. Remove unneeded Restore Points and try again. No data was omitted."); };
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function keys(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!plain(value) || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => ![...required, ...optional].includes(key))) fail("the manifest schema is invalid.");
}

function safePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && !/[\\\u0000-\u001f\u007f<>:"|?*]/.test(value)
    && value.split("/").every((part) => part && part !== "." && part !== ".." && !/[. ]$/.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function safeAudioName(name: string): string {
  const result = name.normalize("NFC").replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/[. ]+$/g, "").slice(0, 180);
  return safePath(result) && !result.includes("/")
    ? result : `original-${result || "audio"}`;
}

function decodeDataUrl(value: string): { bytes: Uint8Array; header: string; mimeType: string; encoding: "base64" | "percent" } {
  const comma = value.indexOf(",");
  if (comma < 1 || comma > 150) fail("an asset data URL has an invalid header.");
  const header = value.slice(0, comma);
  const mimeType = /^data:([^;,]+)/i.exec(header)?.[1];
  if (!mimeType) fail("an asset MIME type is missing.");
  const body = value.slice(comma + 1);
  if (/;base64$/i.test(header)) {
    const binary = atob(body);
    return { bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)), header, mimeType, encoding: "base64" };
  }
  const output: number[] = [];
  for (let offset = 0; offset < body.length;) {
    if (body[offset] === "%") {
      if (!/^[a-f\d]{2}$/i.test(body.slice(offset + 1, offset + 3))) fail("an asset has invalid percent encoding.");
      output.push(parseInt(body.slice(offset + 1, offset + 3), 16));
      offset += 3;
    } else {
      const point = body.codePointAt(offset)!;
      const char = String.fromCodePoint(point);
      output.push(...encoder.encode(char));
      offset += char.length;
    }
  }
  return { bytes: new Uint8Array(output), header, mimeType, encoding: "percent" };
}

function canonicalUrl(bytes: Uint8Array, header: string): string {
  return header + timerSoundBytesToDataUrl(bytes, "application/octet-stream").slice("data:application/octet-stream;base64".length);
}

function imageExtension(mime: string): string {
  const types: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
  return types[mime.toLowerCase()] ?? fail("the background image MIME type is unsupported.");
}

async function digestText(value: string): Promise<string> {
  return await digestBytes(encoder.encode(value));
}

async function digestBytes(value: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", value as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function referencedAssets(data: AuraStartData): { images: Set<string>; sounds: Set<string> } {
  const images = new Set<string>();
  const sounds = new Set<string>();
  for (const snapshot of [data, ...data.restorePoints.map((point) => point.data)]) {
    if (snapshot.settings.background.customImageId) images.add(snapshot.settings.background.customImageId);
    if (snapshot.settings.timer.customSoundId) sounds.add(snapshot.settings.timer.customSoundId);
  }
  return { images, sounds };
}

/** The archive retains only the currently selected original sound. Historical
 * choices whose files are omitted become neutral in this export copy alone.
 */
function omitHistoricalTimerSounds(data: AuraStartData): void {
  const selected = data.settings.timer.customSoundId;
  for (const point of data.restorePoints) {
    const previous = point.data.settings.timer.customSoundId;
    if (!previous || previous === selected) continue;
    point.data.settings.timer.customSoundId = null;
    const compatibility = normalizeSharedSettings(point.data.settings, point.data.settingsCompatibility).settingsCompatibility;
    compatibility.defaulted = [...new Set([...compatibility.defaulted, "timer.customSoundId"])].sort();
    delete compatibility.preserved["timer.customSoundId"];
    point.data.settingsCompatibility = compatibility;
  }
}

/** Runs in a bundled local worker in the browser, including IDB reads and conversions. */
export async function encodeZipBackup(input: AuraStartData): Promise<Uint8Array> {
  const budget = new PortableJsonBudget(MAX_DATA_BYTES);
  try { budget.add(input); }
  catch (error) {
    if (error instanceof Error && error.message.includes("size limit")) fail("the settings JSON exceeds 64 MiB.");
    throw error;
  }
  const data = validateAuraData(input);
  if (data.restorePoints.length !== input.restorePoints.length) fail("a Restore Point is invalid; nothing was exported.");
  if (data.syncReplica?.settings["timer.customSoundId"].value !== data.settings.timer.customSoundId) fail("the selected timer sound does not match its sync history.");
  omitHistoricalTimerSounds(data);
  const files: Files = Object.create(null);
  let total = 22;
  const add = (path: string, bytes: Uint8Array) => {
    if (!safePath(path) || Object.hasOwn(files, path)) fail("an asset filename is unsafe or duplicated.");
    total += bytes.byteLength + encoder.encode(path).byteLength * 2 + 128;
    if (total > MAX_ZIP_BACKUP_BYTES) sizeError();
    files[path] = bytes;
  };
  const main = encoder.encode(JSON.stringify(data, null, 2));
  if (main.byteLength > MAX_DATA_BYTES) fail("the settings JSON exceeds 64 MiB.");
  add(DATA_FILE, main);
  const manifest: ZipBackupManifest = { format: "aura-start-full-backup", version: 2, createdAt: new Date().toISOString(),
    appVersion: getAuraStartVersion(), dataFile: DATA_FILE, backgroundImages: Object.create(null), timerSounds: Object.create(null) };
  const images = await collectBackgroundImageBackup(data);
  for (const id of Object.keys(images)) {
    const image = images[id];
    const decoded = decodeDataUrl(image);
    const path = `images/backgrounds/${id}.${imageExtension(decoded.mimeType)}`;
    add(path, decoded.bytes);
    const entry: ImageEntry = { path, mimeType: decoded.mimeType, dataUrlHeader: decoded.header, dataUrlEncoding: decoded.encoding };
    if (decoded.encoding !== "base64" || canonicalUrl(decoded.bytes, decoded.header) !== image) {
      entry.sourceDataUrlPath = `images/backgrounds/${id}.data-url.txt`;
      add(entry.sourceDataUrlPath, encoder.encode(image));
    }
    manifest.backgroundImages[id] = entry;
    delete images[id];
  }
  const selectedSound = data.settings.timer.customSoundId;
  if (selectedSound) {
    const sound = await loadTimerSound(selectedSound);
    if (!sound) throw new Error("The selected timer sound is unavailable. The ZIP backup was not exported.");
    const original = decodeDataUrl(sound.dataUrl);
    const prefix = `audio/timer/${selectedSound}/`;
    const entry: OriginalSoundEntry = { name: sound.name, path: prefix + safeAudioName(sound.name), mimeType: original.mimeType,
      sha256: await digestBytes(original.bytes) };
    add(entry.path, original.bytes);
    manifest.timerSounds[selectedSound] = entry;
  }
  const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) fail("the manifest exceeds its size limit.");
  add(MANIFEST_FILE, manifestBytes);
  const archive = zipSync(files, { level: 0 });
  if (archive.byteLength > MAX_ZIP_BACKUP_BYTES) sizeError();
  return archive;
}

type ZipEntry = { name: string; flags: number; method: number; crc: number; compressed: number; size: number; offset: number; start: number; end: number };
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate paths, duplicate entries, bounds and both ZIP directories before inflation. */
function inspectZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength > MAX_ZIP_BACKUP_BYTES) sizeError();
  if (bytes.byteLength < 22) fail("the ZIP file is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { eocd = offset; break; }
  }
  if (eocd < 0) fail("the ZIP directory is missing or truncated.");
  const count = u16(eocd + 10), centralSize = u32(eocd + 12), centralStart = u32(eocd + 16);
  if (u16(eocd + 4) || u16(eocd + 6) || u16(eocd + 8) !== count || count < 2 || count > MAX_ZIP_BACKUP_FILES
    || centralStart + centralSize !== eocd) fail("the ZIP directory layout or file count is invalid.");
  const names = new Set<string>();
  const entries: ZipEntry[] = [];
  let cursor = centralStart, expanded = 0;
  const extra = (start: number, length: number) => {
    for (let offset = start; offset < start + length;) {
      if (offset + 4 > start + length || u16(offset) === 1) fail("ZIP64 or a malformed ZIP extra field is unsupported.");
      offset += 4 + u16(offset + 2);
      if (offset > start + length) fail("a ZIP extra field is truncated.");
    }
  };
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || u32(cursor) !== 0x02014b50) fail("a ZIP directory entry is invalid.");
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16);
    const compressed = u32(cursor + 20), size = u32(cursor + 24), nameLength = u16(cursor + 28), extraLength = u16(cursor + 30);
    const next = cursor + 46 + nameLength + extraLength + u16(cursor + 32), offset = u32(cursor + 42);
    const unixType = (u32(cursor + 38) >>> 16) & 0xf000;
    if (next > eocd || !nameLength || flags & ~0x080e || ![0, 8].includes(method) || u16(cursor + 34)
      || compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff
      || ![0, 0x8000].includes(unixType) || (u32(cursor + 38) & 0x10)) fail("an encrypted, linked or unsupported ZIP entry was found.");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if (!(flags & 0x800) && nameBytes.some((byte) => byte >= 128)) fail("ZIP filenames must use UTF-8.");
    const name = decoder.decode(nameBytes), normalizedName = name.normalize("NFC").toLowerCase();
    if (!safePath(name) || names.has(normalizedName)) fail("a ZIP path is unsafe or duplicated.");
    names.add(normalizedName);
    expanded += size;
    if (expanded > MAX_ZIP_BACKUP_BYTES) sizeError();
    if ((name === DATA_FILE && size > MAX_DATA_BYTES) || (name === MANIFEST_FILE && size > MAX_MANIFEST_BYTES)) fail("a ZIP metadata file exceeds its size limit.");
    extra(cursor + 46 + nameLength, extraLength);
    if (offset + 30 > centralStart || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method
      || u16(offset + 26) !== nameLength) fail("a ZIP local header does not match its directory.");
    const localExtra = u16(offset + 28), start = offset + 30 + nameLength + localExtra;
    if (start + compressed > centralStart || !nameBytes.every((byte, i) => byte === bytes[offset + 30 + i])) fail("a ZIP entry overlaps its directory or has a mismatched filename.");
    extra(offset + 30 + nameLength, localExtra);
    if (!(flags & 8) && (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== size)) fail("ZIP sizes or CRC fields disagree.");
    let end = start + compressed;
    if (flags & 8) {
      if (end + 12 > centralStart) fail("a ZIP data descriptor is truncated.");
      const descriptor = u32(end) === 0x08074b50 ? end + 4 : end;
      if (descriptor + 12 > centralStart || u32(descriptor) !== crc || u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== size) fail("a ZIP data descriptor is invalid.");
      end = descriptor + 12;
    }
    if (method === 0 && compressed !== size) fail("a stored ZIP entry has inconsistent sizes.");
    entries.push({ name, flags, method, crc, compressed, size, offset, start, end });
    cursor = next;
  }
  if (cursor !== eocd) fail("the ZIP directory contains unexpected bytes.");
  const ordered = entries.slice().sort((a, b) => a.offset - b.offset);
  let expectedOffset = 0;
  for (const entry of ordered) {
    if (entry.offset !== expectedOffset) fail("ZIP entries overlap or contain unlisted bytes.");
    expectedOffset = entry.end;
  }
  if (expectedOffset !== centralStart) fail("the ZIP contains unlisted data.");
  return entries;
}

function extractZip(bytes: Uint8Array, entries: ZipEntry[]): Files {
  const files: Files = Object.create(null);
  for (const entry of entries) {
    let output: Uint8Array;
    if (entry.method === 0) output = bytes.subarray(entry.start, entry.start + entry.compressed);
    else {
      output = new Uint8Array(entry.size);
      let received = 0;
      const inflate = new Inflate((chunk) => {
        if (received + chunk.byteLength > entry.size) fail("an inflated entry exceeds its declared size.");
        output.set(chunk, received);
        received += chunk.byteLength;
      });
      for (let offset = 0; offset < entry.compressed; offset += 1024) {
        const end = Math.min(entry.compressed, offset + 1024);
        inflate.push(bytes.subarray(entry.start + offset, entry.start + end), end === entry.compressed);
      }
      if (!entry.compressed) inflate.push(new Uint8Array(), true);
      if (received !== entry.size) fail("an inflated entry does not match its declared size.");
    }
    if (crc32(output) !== entry.crc) fail("an asset failed its ZIP CRC integrity check.");
    files[entry.name] = output;
  }
  return files;
}

function parseManifest(value: unknown): ZipBackupManifest {
  keys(value, ["format", "version", "createdAt", "appVersion", "dataFile", "backgroundImages", "timerSounds"]);
  if (value.format !== "aura-start-full-backup" || ![1, 2].includes(Number(value.version)) || value.dataFile !== DATA_FILE
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.appVersion !== "string" || !/^\d+(?:\.\d+){1,3}$/.test(value.appVersion)
    || !plain(value.backgroundImages) || !plain(value.timerSounds)) fail("the archive format or version is unsupported.");
  if (value.version !== 1 && value.version !== 2) fail("the archive format or version is unsupported.");
  for (const map of [value.backgroundImages, value.timerSounds]) {
    if (Object.keys(map).length > MAX_RESTORE_POINTS + 1 || Object.keys(map).some((id) => !isBackgroundImageId(id))) fail("the asset manifest contains invalid identifiers.");
  }
  for (const entry of Object.values(value.backgroundImages)) {
    keys(entry, ["path", "mimeType", "dataUrlHeader", "dataUrlEncoding"], ["sourceDataUrlPath"]);
    if (typeof entry.mimeType !== "string" || typeof entry.dataUrlHeader !== "string" || entry.dataUrlHeader.length > 150
      || !["base64", "percent"].includes(String(entry.dataUrlEncoding))) fail("an image manifest entry is invalid.");
  }
  for (const entry of Object.values(value.timerSounds)) {
    if (value.version === 1) keys(entry, ["name", "path", "mimeType", "playbackPath"], ["sourceDataUrlPath", "playbackSourceDataUrlPath"]);
    else keys(entry, ["name", "path", "mimeType", "sha256"]);
    if (typeof entry.name !== "string" || typeof entry.mimeType !== "string" || entry.mimeType.length > 128) fail("an audio manifest entry is invalid.");
    if (value.version === 2 && (!entry.name.trim() || entry.name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(entry.name)
      || !/^(?:audio\/[a-z0-9.+-]+|application\/octet-stream|video\/(?:mp4|webm))$/.test(entry.mimeType)
      || !isBackgroundImageId(entry.sha256))) fail("an original audio manifest entry is invalid.");
  }
  return value as unknown as ZipBackupManifest;
}

/** Parse and hash-check the entire archive without opening a writable database. */
export async function decodeZipBackup(bytes: Uint8Array): Promise<ParsedZipBackup> {
  const entries = inspectZip(bytes);
  const files = extractZip(bytes, entries);
  if (!files[MANIFEST_FILE] || !files[DATA_FILE]) fail("the manifest or settings JSON is missing.");
  const manifest = parseManifest(JSON.parse(decoder.decode(files[MANIFEST_FILE])));
  const raw: unknown = JSON.parse(decoder.decode(files[DATA_FILE]));
  if (!plain(raw) || !Array.isArray(raw.restorePoints) || raw.restorePoints.length > MAX_RESTORE_POINTS
    || Object.hasOwn(raw, "backgroundImages") || Object.hasOwn(raw, "timerSounds")) fail("the settings snapshot is invalid or contains embedded assets.");
  const data = validateAuraData(raw);
  if (data.restorePoints.length !== raw.restorePoints.length) fail("a Restore Point is invalid.");
  const refs = referencedAssets(data);
  if (Object.keys(manifest.backgroundImages).length !== refs.images.size || Object.keys(manifest.timerSounds).length !== refs.sounds.size
    || Object.keys(manifest.backgroundImages).some((id) => !refs.images.has(id)) || Object.keys(manifest.timerSounds).some((id) => !refs.sounds.has(id))) fail("referenced assets are missing or unrelated assets were included.");
  if (manifest.version === 2 && (Object.keys(manifest.timerSounds).length !== (data.settings.timer.customSoundId ? 1 : 0)
    || Object.keys(manifest.timerSounds).some((id) => id !== data.settings.timer.customSoundId)
    || data.syncReplica?.settings["timer.customSoundId"].value !== data.settings.timer.customSoundId)) fail("only the selected timer sound may be included in this archive version.");
  const used = new Set([MANIFEST_FILE, DATA_FILE]);
  const take = (path: unknown, max: number): Uint8Array => {
    if (!safePath(path) || used.has(path) || !Object.hasOwn(files, path)) fail("an asset path is missing, unsafe or duplicated.");
    const bytes = files[path];
    if (bytes.byteLength > max) fail("an asset exceeds its size limit.");
    used.add(path);
    return bytes;
  };
  const urlFromBytes = (bytes: Uint8Array, header: string, sidecar: string | undefined, maxChars: number): string => {
    const url = sidecar === undefined ? canonicalUrl(bytes, header) : decoder.decode(take(sidecar, maxChars * 4));
    if (url.length > maxChars) fail("an asset URL exceeds its size limit.");
    const decoded = decodeDataUrl(url);
    if (decoded.header !== header || decoded.bytes.byteLength !== bytes.byteLength || !bytes.every((byte, i) => byte === decoded.bytes[i])) fail("an original asset does not match its reconstruction metadata.");
    return url;
  };
  const backgroundImages: Record<string, string> = Object.create(null);
  for (const [id, entry] of Object.entries(manifest.backgroundImages)) {
    const image = take(entry.path, 2_500_000);
    if (entry.dataUrlEncoding === "percent" && !entry.sourceDataUrlPath) fail("a percent-encoded image is missing its original URL.");
    const url = urlFromBytes(image, entry.dataUrlHeader, entry.sourceDataUrlPath, 2_500_000);
    const decoded = decodeDataUrl(url);
    if (!normalizeCustomBackgroundImage(url) || decoded.mimeType !== entry.mimeType || decoded.encoding !== entry.dataUrlEncoding
      || await digestText(url) !== id) fail("the background image does not match its identifier or MIME type.");
    backgroundImages[id] = url;
  }
  const timerSounds: Record<string, TimerSoundAsset> = Object.create(null);
  let originalTimerSound: ParsedZipBackup["originalTimerSound"];
  if (manifest.version === 1) {
    for (const [id, entry] of Object.entries(manifest.timerSounds)) {
      const original = take(entry.path, MAX_TIMER_SOUND_BYTES), playback = take(entry.playbackPath, MAX_TIMER_PLAYBACK_BYTES);
      const sound = {
        name: entry.name,
        dataUrl: urlFromBytes(original, `data:${entry.mimeType};base64`, entry.sourceDataUrlPath, Math.ceil(MAX_TIMER_SOUND_BYTES / 3) * 4 + 160),
        playbackDataUrl: urlFromBytes(playback, "data:audio/wav;base64", entry.playbackSourceDataUrlPath, Math.ceil(MAX_TIMER_PLAYBACK_BYTES / 3) * 4 + 160)
      };
      timerSounds[id] = await validateTimerSoundAsset(sound, id);
    }
  } else {
    for (const [id, entry] of Object.entries(manifest.timerSounds)) {
      const original = take(entry.path, MAX_TIMER_SOUND_BYTES);
      if (!original.byteLength || await digestBytes(original) !== entry.sha256) fail("the original timer audio does not match its SHA-256 checksum.");
      originalTimerSound = { sourceId: id, name: entry.name, mimeType: entry.mimeType, bytes: original.slice() };
    }
  }
  if (used.size !== Object.keys(files).length) fail("the archive contains unlisted files.");
  return { data, backgroundImages, timerSounds, ...(originalTimerSound ? { originalTimerSound } : {}) };
}
