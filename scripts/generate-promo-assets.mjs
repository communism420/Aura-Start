import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = process.cwd();
const photoDir = join(root, "Chrome Submit", "Photo");
const outputDir = photoDir;
const runId = `${Date.now()}-${process.pid}`;
const tempDir = join(process.env.TEMP ?? process.env.TMP ?? root, `aura-start-promo-assets-${runId}`);
const profileDir = join(process.env.TEMP ?? process.env.TMP ?? root, `aura-start-promo-profile-${runId}`);
const debugPort = 9251;

const assets = {
  logo: join(root, "public", "logo.png"),
  overview: join(photoDir, "01-new-tab-overview-1280x800.png"),
  search: join(photoDir, "02-search-mode-1280x800.png"),
  settings: join(photoDir, "04-settings-1280x800.png")
};

const promoTargets = [
  {
    name: "small-promo-tile-440x280.png",
    width: 440,
    height: 280,
    variant: "small"
  },
  {
    name: "large-promo-tile-920x680.png",
    width: 920,
    height: 680,
    variant: "large"
  },
  {
    name: "marquee-promo-tile-1400x560.png",
    width: 1400,
    height: 560,
    variant: "marquee"
  }
];

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function chromePath() {
  const candidates = [
    `${process.env.ProgramFiles ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["ProgramFiles(x86)"] ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`
  ];
  const path = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!path) {
    throw new Error("Chrome executable was not found.");
  }

  return path;
}

async function waitForUrl(url, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Chrome is still starting.
    }
    await delay(150);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function dataUrl(path) {
  const buffer = await readFile(path);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
        return;
      }

      const waiters = this.waiters.get(message.method);
      if (waiters?.length) {
        waiters.splice(0).forEach((resolveWaiter) => resolveWaiter(message.params));
      }
    });
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;

    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.addEventListener("open", resolveOpen, { once: true });
      this.ws.addEventListener("error", rejectOpen, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));

    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
  }

  waitFor(method, timeout = 10_000) {
    return new Promise((resolveWait, rejectWait) => {
      const timer = setTimeout(() => rejectWait(new Error(`Timed out waiting for ${method}`)), timeout);
      const wrapped = (params) => {
        clearTimeout(timer);
        resolveWait(params);
      };
      const waiters = this.waiters.get(method) ?? [];
      waiters.push(wrapped);
      this.waiters.set(method, waiters);
    });
  }

  close() {
    this.ws.close();
  }
}

function brandMarkup(logo, size = "regular") {
  const compact = size === "small";
  const logoSize = compact ? 46 : 62;
  return `
    <div class="brand brand-${escapeHtml(size)}">
      <img alt="" class="brand-logo" src="${logo}" width="${logoSize}" height="${logoSize}">
      <div>
        <div class="brand-name">Aura Start</div>
        <div class="brand-note">Inspired by A Fine Start</div>
      </div>
    </div>
  `;
}

function featureMarkup() {
  return `
    <div class="feature-row">
      <span>Local-first</span>
      <span>Optional Drive sync</span>
      <span>Export anytime</span>
    </div>
  `;
}

function smallLayout(images) {
  return `
    <main class="stage small-stage">
      ${brandMarkup(images.logo, "small")}
      <div class="small-copy small-title-copy">
        <div class="small-title">Local-first new tab</div>
      </div>
      <section class="browser-frame small-browser">
        <img alt="" class="screen-img" src="${images.overview}">
      </section>
      <div class="small-copy small-footer-copy">
        <div class="small-subtitle">Private links. Optional Drive backup. Your data.</div>
      </div>
    </main>
  `;
}

