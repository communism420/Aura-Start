# Aura Start Screenshot Capture

> Maintainer-only document. This workflow prepares store images; it does not publish a release.

Run `npm run screenshots` to capture the current Aura Start interface in a real installed Chromium browser. The same five 1280 x 800 RGB PNG images are prepared for Chrome Web Store and Firefox Add-ons. The command also creates Chrome Web Store promotional images at 440 x 280 and 1400 x 560 automatically. These sizes follow the [Chrome Web Store image guidance](https://developer.chrome.com/docs/webstore/images) and [Mozilla listing guidance](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/). Review the current store dashboard requirements before uploading.

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

The five interface screenshots use the application's actual HTML, JavaScript, styles, images, and controls. Browser automation supplies only non-personal fixture data and the extension API surface needed for a local preview. It does not recreate the interface, replace its CSS, or use image generation. The two promotional images are separate branded compositions, also rendered in the real browser, using the actual application logo and an overview screenshot captured in the same run. Their interface preview is that screenshot, not a redrawn application. See [Screenshot Demo Data](SCREENSHOT_DEMO_DATA.md) for the fixture boundaries.

The older `node scripts/generate-promo-assets.mjs` command is a compatibility entry point for this full pipeline. It accepts the same options, captures the current interface again, and creates both screenshots and promotional images; it does not reuse older `Photo/` images.

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

The run ID combines a UTC timestamp and a random suffix. Both directories contain identical copies of the five interface images and their screenshot ZIP. Each also has its own `capture-report.json` and short `README.md` describing the files for that store. Previous captures and release ZIPs remain unchanged. These submission folders are ignored by Git.

Upload the PNG images in this order:

| File | Actual interface shown |
| --- | --- |
| `01-links-and-groups-1280x800.png` | The start page with sample links and groups. |
| `02-notes-and-countdown-1280x800.png` | Markdown notes and the optional Countdown widget. |
| `03-full-backup-zip-1280x800.png` | The export/backup interface and Full Backup ZIP option. |
| `04-custom-timer-sound-1280x800.png` | Countdown settings with a sample WAV imported through the real file input. |
| `05-google-drive-sync-1280x800.png` | The actual Google Drive settings while disconnected. |

The screenshot ZIP is a convenient bundle of the five interface images, not an extension release package. Store screenshot fields expect the individual PNG files.

The Chrome run directory additionally contains:

| File | Chrome Web Store field |
| --- | --- |
| `Promo/small-promo-440x280.png` | Small promotional tile, 440 x 280. |
| `Promo/marquee-promo-1400x560.png` | Marquee promotional tile, 1400 x 560. |
| `aura-start-<version>-chrome-web-store-images.zip` | Convenience bundle with the five interface PNGs under `screenshots/` and both promotional PNGs under `Promo/`. |

All seven images are 24-bit RGB PNGs without an alpha channel. Upload each promotional PNG to its matching promotional field, separately from the five screenshots. The legacy 920 x 680 promotional size is not generated. Firefox output contains only the five interface screenshots, their ZIP, report, and instructions; Chrome promotional tiles are not copied there.

The Chrome capture report records promotional image metadata, the source screenshot hash, and the Chrome image bundle hash in addition to the screenshot information. This makes the connection between the current capture and its promotional images inspectable.

## Isolation And Validation

The tool creates its own browser profile, temporary build, and loopback server with dynamically allocated ports. It never uses a personal browser profile or reads personal bookmarks or tabs. Synthetic extension storage belongs only to that preview. Google Drive remains off, and external requests are blocked during capture. No real account, token, Drive file, completed synchronization, or sync timestamp is fabricated.

The custom-sound scene uses a generated sample WAV. The script imports that file through Aura Start's real audio file input and waits for the application to process it. The sound does not come from a user's files.

Before accepting the output, the command checks the current version, expected headings and visible controls, browser JavaScript errors, image dimensions and RGB format, and ZIP hashes. The promotional images are checked at their own required dimensions. If the interface changes so the expected controls cannot be found, the command fails instead of fabricating a replacement screen. Update the scene navigation and checks to match the real interface, then run it again.

Automated checks do not replace visual review. Open all five screenshots and both promotional PNGs before upload and check that text is readable, important controls are in view, the scenes match the intended release, and no personal information appears. Screenshots are not evidence that real Google authorization, synchronization, or store submission succeeded.

Run `npm run test:screenshots` for the capture helper's regression checks, including DevTools timeouts, unsafe profile rejection, and rejection of outdated builds. These tests supplement the full `npm run screenshots` browser run.

## Public Website And Older Artwork

This command does not refresh the website gallery automatically. The current public images in `docs/assets/screenshots/` with `*-2-1-1-20261004.png` filenames are reviewed copies from the 2.1.1 run `20261004T030628Z-10391764`, captured on October 4, 2026 in Chrome 154. The [asset inventory](assets/store/README.md) maps the store and public names, and a [public capture record](assets/screenshots/capture-2-1-1-20261004.json) records their hashes and build fingerprint.

When updating the website, copy the reviewed original PNGs without redrawing or changing their contents. Use new versioned filenames, update the home-page images and gallery captions to match the actual scenes, and refresh the public capture record. Keep local paths, credentials, and personal data out of that record.

The older `Chrome Submit/Photo/` and `Firefox Submit/Photo/` directories are retained as local reference artwork. Neither those directories, the previous `Screenshots 2.1.0` sets, nor `Chrome Submit/Promo/` are overwritten. Fresh promotional images are saved only in the new Chrome run's `Promo/` subdirectory. Updating the website gallery remains a separate task.

Before publication, also check that store listing text agrees with the current product, `PRIVACY.md`, and manifest permissions. Official store publication remains the project owner's responsibility under [CONTRIBUTING.md](../CONTRIBUTING.md).
