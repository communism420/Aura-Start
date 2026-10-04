# Aura Start 2.1.1 — Firefox Homepage and New Windows

> Maintainer-only draft. Version 2.1.1 adds Firefox homepage support; the 2.1.0 changes since 2.0.5 are retained below. Verify final packages and publication status before publishing; this page does not announce a completed store release.

Reviewed October 4, 2026.

## What's new in 2.1.1

- Added Firefox homepage support so new windows and the Home button can open the same Aura Start page as new tabs.
- Preserved Firefox's confirmation, homepage controls, and previous-session restoration preference without adding browser permissions.
- Refreshed the documentation, privacy and permission explanations, both store listing drafts, and website screenshots for 2.1.1.

## Previously added in 2.1.0

- Reworked Google Drive synchronization so updated installations share one visible `aura-start-sync.json`, with verified consolidation of accessible older copies.
- Added automatic merging of concurrent and offline changes, conditional writes, retry after write conflicts, and deletion records that prevent stale edits from restoring deleted links.
- Made receiving changes faster: visible online Aura Start pages check approximately every five seconds. Hidden or closed pages use a roughly one-minute background check while the browser runs. Multiple pages share the same check schedule, and failures increase the retry delay.
- Removed unnecessary uploads and sync animations caused by opening, closing, or focusing unchanged pages. Periodic metadata checks continue quietly.
- Added Google Drive synchronization of Markdown notes, including edits and clearing while the widget is hidden, and of the saved custom background image.
- Added the optional Countdown widget with pause, resume, reset, a completion signal, adjustable volume, and custom audio.
- Added local preparation of custom audio with browser decoding and a bundled FFmpeg fallback. Original files up to 20 MiB are retained; up to the first 60 seconds are prepared for playback. Codec support depends on successful decoding, so protected, damaged, or unsupported files can be rejected.
- Added synchronization of Countdown preferences and the selected custom sound, including its original filename, original bytes, and prepared playback copy.
- Added Full Backup ZIP containing settings, links, notes, Restore Points, current and historical backgrounds, and only the selected original Countdown audio. Built-in sound, other historical audio, and the generated playback WAV are excluded from ZIP v2.
- Renamed the previous JSON backup option to “Settings and links only.” It retains notes and recovery history but omits custom media bytes; use ZIP to transfer custom files.
- Improved additive settings migration so missing new options receive compatible defaults without overwriting existing explicit preferences.
- Preserved compatibility with 2.0.5 JSON backups and added safe migration of locally stored notes and backgrounds when updating an existing profile.
- Strengthened recovery after temporary network and authorization failures, while preserving pending changes and manual account disconnection.
- Made ordinary Google account disconnection local to the selected installation, without revoking other installations' authorization.
- Improved verified cloud-backup deletion, including old, renamed app-marked, and trashed snapshots, with an explicit persistent notice when hidden legacy storage cannot be checked.
- Corrected misleading messages when a clean installation receives an existing cloud backup.
- Improved import, restore, and Undo handling so the current Drive connection and unrelated synchronized changes are preserved.

## Upgrading from 2.0.5

Update the existing installation when possible. Aura Start migrates local settings, notes, and the custom background before synchronizing; failed migration retains the previous local copy for retry. New settings are added without resetting known choices.

Old JSON backups remain importable, but 2.0.5 did not include the notes widget's text or custom background image bytes in JSON. Import cannot recover content the file never contained. Updating an existing profile can migrate those local values. Older portable JSON and ZIP v1 backups also remain supported.

Native Chrome authorization requests `drive.file` for the shared visible file and retains `drive.appdata` for accessible hidden legacy backups. An old app-data-only connection may need explicit reconnection to approve the shared-file scope. The current Device flow in Firefox, Helium, other compatible Chromium browsers, and some unpacked Chrome installations uses `drive.file` only. It cannot read a hidden legacy copy through that authorization. Accessible legacy copies are merged before verified conditional cleanup.

Update every connected installation to the current build. The shared sync protocol introduced in 2.1.0 is unchanged in 2.1.1. Use the same Google account and compatible release OAuth configuration. A simultaneous first connection can briefly create more than one file; updated installations consolidate those accessible copies after verification.