function largeLayout(images) {
  return `
    <main class="stage large-stage">
      <header class="large-header">
        ${brandMarkup(images.logo)}
        <div class="large-title">A private, local-first start page for your links - free, open-source, and easy to export</div>
      </header>
      <section class="browser-frame large-browser">
        <img alt="" class="screen-img" src="${images.overview}">
      </section>
      <section class="mini-frame mini-search">
        <img alt="" class="screen-img" src="${images.search}">
      </section>
      <section class="mini-frame mini-settings">
        <img alt="" class="screen-img" src="${images.settings}">
      </section>
      ${featureMarkup()}
    </main>
  `;
}

function marqueeLayout(images) {
  return `
    <main class="stage marquee-stage">
      <section class="marquee-copy">
        ${brandMarkup(images.logo)}
        <h1>Local-first start page</h1>
        <p>Compact groups, search, import/export, restore points, and optional Google Drive sync.</p>
        ${featureMarkup()}
      </section>
      <section class="browser-frame marquee-browser">
        <img alt="" class="screen-img" src="${images.overview}">
      </section>
    </main>
  `;
}

function layoutFor(target, images) {
  if (target.variant === "small") return smallLayout(images);
  if (target.variant === "large") return largeLayout(images);
  return marqueeLayout(images);
}

function htmlFor(target, images) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${target.width}, initial-scale=1">
  <style>
    :root {
      color-scheme: dark;
      --page: #202122;
      --panel: #242628;
      --panel-strong: #18191b;
      --border: rgba(229, 231, 235, 0.24);
      --muted: #9ca3af;
      --text: #f4f5f7;
      --accent: #79d7d0;
      --blue: #4da3ff;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      width: ${target.width}px;
      height: ${target.height}px;
      overflow: hidden;
      background: var(--page);
      color: var(--text);
      font-family: "Segoe UI", Inter, Arial, sans-serif;
      letter-spacing: 0;
    }

    .stage {
      position: relative;
      width: ${target.width}px;
      height: ${target.height}px;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(0, 0, 0, 0.05)),
        var(--page);
    }

    .stage::before {
      content: "";
      position: absolute;
      inset: 0;
      border: 1px solid rgba(255, 255, 255, 0.04);
      pointer-events: none;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 16px;
      color: var(--text);
    }

    .brand-small {
      gap: 10px;
    }

    .brand-logo {
      display: block;
      object-fit: contain;
      filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.24));
    }

    .brand-name {
      font-size: 35px;
      font-weight: 700;
      line-height: 1;
    }

    .brand-small .brand-name {
      font-size: 25px;
    }

    .brand-note {
      margin-top: 6px;
      color: var(--muted);
      font-size: 15px;
      font-weight: 500;
    }

    .brand-small .brand-note {
      margin-top: 3px;
      font-size: 11px;
    }

    .browser-frame,
    .mini-frame {
      position: absolute;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-strong);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
    }

    .screen-img,
    .full-ui {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: left top;
    }

    .full-ui {
      position: absolute;
      inset: 0;
    }

    .scrim {
      position: absolute;
      inset: 0;
      background: rgba(19, 20, 21, 0.58);
    }

    .small-stage {
      background: #222324;
    }

    .small-stage .brand {
      position: absolute;
      left: 26px;
      top: 22px;
    }

    .small-title-copy {
      position: absolute;
      left: 30px;
      top: 84px;
      max-width: 230px;
    }

    .small-footer-copy {
      position: absolute;
      left: 30px;
      bottom: 16px;
      max-width: 320px;
    }

    .small-browser {
      left: 30px;
      top: 119px;
      width: 380px;
      height: 118px;
      border-color: rgba(229, 231, 235, 0.28);
      box-shadow: 0 18px 46px rgba(0, 0, 0, 0.22);
    }

    .small-title {
      color: var(--accent);
      font-size: 20px;
      font-weight: 700;
      line-height: 1.1;
    }

    .small-subtitle {
      margin-top: 8px;
      color: #e5e7eb;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.35;
    }

    .large-header {
      position: absolute;
      left: 44px;
      top: 36px;
      right: 44px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 28px;
    }

    .large-title {
      max-width: 360px;
      color: var(--accent);
      font-size: 21px;
      font-weight: 700;
      line-height: 1.28;
      text-align: right;
    }

    .large-browser {
      left: 44px;
      top: 132px;
      width: 832px;
      height: 520px;
    }

    .mini-frame {
      width: 250px;
      height: 156px;
      opacity: 0.94;
    }

    .mini-search {
      left: 608px;
      top: 160px;
      display: none;
    }

    .mini-settings {
      left: 608px;
      top: 340px;
      display: none;
    }

    .large-stage .feature-row {
      position: absolute;
      left: 64px;
      bottom: 44px;
    }

    .feature-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      color: #d1d5db;
      font-size: 18px;
      font-weight: 650;
    }

    .feature-row span {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 14px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 999px;
      background: rgba(36, 38, 40, 0.78);
    }

    .marquee-copy {
      position: absolute;
      left: 72px;
      top: 104px;
      width: 430px;
    }

    .marquee-copy h1 {
      margin: 44px 0 0;
      color: var(--text);
      font-size: 58px;
      font-weight: 750;
      line-height: 0.98;
    }

    .marquee-copy p {
      margin: 24px 0 28px;
      color: #d7dbe1;
      font-size: 22px;
      font-weight: 500;
      line-height: 1.42;
    }

    .marquee-copy .feature-row {
      gap: 12px;
      font-size: 17px;
    }

    .marquee-browser {
      right: 64px;
      top: 58px;
      width: 790px;
      height: 494px;
    }

    .marquee-browser::before,
    .large-browser::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 22%);
      pointer-events: none;
      z-index: 1;
    }
  </style>
