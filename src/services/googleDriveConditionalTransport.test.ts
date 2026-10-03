import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyData } from "../utils/sampleData";
import { commitLocalSyncChanges } from "../utils/syncReplica";
import { storeTimerSound } from "../utils/timerSoundStorage";
import type { GoogleDriveConditionalDownload, GoogleDriveFileMetadata, GoogleDriveSyncPayload } from "./googleDriveSync";

const ISO = "2026-09-12T10:00:00.000Z";
const TOKEN = "test-conditional-token";
const ETAG = '"opaque-file-version-1"';
const metadata: GoogleDriveFileMetadata = {
  id: "shared-file", name: "aura-start-sync.json", createdTime: ISO, modifiedTime: ISO, version: "1", size: "500",
  appProperties: { auraStartSync: "true", auraStartSharedSync: "1" }
};
type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
let route: Route;
let fetchMock: ReturnType<typeof vi.fn>;
let drive: typeof import("./googleDriveSync");

function data() {
  const result = structuredClone(createEmptyData());
  result.updatedAt = ISO;
  result.settings.sync.deviceId = "conditional-device";
  result.settings.notes.text = "Shared note";
  return result;
}

function payload(): GoogleDriveSyncPayload {
  const value = data();
  return { schemaVersion: 1, app: "Aura Start", appVersion: "2.1.0", updatedAt: ISO, deviceId: value.settings.sync.deviceId, data: value };
}

function snapshot(): GoogleDriveConditionalDownload {
  const value = payload();
  return { metadata, payload: value, data: value.data, cloudUpdatedAt: ISO, etag: ETAG };
}