## Local data, privacy, and permissions

Aura Start remains local-first, with no required account, analytics, tracking, ads, or Aura Start backend. Drive sync is optional and off by default. The shared file contains preferences, links, groups, notes, the saved background, the selected sound, and merge metadata. Credentials, connection state, actual browser permission grants, running countdowns, search/filter state, and Restore Timeline stay local. Deleted link/group fields can remain in causal deletion records to prevent resurrection.

Chromium packages declare `storage`, `identity`, and `alarms`; Firefox packages declare `storage` and `alarms`. `tabs` remains optional for Save open tabs. Host permissions are limited to `https://www.googleapis.com/*` and `https://oauth2.googleapis.com/*`. No browser history/bookmarks permission or full Google Drive scope is requested.

Firefox builds require version 142 or later, remove Chromium's `oauth2` entry and `identity`, and declare `data_collection_permissions` as required `none`, with optional `browsingActivity` and `technicalAndInteraction` for Google Drive synchronization. The packaged WebAssembly decoder uses the CSP's `wasm-unsafe-eval` allowance and adds no timer permission. Conversion stays on the device.

The Countdown completion sound requires an Aura Start page to remain open. It is not a system alarm that can play after the browser closes. Polling intervals are not guaranteed cloud-delivery times. Aura Start does not add password protection or end-to-end encryption to its visible Drive JSON or exported backups. See the [privacy policy](../PRIVACY.md).

## Export and backup

- **Full Backup ZIP:** settings, links, notes, Restore Points, current/historical background files, and the selected original Countdown audio only. Playback is prepared locally on import.
- **Settings and links only (JSON):** preferences, links, notes, and recovery history without custom media. Omitted custom choices retain receiving-device values or use defaults on a fresh profile; explicit built-in selections and intentional media removals can still apply.
- **Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible code:** portable link exports with the limitations described in the [documentation](documentation.html).

Import keeps this installation's Google connection. Imported shared content synchronizes normally when sync is enabled. Aura Start also continues to import A Fine Start export codes; it is independent and not affiliated with A Fine Start.

## Build and packaging notes

These are build instructions, not completed verification results:

```bash
npm ci
npm run test
npm run typecheck
npm run build
```

`build` produces `dist`; `build:local` produces `dist-local`. Before `build:store`, privately configure the release `AURA_GOOGLE_OAUTH_CLIENT_ID` and required `AURA_GOOGLE_STORE_DEVICE_OAUTH_CLIENT_SECRET`; the command builds and validates `dist` but does not create a ZIP. The Device client secret is packaged for a distributed public client, not used as a confidential backend secret. Never publish personal tokens or local environment files.

For Firefox, configure the intended `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID`, `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET`, and add-on ID, then run `npm run build:firefox`. This produces `dist-firefox` and runs sanitization, manifest finalization, and validation. Unpacked Chromium loads from its selected folder through the browser's extension manager; Firefox temporary testing uses `about:debugging` and the generated manifest.

The project workflow refreshes `dist-google`, `dist-google-local`, `dist-firefox`, and `dist-firefox-local` after changes. Creating those exact paths requires the intended Vite `--outDir`, browser/mode and credential role, plus validation of each actual folder. See the [release checklist](RELEASE_CHECKLIST.md) for the validation environment variables and package requirements.

Create store ZIPs separately from validated release outputs, with `manifest.json` at archive root and all referenced background, worker, decoder, locale, icon, and license files included. Rebuilding a folder does not refresh an old ZIP. Upload and publish manually only after verifying the actual archives. Do not describe a prepared directory as a published or reviewed store release.

## Verification record

Record final build commands, package hashes, store URLs, and actual publication status before releasing these notes. Use the [installed-extension matrix](INSTALLED_EXTENSION_TEST_MATRIX.md) for dated evidence and outstanding manual checks. Its controlled tests include concurrent editing, browser interruption/recovery, and visible-page propagation in real browser processes with simulated Google HTTP; these are not live-account Google guarantees. Prior results and user reports do not automatically validate a newly prepared archive.

The application source is MIT-licensed; bundled third-party components retain their own licenses and notices.
