import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const hash = (value) => createHash("sha256").update(value).digest("hex");

function pngSize(buffer, label, { rgb = false } = {}) {
  if (buffer.length < 33 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    || buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString() !== "IHDR") {
    throw new Error(`${label} is not a PNG with a valid image header.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || (rgb && (buffer[24] !== 8 || buffer[25] !== 2))) {
    throw new Error(`${label} must be a nonempty 8-bit RGB PNG without an alpha channel.`);
  }
  return { width, height };
}

function promotionalHtml({ width, height, logo, screenshot, screenshotSize }) {
  const small = width === 440;
  const imageWidth = small ? 306 : 752;
  const imageHeight = imageWidth * screenshotSize.height / screenshotSize.width;
  const imageLeft = small ? (width - imageWidth) / 2 : 592;
  const imageTop = small ? 72 : (height - imageHeight) / 2;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aura Start promotional image</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; width: ${width}px; height: ${height}px; }
body { color: #f4f8ff; background: #0b1423; font-family: 'Segoe UI', Arial, sans-serif; }
main { position: relative; width: 100%; height: 100%; background:
  radial-gradient(ellipse at 94% 100%, #153c4d 0, transparent 63%),
  radial-gradient(ellipse at 18% 0, #1d304b 0, transparent 62%), #0b1423; }
.brand { position: absolute; display: flex; align-items: center; gap: ${small ? 12 : 16}px;
  left: ${small ? 67 : 60}px; top: ${small ? 18 : 64}px; }
.brand img { width: ${small ? 36 : 52}px; height: ${small ? 36 : 52}px; display: block; }
.brand-name { font-size: ${small ? 28 : 32}px; line-height: 1.2; font-weight: 650; letter-spacing: -.8px; white-space: nowrap; }
h1 { position: absolute; left: 60px; top: 177px; margin: 0; width: 468px;
  font-size: 67px; line-height: 1.05; font-weight: 680; letter-spacing: -2.6px; }
h1 span { display: block; white-space: nowrap; }
h1 span:last-child { color: #a5e7de; }
.description { position: absolute; left: 63px; top: 367px; width: 440px; margin: 0;
  color: #c1d0e0; font-size: 22px; line-height: 1.5; font-weight: 400; }
.description span { display: block; white-space: nowrap; }
.screenshot { position: absolute; left: ${imageLeft}px; top: ${imageTop}px;
  width: ${imageWidth}px; height: ${imageHeight}px; margin: 0;
  outline: 1px solid #bddde533; box-shadow: 0 16px 44px #0007; }
.screenshot img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style></head><body><main>
<div class="brand" data-check><img src="data:image/png;base64,${logo}" alt="" data-check><span class="brand-name" data-check>Aura Start</span></div>
${small ? "" : `<h1 data-check><span data-check>Your links.</span><span data-check>Your space.</span></h1>
<p class="description" data-check><span data-check>Notes, timers, and</span><span data-check>optional Drive sync.</span></p>`}
<figure class="screenshot" data-check><img id="actual-screenshot" data-check src="data:image/png;base64,${screenshot}" alt="Actual Aura Start interface"></figure>
</main></body></html>`;
}

async function assertRenderedLayout(page, { width, height, screenshotSize }) {
  const result = await page.evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => image.decode()));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const failures = [];
    if (innerWidth !== ${width} || innerHeight !== ${height}
      || document.documentElement.scrollWidth !== ${width} || document.documentElement.scrollHeight !== ${height}) {
      failures.push('Document dimensions or overflow');
    }
    for (const element of document.querySelectorAll('[data-check]')) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0
        || rect.right > innerWidth + .1 || rect.bottom > innerHeight + .1
        || element.scrollWidth > element.clientWidth + 1) {
        failures.push('Element outside canvas or overflowing: ' + element.className + '/' + element.tagName);
      }
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const textRect of range.getClientRects()) {
          // Font ascent/descent can legitimately exceed a CSS line box. The
          // composition never clips text, so check horizontal fit and canvas
          // bounds rather than treating that normal font metric as truncation.
          if (textRect.left < rect.left - 1 || textRect.right > rect.right + 1
            || textRect.top < 0 || textRect.bottom > innerHeight) {
            failures.push('Text overflow: ' + node.textContent.trim());
          }
        }
      }
    }
    const image = document.querySelector('#actual-screenshot');
    const rect = image.getBoundingClientRect();
    if (image.naturalWidth !== ${screenshotSize.width} || image.naturalHeight !== ${screenshotSize.height}
      || Math.abs(rect.width / rect.height - image.naturalWidth / image.naturalHeight) > .001) {
      failures.push('Source screenshot was not decoded at its original aspect ratio');
    }
    return failures;
  })()`);
  if (result.length) throw new Error(`Promotional image layout failed: ${result.join('; ')}`);
}

/**
 * Compose two Chrome Web Store promotional canvases in the same real Chromium
 * session as the UI captures. The app itself is an unchanged, complete PNG from
 * this run; only the surrounding promotional typography and background are new.
 * No image library, app recreation, image cropping, or network asset is used.
 */
export async function renderPromotionalImages({ page, session, outputDir, logoPath, screenshotPath }) {
  const [screenshot, logo] = await Promise.all([readFile(screenshotPath), readFile(logoPath)]);
  const screenshotSize = pngSize(screenshot, "Source screenshot", { rgb: true });
  pngSize(logo, "Application logo");
  const sourceScreenshot = { name: path.basename(screenshotPath), sha256: hash(screenshot) };
  const images = [];
  for (const spec of [
    { name: "small-promo-440x280.png", width: 440, height: 280 },
    { name: "marquee-promo-1400x560.png", width: 1400, height: 560 }
  ]) {
    if (session.errors.length) throw new Error(`Browser page errors: ${JSON.stringify(session.errors)}`);
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: spec.width, height: spec.height, deviceScaleFactor: 1, mobile: false,
      screenWidth: spec.width, screenHeight: spec.height
    });
    await page.send("Page.navigate", { url: "about:blank" });
    await page.waitForExpression("document.readyState === 'complete' && location.href === 'about:blank'");
    const { frameTree } = await page.send("Page.getFrameTree");
    await page.send("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html: promotionalHtml({ ...spec, screenshotSize, screenshot: screenshot.toString("base64"), logo: logo.toString("base64") })
    });
    await assertRenderedLayout(page, { ...spec, screenshotSize });
    const { data } = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const png = Buffer.from(data, "base64");
    const size = pngSize(png, spec.name, { rgb: true });
    if (size.width !== spec.width || size.height !== spec.height) throw new Error(`Wrong PNG size for ${spec.name}.`);
    const decoded = await page.evaluate(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(`data:image/png;base64,${data}`)};
      await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight };
    })()`);
    if (decoded.width !== spec.width || decoded.height !== spec.height) throw new Error(`PNG decoding failed for ${spec.name}.`);
    if (session.errors.length) throw new Error(`Browser page errors: ${JSON.stringify(session.errors)}`);
    await writeFile(path.join(outputDir, spec.name), png);
    images.push({ ...spec, color: "RGB, 8 bits per channel, no alpha", bytes: png.length, sha256: hash(png),
      sourceScreenshot, kind: "promotional-composite" });
    console.log(`Rendered ${spec.name} from ${sourceScreenshot.name}`);
  }
  return images;
}
