import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const chromePhotoDir = path.join(cwd, "Chrome Submit", "Photo");
const firefoxPhotoDir = path.join(cwd, "Firefox Submit", "Photo");
const docsScreenshotDir = path.join(cwd, "docs", "assets", "screenshots");
const previewDistDir = process.env.AURA_SCREENSHOT_DIST_DIR?.trim() || "dist-google";
const previewPort = 4173;
const debugPort = 9241;
const profileDir = path.join(cwd, ".tmp-cws-screenshot-profile");
const baseUrl = `http://127.0.0.1:${previewPort}/newtab.html`;
const siteScreenshotDate = "20260630";

const chromeCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  `${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`
].filter(Boolean);

const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));

if (!chromePath) {
  throw new Error("Chrome executable was not found.");
}

const now = "2026-05-10T10:00:00.000Z";
const settings = {
  theme: "dark",
  language: "en",
  columns: 2,
  compactMode: false,
  openLinksInNewTab: false,
  showDescriptions: true,
  showSearch: true,
  showVersionInHeader: true,
  captureOpenTabs: true,
  background: {
    preset: "forest",
    blur: 4,
    dim: 38,
    position: "center"
  },
  widgets: {
    clock: true,
    notes: true,
    pomodoro: true
  },
  pomodoro: {
    focusMinutes: 25,
    breakMinutes: 5
  },
  autoRestorePoints: true,
  sync: {
    mode: "auto",
    deviceId: "screenshot-device",
    connected: true,
    accountName: "Google Drive",
    lastSyncedAt: "2026-05-10T10:04:00.000Z",
    lastCloudUpdatedAt: "2026-05-10T10:04:00.000Z",
    deleteCloudFileOnDisconnect: true
  }
};

const link = (id, title, url, order, description = "", tags = []) => ({
  id,
  title,
  url,
  description,
  tags,
  order,
  createdAt: now,
  updatedAt: now
});

const groups = [
  {
    id: "group-daily",
    title: "Daily",
    parentId: null,
    collapsed: false,
    order: 0,
    links: [
      link("link-dashboard", "Project dashboard", "https://example.com/dashboard", 0, "Current work overview", ["work"]),
      link("link-mail", "Inbox", "https://mail.example.com", 1, "Personal mail", ["mail"]),
      link("link-calendar", "Calendar", "https://calendar.example.com", 2, "Meetings and planning", ["calendar"])
    ]
  },
  {
    id: "group-research",
    title: "Research",
    parentId: null,
    collapsed: false,
    order: 1,
    links: [
      link("link-docs", "Design notes", "https://example.com/design", 0, "Reference library", ["design"]),
      link("link-reading", "Reading list", "https://example.com/reading", 1, "Saved articles", ["reading"]),
      link("link-archive", "Archive", "https://web.archive.org", 2, "Snapshots and references", ["tools"])
    ]
  },
  {
    id: "group-research-deep",
    title: "Deep dives",
    parentId: "group-research",
    collapsed: false,
    order: 0,
    links: [
      link("link-mdn", "MDN Web Docs", "https://developer.mozilla.org", 0, "API references", ["docs", "web"]),
      link("link-wiki", "Wikipedia", "https://wikipedia.org", 1, "Background reading", ["research"])
    ]
  },
  {
    id: "group-tools",
    title: "Tools",
    parentId: null,
    collapsed: false,
    order: 2,
    links: [
      link("link-figma", "Figma", "https://figma.com", 0, "Design workspace", ["design"]),
      link("link-github", "GitHub", "https://github.com", 1, "Code repositories", ["code"]),
      link("link-status", "Service status", "https://status.example.com", 2, "Monitoring", ["ops"])
    ]
  },
  {
    id: "group-personal",
    title: "Personal",
    parentId: null,
    collapsed: false,
    order: 3,
    links: [
      link("link-notes", "Notes", "https://notes.example.com", 0, "Private notes", ["notes"]),
      link("link-travel", "Travel ideas", "https://example.com/travel", 1, "Plans and maps", ["travel"])
    ]
  }
];

