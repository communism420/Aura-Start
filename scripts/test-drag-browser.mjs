// Real browser regression coverage. Uses an isolated profile and synthetic, offline data.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchCaptureBrowser } from "./lib/screenshot-browser.mjs";
import { launchFirefoxTestBrowser } from "./lib/drag-firefox-test-browser.mjs";
import { createScreenshotData, screenshotFixtureSource } from "./lib/screenshot-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
for (const name of ["AURA_GOOGLE_OAUTH_CLIENT_ID", "AURA_GOOGLE_WEB_OAUTH_CLIENT_ID", "AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID", "AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET"]) process.env[name] = "";
process.env.AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK = "false";
process.env.AURA_ENABLE_GOOGLE_DEVICE_OAUTH_FALLBACK = "false";
process.env.AURA_STORE_BUILD = "true";
process.env.AURA_TARGET_BROWSER = "chromium";
process.env.AURA_EXTENSION_VERSION = version;
process.env.AURA_CHROMIUM_EXTENSION_VERSION = version;
const temporary = await mkdtemp(path.join(tmpdir(), "aura-drag-browser-"));
const profileDir = path.join(temporary, "profile");
await mkdir(profileDir);
let server;
let browser;
let injection;
let passed = 0;
try {
  // Build the actual current app without OAuth. Production assets contain no Vite
  // development websocket client, so neither browser needs external networking.
  const requestedDist = process.env.AURA_DND_DIST_DIR?.trim();
  const directory = requestedDist ? path.resolve(root, requestedDist) : path.join(temporary, "build");
  if (!requestedDist) {
    const { build } = await import("vite");
    await build({ root, mode: "production", logLevel: "warn", build: { outDir: directory, emptyOutDir: true } });
  }
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.version !== version) throw new Error(`Drag test build is ${manifest.version}; expected ${version}. Rebuild or unset AURA_DND_DIST_DIR.`);
  const directoryReal = await realpath(directory);
  const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".woff2": "font/woff2" };
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
      const target = await realpath(path.resolve(directoryReal, `.${pathname}`));
      if (!target.startsWith(directoryReal + path.sep) || !(await stat(target)).isFile()) { response.writeHead(403).end(); return; }
      response.writeHead(200, { "Content-Type": mime[path.extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      response.end(await readFile(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = process.env.AURA_DND_BROWSER === "firefox"
    ? await launchFirefoxTestBrowser({ profileDir, allowedOrigin: origin })
    : await launchCaptureBrowser({ profileDir, allowedOrigin: origin, executablePath: process.env.AURA_SCREENSHOT_BROWSER });
  const { page } = browser;
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features:[{name:"prefers-reduced-motion",value:"no-preference"}] });
  const now = "2026-01-01T00:00:00.000Z";
  const base = createScreenshotData(now);
  base.settings.widgets = { clock: false, notes: false, pomodoro: false, timer: false };
  base.settings.columns = 1;
  base.groups = base.groups.filter((group) => ["daily", "research", "deep", "tools"].includes(group.id));
  base.groups[0].links[1].description = "A taller row with a description. ".repeat(8);
  base.groups.push({ id: "empty", title: "Empty", parentId: null, collapsed: false, order: 3, links: [] });
  const grid = structuredClone(base); grid.settings.columns = 2;

  async function load(data = base) {
    if (injection) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection });
    const source = screenshotFixtureSource({ version, manifest_version: 3, name: "Aura Start" }, now)
      .replace(JSON.stringify(createScreenshotData(now)), JSON.stringify(data));
    injection = (await page.send("Page.addScriptToEvaluateOnNewDocument", { source })).identifier;
    await page.send("Page.navigate", { url: `${origin}/newtab.html` });
    const editSelector = '[aria-label="Enable edit mode"]';
    await page.waitForExpression(`Boolean(document.querySelector(${JSON.stringify(editSelector)}))`);
    await page.evaluate(`document.querySelector(${JSON.stringify(editSelector)}).click()`);
    await page.waitForExpression('Boolean(document.querySelector("[data-link-id]"))');
    await page.evaluate('window.scrollTo(0, 0)');
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  }
  const rect = (selector) => page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
  const point = async (selector, x = 0.5, y = 0.5) => { const r = await rect(selector); return { x: r.x + r.width * x, y: r.y + r.height * y }; };
  const positions = () => page.evaluate('Array.from(document.querySelectorAll("[data-group-id], [data-link-id]")).map(e => { const r=e.getBoundingClientRect(); return [e.dataset.groupId || e.dataset.linkId,r.x,r.y,r.width,r.height]; })');
  const frame = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const mouse = (type, p) => page.send("Input.dispatchMouseEvent", { type, ...p, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
  const key = async (code, key = code, modifiers = 0) => { await page.send("Input.dispatchKeyEvent", { type: "keyDown", code, key, modifiers }); await page.send("Input.dispatchKeyEvent", { type: "keyUp", code, key, modifiers }); await frame(); };
  async function altArrow(code) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", code: "AltLeft", key: "Alt", modifiers: 1 });
    await key(code, code, 1);
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", code: "AltLeft", key: "Alt" });
  }
  async function start(selector, y = 0.5, x = 0.25) {
    const p = await point(selector, x, y);
    await mouse("mouseMoved", p); await mouse("mousePressed", p);
    await mouse("mouseMoved", { x: p.x + 6, y: p.y }); await frame();
    return p;
  }
  async function move(to) { await mouse("mouseMoved", to); await frame(); }
  async function drop(to) { await mouse("mouseReleased", to); await frame(); }
  async function expectLinks(groupId, ids) {
    const expression = `(async () => { const d=(await chrome.storage.local.get("aura-start-data-v1"))["aura-start-data-v1"]; return JSON.stringify(d.groups.find(g=>g.id===${JSON.stringify(groupId)}).links.map(l=>l.id)) === ${JSON.stringify(JSON.stringify(ids))}; })()`;
    await page.waitForExpression(expression);
    passed++;
  }
  async function expectGroups(ids, parentId = null) {
    await page.waitForExpression(`(async () => { const d=(await chrome.storage.local.get("aura-start-data-v1"))["aura-start-data-v1"]; return JSON.stringify(d.groups.filter(g=>g.parentId===${JSON.stringify(parentId)}).sort((a,b)=>a.order-b.order).map(g=>g.id)) === ${JSON.stringify(JSON.stringify(ids))}; })()`);
    passed++;
  }
  const link = (id) => `[data-link-id="${id}"]`;
  const handle = (id) => `${link(id)} .bookmark-drag-zone`;
  const group = (id) => `[data-group-id="${id}"]`;
  const groupHandle = (id) => `${group(id)} > .bookmark-group > .group-name-row`;
  const content = (id) => `${link(id)} > .sortable-link-content`;
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.75, `${message}: ${actual} vs ${expected}`);
  async function previewGeometry(groupId) {
    return await page.evaluate(`(() => {
      const list = document.querySelector(${JSON.stringify(`${group(groupId)} > .bookmark-group .bookmark-link-preview-list`)});
      const origin = list.getBoundingClientRect();
      const geometry = element => { const r=element.getBoundingClientRect(); return {top:r.top-origin.top,bottom:r.bottom-origin.top,height:r.height}; };
      return { rows:Array.from(list.querySelectorAll('.sortable-link-shell')).map(shell => {
        const inner=shell.querySelector('.sortable-link-content'); const css=getComputedStyle(inner);
        return {id:shell.dataset.linkId,...geometry(inner),shell:geometry(shell),visibility:css.visibility,
          transform:new DOMMatrixReadOnly(css.transform).m42,target:new DOMMatrixReadOnly(inner.style.transform || 'none').m42};
      }), gap:list.querySelector('.link-insertion-gap') ? geometry(list.querySelector('.link-insertion-gap')) : null,
        spacer:geometry(list.querySelector('.link-insertion-space')), top:origin.top };
    })()`);
  }
  async function beginMotionProbe(ids) {
    await page.evaluate(`(() => {
      const selectors=${JSON.stringify(ids.map(content))};
      window.__auraMotionProbe=new Promise(resolve=>{
        const samples=[]; const started=performance.now(); let frames=0;
        function sample(){ samples.push(selectors.map(selector=>{
          const inner=document.querySelector(selector); const css=getComputedStyle(inner);
          const shell=inner.parentElement.getBoundingClientRect();
          return {value:new DOMMatrixReadOnly(css.transform).m42,target:new DOMMatrixReadOnly(inner.style.transform || 'none').m42,
            shell:{x:shell.x,y:shell.y,width:shell.width,height:shell.height}};
        })); if(++frames<4 || performance.now()-started<400)requestAnimationFrame(sample);else resolve(samples); }
        requestAnimationFrame(sample);
      });
    })()`);
  }
  async function assertAnimatedNeighbor(index = 0) {
    const samples = await page.evaluate('window.__auraMotionProbe');
    const target = samples.at(-1)[index].target;
    assert.ok(Math.abs(target) > 1, 'A neighboring link must actually move to make room');
    assert.ok(samples.some(sample => Math.abs(sample[index].value) > 0.1 && Math.abs(sample[index].value - target) > 0.1),
      `The browser must render intermediate transform positions, not an immediate jump: ${JSON.stringify(samples.map(sample=>({value:sample[index].value,target:sample[index].target})))}`);
    near(samples.at(-1)[index].value, target, 'The neighbor must settle at its projected position');
    for (const sample of samples) assert.deepEqual(sample.map(row => row.shell), samples[0].map(row => row.shell),
      'Animation must not move the measured link shells');
  }
  async function assertStablePreview(groupId) {
    await page.evaluate(`(async () => {
      const list=document.querySelector(${JSON.stringify(`${group(groupId)} > .bookmark-group .bookmark-link-preview-list`)});
      await Promise.all(list.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    })()`);
    const settled = await previewGeometry(groupId);
    for (let i=0;i<8;i++) {
      await frame();
      assert.deepEqual(await previewGeometry(groupId), settled, 'A stationary pointer must not alternate insertion slots or transforms');
    }
    return settled;
  }
  async function assertPreviewMatchesDrop(groupId, before, activeId) {
    const after = await previewGeometry(groupId);
    assert.equal(after.gap, null, 'A completed drag must remove its insertion gap');
    near(after.spacer.height, 0, 'A completed drag must remove its extra spacer');
    for (const row of before.rows.filter(row => row.id !== activeId)) {
      near(after.rows.find(item => item.id === row.id).top, row.top, 'Committed neighbor position must match the settled preview');
    }
    near(after.rows.find(item => item.id === activeId).top, before.gap.top, 'The moved link must occupy the displayed gap');
    for (const row of after.rows) near(row.transform, 0, 'Committed rows must have no residual translation');
  }

  // Down then upward, grabbing different row offsets. Hold still to catch layout feedback/jitter.
  await load();
  let initial = await positions();
  let target = await point(link("mail"), 0.5, 0.8);
  await start(handle("dashboard"), 0.1); await beginMotionProbe(["mail", "calendar"]); await move(target);
  await assertAnimatedNeighbor();
  for (let i = 0; i < 12; i++) { await frame(); assert.deepEqual(await positions(), initial); }
  assert.equal(await page.evaluate('document.querySelector("[data-link-id=calendar]").dataset.dropEdge'), "before");
  const downPreview = await assertStablePreview("daily");
  assert.equal(downPreview.rows.find(row => row.id === "dashboard").visibility, "hidden");
  near(downPreview.gap.height, downPreview.rows.find(row => row.id === "dashboard").height, 'Gap must match the dragged row height');
  if (process.env.AURA_DND_SCREENSHOT) {
    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    await writeFile(process.env.AURA_DND_SCREENSHOT, Buffer.from(shot.data, "base64"));
  }
  await drop(target); await expectLinks("daily", ["mail", "dashboard", "calendar"]);
  await assertPreviewMatchesDrop("daily", downPreview, "dashboard");
  target = await point(link("mail"), 0.5, 0.2);
  await start(handle("calendar"), 0.9); await move(target); await drop(target);
  await expectLinks("daily", ["calendar", "mail", "dashboard"]);

  // Inter-group insert, empty group, collapsed group, and cancel/outside.
  await load(); target = await point(link("reading"), 0.5, 0.2);
  await start(handle("dashboard")); await move(target); await drop(target);
  await expectLinks("research", ["design", "dashboard", "reading", "archive"]);
  await load(); target = await point(`${group("empty")} .empty-group-button`);
  await start(handle("dashboard")); await move(target); await drop(target); await expectLinks("empty", ["dashboard"]);
  const collapsed = structuredClone(base); collapsed.groups.find(g => g.id === "research").collapsed = true;
  await load(collapsed); target = await point(groupHandle("research"));
  await start(handle("dashboard")); await move(target); await drop(target);
  await expectLinks("research", ["design", "reading", "archive", "dashboard"]);
  await load(); await start(handle("dashboard")); await move(await point(link("calendar"))); await key("Escape");
  await expectLinks("daily", ["dashboard", "mail", "calendar"]);
  await start(handle("dashboard")); target = { x: 1200, y: 50 }; await move(target); await drop(target);
  await expectLinks("daily", ["dashboard", "mail", "calendar"]);

  await load(); await page.evaluate(`document.querySelector(${JSON.stringify(handle("dashboard"))}).focus()`);
  await key("Space", " "); await key("ArrowDown"); await key("ArrowDown"); await key("ArrowUp"); await key("Space", " ");
  await expectLinks("daily", ["mail", "dashboard", "calendar"]);
  await load(grid); await page.evaluate(`document.querySelector(${JSON.stringify(`${groupHandle("tools")} .group-handle`)}).focus()`);
  await key("Space", " "); await key("ArrowUp"); await key("Space", " ");
  await expectGroups(["tools", "daily", "research", "empty"]);

  // The visible grips sit in the left gutter, outside the card rectangle.
  await load(grid); await mouse("mouseMoved", await point(handle("dashboard")));
  const linkGrip = await point(`${link("dashboard")} .bookmark-handle`);
  target = { x: linkGrip.x, y: (await point(link("calendar"), 0.5, 0.8)).y };
  await start(`${link("dashboard")} .bookmark-handle`, 0.5, 0.5); await move(target); await drop(target);
  await expectLinks("daily", ["mail", "calendar", "dashboard"]);
  await load(grid); await mouse("mouseMoved", await point(groupHandle("tools")));
  const grip = await point(`${groupHandle("tools")} .group-handle`);
  target = { x: grip.x, y: (await point(group("daily"), 0.5, 0.2)).y };
  await start(`${groupHandle("tools")} .group-handle`, 0.5, 0.5); await move(target); await drop(target);
  await expectGroups(["tools", "daily", "research", "empty"]);
  const nesting = structuredClone(base); nesting.groups = nesting.groups.filter(g => ["research", "deep", "tools"].includes(g.id));
  await load(nesting); await page.evaluate(`document.querySelector(${JSON.stringify(`${groupHandle("tools")} .group-handle`)}).focus()`);
  await key("Space", " "); await altArrow("ArrowRight"); await key("Space", " ");
  // Research is the only eligible parent in this fixture.
  await expectGroups(["deep", "tools"], "research");
  await load(); await page.evaluate(`document.querySelector(${JSON.stringify(`${groupHandle("deep")} .group-handle`)}).focus()`);
  await key("Space", " "); await altArrow("ArrowLeft"); await key("Space", " ");
  await expectGroups(["daily", "research", "tools", "empty", "deep"]);

  // A long list must scroll while dragging and still insert at the pointer's visible slot.
  const longList = structuredClone(base);
  longList.groups = [longList.groups[0]];
  longList.groups[0].links = Array.from({ length: 80 }, (_, i) => ({ ...base.groups[0].links[0], id: `long-${i}`, title: `Link ${i}`, order: i }));
  await load(longList); await start(handle("long-0"));
  await move({ x: 160, y: 890 });
  await page.waitForExpression("window.scrollY > 100");
  await move({ x: 160, y: 430 }); await frame();
  const visible = await page.evaluate('Array.from(document.querySelectorAll("[data-link-id]")).find(e => { const r=e.getBoundingClientRect(); return r.top>400 && r.bottom<500; }).dataset.linkId');
  target = await point(link(visible), 0.5, 0.2); await move(target); await drop(target);
  await page.waitForExpression(`(async () => { const links=(await chrome.storage.local.get("aura-start-data-v1"))["aura-start-data-v1"].groups[0].links.map(l=>l.id); return links.indexOf("long-0") === links.indexOf(${JSON.stringify(visible)})-1; })()`);
  passed++;

  // Compact mobile-width layout uses the same coordinates and insertion contract.
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  const compact = structuredClone(base); compact.settings.compactMode = true; compact.settings.columns = "auto";
  await load(compact); target = await point(link("calendar"), 0.5, 0.8);
  await start(handle("dashboard")); await move(target); await drop(target);
  await expectLinks("daily", ["mail", "calendar", "dashboard"]);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // Group geometry stays fixed when root/nesting destinations become available.
  await load(); initial = await positions();
  target = await point(group("daily"), 0.5, 0.1);
  await start(groupHandle("tools")); await move(target); assert.deepEqual(await positions(), initial); await drop(target);
  await expectGroups(["tools", "daily", "research", "empty"]);
  await load(); await start(groupHandle("tools")); target = await point(`${group("daily")} .group-child-drop-zone`);
  await move(target); await drop(target); await expectGroups(["tools"], "daily");
  await load(); initial = await positions(); await start(groupHandle("deep"));
  assert.deepEqual(await positions(), initial); target = await point(".group-root-drop-zone");
  await move(target); await drop(target); await expectGroups(["daily", "research", "tools", "empty", "deep"]);

  // Grid placement follows the visible before/after side, including across rows.
  await load(grid); await start(groupHandle("tools")); target = await point(group("daily"), 0.1, 0.3);
  await move(target); await drop(target); await expectGroups(["tools", "daily", "research", "empty"]);

  // Keyboard must reorder links rather than collide with a group container.
  await load(); await page.evaluate(`document.querySelector(${JSON.stringify(handle("dashboard"))}).focus()`);
  await key("Space", " "); await key("ArrowDown"); await key("Space", " ");
  await expectLinks("daily", ["mail", "dashboard", "calendar"]);
  await page.evaluate(`document.querySelector(${JSON.stringify(handle("dashboard"))}).focus()`);
  await key("Space", " "); await key("ArrowUp"); await key("Space", " ");
  await expectLinks("daily", ["dashboard", "mail", "calendar"]);

  // Preview in another list must reserve real space below it, without moving its
  // hit rows or overlapping the next group. All markup still comes from Aura Start.
  const crossPreviewData = structuredClone(base);
  crossPreviewData.groups = crossPreviewData.groups.filter(g => ["research", "empty", "tools"].includes(g.id));
  crossPreviewData.groups.forEach(g => { g.order = {research:0,empty:1,tools:2}[g.id]; });
  await load(crossPreviewData);
  const followingBefore = await rect(group("empty"));
  const targetRowsBefore = (await previewGeometry("research")).rows.map(row => ({id:row.id,...row.shell}));
  const incomingHeight = (await rect(link("figma"))).height;
  target = await point(link("reading"), 0.5, 0.2);
  await start(handle("figma")); await beginMotionProbe(["reading", "archive"]); await move(target);
  await assertAnimatedNeighbor();
  const crossPreview = await assertStablePreview("research");
  assert.deepEqual(crossPreview.rows.map(row => ({id:row.id,...row.shell})), targetRowsBefore);
  near(crossPreview.spacer.height, incomingHeight, 'Incoming link spacer must reserve one source row');
  near((await rect(group("empty"))).y - followingBefore.y, incomingHeight, 'Following group must move beyond the incoming row');
  assert.ok((await rect(group("empty"))).y >= crossPreview.top + Math.max(crossPreview.gap.bottom, ...crossPreview.rows.map(row=>row.bottom)) - 0.75,
    'Animated target links must not overlap the following group');
  await drop(target); await expectLinks("research", ["design", "figma", "reading", "archive"]);
  await assertPreviewMatchesDrop("research", crossPreview, "figma");

  // Removing the incoming spacer must not lose a newly selected short group
  // which was beneath the pointer immediately before that layout change.
  const shortFollowing = structuredClone(base);
  shortFollowing.groups.find(g => g.id === "tools").collapsed = true;
  await load(shortFollowing);
  await start(handle("dashboard")); await move(await point(link("reading"), 0.5, 0.2));
  await assertStablePreview("research");
  target = await point(groupHandle("tools")); await move(target);
  await page.waitForExpression('document.querySelector("[data-group-id=tools] > .bookmark-group").dataset.dropEdge === "inside"');
  for (let i=0;i<12;i++) {
    await frame();
    assert.equal(await page.evaluate('document.querySelector("[data-group-id=tools] > .bookmark-group").dataset.dropEdge'), "inside",
      'Removing an earlier spacer must preserve the newly selected collapsed target under a stationary pointer');
  }
  await drop(target); await expectLinks("tools", ["figma", "github", "status", "dashboard"]);

  // Returning to a later source's final slot removes the earlier target spacer;
  // the same physical pointer must still commit the gap it selected.
  await load(crossPreviewData);
  await start(handle("figma")); await move(await point(link("reading"), 0.5, 0.2));
  await assertStablePreview("research");
  target = await point(link("status"), 0.5, 0.8); await move(target);
  const returnedPreview = await assertStablePreview("tools");
  assert.ok(returnedPreview.gap, 'Returning to the source must retain its selected insertion gap');
  await drop(target); await expectLinks("tools", ["github", "status", "figma"]);
  await assertPreviewMatchesDrop("tools", returnedPreview, "figma");

  // Unequal-height geometry stress fixture: descriptions are hidden in the real
  // design, so increase source-row padding explicitly instead of claiming they
  // make a taller row. The app still renders and animates every link itself.
  await load();
  await page.evaluate(`document.querySelector(${JSON.stringify(`${content("mail")} .bookmark-link`)}).style.paddingBlock='28px'`);
  await frame();
  const tall = await rect(link("mail")); const ordinary = await rect(link("dashboard"));
  assert.ok(tall.height > ordinary.height + 20, 'The geometry fixture must contain genuinely different row heights');
  target = await point(link("dashboard"), 0.5, 0.2);
  await start(handle("mail")); await beginMotionProbe(["dashboard", "calendar"]); await move(target);
  await assertAnimatedNeighbor();
  const tallPreview = await assertStablePreview("daily");
  near(tallPreview.gap.height, tall.height, 'The insertion gap must preserve a tall source row');
  await drop(target); await expectLinks("daily", ["mail", "dashboard", "calendar"]);
  await assertPreviewMatchesDrop("daily", tallPreview, "mail");

  // Both browser adapters emulate this preference without modifying app CSS.
  {
    await page.send("Emulation.setEmulatedMedia", { features:[{name:"prefers-reduced-motion",value:"reduce"}] });
    try {
      await load(); target = await point(link("calendar"), 0.5, 0.8);
      await start(handle("dashboard")); await move(target);
      assert.equal(await page.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(content("mail"))})).transitionDuration`), '0s');
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".link-insertion-gap")).transitionDuration'), '0s');
      const reducedPreview = await assertStablePreview("daily");
      await drop(target); await expectLinks("daily", ["mail", "calendar", "dashboard"]);
      await assertPreviewMatchesDrop("daily", reducedPreview, "dashboard");
    } finally { await page.send("Emulation.setEmulatedMedia", { features:[] }); }
  }

  assert.deepEqual(browser.errors, []);
  console.log(`Drag browser regressions passed: ${passed}; ${browser.browserVersion}. Smooth preview, stationary hit geometry and exact persisted order verified.`);
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  // mkdtemp creates this dedicated profile under the OS temp root; never use a personal browser profile.
  const tempRoot = path.resolve(tmpdir()) + path.sep;
  if (path.resolve(temporary).startsWith(tempRoot) && path.basename(temporary).startsWith("aura-drag-browser-")) await rm(temporary, { recursive: true, force: true });
}
