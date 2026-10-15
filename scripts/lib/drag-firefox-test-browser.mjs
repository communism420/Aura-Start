// Optional real Firefox adapter for the shared drag regression harness.
// Requires an already installed Playwright module and its compatible Firefox build;
// never downloads browsers or opens a personal profile.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT = 15_000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadPlaywright() {
  const override = process.env.AURA_DND_PLAYWRIGHT_MODULE?.trim();
  if (override) {
    let modulePath = path.resolve(override);
    if ((await stat(modulePath)).isDirectory()) modulePath = path.join(modulePath, "index.mjs");
    return await import(pathToFileURL(modulePath).href);
  }
  try { return await import("playwright"); }
  catch {
    try { return await import("playwright-core"); }
    catch {
      throw new Error("Firefox drag tests require an installed Playwright module. Set AURA_DND_PLAYWRIGHT_MODULE to its package directory or entry file; no dependencies are downloaded automatically.");
    }
  }
}

export async function launchFirefoxTestBrowser({ profileDir, allowedOrigin, headed = false, executablePath } = {}) {
  if (!path.isAbsolute(profileDir ?? "") || (await readdir(profileDir)).length) {
    throw new Error("Firefox drag tests require an existing, empty, absolute temporary profile directory.");
  }
  const origin = new URL(allowedOrigin);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) || origin.origin !== allowedOrigin) {
    throw new Error("Firefox drag tests require an exact local HTTP allowedOrigin.");
  }
  const playwright = await loadPlaywright();
  const firefox = playwright.firefox ?? playwright.default?.firefox;
  if (!firefox) throw new Error("The configured Playwright module does not expose Firefox.");
  const configuredExecutable = process.env.AURA_DND_FIREFOX_PATH?.trim() || executablePath;
  if (configuredExecutable && !(await stat(configuredExecutable)).isFile()) throw new Error("The configured Firefox executable does not exist.");
  const errors = [];
  const blockedRequests = [];
  const scripts = new Map();
  let nextScriptId = 1;
  let currentPage;
  let context;
  let closePromise;
  let viewport = { width: 1280, height: 800 };
  let reducedMotion = "no-preference";
  const close = () => closePromise ??= context?.close() ?? Promise.resolve();

  try {
    context = await firefox.launchPersistentContext(profileDir, {
      ...(configuredExecutable ? { executablePath: path.resolve(configuredExecutable) } : {}),
      headless: !headed,
      viewport,
      deviceScaleFactor: 1,
      locale: "en-US",
      serviceWorkers: "block",
      firefoxUserPrefs: { "app.update.auto": false, "browser.shell.checkDefaultBrowser": false }
    });
    context.setDefaultTimeout(DEFAULT_TIMEOUT);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === allowedOrigin || ["data:", "blob:", "about:"].includes(url.protocol)) return await route.continue();
      blockedRequests.push({ url: request.url(), method: request.method() });
      await route.abort("blockedbyclient");
    });
    if (typeof context.routeWebSocket === "function") await context.routeWebSocket("**/*", (socket) => socket.close());

    async function createPage() {
      const next = await context.newPage();
      next.on("pageerror", (error) => errors.push({ type: "javascript", message: error.message }));
      next.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("NS_ERROR_BLOCKED_BY_CLIENT")) {
          errors.push({ type: "console", message: message.text() });
        }
      });
      await next.setViewportSize(viewport);
      await next.emulateMedia({ reducedMotion });
      for (const source of scripts.values()) await next.addInitScript({ content: source });
      return next;
    }
    currentPage = context.pages()[0] ?? await createPage();
    const page = {
      async evaluate(expression) { return await currentPage.evaluate(expression); },
      async waitForExpression(expression, timeoutMs = DEFAULT_TIMEOUT) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (await currentPage.evaluate(expression)) return;
          await delay(Math.min(100, Math.max(0, deadline - Date.now())));
        }
        throw new Error(`Timed out after ${timeoutMs} ms waiting for Firefox expression: ${expression}`);
      },
      async send(method, params = {}) {
        switch (method) {
          case "Emulation.setEmulatedMedia": {
            const features = params.features ?? [];
            if (features.some((feature) => feature.name !== "prefers-reduced-motion" || !["reduce", "no-preference"].includes(feature.value))) {
              throw new Error("Firefox drag tests only emulate the reduced-motion media feature.");
            }
            reducedMotion = features.find((feature) => feature.name === "prefers-reduced-motion")?.value ?? "no-preference";
            await currentPage.emulateMedia({ reducedMotion });
            return {};
          }
          case "Emulation.setDeviceMetricsOverride":
            if (params.mobile || (params.deviceScaleFactor ?? 1) !== 1) throw new Error("Firefox drag tests support desktop device scale 1 only.");
            viewport = { width: params.width, height: params.height };
            await currentPage.setViewportSize(viewport);
            return {};
          case "Page.addScriptToEvaluateOnNewDocument": {
            const identifier = String(nextScriptId++);
            scripts.set(identifier, params.source);
            return { identifier };
          }
          case "Page.removeScriptToEvaluateOnNewDocument":
            scripts.delete(params.identifier);
            return {};
          case "Page.navigate": {
            if (new URL(params.url).origin !== allowedOrigin) throw new Error("Firefox drag tests may navigate only to their local fixture server.");
            // Playwright cannot remove init scripts. A fresh tab applies exactly the
            // current fixture scripts without accumulating old ones across trials.
            const previousPage = currentPage;
            currentPage = await createPage();
            await previousPage.close();
            await currentPage.goto(params.url, { waitUntil: "load" });
            return {};
          }
          case "Page.captureScreenshot": {
            if (params.format && params.format !== "png") throw new Error("Firefox drag test screenshots must use PNG.");
            const data = await currentPage.screenshot({ type: "png", animations: "allow" });
            return { data: data.toString("base64") };
          }
          case "Input.dispatchMouseEvent": {
            const button = params.button && params.button !== "none" ? params.button : "left";
            await currentPage.mouse.move(params.x, params.y);
            if (params.type === "mousePressed") await currentPage.mouse.down({ button, clickCount: params.clickCount ?? 1 });
            else if (params.type === "mouseReleased") await currentPage.mouse.up({ button, clickCount: params.clickCount ?? 1 });
            else if (params.type === "mouseWheel") await currentPage.mouse.wheel(params.deltaX ?? 0, params.deltaY ?? 0);
            else if (params.type !== "mouseMoved") throw new Error(`Unsupported Firefox mouse event: ${params.type}`);
            return {};
          }
          case "Input.dispatchKeyEvent": {
            const key = params.code === "Space" ? "Space" : params.key || params.code;
            if (params.type === "keyDown" || params.type === "rawKeyDown") await currentPage.keyboard.down(key);
            else if (params.type === "keyUp") await currentPage.keyboard.up(key);
            else if (params.type === "char") await currentPage.keyboard.insertText(params.text ?? params.key ?? "");
            else throw new Error(`Unsupported Firefox key event: ${params.type}`);
            return {};
          }
          default: throw new Error(`Unsupported Firefox test adapter method: ${method}`);
        }
      }
    };
    return { page, browserVersion: `Firefox/${context.browser().version()}`, errors, blockedRequests, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