const sampleData = {
  version: 1,
  updatedAt: now,
  settings,
  groups,
  restorePoints: [
    {
      id: "restore-before-import",
      name: "Before import",
      createdAt: now,
      reason: "before_import",
      context: {
        entity: "import",
        source: "Aura JSON",
        count: 4,
        description: "4 groups, 11 links"
      },
      data: { version: 1, updatedAt: now, settings, groups: [] }
    },
    {
      id: "restore-before-link-move",
      name: "Before moving GitHub",
      createdAt: "2026-05-10T09:30:00.000Z",
      reason: "before_link_move",
      context: {
        entity: "link",
        title: "GitHub",
        from: "Daily",
        to: "Tools"
      },
      data: { version: 1, updatedAt: now, settings, groups }
    }
  ]
};

const uiState = {
  onboardingCompleted: true,
  demoData: { groupIds: [], linkIds: [] },
  lastSearchQuery: "",
  searchFilter: "all",
  customBackgroundImage: null,
  widgetNotes: "# Launch notes\n- Review screenshots\n- Verify Chrome and Firefox packages\n- Test Google Drive sync"
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeRemove(target) {
  try {
    await rm(target, { recursive: true, force: true });
  } catch {
    // Chrome can keep its temporary lockfile open briefly after Browser.close.
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGKILL");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]);
}

async function waitForHttp(url, child, timeout = 30_000) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeout) {
    if (child?.exitCode !== null) {
      throw new Error(`Preview server exited early with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "unknown error"}`);
}

async function startPreview() {
  const preview = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(previewPort), "--outDir", previewDistDir],
    { cwd, stdio: ["ignore", "pipe", "pipe"] }
  );

  await waitForHttp(baseUrl, preview);
  return preview;
}

async function startChrome() {
  await safeRemove(profileDir);

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      "--window-size=1280,800",
      "--force-device-scale-factor=1",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--metrics-recording-only",
      "--remote-allow-origins=*",
      "--lang=en-US",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  const started = Date.now();

  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return { chrome, version: await response.json() };
    } catch {
      // Keep polling while Chrome brings up the DevTools endpoint.
    }

    await delay(250);
  }

  throw new Error("Chrome DevTools endpoint did not become ready.");
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
    this.ws.addEventListener("message", (event) => this.handleMessage(JSON.parse(event.data)));
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;

    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  handleMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result ?? {});
      }

      return;
    }

    if (message.method && this.waiters.has(message.method)) {
      const waiters = this.waiters.get(message.method);
      this.waiters.delete(message.method);
      waiters.forEach((resolve) => resolve(message.params ?? {}));
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeout = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const wrapped = (params) => {
        clearTimeout(timer);
        resolve(params);
      };
      const waiters = this.waiters.get(method) ?? [];
      waiters.push(wrapped);
      this.waiters.set(method, waiters);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // The browser may already be closed.
    }
  }
}

async function createPage(browserWsUrl) {
  const browser = new CdpClient(browserWsUrl);
  await browser.open();

  const target = await browser.send("Target.createTarget", { url: "about:blank" });
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const pageTarget = targets.find((item) => item.id === target.targetId);

  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error("Could not find page target websocket URL.");
  }

  const page = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await page.open();
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setLocaleOverride", { locale: "en-US" });
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1280,
    screenHeight: 800
  });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: chromeStorageMockSource() });

  return { browser, page };
}

