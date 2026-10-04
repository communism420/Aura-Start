# Aura Start Screenshot Capture

> Maintainer-only document. This workflow prepares store images; it does not publish a release.

Run `npm run screenshots` to capture the current Aura Start interface in a real installed Chromium browser. The same five 1280 x 800 RGB PNG images are prepared for Chrome Web Store and Firefox Add-ons. This size follows the [Chrome Web Store screenshot guidance](https://developer.chrome.com/docs/webstore/images) and [Mozilla listing guidance](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/). Review the current store dashboard requirements before uploading.

## Requirements And Quick Start

- Node.js 22 or newer.
- Project dependencies installed with `npm ci`.
- An installed Chrome, Edge, or Chromium browser.

From the repository root:

```bash
npm ci
npm run screenshots
```

The command runs `scripts/generate-store-photos.mjs`. By default it builds the current source with Vite into a unique temporary directory, serves those files on a loopback address, and launches a separate browser with a temporary profile. It reads the version from the project rather than assuming a particular release number. It does not reuse or overwrite a release build directory.

The capture uses the application's actual HTML, JavaScript, styles, images, and controls. Browser automation supplies only non-personal fixture data and the extension API surface needed for a local preview. It does not recreate the interface, replace its CSS, generate a mock page, or use image generation. See [Screenshot Demo Data](SCREENSHOT_DEMO_DATA.md) for the fixture boundaries.

## Browser And Build Options

Browser discovery is automatic. To select an executable explicitly:

```bash
npm run screenshots -- --browser-path "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

`AURA_SCREENSHOT_BROWSER` provides the same browser-path setting through the environment. Add `--headed` to see the isolated browser window while it works; the default is headless.

```bash
npm run screenshots -- --headed
```

To capture a particular existing build instead of rebuilding the current source:

```bash
npm run screenshots -- --dist dist-google
```

`AURA_SCREENSHOT_DIST_DIR` also selects an existing build. The explicit build's manifest version must match the current package version, and the visible application version is checked during capture. Matching version numbers cannot prove that an existing build includes every source edit: use the default fresh build for current-source screenshots.

The Chromium and Firefox target versions in `package.json` must match for a shared screenshot set. The command reports an error if they differ.

The browser is controlled through the Chrome DevTools Protocol. Native Firefox is not automated by this command. These screenshots show Aura Start's shared interface in a format suitable for both stores; they do not verify native Firefox behavior, browser permissions, Google OAuth, or live synchronization.

## Output And Scene Order

Every successful run creates a new directory in each local-only submission folder:

```text
Chrome Submit/Screenshots/<version>/<run-id>/
Firefox Submit/Screenshots/<version>/<run-id>/
```

The run ID combines a UTC timestamp and a random suffix. Both directories contain identical copies of the five images, a screenshot ZIP, `capture-report.json`, and a short `README.md`. Previous captures and release ZIPs remain unchanged. These submission folders are ignored by Git.

Upload the PNG images in this order:

| File | Actual interface shown |
| --- | --- |
| `01-links-and-groups-1280x800.png` | The start page with sample links and groups. |
| `02-notes-and-countdown-1280x800.png` | Markdown notes and the optional Countdown widget. |
| `03-full-backup-zip-1280x800.png` | The export/backup interface and Full Backup ZIP option. |
| `04-custom-timer-sound-1280x800.png` | Countdown settings with a sample WAV imported through the real file input. |
| `05-google-drive-sync-1280x800.png` | The actual Google Drive settings while disconnected. |

The ZIP is a convenient bundle of screenshots, not an extension release package. Store screenshot fields expect the individual PNG files.

## Isolation And Validation

The tool creates its own browser profile, temporary build, and loopback server with dynamically allocated ports. It never uses a personal browser profile or reads personal bookmarks or tabs. Synthetic extension storage belongs only to that preview. Google Drive remains off, and external requests are blocked during capture. No real account, token, Drive file, completed synchronization, or sync timestamp is fabricated.

The custom-sound scene uses a generated sample WAV. The script imports that file through Aura Start's real audio file input and waits for the application to process it. The sound does not come from a user's files.

Before accepting the output, the command checks the current version, expected headings and visible controls, browser JavaScript errors, PNG dimensions and RGB format, and the screenshot ZIP hashes. If the interface changes so the expected controls cannot be found, the command fails instead of fabricating a replacement screen. Update the scene navigation and checks to match the real interface, then run it again.

Automated checks do not replace visual review. Open all five PNGs before upload and check that text is readable, important controls are in view, the scenes match the intended release, and no personal information appears. Screenshots are not evidence that real Google authorization, synchronization, or store submission succeeded.

Run `npm run test:screenshots` for the capture helper's regression checks, including DevTools timeouts, unsafe profile rejection, and rejection of outdated builds. These tests supplement the full `npm run screenshots` browser run.

## Public Website And Older Artwork

This command does not refresh the website gallery or promotional composites. The public images in `docs/assets/screenshots/` with `*-20261004.png` filenames document the October 4, 2026 capture. They remain separate from new store capture runs.

The older `Chrome Submit/Photo/` and `Firefox Submit/Photo/` directories are retained as local reference artwork. Neither those directories, the previous `Screenshots 2.1.0` sets, nor `Chrome Submit/Promo/` are overwritten. Update the website or promotional images explicitly when a separate task calls for it.

Before publication, also check that store listing text agrees with the current product, `PRIVACY.md`, and manifest permissions. Official store publication remains the project owner's responsibility under [CONTRIBUTING.md](../CONTRIBUTING.md).
