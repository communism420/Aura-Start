import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findBrowserPath, launchCaptureBrowser } from "./lib/screenshot-browser.mjs";
import { createDemoChime, screenshotFixtureSource } from "./lib/screenshot-fixture.mjs";
import { renderPromotionalImages } from "./lib/screenshot-promos.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const { values } = parseArgs({ options: {
  help: { type: "boolean", short: "h" }, headed: { type: "boolean", default: false },
  dist: { type: "string" }, "browser-path": { type: "string" }
} });

if (values.help) {
  console.log(`Capture Aura Start's current UI in a real installed Chromium browser.

  npm run screenshots
  npm run screenshots -- --browser-path "C:/path/to/chrome.exe"
  npm run screenshots -- --headed
  npm run screenshots -- --dist dist-firefox

Default: build current source, capture five screenshots and two Chrome promotional images.
--dist: explicitly reuse a built directory (its version must match package.json).
--headed: show the otherwise headless browser, using an isolated temporary profile.
Environment alternatives: AURA_SCREENSHOT_BROWSER, AURA_SCREENSHOT_DIST_DIR.
Requires Node.js 22+ and npm dependencies; Chrome, Edge, or Chromium must be installed.
Results: Chrome Submit/Screenshots/<version>/<run-id>/ and Firefox Submit/Screenshots/<version>/<run-id>/.
Each run contains five 1280x800 RGB PNGs, a ZIP, README.md and capture-report.json.
Chrome additionally gets Promo/ (440x280 and 1400x560 RGB PNG) and a ZIP of all seven images.
Promotional layouts embed a real screenshot from this run and the current app logo.
No upload, personal profile, Google login, or recreated application interface.`);
} else {
  await main().catch((error) => { console.error(`Screenshot capture failed: ${error.message}`); process.exitCode = 1; });
}

async function buildCurrent(outDir, version) {
  const overrides = {
    AURA_TARGET_BROWSER: "chromium", AURA_EXTENSION_VERSION: version, AURA_CHROMIUM_EXTENSION_VERSION: version,
    AURA_STORE_BUILD: "true", AURA_GOOGLE_OAUTH_CLIENT_ID: "",
    AURA_GOOGLE_WEB_OAUTH_CLIENT_ID: "", AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID: "", AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET: "",
    AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK: "false", AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK: "false"
  };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  const originalCwd = process.cwd();
  try {
    // Vite reads cwd and .env.local. Explicit process values prevent private
    // OAuth configuration being embedded in this UI-only temporary build.
    process.chdir(root);
    Object.assign(process.env, overrides);
    const { build } = await import("vite");
    await build({ root, mode: "production", logLevel: "warn", build: { outDir, emptyOutDir: true } });
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

async function serveBuild(directory) {
  const directoryReal = await realpath(directory);
  const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".woff2": "font/woff2", ".ico": "image/x-icon" };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      // Chrome asks for this browser-only icon even though newtab uses logo.png.
      if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
      const target = await realpath(path.resolve(directoryReal, `.${pathname}`));
      if (!target.startsWith(directoryReal + path.sep) || !(await stat(target)).isFile()) {
        response.writeHead(403).end(); return;
      }
      response.writeHead(200, { "Content-Type": mime[path.extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      response.end(await readFile(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}

async function hashBuild(directory, relative = "") {
  const files = [];
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await hashBuild(directory, name));
    else if (entry.isFile()) files.push({ file: name.split(path.sep).join("/"), sha256: hash(await readFile(path.join(directory, name))) });
    else throw new Error(`Build contains a symbolic link or unsupported file: ${name}`);
  }
  return files;
}

async function viewport(page, width = 1280, height = 800) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1280 / width, mobile: false, screenWidth: 1280, screenHeight: 800
  });
}

async function clickButton(page, text) {
  const point = await page.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(text)});
    button.scrollIntoView({block:'nearest'});
    const r = button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1275, y: 795 });
}