</head>
<body>${layoutFor(target, images)}</body>
</html>`;
}

async function captureAsset(page, target, htmlPath) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: target.width,
    height: target.height,
    deviceScaleFactor: 1,
    mobile: false
  });

  const loaded = page.waitFor("Page.loadEventFired", 15_000).catch(() => undefined);
  await page.send("Page.navigate", { url: `file:///${htmlPath.replaceAll("\\", "/")}` });
  await loaded;
  await delay(350);

  await page.send("Runtime.evaluate", {
    expression: `Promise.all(Array.from(document.images).map((image) => image.complete ? true : new Promise((resolve) => { image.onload = image.onerror = resolve; })))`,
    awaitPromise: true
  });
  await delay(250);

  const result = await page.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    clip: {
      x: 0,
      y: 0,
      width: target.width,
      height: target.height,
      scale: 1
    }
  });
  await writeFile(join(outputDir, target.name), Buffer.from(result.data, "base64"));
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

  return { browser, page };
}

async function stopChild(child) {
  if (!child || child.killed) return;

  child.kill("SIGKILL");
  await delay(500);
}

async function main() {
  for (const [name, path] of Object.entries(assets)) {
    if (!existsSync(path)) {
      throw new Error(`Missing ${name} asset: ${path}`);
    }
  }

  await mkdir(outputDir, { recursive: true });
  await rm(tempDir, { recursive: true, force: true });
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  const images = {
    logo: await dataUrl(assets.logo),
    overview: await dataUrl(assets.overview),
    search: await dataUrl(assets.search),
    settings: await dataUrl(assets.settings)
  };

  const chrome = spawn(chromePath(), [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ], { stdio: "ignore" });

  let browser;
  let page;
  try {
    const version = await (await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`)).json();
    const created = await createPage(version.webSocketDebuggerUrl);
    browser = created.browser;
    page = created.page;

    for (const target of promoTargets) {
      const htmlPath = join(tempDir, `${basename(target.name, ".png")}.html`);
      await writeFile(htmlPath, htmlFor(target, images), "utf8");
      await captureAsset(page, target, htmlPath);
      console.log(`Generated ${target.name}`);
    }
  } finally {
    page?.close();
    browser?.close();
    await stopChild(chrome);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();