function chromeStorageMockSource() {
  return `
    (() => {
      const STORE_KEY = "aura-start-data-v1";
      const UI_STATE_KEY = "aura-start-ui-state-v1";
      const initialData = ${JSON.stringify(sampleData)};
      const initialUiState = ${JSON.stringify(uiState)};
      const store = { [STORE_KEY]: initialData, [UI_STATE_KEY]: initialUiState };
      const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      const chromeApi = globalThis.chrome && typeof globalThis.chrome === "object" ? globalThis.chrome : {};
      chromeApi.storage = {
        local: {
          get: (key, callback) => {
            let result;
            if (typeof key === "string") result = { [key]: clone(store[key]) };
            else if (Array.isArray(key)) result = Object.fromEntries(key.map((item) => [item, clone(store[item])]));
            else if (key && typeof key === "object") {
              result = Object.fromEntries(Object.entries(key).map(([item, fallback]) => [
                item,
                store[item] === undefined ? fallback : clone(store[item])
              ]));
            } else {
              result = clone(store);
            }
            callback?.(result);
            return Promise.resolve(result);
          },
          set: (items, callback) => {
            Object.assign(store, clone(items));
            callback?.();
            return Promise.resolve();
          },
          remove: (key, callback) => {
            for (const item of Array.isArray(key) ? key : [key]) delete store[item];
            callback?.();
            return Promise.resolve();
          }
        }
      };
      chromeApi.runtime = chromeApi.runtime ?? { openOptionsPage: () => {} };
      chromeApi.permissions = chromeApi.permissions ?? {
        contains: (_request, callback) => {
          callback?.(true);
          return Promise.resolve(true);
        },
        request: (_request, callback) => {
          callback?.(true);
          return Promise.resolve(true);
        }
      };
      chromeApi.tabs = chromeApi.tabs ?? {
        create: () => {},
        query: (_queryInfo, callback) => {
          const tabs = [
            { title: "Aura Start repository", url: "https://github.com/communism420/Aura-Start" },
            { title: "Cloudflare Pages docs", url: "https://developers.cloudflare.com/pages/" },
            { title: "Project dashboard", url: "https://example.com/dashboard" },
            { title: "Firefox Add-ons Developer Hub", url: "https://addons.mozilla.org/developers/" },
            { title: "Browser settings", url: "chrome://extensions" }
          ];
          callback?.(tabs);
          return Promise.resolve(tabs);
        }
      };
      if (!globalThis.chrome) {
        Object.defineProperty(globalThis, "chrome", { configurable: true, value: chromeApi });
      }
    })();
  `;
}

async function evaluate(page, expression) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed.");
  }

  return result.result?.value;
}

async function waitForExpression(page, expression, timeout = 10_000) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (await evaluate(page, expression)) return;
    await delay(150);
  }

  const bodyText = await evaluate(page, `document.body?.innerText?.slice(0, 1000) ?? ""`).catch(() => "");
  throw new Error(`Timed out waiting for expression: ${expression}\nVisible text: ${bodyText}`);
}

async function navigateFresh(page) {
  const load = page.waitFor("Page.loadEventFired", 15_000).catch(() => undefined);
  await page.send("Page.navigate", { url: `${baseUrl}?shot=${Date.now()}` });
  await load;
  await waitForExpression(
    page,
    `document.body && document.body.innerText.includes("Aura Start") && document.body.innerText.includes("Project dashboard")`,
    15_000
  );
  await delay(500);
}

async function clickByText(page, text) {
  const clicked = await evaluate(
    page,
    `(() => {
      const text = ${JSON.stringify(text)};
      const button = Array.from(document.querySelectorAll("button")).find((element) => {
        const label = ((element.getAttribute("aria-label") || "") + " " + (element.textContent || "")).trim();
        return label.includes(text);
      });
      if (!button) return false;
      button.click();
      return true;
    })()`
  );

  if (!clicked) {
    throw new Error(`Button not found: ${text}`);
  }
}

async function clickByAnyText(page, labels) {
  for (const label of labels) {
    const clicked = await evaluate(
      page,
      `(() => {
        const text = ${JSON.stringify(label)};
        const button = Array.from(document.querySelectorAll("button")).find((element) => {
          const label = ((element.getAttribute("aria-label") || "") + " " + (element.textContent || "")).trim();
          return label.includes(text);
        });
        if (!button) return false;
        button.click();
        return true;
      })()`
    );

    if (clicked) {
      return;
    }
  }

  throw new Error(`Button not found: ${labels.join(" / ")}`);
}

async function assertEditModeOff(page) {
  const editPressed = await evaluate(
    page,
    `Array.from(document.querySelectorAll("button"))
      .filter((button) => (button.textContent || "").includes("Edit"))
      .every((button) => button.getAttribute("aria-pressed") !== "true")`
  );

  if (!editPressed) {
    throw new Error("Edit mode is active in a generated screenshot.");
  }
}

async function screenshot(page, { storeName, docsName }) {
  await evaluate(page, `window.scrollTo(0, 0)`);
  await assertEditModeOff(page);
  await delay(350);
  const result = await page.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });

  const buffer = Buffer.from(result.data, "base64");
  const targets = [];
  if (storeName) {
    targets.push(path.join(chromePhotoDir, storeName), path.join(firefoxPhotoDir, storeName));
  }
  if (docsName) {
    targets.push(path.join(docsScreenshotDir, docsName));
  }

  await Promise.all(targets.map((target) => writeFile(target, buffer)));
}

