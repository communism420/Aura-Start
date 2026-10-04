import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CdpClient, findBrowserPath, launchCaptureBrowser, parseDevToolsActivePort } from "./screenshot-browser.mjs";

test("DevTools endpoint parsing accepts CRLF and pins the endpoint to loopback", () => {
  assert.deepEqual(parseDevToolsActivePort("54218\r\n/devtools/browser/abc-123\r\n"), {
    origin: "http://127.0.0.1:54218", websocketUrl: "ws://127.0.0.1:54218/devtools/browser/abc-123"
  });
  for (const contents of ["0\n/devtools/browser/a", "65536\n/devtools/browser/a", "80oops\n/devtools/browser/a", "1234\n//example.com/socket", "1234\n/devtools/browser/a?url=remote"]) {
    assert.throws(() => parseDevToolsActivePort(contents), /valid DevToolsActivePort/);
  }
});

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  constructor() {
    super();
    this.readyState = 0;
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
  }
  send(serialized) { this.lastRequest = JSON.parse(serialized); }
  reply(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

async function withFakeSocket(run) {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  const client = new CdpClient("ws://127.0.0.1:1");
  try { await client.open(); await run(client); }
  finally { client.close(); globalThis.WebSocket = previous; }
}

test("DevTools requests time out and release their pending entry", () => withFakeSocket(async (client) => {
  await assert.rejects(client.send("Page.captureScreenshot", {}, 15), /Timed out.*Page.captureScreenshot/);
  assert.equal(client.pending.size, 0);
}));

test("socket closure promptly rejects every pending request", () => withFakeSocket(async (client) => {
  const first = client.send("Runtime.evaluate");
  const second = client.send("Page.navigate");
  await Promise.resolve();
  const checks = [assert.rejects(first, /websocket closed/), assert.rejects(second, /websocket closed/)];
  client.ws.close();
  await Promise.all(checks);
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.send("Browser.close"), /DevTools is closed/);
}));

test("evaluation surfaces browser exceptions instead of passing broken scenes", () => withFakeSocket(async (client) => {
  const evaluation = client.evaluate("throw new Error('broken scene')");
  await Promise.resolve();
  client.ws.reply({ id: client.ws.lastRequest.id, result: { exceptionDetails: { exception: { description: "Error: broken scene" } } } });
  await assert.rejects(evaluation, /broken scene/);
}));

test("DevTools protocol errors contain the failed command", () => withFakeSocket(async (client) => {
  const capture = client.send("Page.captureScreenshot");
  await Promise.resolve();
  client.ws.reply({ id: client.ws.lastRequest.id, error: { message: "Unable to capture screenshot" } });
  await assert.rejects(capture, /Page.captureScreenshot: Unable/);
}));

test("browser discovery rejects directories and profile launch rejects nonlocal origins", async () => {
  await assert.rejects(findBrowserPath(tmpdir()), /not executable/);
  await assert.rejects(launchCaptureBrowser({ profileDir: tmpdir(), allowedOrigin: "https://example.com" }), /local HTTP origin/);
});

test("browser launch refuses a populated profile before spawning anything", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "aura-browser-guard-test-"));
  try {
    await writeFile(path.join(directory, "existing-user-data"), "preserve this");
    // Node is an executable, but the safety guard must fail before it can be launched.
    await assert.rejects(launchCaptureBrowser({ executablePath: process.execPath, profileDir: directory }), /nonempty browser profile/);
  } finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("aura-browser-guard-test-"));
    await rm(resolved, { recursive: true, force: true });
  }
});