function v2(etag: unknown = ETAG, overrides: Record<string, unknown> = {}) {
  return {
    id: metadata.id, title: metadata.name, etag, createdDate: ISO, modifiedDate: ISO, version: "1", fileSize: "500",
    properties: Object.entries(metadata.appProperties!).map(([key, value]) => ({ key, value, visibility: "PRIVATE" })),
    ...overrides
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const errorResponse = (status: number) => json({ error: { message: "Conditional request failed" } }, status);
const calls = () => fetchMock.mock.calls.map(([input, init = {}]) => ({ url: new URL(String(input)), init: init as RequestInit }));
const mutations = () => calls().filter(({ init }) => ["PUT", "POST", "PATCH", "DELETE"].includes(init.method ?? "GET"));

function multipart(init: RequestInit): [Record<string, unknown>, GoogleDriveSyncPayload] {
  const boundary = new Headers(init.headers).get("Content-Type")?.split("boundary=")[1];
  if (!boundary) throw new Error("Missing multipart boundary");
  return String(init.body).split(`--${boundary}`).slice(1, -1).map((part) => JSON.parse(part.slice(part.indexOf("\r\n\r\n") + 4).trim())) as [Record<string, unknown>, GoogleDriveSyncPayload];
}

async function largeData() {
  const bytes = new Uint8Array(44 + 480);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((letter, index) => { bytes[offset + index] = letter.charCodeAt(0); });
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, 480, true);
  const original = data();
  const next = structuredClone(original);
  next.settings.timer.customSoundId = await storeTimerSound({
    name: "Shared.flac", dataUrl: `data:audio/flac;base64,${"AAAA".repeat(300_000)}`,
    playbackDataUrl: `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`
  });
  return commitLocalSyncChanges(original, next);
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("browser", undefined);
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "2.1.0" }) } });
  route = (url) => { throw new Error(`Unexpected request: ${url.pathname}`); };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => route(new URL(String(input)), init));
  vi.stubGlobal("fetch", fetchMock);
  drive = await import("./googleDriveSync");
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("conditional Drive v2 snapshot reads", () => {
  it("uses v2 metadata around v3 media and returns normalized fresh fields with the exact ETag", async () => {
    const current = v2(ETAG, { title: "Renamed backup.json", createdDate: "2026-09-01T00:00:00.000Z", version: "9007199254740999", fileSize: "800" });
    current.properties.push({ key: "public-only", value: "untrusted", visibility: "PUBLIC" });
    route = (url) => json(url.pathname.startsWith("/drive/v2/") ? current : payload());
    const result = await drive.downloadConditionalSyncFile({ ...metadata, legacyAppData: true }, TOKEN);
    expect(result).toMatchObject({ etag: ETAG, data: { settings: { notes: { text: "Shared note" } } }, metadata: {
      id: metadata.id, name: "Renamed backup.json", createdTime: "2026-09-01T00:00:00.000Z", version: "9007199254740999",
      size: "800", legacyAppData: true, appProperties: metadata.appProperties
    } });
    expect(result?.metadata.appProperties).not.toHaveProperty("public-only");
    expect(calls().map(({ url }) => url.pathname)).toEqual(["/drive/v2/files/shared-file", "/drive/v3/files/shared-file", "/drive/v2/files/shared-file"]);
    expect(calls()[0].url.searchParams.get("fields")).toContain("etag");
    expect(calls()[0].url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(calls()[1].url.searchParams.get("alt")).toBe("media");
    expect(mutations()).toHaveLength(0);
  });

  it("discards a racing download and reads the new snapshot before returning", async () => {
    let versionReads = 0;
    let mediaReads = 0;
    route = (url) => {
      if (url.pathname.startsWith("/drive/v2/")) return json(v2(++versionReads === 1 ? ETAG : '"next-version"', { version: versionReads === 1 ? "1" : "2" }));
      const value = payload();
      value.data.settings.notes.text = ++mediaReads === 1 ? "stale" : "fresh";
      return json(value);
    };
    const result = await drive.downloadConditionalSyncFile(metadata, TOKEN);
    expect(result?.data.settings.notes.text).toBe("fresh");
    expect(result?.etag).toBe('"next-version"');
    expect(versionReads).toBe(4);
    expect(mediaReads).toBe(2);
  });

  it("bounds continuous modifications and exposes a retryable precondition failure", async () => {
    let reads = 0;
    route = (url) => json(url.pathname.startsWith("/drive/v2/") ? v2(`"version-${++reads}"`) : payload());
    const error = await drive.downloadConditionalSyncFile(metadata, TOKEN).catch((value: unknown) => value);
    expect(drive.isGoogleDrivePreconditionFailed(error)).toBe(true);
    expect(error).toMatchObject({ reason: "conditional_read_changed", status: 412 });
    expect(calls()).toHaveLength(9);
  });

  it.each([undefined, null, "", " ", "*", 'W/"weak"', '"bad"\r\nother: header'])("fails closed before media read for unusable ETag %j", async (etag) => {
    route = () => json(v2(etag === undefined ? null : etag));
    await expect(drive.downloadConditionalSyncFile(metadata, TOKEN)).rejects.toThrow("usable file ETag");
    expect(calls()).toHaveLength(1);
  });

  it.each([0, 1, 2])("returns no snapshot if the file disappears at request %i", async (index) => {
    let request = 0;
    route = (url) => request++ === index ? errorResponse(404) : json(url.pathname.startsWith("/drive/v2/") ? v2() : payload());
    await expect(drive.downloadConditionalSyncFile(metadata, TOKEN)).resolves.toBeUndefined();
    expect(calls()).toHaveLength(index + 1);
  });

  it("validates downloaded settings before exposing a stable snapshot", async () => {
    route = (url) => json(url.pathname.startsWith("/drive/v2/") ? v2() : { ...payload(), schemaVersion: 999 });
    await expect(drive.downloadConditionalSyncFile(metadata, TOKEN)).rejects.toThrow();
    expect(mutations()).toHaveLength(0);
  });
});

describe("conditional shared-file mutations", () => {
  it("creates normal Drive shared metadata with no device ownership through v3", async () => {
    route = () => json(metadata);
    const result = await drive.createSharedSyncFile(data(), "conditional-device", TOKEN);
    expect(result).toEqual(metadata);
    const [{ url, init }] = calls();
    expect(url.pathname).toBe("/upload/drive/v3/files");
    expect(init.method).toBe("POST");
    expect(url.searchParams.get("fields")).toContain("createdTime");
    const [sent, body] = multipart(init);
    expect(sent).toEqual({ name: metadata.name, mimeType: "application/json", appProperties: { auraStartSync: "true", auraStartSharedSync: "1", app: "Aura Start" } });
    expect(body.data.settings.notes.text).toBe("Shared note");
    expect(body.deviceId).toBe("conditional-device");
    expect(drive.isSharedSyncFile(result)).toBe(true);
    expect(drive.isSharedSyncFile({ ...result, legacyAppData: true })).toBe(false);
    for (const owner of ["old-device", ""]) {
      expect(drive.isSharedSyncFile({ ...result, appProperties: { ...result.appProperties, auraStartDeviceId: owner } })).toBe(false);
    }
  });

  it("updates v2 multipart by exact ETag without unsupported null property mutations", async () => {
    route = () => json(v2('"updated"', { version: "2" }));
    const result = await drive.updateConditionalSyncFile(data(), { deviceId: "conditional-device", token: TOKEN, snapshot: snapshot() });
    expect(result).toMatchObject({ version: "2", createdTime: ISO, appProperties: metadata.appProperties });
    const [{ url, init }] = calls();
    expect(init.method).toBe("PUT");
    expect(url.pathname).toBe("/upload/drive/v2/files/shared-file");
    expect(url.searchParams.get("uploadType")).toBe("multipart");
    expect(new Headers(init.headers).get("If-Match")).toBe(ETAG);
    const [sent, body] = multipart(init);
    expect(sent).toMatchObject({ title: metadata.name, properties: expect.arrayContaining([
      { key: "auraStartSharedSync", value: "1", visibility: "PRIVATE" }
    ]) });
    expect(sent.properties).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: "auraStartDeviceId" })]));
    expect(sent).not.toHaveProperty("name");
    expect(sent).not.toHaveProperty("appProperties");
    expect(body.data.settings.notes.text).toBe("Shared note");
  });

  it.each(["update", "delete"])("rejects a missing conditional ETag before %s issues any request", async (operation) => {
    const current = { ...snapshot(), etag: "" };
    const promise = operation === "update"
      ? drive.updateConditionalSyncFile(data(), { deviceId: "conditional-device", token: TOKEN, snapshot: current })
      : drive.deleteConditionalSyncFile(current, TOKEN);
    await expect(promise).rejects.toThrow("usable file ETag");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["update", "delete"])("propagates %s conflict without an unconditional retry or create", async (operation) => {
    route = () => errorResponse(412);
    const promise = operation === "update"
      ? drive.updateConditionalSyncFile(data(), { deviceId: "conditional-device", token: TOKEN, snapshot: snapshot() })
      : drive.deleteConditionalSyncFile(snapshot(), TOKEN);
    const error = await promise.catch((value: unknown) => value);
    expect(drive.isGoogleDrivePreconditionFailed(error)).toBe(true);
    expect(calls()).toHaveLength(1);
    expect(new Headers(calls()[0].init.headers).get("If-Match")).toBe(ETAG);
  });

  it.each([204, 404])("conditional deletion is idempotent for status %i", async (status) => {
    route = () => status === 204 ? new Response(null, { status }) : errorResponse(status);
    await expect(drive.deleteConditionalSyncFile(snapshot(), TOKEN)).resolves.toBeUndefined();
    const [{ url, init }] = calls();
    expect(url.pathname).toBe("/drive/v2/files/shared-file");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("If-Match")).toBe(ETAG);
  });

  it("does not create a replacement when conditional update reports a deleted file", async () => {
    route = () => errorResponse(404);
    await expect(drive.updateConditionalSyncFile(data(), { deviceId: "conditional-device", token: TOKEN, snapshot: snapshot() })).rejects.toMatchObject({ status: 404 });
    expect(calls()).toHaveLength(1);
  });

  it("preserves the exact conditional request through a single Chrome token renewal", async () => {
    const renew = vi.fn((_options: unknown, callback: (token: string) => void) => callback("renewed-test-token"));
    vi.stubGlobal("chrome", {
      identity: { getAuthToken: renew, removeCachedAuthToken: (_options: unknown, callback: () => void) => callback() },
      runtime: {
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        getManifest: () => ({ manifest_version: 3, version: "2.1.0", update_url: "https://clients2.google.com/service/update2/crx",
          oauth2: { client_id: "71648271904-testchromeclient.apps.googleusercontent.com", scopes: [
            "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.appdata"
          ] } })
      }
    });
    vi.stubGlobal("navigator", { languages: ["en"], language: "en", vendor: "Google Inc.", userAgent: "Chrome/130.0.0.0", userAgentData: { brands: [{ brand: "Google Chrome", version: "130" }] } });
    route = (_url, init) => new Headers(init.headers).get("Authorization") === `Bearer ${TOKEN}` ? errorResponse(401) : json(v2('"renewed-version"'));
    await drive.updateConditionalSyncFile(data(), { deviceId: "conditional-device", token: TOKEN, snapshot: snapshot() });
    expect(calls()).toHaveLength(2);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(calls()[0].url.href).toBe(calls()[1].url.href);
    expect(calls()[0].init.body).toBe(calls()[1].init.body);
    expect(calls().map(({ init }) => [init.method, new Headers(init.headers).get("If-Match")])).toEqual([["PUT", ETAG], ["PUT", ETAG]]);
  });
});

