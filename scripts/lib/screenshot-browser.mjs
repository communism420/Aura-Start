import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_TIMEOUT = 15_000;

async function isExecutable(candidate) {
  try {
    if (!(await stat(candidate)).isFile()) return false;
    await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Locate an installed Chromium browser; never download a browser or use a personal profile. */
export async function findBrowserPath(override) {
  if (override) {
    const candidate = path.resolve(override);
    if (!(await isExecutable(candidate))) throw new Error(`Browser executable was not found or is not executable: ${candidate}`);
    return candidate;
  }
  const candidates = [];
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.ProgramW6432, process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      for (const relative of ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe", "Chromium/Application/chrome.exe", "BraveSoftware/Brave-Browser/Application/brave.exe"]) {
        candidates.push(path.join(root, relative));
      }
    }
  } else if (process.platform === "darwin") {
    for (const root of ["/Applications", path.join(homedir(), "Applications")]) {
      for (const app of ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"]) {
        candidates.push(path.join(root, `${app}.app`, "Contents", "MacOS", app));
      }
    }
  }
  const names = process.platform === "win32"
    ? ["chrome.exe", "msedge.exe", "chromium.exe", "brave.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(directory.replace(/^"|"$/g, ""), name));
  }
  for (const candidate of [...new Set(candidates)]) {
    if (await isExecutable(candidate)) return path.resolve(candidate);
  }
  throw new Error("No installed Chrome, Edge, Chromium, or Brave was found. Pass --browser-path with the path to its executable.");
}

/** Chromium writes this file in the newly created profile when port=0 is used. */
export function parseDevToolsActivePort(contents) {
  const [portText, browserPath] = contents.trim().split(/\r?\n/);
  const port = Number(portText);
  if (!/^\d+$/.test(portText ?? "") || !Number.isInteger(port) || port < 1 || port > 65535
    || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath ?? "")) {
    throw new Error("Chromium has not written a valid DevToolsActivePort endpoint yet.");
  }
  return { origin: `http://127.0.0.1:${port}`, websocketUrl: `ws://127.0.0.1:${port}${browserPath}` };
}

export class CdpClient {
  constructor(url) {
    this.pending = new Map();
    this.listeners = new Map();
    this.nextId = 1;
    this.closed = false;
    this.ws = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      this.rejectOpen = reject;
      this.openTimer = setTimeout(() => {
        this.fail(new Error("Timed out connecting to Chromium DevTools."));
        this.close();
      }, DEFAULT_TIMEOUT);
      this.ws.addEventListener("open", () => {
        clearTimeout(this.openTimer);
        this.rejectOpen = undefined;
        resolve();
      }, { once: true });
    });
    // An early socket error can arrive before the caller awaits open().
    this.openPromise.catch(() => {});
    this.ws.addEventListener("error", () => this.fail(new Error("Chromium DevTools websocket failed.")));
    this.ws.addEventListener("close", () => this.fail(new Error("Chromium DevTools websocket closed.")));
    this.ws.addEventListener("message", (event) => {
      try { this.receive(JSON.parse(event.data)); }
      catch (error) { this.fail(new Error(`Invalid DevTools message: ${error.message}`)); }
    });
  }

  open() { return this.openPromise; }

  fail(error) {
    this.closed = true;
    clearTimeout(this.openTimer);
    this.rejectOpen?.(error);
    this.rejectOpen = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  receive(message) {
    if (message.id !== undefined) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  async send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT) {
    await this.open();
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) throw new Error(`Cannot send ${method}: Chromium DevTools is closed.`);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression, timeoutMs = DEFAULT_TIMEOUT) {
    const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (response.exceptionDetails) {
      const details = response.exceptionDetails;
      throw new Error(details.exception?.description ?? details.text ?? "Browser evaluation failed.");
    }
    return response.result?.value;
  }

  async waitForExpression(expression, timeoutMs = DEFAULT_TIMEOUT) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression, Math.max(1, deadline - Date.now()))) return;
      await delay(Math.min(100, Math.max(0, deadline - Date.now())));
    }
    throw new Error(`Timed out after ${timeoutMs} ms waiting for browser expression: ${expression}`);
  }

  close() {
    this.fail(new Error("Chromium DevTools client was closed."));
    this.listeners.clear();
    try { this.ws.close(); } catch { /* It may already have closed with the browser. */ }
  }
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const waitForExit = (timeout) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); child.removeListener("exit", done); resolve(); };
    const timer = setTimeout(done, timeout);
    child.once("exit", done);
  });
  await waitForExit(1500);
  if (child.exitCode !== null || child.signalCode !== null) return;
  // Only the process started here is eligible for termination. Never kill by browser name.
  child.kill("SIGKILL");
  await waitForExit(3000);
  if (child.exitCode === null && child.signalCode === null) throw new Error("The isolated screenshot browser did not exit.");
}

/**
 * Start a real installed browser in an empty, caller-owned temporary profile.
 * The caller removes that profile after close(). Capture pixels with page.send("Page.captureScreenshot", ...).
 * errors contains uncaught JS exceptions and browser error logs; deliberate network blocks are separate.
 */