let preview;
let chrome;
let browserClient;
let page;

try {
  await Promise.all([
    mkdir(chromePhotoDir, { recursive: true }),
    mkdir(firefoxPhotoDir, { recursive: true }),
    mkdir(docsScreenshotDir, { recursive: true })
  ]);
  preview = await startPreview();
  const chromeStart = await startChrome();
  chrome = chromeStart.chrome;
  const created = await createPage(chromeStart.version.webSocketDebuggerUrl);
  browserClient = created.browser;
  page = created.page;

  await navigateFresh(page);
  await screenshot(page, {
    storeName: "01-new-tab-overview-1280x800.png",
    docsName: `01-new-tab-overview-${siteScreenshotDate}.png`
  });

  await navigateFresh(page);
  await clickByText(page, "Search");
  await waitForExpression(
    page,
    `document.querySelector('input[type="search"]')?.placeholder === "Search title, URL, description, tags"`
  );
  await evaluate(page, `(() => {
    const input = document.querySelector('input[type="search"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "githb");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await waitForExpression(page, `document.body.innerText.includes("GitHub")`);
  await screenshot(page, {
    storeName: "02-search-mode-1280x800.png",
    docsName: `02-fuzzy-search-${siteScreenshotDate}.png`
  });

  await navigateFresh(page);
  await clickByText(page, "Import");
  await waitForExpression(
    page,
    `document.body.innerText.includes("Import backup") && document.body.innerText.includes("Import format")`
  );
  await screenshot(page, {
    storeName: "03-import-export-1280x800.png",
    docsName: `03-import-export-${siteScreenshotDate}.png`
  });

  await navigateFresh(page);
  await clickByText(page, "Settings");
  await waitForExpression(
    page,
    `document.body.innerText.includes("Settings") && document.body.innerText.includes("Backgrounds") && document.body.innerText.includes("Widgets")`
  );
  await evaluate(page, `(() => {
    const scroller = document.querySelector('[role="presentation"]');
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop = 180;
    }
  })()`);
  await delay(250);
  await screenshot(page, {
    storeName: "04-settings-1280x800.png",
    docsName: `04-backgrounds-widgets-${siteScreenshotDate}.png`
  });

  await navigateFresh(page);
  await clickByText(page, "Settings");
  await waitForExpression(page, `document.body.innerText.includes("Restore Timeline")`);
  await clickByText(page, "Restore Timeline");
  await waitForExpression(
    page,
    `document.body.innerText.includes("Before import") && Array.from(document.querySelectorAll("input")).some((input) => input.value === "Manual checkpoint")`
  );
  await screenshot(page, {
    storeName: "05-restore-points-1280x800.png",
    docsName: `05-restore-timeline-${siteScreenshotDate}.png`
  });

  await navigateFresh(page);
  await clickByAnyText(page, ["Save tabs", "Tabs", "Save open tabs"]);
  await waitForExpression(page, `document.body.innerText.includes("Save open tabs")`);
  await clickByText(page, "Review open tabs");
  await waitForExpression(page, `document.body.innerText.includes("tabs will be saved")`);
  await screenshot(page, {
    docsName: `06-save-open-tabs-${siteScreenshotDate}.png`
  });

  await navigateFresh(page);
  await clickByText(page, "Command Palette");
  await waitForExpression(page, `document.querySelector(".command-palette-input") instanceof HTMLInputElement`);
  await evaluate(page, `(() => {
    const input = document.querySelector('.command-palette-input');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "tabs");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await waitForExpression(page, `document.body.innerText.includes("Save open tabs")`);
  await screenshot(page, {
    docsName: `07-command-palette-${siteScreenshotDate}.png`
  });

  console.log("Store screenshots generated in Chrome Submit/Photo and Firefox Submit/Photo.");
  console.log("Site screenshots generated in docs/assets/screenshots.");
} finally {
  try {
    await browserClient?.send("Browser.close");
  } catch {
    // Browser.close may race with process shutdown.
  }

  page?.close();
  browserClient?.close();
  await stopChild(chrome);
  await stopChild(preview);
  await delay(800);
  await safeRemove(profileDir);
}