describe("conditional resumable uploads", () => {
  it.each(["initialization", "final chunk", "recovery query"])("retains exact ETag and propagates 412 at %s", async (stage) => {
    const value = await largeData();
    let initialized = false;
    let finalReached = false;
    route = (url, init) => {
      expect(url.pathname).toBe("/upload/drive/v2/files/shared-file");
      expect(init.method).toBe("PUT");
      const headers = new Headers(init.headers);
      expect(headers.get("If-Match")).toBe(ETAG);
      if (!url.searchParams.has("upload_id")) {
        expect(url.searchParams.get("uploadType")).toBe("resumable");
        initialized = true;
        return stage === "initialization" ? errorResponse(412)
          : new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=conditional-session` } });
      }
      const range = headers.get("Content-Range")!;
      if (range.startsWith("bytes */")) return errorResponse(412);
      if (stage === "recovery query") throw new TypeError("Simulated lost response");
      const [, , end, total] = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!.map(Number);
      if (end + 1 === total) { finalReached = true; return errorResponse(412); }
      return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
    };
    const error = await drive.updateConditionalSyncFile(value, { deviceId: "conditional-device", token: TOKEN, snapshot: snapshot() }).catch((result: unknown) => result);
    expect(drive.isGoogleDrivePreconditionFailed(error)).toBe(true);
    expect(initialized).toBe(true);
    expect(finalReached).toBe(stage === "final chunk");
    expect(calls().filter(({ url }) => !url.searchParams.has("upload_id"))).toHaveLength(1);
    expect(calls().every(({ init }) => init.method === "PUT")).toBe(true);
  });

  it("publishes all audio bytes only after a successful conditional final chunk", async () => {
    const value = await largeData();
    const chunks: Blob[] = [];
    route = (url, init) => {
      expect(new Headers(init.headers).get("If-Match")).toBe(ETAG);
      if (!url.searchParams.has("upload_id")) return new Response(null, { status: 200, headers: { Location: `${url.href}&upload_id=conditional-session` } });
      chunks.push(init.body as Blob);
      const [, , end, total] = new Headers(init.headers).get("Content-Range")!.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!.map(Number);
      return end + 1 === total ? json(v2('"completed"', { version: "2" }))
        : new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
    };
    expect(await drive.updateConditionalSyncFile(value, { deviceId: "conditional-device", token: TOKEN, snapshot: snapshot() })).toMatchObject({ version: "2" });
    expect(chunks.length).toBeGreaterThan(4);
    const sent = JSON.parse(await new Blob(chunks).text()) as GoogleDriveSyncPayload;
    expect(sent.timerSound?.dataUrl).toBe(`data:audio/flac;base64,${"AAAA".repeat(300_000)}`);
    expect(sent.data.settings.timer.customSoundId).toBe(value.settings.timer.customSoundId);
    expect(chunks.every((chunk) => chunk.size <= 256 * 1024)).toBe(true);
  });
});