export async function launchCaptureBrowser({ executablePath, profileDir, headed = false, allowedOrigin }) {
  if (typeof WebSocket !== "function") throw new Error("Screenshot capture requires Node.js 22 or newer (built-in WebSocket).");
  if (!path.isAbsolute(profileDir ?? "")) throw new Error("The isolated screenshot profile must have an absolute path.");
  if (allowedOrigin) {
    const url = new URL(allowedOrigin);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.origin !== allowedOrigin) {
      throw new Error("allowedOrigin must be an exact local HTTP origin, for example http://127.0.0.1:4173.");
    }
  }
  executablePath = await findBrowserPath(executablePath);
  await mkdir(profileDir, { recursive: true });
  const resolvedProfile = await realpath(profileDir);
  if ((await readdir(resolvedProfile)).length !== 0) throw new Error("Refusing to launch in a nonempty browser profile. Supply a fresh temporary directory.");
  await writeFile(path.join(resolvedProfile, ".aura-screenshot-profile"), `${process.pid}\n`, { flag: "wx" });
  const errors = [];
  const blockedRequests = [];
  let child;
  let browser;
  let page;
  let closePromise;
  const close = () => closePromise ??= (async () => {
    try { await browser?.send("Browser.close", {}, 2000); } catch { /* Shutdown may close the socket before acknowledging. */ }
    page?.close();
    browser?.close();
    await stopOwnedChild(child);
  })();

  try {
    const args = [
      ...(headed ? [] : ["--headless=new"]),
      "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${resolvedProfile}`, "--window-size=1280,800", "--force-device-scale-factor=1",
      "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
      "--disable-sync", "--disable-component-update", "--metrics-recording-only", "--lang=en-US", "about:blank"
    ];
    child = spawn(executablePath, args, { windowsHide: !headed, stdio: ["ignore", "ignore", "pipe"] });
    let startupError;
    let stderr = "";
    child.on("error", (error) => { startupError = error; });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    let endpoint;
    let version;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Screenshot browser exited during startup (${child.exitCode ?? child.signalCode}). ${stderr}`);
      try {
        endpoint = parseDevToolsActivePort(await readFile(path.join(resolvedProfile, "DevToolsActivePort"), "utf8"));
        const response = await fetch(`${endpoint.origin}/json/version`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { version = await response.json(); break; }
      } catch { /* The file can be absent or briefly incomplete while Chromium starts. */ }
      await delay(100);
    }
    if (!version) throw new Error(`Chromium DevTools did not become ready within 30 seconds. ${stderr}`);
    browser = new CdpClient(endpoint.websocketUrl);
    await browser.open();
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const response = await fetch(`${endpoint.origin}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Cannot list Chromium pages: HTTP ${response.status}.`);
    const target = (await response.json()).find((entry) => entry.id === targetId);
    if (!target?.webSocketDebuggerUrl) throw new Error("Chromium did not expose the screenshot page target.");
    const pageUrl = new URL(target.webSocketDebuggerUrl);
    if (pageUrl.protocol !== "ws:" || pageUrl.host !== new URL(endpoint.origin).host) throw new Error("Unexpected nonlocal Chromium page websocket endpoint.");
    page = new CdpClient(pageUrl.href);
    await page.open();
    page.on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push({
      type: "javascript", message: exceptionDetails.exception?.description ?? exceptionDetails.text,
      url: exceptionDetails.url, line: exceptionDetails.lineNumber
    }));
    page.on("Log.entryAdded", ({ entry }) => {
      if (entry.level === "error" && !entry.text.includes("ERR_BLOCKED_BY_CLIENT")) errors.push({ type: "browser", message: entry.text, url: entry.url });
    });
    page.on("Runtime.consoleAPICalled", ({ type, args: values }) => {
      if (type === "error") errors.push({ type: "console", message: values.map((value) => value.value ?? value.description ?? value.type).join(" ") });
    });
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Log.enable");
    await page.send("Network.enable");
    await page.send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });
    if (allowedOrigin) {
      page.on("Fetch.requestPaused", ({ requestId, request }) => {
        let allowed = false;
        try { allowed = new URL(request.url).origin === allowedOrigin; } catch { /* Invalid URLs are blocked. */ }
        if (!allowed) blockedRequests.push({ url: request.url, method: request.method });
        page.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ? { requestId } : { requestId, errorReason: "BlockedByClient" })
          .catch((error) => { if (!closePromise) errors.push({ type: "network-interception", message: error.message }); });
      });
      await page.send("Fetch.enable", { patterns: [{ urlPattern: "http://*", requestStage: "Request" }, { urlPattern: "https://*", requestStage: "Request" }] });
    } else {
      const requests = new Map();
      page.on("Network.requestWillBeSent", ({ requestId, request }) => requests.set(requestId, request));
      page.on("Network.loadingFinished", ({ requestId }) => requests.delete(requestId));
      page.on("Network.loadingFailed", ({ requestId, blockedReason }) => {
        if (blockedReason && requests.has(requestId)) {
          const request = requests.get(requestId);
          blockedRequests.push({ url: request.url, method: request.method });
        }
        requests.delete(requestId);
      });
      await page.send("Network.setBlockedURLs", { urls: ["https://*"] });
    }
    return { browser, page, browserVersion: version.Browser, errors, blockedRequests, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