async function settle(page) {
  await page.evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(i => i.complete ? Promise.resolve() : i.decode()));
    const layer = document.querySelector('.aura-background-image');
    if (layer) {
      const url = getComputedStyle(layer).backgroundImage.match(/^url\\(["']?(.*?)["']?\\)$/)?.[1];
      if (url) { const image = new Image(); image.src = url; await image.decode(); }
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
}

async function visible(page, expression) {
  await page.waitForExpression(`(() => {
    const elements = ${expression};
    return elements.length > 0 && elements.every(e => {
      if (!e) return false;
      const r = e.getBoundingClientRect(); const style = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 && style.visibility !== 'hidden' && style.display !== 'none';
    });
  })()`);
}

async function capture(page, session, directory, name, requiredElements, manifest) {
  await settle(page);
  await visible(page, requiredElements);
  const state = await page.evaluate(`(() => {
    const badge = document.querySelector('.aura-version-badge');
    return {
      version: badge?.textContent.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(e => e.textContent.trim()).filter(Boolean),
      connected: !!document.querySelector('.sync-account-marker'),
      edit: !!document.querySelector('button[aria-pressed="true"][aria-label="Disable edit mode"]')
    };
  })()`);
  if (state.version !== `v${manifest.version}`) throw new Error(`UI version mismatch: ${state.version} vs ${manifest.version}`);
  if (state.horizontalOverflow || state.alerts.length || state.connected || state.edit) throw new Error(`Scene ${name} failed UI checks: ${JSON.stringify(state)}`);
  if (session.errors.length) throw new Error(`Browser page errors: ${JSON.stringify(session.errors)}`);
  const { data } = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const png = Buffer.from(data, "base64");
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.readUInt32BE(16) !== 1280 || png.readUInt32BE(20) !== 800 || png[24] !== 8 || png[25] !== 2) {
    throw new Error(`Browser returned a non-RGB or incorrectly sized PNG for ${name}; no image postprocessing is performed.`);
  }
  await writeFile(path.join(directory, name), png);
  console.log(`Captured ${name}`);
  return { name, width: 1280, height: 800, color: "RGB, 8 bits per channel, no alpha", bytes: png.length, sha256: hash(png) };
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Use Node.js 22 or newer.");
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const version = packageJson.extensionVersions?.chromium ?? packageJson.version;
  if (!/^\d+(?:\.\d+){1,3}$/.test(version)) throw new Error("Invalid current version in package.json.");
  if ((packageJson.extensionVersions?.firefox ?? version) !== version) throw new Error("Chromium and Firefox versions differ; a shared screenshot set requires the same version.");
  const browserPath = await findBrowserPath(values["browser-path"] ?? process.env.AURA_SCREENSHOT_BROWSER);
  const requestedDist = values.dist ?? process.env.AURA_SCREENSHOT_DIST_DIR;
  const temporary = await mkdtemp(path.join(tmpdir(), "aura-store-screenshots-"));
  const ownedTemporary = await realpath(temporary);
  let server; let session;
  try {
    const dist = requestedDist ? path.resolve(requestedDist) : path.join(temporary, "build");
    if (!requestedDist) {
      console.log(`Building current Aura Start ${version} UI in a temporary directory...`);
      await buildCurrent(dist, version);
    }
    const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
    if (manifest.version !== version) throw new Error(`Build is version ${manifest.version}; package.json requires ${version}. Rebuild or omit --dist.`);
    await access(path.join(dist, "newtab.html"));
    const buildFiles = await hashBuild(dist);
    server = await serveBuild(dist);
    const profileDir = path.join(temporary, "browser-profile");
    await mkdir(profileDir);
    session = await launchCaptureBrowser({ executablePath: browserPath, profileDir, headed: values.headed, allowedOrigin: server.origin });
    const { page } = session;
    await page.send("Emulation.setLocaleOverride", { locale: "en-US" });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: screenshotFixtureSource(manifest) });
    const staging = path.join(temporary, "screenshots");
    await mkdir(staging);
    const wavPath = path.join(temporary, "Gentle chime.wav");
    await writeFile(wavPath, createDemoChime());
    const fresh = async (scene = "overview") => {
      await page.send("Page.navigate", { url: `${server.origin}/newtab.html?view=${scene}` });
      await page.waitForExpression(`document.readyState === 'complete' && document.body.innerText.includes('Project dashboard') && document.body.innerText.includes('v${version}')`);
      await settle(page);
    };
    const shots = [];
    const take = async (name, elements) => shots.push(await capture(page, session, staging, name, elements, manifest));
    await viewport(page);
    await fresh();
    await take("01-links-and-groups-1280x800.png", `[document.querySelector('.notes-widget'), document.querySelector('.aura-group-grid'), document.querySelector('.aura-group-grid a'), ...document.querySelectorAll('.aura-group-grid a')]`);
    await fresh("countdown");
    await take("02-notes-and-countdown-1280x800.png", `[document.querySelector('.notes-widget'), document.querySelector('.countdown-widget'), document.querySelector('.aura-group-grid'), document.querySelector('.aura-group-grid a'), ...document.querySelectorAll('.aura-group-grid a')]`);
    await fresh();
    await clickButton(page, "Export");
    await page.waitForExpression(`document.querySelector('.export-menu-popover')?.innerText.includes('Full backup (ZIP)')`);
    await take("03-full-backup-zip-1280x800.png", `[document.querySelector('.export-menu-popover')]`);

    await viewport(page, 896, 560);
    await fresh("sound");
    await clickButton(page, "Settings");
    await page.waitForExpression(`document.querySelector('input[type="file"][aria-label]') !== null`);
    const { root: documentNode } = await page.send("DOM.getDocument");
    const { nodeId } = await page.send("DOM.querySelector", { nodeId: documentNode.nodeId, selector: 'input[type="file"][aria-label]' });
    await page.send("DOM.setFileInputFiles", { nodeId, files: [wavPath] });
    await page.waitForExpression(`document.body.innerText.includes('Gentle chime.wav')`, 30000);
    await page.evaluate(`(() => {
      const label = Array.from(document.querySelectorAll('label')).find(e => e.textContent.trim().startsWith('Countdown'));
      document.querySelector('[role="presentation"]').scrollTop += label.getBoundingClientRect().top - 8;
    })()`);
    await take("04-custom-timer-sound-1280x800.png", `[
      Array.from(document.querySelectorAll('h4')).find(e => e.textContent.trim() === 'Timer signal')?.parentElement,
      document.querySelector('.settings-info-table')
    ]`);

    await viewport(page, 1024, 640);
    await fresh();
    await clickButton(page, "Settings");
    await page.waitForExpression(`Array.from(document.querySelectorAll('h3')).some(e => e.textContent.trim() === 'Google Drive Sync')`);
    await page.evaluate(`(() => {
      const section = Array.from(document.querySelectorAll('h3')).find(e => e.textContent.trim() === 'Google Drive Sync').closest('.surface-flat');
      document.querySelector('[role="presentation"]').scrollTop += section.getBoundingClientRect().top - 32;
    })()`);
    await take("05-google-drive-sync-1280x800.png", `[
      Array.from(document.querySelectorAll('h3')).find(e => e.textContent.trim() === 'Google Drive Sync'),
      Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Connect Google Drive')
    ]`);

    const promoDir = path.join(staging, "Promo");
    await mkdir(promoDir);
    const promotionalImages = await renderPromotionalImages({
      page, session, outputDir: promoDir, logoPath: path.join(dist, "logo.png"),
      screenshotPath: path.join(staging, shots[0].name)
    });
    if (promotionalImages.length !== 2 || promotionalImages.some((image) => image.sourceScreenshot.sha256 !== shots[0].sha256)) {
      throw new Error("Promotional images must use the overview screenshot from this run.");
    }

    const { zipSync, unzipSync } = await import("fflate");
    const zipEntries = Object.fromEntries(await Promise.all(shots.map(async (shot) => [shot.name, new Uint8Array(await readFile(path.join(staging, shot.name)))])));
    const zip = zipSync(zipEntries, { level: 6 });
    const unpacked = unzipSync(zip);
    if (Object.keys(unpacked).length !== 5 || shots.some((shot) => hash(unpacked[shot.name]) !== shot.sha256)) throw new Error("Screenshot ZIP integrity check failed.");
    const archiveName = `aura-start-${version}-store-screenshots.zip`;
    await writeFile(path.join(staging, archiveName), zip);
    const chromeEntries = Object.fromEntries(Object.entries(zipEntries).map(([name, bytes]) => [`screenshots/${name}`, bytes]));
    for (const image of promotionalImages) chromeEntries[`Promo/${image.name}`] = new Uint8Array(await readFile(path.join(promoDir, image.name)));
    const chromeZip = zipSync(chromeEntries, { level: 6 });
    const chromeUnpacked = unzipSync(chromeZip);
    if (Object.keys(chromeUnpacked).length !== 7 || Object.entries(chromeEntries).some(([name, bytes]) => hash(chromeUnpacked[name]) !== hash(bytes))) {
      throw new Error("Chrome store image ZIP integrity check failed.");
    }
    const chromeArchiveName = `aura-start-${version}-chrome-web-store-images.zip`;
    await writeFile(path.join(staging, chromeArchiveName), chromeZip);
    const createdAt = new Date().toISOString();
    const runId = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z") + "-" + randomUUID().slice(0, 8);
    const report = {
      version, createdAt, runId, browserVersion: session.browserVersion,
      source: requestedDist ? "explicit existing build (--dist); source freshness not asserted" : "fresh build of current source",
      buildFingerprint: hash(JSON.stringify(buildFiles)), buildFiles,
      capture: "UI screenshots: real Chromium browser, actual Aura Start UI, synthetic storage data only; no CSS/DOM design replacement or image postprocessing",
      scenes: shots, browserErrors: session.errors, blockedRequests: session.blockedRequests,
      drive: "disabled and disconnected", customSound: { name: "Gentle chime.wav", sha256: hash(await readFile(wavPath)) },
      archive: { name: archiveName, sha256: hash(zip), files: shots.length }
    };
    await writeFile(path.join(staging, "README.md"), `# Aura Start ${version} store screenshots\n\nCaptured ${createdAt} in a real browser from the actual app.\n\nUpload the five PNGs in filename order to Chrome Web Store or Firefox Add-ons. Each is 1280 x 800 RGB PNG without transparency. The ZIP contains only these five PNGs; it is not an extension package.\n\n1. Links, nested groups and Markdown notes\n2. Notes and Countdown\n3. Full ZIP backup\n4. Custom Countdown sound, imported through the real file picker\n5. Optional Google Drive sync, disconnected\n\nInspect every image before publishing. This is a UI illustration, not a real-account or native-extension integration test. No personal data or Google account was used. The same shared UI images are copied to both store directories.\n\nReproduce from the repository: npm run screenshots\n\nBrowser/build identity and image hashes: capture-report.json.\n\nStore image guidance:\n- https://developer.chrome.com/docs/webstore/images\n- https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/\n`);
    const names = [...shots.map((shot) => shot.name), archiveName, "README.md", "capture-report.json"];
    for (const store of ["Chrome Submit", "Firefox Submit"]) {
      const isChrome = store === "Chrome Submit";
      const storeReport = isChrome ? {
        ...report,
        promotionalCapture: "real-browser rendering of brand layout with current logo and the unmodified overview PNG from the same capture run",
        promotionalImages,
        promotionalArchive: { name: chromeArchiveName, sha256: hash(chromeZip), files: 7 }
      } : report;
      await writeFile(path.join(staging, "capture-report.json"), JSON.stringify(storeReport, null, 2) + "\n");
      const parent = path.join(root, store, "Screenshots", version);
      await mkdir(parent, { recursive: true });
      const destination = path.join(parent, runId);
      await mkdir(destination); // Unique per run; never replace earlier screenshots.
      const storeNames = isChrome ? [...names, chromeArchiveName, ...promotionalImages.map((image) => `Promo/${image.name}`)] : names;
      if (isChrome) await mkdir(path.join(destination, "Promo"));
      for (const name of storeNames) await copyFile(path.join(staging, name), path.join(destination, name));
      for (const name of storeNames) if (hash(await readFile(path.join(destination, name))) !== hash(await readFile(path.join(staging, name)))) throw new Error(`Output copy verification failed: ${store}/${name}`);
      if (isChrome) {
        const readmePath = path.join(destination, "README.md");
        await writeFile(readmePath, await readFile(readmePath, "utf8") + `\n## Chrome Web Store promotional images\n\n- Promo/small-promo-440x280.png: Small promotional image field (440 x 280).\n- Promo/marquee-promo-1400x560.png: Marquee promotional image field (1400 x 560).\n\nBoth are 24-bit RGB PNGs without transparency. They are branded promotional compositions rendered in the real browser, using this run's actual overview screenshot and current app logo. The application UI is embedded as a complete, unchanged image, not redrawn.\n\n${chromeArchiveName} bundles all seven images: screenshots/ contains the five UI screenshots, and Promo/ contains the two promotional images. Upload them to their corresponding image fields; this ZIP is not an extension package.\n`);
      }
      console.log(`Saved: ${destination}`);
    }
    console.log("Done: five screenshots for both stores; Chrome also has 440x280 and 1400x560 promotional PNGs and a seven-image ZIP. Review images before uploading.");
  } finally {
    // A stuck browser must not leave the HTTP server keeping Node alive. If it
    // cannot be stopped, keep its profile instead of deleting files still in use.
    try { await session?.close(); }
    finally { await server?.close(); }
    // Only the directory allocated by this run may ever be recursively removed.
    const resolved = await realpath(temporary);
    if (resolved !== ownedTemporary || path.dirname(resolved) !== await realpath(tmpdir()) || !path.basename(resolved).startsWith("aura-store-screenshots-")) {
      throw new Error("Refusing to clean a directory outside this run's temporary workspace.");
    }
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {
      console.warn(`Browser files are still locked; temporary capture files remain in ${resolved}`);
    });
  }
}
