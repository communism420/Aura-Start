# Aura Start

Aura Start is a private, local-first browser new tab extension for clean groups of links. It is built for people who want a fast, exportable start page without accounts, analytics, tracking, forced cloud sync, or paid data access.

Aura Start is an independent open-source project, not affiliated with A Fine Start. It is inspired by the simple grouped-link workflow and focuses on local-first data ownership, export, privacy, and migration.

Positioning: A private, local-first start page for your links - free, open-source, and easy to export.

This documentation describes Aura Start **2.1.0** (updated October 4, 2026). Store availability may differ from the source version; see [what changed since 2.0.5](CHANGELOG.md).

## Download

- Chromium browsers: [Chrome Web Store](https://chromewebstore.google.com/detail/aura-start/pdhhhnmcampmmklkbbfbmniijmgjiabi)
- Firefox: [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/aura-start/)

## Why Aura Start?

- Free and open-source
- No account required
- No analytics or tracking
- Your links stay local by default
- Export anytime
- Import from A Fine Start export codes
- Optional Google Drive sync for groups, links, settings, notes, your background image, and your selected Countdown sound across connected devices

## Features

- Open-source application code under the MIT License; bundled third-party components retain their own licenses
- Custom groups and links on the new tab page
- Nested groups up to two levels
- Local extension storage through the WebExtension storage API
- Light, dark, and system themes
- Interface languages: English, Russian, Spanish, German, French, Portuguese, and Ukrainian
- Compact mode and configurable columns
- Fuzzy search across title, URL, description, and tags with quick filters and result counts
- Background image presets, custom image upload with optional Google Drive sync, blur, dim, and positioning controls
- Optional widgets for clock, Markdown notes with optional Google Drive sync, Pomodoro, and Countdown with a customizable completion sound
- First-run onboarding with start fresh, restore from Google Drive, A Fine Start import, and backup import options
- Empty-state actions and opt-in demo groups
- Command Palette for keyboard-first navigation, with a visible UI button and Ctrl+K/Cmd+K when the browser assigns that shortcut to Aura Start
- Layout-aware keyboard shortcuts that continue to work on Latin and Cyrillic keyboard layouts
- Duplicate Finder that scans read-only and deletes only after user selection and confirmation
- Explicit edit mode: drag-and-drop and inline edit controls stay disabled until you turn editing on
- Drag and drop for groups and links, including moving links between groups and moving groups into or out of nested parents
- Optional Save open tabs workflow with preview, duplicate filtering, and runtime `tabs` permission request
- Optional bidirectional Google Drive sync with automatic merging of concurrent and offline edits
- Settings migration that adds newly introduced options while preserving existing choices in local storage and Google Drive
- Google Chrome OAuth through `chrome.identity.getAuthToken`, plus configured device-code fallback builds for Firefox and Chromium browsers that reject Chrome's built-in Google sign-in
- Visible Export / Backup hub and Restore Timeline
- JSON import with validation, merge, replace, and restore point protection
- Import from A Fine Start export codes for migration
- Export to an A Fine Start-compatible export code if you change your mind
- Restore points before imports, link/group deletion, group moves/reorders, tab saves, reset, and cloud restore actions
- Privacy Promise and keyboard shortcuts help in Settings
- Version information in Settings and an optional header version badge
- Undo toast for deleting links and groups
- Safe recovery screen for corrupted local data
- Export through local Blob downloads only

## Local-First Philosophy

Aura Start does not need a server to work. Your groups and links stay in your browser profile by default, and the extension does not use analytics, trackers, bookmarks permission, history permission, Firebase, Supabase, or a custom backend.

Google Drive sync is optional, off by default, and user-controlled. Aura Start makes no Google authorization or Drive requests before you choose to connect. Google authorization is used only so Aura Start can read and write its own sync files; it is not used for analytics, tracking, account profiling, or broad access to Drive files.

Aura Start 2.1.0 uses `https://www.googleapis.com/auth/drive.file` for one shared `aura-start-sync.json` in normal Google Drive storage, marked with Aura Start app properties. All updated installations connected to the same Google account read and update that file. Existing accessible Aura Start copies are merged and removed only after their contents have been verified in the shared file. Aura Start does not access unrelated Drive files.

Google Chrome builds whose extension ID supports the configured native OAuth client use `chrome.identity.getAuthToken`, with `drive.file` for shared sync and `drive.appdata` for legacy hidden backups. Firefox, unpacked Chromium builds (including unpacked builds running in Google Chrome), and compatible Chromium browsers without native Google sign-in use the configured Google Device OAuth fallback with `drive.file` for sync and deletion. The authorization flow depends on the build and browser, not just the browser name. Hidden backups are included only with existing access; otherwise a persistent notice explains how to check the Google account used for cleanup. Neither flow requests the full `https://www.googleapis.com/auth/drive` scope.

Aura Start does not request browser history, bookmarks, cookies, `webRequest`, scripting, full Drive access, or `identity.email`. The `alarms` permission schedules background checks only for connected automatic sync. The optional tabs permission is requested only when the user enables and uses Save open tabs. Manual ZIP and JSON export/import remain fully available without Google Drive.

| Permission | Purpose |
| --- | --- |
| `storage` | Save links, settings, local recovery snapshots, and connection state in this browser profile. |
| `alarms` | Schedule periodic Google Drive checks while connected automatic sync is enabled and the browser runs. |
| `identity` (Chromium builds) | Use native Google Chrome extension authorization; Firefox Device OAuth builds omit this permission. |
| `tabs` (optional) | Read the current window's tab titles and URLs only for the user-requested Save open tabs preview. Receiving the setting through sync does not grant this permission. |
| Google API hosts (`www.googleapis.com`, `oauth2.googleapis.com`) | Authorize and exchange Aura Start sync data after the user connects Google Drive. Host permissions are declared in the package; Google consent is a separate step. |

Custom images, sound preparation, and file backups run locally and need no additional browser permissions. The packaged audio decoder uses `wasm-unsafe-eval` in the extension content security policy; it is not a browser permission or a remote-code exception. See the [Privacy Policy](PRIVACY.md) for data handling and browser-specific permission details.

Your data belongs to you. Export it whenever you want and keep backups in normal files.

## Open Source

Aura Start's application code is open-source under the MIT License. The extension code, build scripts, validation scripts, and documentation are intended to be public and auditable. Bundled dependencies retain their own licenses.

There is no proprietary server component, hidden backend, paid data lock-in, or closed sync service required for Aura Start to work. You can inspect, build, fork, modify, and redistribute the application under MIT, while complying with the licenses of included third-party code. In particular, the packaged `@ffmpeg/ffmpeg` wrapper is MIT and the `@ffmpeg/core` decoder is GPL-2.0-or-later. Build output under `vendor/ffmpeg/` includes their notices, pinned hashes, and matching upstream source/build references; preserve the corresponding redistribution materials.

## Export Formats

Aura Start supports:

- Full Backup ZIP: settings, links, notes, Restore Points, their background files, and the currently selected original Countdown sound; no stock or other historical sounds
- Settings and links only (JSON): settings, links, notes, and Restore Points without embedded media
- Browser Bookmarks HTML: Netscape bookmarks HTML with groups as folders
- Markdown: readable grouped link lists
- CSV: `group,title,url,description,tags,createdAt,updatedAt`
- A Fine Start export code: JSON code compatible with A Fine Start's Import bookmarks tool

## Install In Developer Mode

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click Load unpacked.
6. Select the generated `dist` folder.

The extension overrides the browser new tab page with `newtab.html`.

## Development

```bash
npm install
npm run test
npm run typecheck
npm run build
npm run build:local
npm run build:firefox
npm run build:store
npm run validate:zip
```

In Vite development mode, Aura Start falls back to `localStorage` when the WebExtension storage API is not available. Production extension builds use browser-local extension storage.

When adding or changing a stored setting, follow the migration and compatibility checklist in [Settings Schema](docs/SETTINGS_SCHEMA.md).

`npm run build:local` creates a local unpacked-extension build in `dist-local`. `npm run build:firefox` creates a Firefox-oriented package in `dist-firefox` and rewrites the built manifest for Firefox ES-module background scripts plus `browser_specific_settings.gecko`. `npm run build:store` builds the Chrome Web Store release package in `dist` and validates Manifest V3, least-privilege permissions, required extension files, localized manifest messages, CSP, OAuth configuration, and no obvious remote-code patterns. `npm run validate:zip` checks the Chrome Submit ZIP against the current `dist` package after a fresh ZIP is created.

The working release matrix also uses the four review folders `dist-google`, `dist-google-local`, `dist-firefox`, and `dist-firefox-local`; these names are not all default outputs of individual npm commands. See [Release Checklist](docs/RELEASE_CHECKLIST.md) for the build/client mapping and exact preparation workflow. All four current builds are 2.1.0. Existing submission ZIPs must be rebuilt and validated separately; updating documentation or a build directory does not update an older archive.

Extension store versions are configured separately in `package.json` under `extensionVersions.chromium` and `extensionVersions.firefox`. Build-time manifest injection writes the target browser version into the generated `manifest.json`, and release validators fail if a Chromium or Firefox package contains the wrong target version. Use `AURA_CHROMIUM_EXTENSION_VERSION`, `AURA_FIREFOX_EXTENSION_VERSION`, or `AURA_EXTENSION_VERSION` only for one-off build overrides.

For a release build with Google Drive sync, provide real OAuth configuration through environment variables instead of committing secrets:

- `AURA_GOOGLE_OAUTH_CLIENT_ID`: Chrome Extension OAuth client ID for the final extension ID.
- `AURA_GOOGLE_STORE_DEVICE_OAUTH_CLIENT_SECRET`: release Device OAuth client secret used by `npm run build:store` for Chromium browsers where Chrome identity sign-in is unavailable.
- `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID` and `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET`: Device OAuth credentials used by `npm run build:firefox` for Firefox Google Drive sync.
- `AURA_FIREFOX_EXTENSION_ID`: Firefox add-on ID for `browser_specific_settings.gecko.id`; the finalizer defaults to `aura-start@example.com` whenever this variable is omitted, including release builds. Preserve and verify the existing AMO add-on ID when preparing a release.
- Local development builds can use `.env.local` for local-only OAuth values; do not commit that file.

### Store Screenshots

With Node.js 22 or newer, `npm ci`, and an installed Chrome, Edge, or Chromium browser, run:

```bash
npm run screenshots
```

The command builds the current source in a temporary directory and captures five 1280 x 800 PNGs from the real application in an isolated browser profile. It prepares identical local-only sets for Chrome Web Store and Firefox Add-ons under `Chrome Submit/Screenshots/<version>/<run-id>/` and `Firefox Submit/Screenshots/<version>/<run-id>/`, with a screenshot ZIP and capture report. It uses non-personal sample data, leaves Google Drive disconnected, and preserves previous screenshots and release packages.

Use `-- --browser-path "C:/path/to/chrome.exe"` to select the browser, `-- --headed` to show it, or `-- --dist dist-google` to capture an existing version-checked build. This is a capture of the shared interface in a real Chromium browser, not a native Firefox or Google OAuth integration test. Review the images before uploading. See the [screenshot capture guide](docs/SCREENSHOTS.md) for the full workflow and fixture boundaries.

## Import And Recovery

Use Settings -> Import backup to select a Full Backup ZIP directly; no manual extraction is needed. Settings and links only JSON and older Aura Start JSON backups are also accepted. Aura Start validates the backup before applying it, preserves this installation's Google Drive connection, and lets you choose:

- Merge with current data
- Replace current data

Before import replace, restore, group deletion, group moves, tab saves, reset, demo-data removal, duplicate deletion, and cloud restore actions, Aura Start creates a restore point. Restore Timeline shows these local snapshots grouped by day with search and action filters. Restore points are kept locally and capped to 20 snapshots to avoid unbounded storage growth. Use Full Backup ZIP for long-term backup history.

Full Backup ZIP contains a JSON document with settings, links, notes, and Restore Points, together with current and historical custom background files. ZIP format v2 includes only the currently selected original Countdown audio file; it does not add a playback WAV or other sounds from history. Selecting the built-in signal produces no audio file in the archive. References to different historical sounds are omitted neutrally, so restoring that history keeps the receiving profile's current sound or its built-in default. A Restore Point exported individually includes the original sound selected in that point. Import rebuilds playback locally before applying settings; older v1 ZIPs and portable JSON backups remain supported.

Settings and links only (JSON) contains no embedded images or audio. Custom-file references and an active Custom background choice are omitted with neutral compatibility metadata: those omitted choices keep the receiving profile's existing values, or use built-in defaults on a fresh profile. Explicit built-in background choices and intentional image/sound removals remain settings and can replace the receiver's choices on import. Other settings, notes, links, and history remain in the JSON. Use ZIP to transfer custom files. Older portable JSON backups with embedded media are still importable. A complete backup with a corrupt or unavailable referenced asset fails before local data changes rather than silently dropping that asset.

JSON backups created by 2.0.5 remain importable, with new settings filled in automatically. Those old exports did not contain the Notes widget text or the actual custom background image. Import cannot recover files or text absent from the backup; upgrading an existing installation migrates its locally stored notes and background instead. OAuth tokens and an active running timer are not portable backup contents, and importing a backup does not sign another installation into Google.

ZIP processing happens in a packaged local worker. Archives are limited to 256 MiB; a backup that exceeds a limit or has unavailable required assets reports an error rather than silently omitting data.

If stored data is corrupted, Aura Start shows a recovery screen instead of overwriting it. You can export the raw stored payload before resetting.

## Countdown Widget

Enable Countdown in Settings -> Widgets to set a duration from 1 second to 24 hours, then start, pause, resume, or reset it. A built-in sound signals completion. Choose a custom audio file in settings, preview it, adjust volume from 0 to 100, or return to the built-in signal. Countdown is disabled by default, including after an upgrade.

Custom files may be up to 20 MiB. Aura Start keeps the original file and prepares the first 60 seconds as a 24 kHz mono PCM WAV signal, so a sound selected in one supported browser can also play after syncing to another. Import supports formats such as WAV, MP3, Ogg/Opus/Vorbis, FLAC, AAC/M4A, WebM, AIFF, WMA, APE, and others supported by the bundled decoder. A filename extension alone does not guarantee a supported codec: damaged, protected, or unsupported audio is rejected without replacing the current sound.

Audio preparation runs locally. The browser decoder is tried first; a bundled FFmpeg WebAssembly decoder handles fallback imports without sending audio to a conversion service. This adds roughly 32 MB to the extension package and loads only when the fallback is needed. The extension allows its packaged WebAssembly through `wasm-unsafe-eval` in its content security policy; it does not download executable code or request additional browser permissions for the timer.

The running countdown is local to the browser profile and is shared between its Aura Start tabs, including after a page reload. Keep Countdown enabled and an Aura Start page open for the completion sound; the page may be in the background, but browser suspension or a sleeping device can delay playback. Closing every Aura Start page or the browser prevents timely sound delivery. Reopening the page shows the deadline-based remaining or completed state; browser audio restrictions may require pressing Play signal. Hiding the widget stops its sound and display updates while retaining the countdown deadline. Google Drive syncs the widget preference, duration, volume, and selected audio, while the active countdown stays local.

## Optional Google Drive Sync

Google Drive Sync is available in Settings and is disabled by default. Connect the same Google account on every device and update every connected installation to 2.1.0. Aura Start combines the devices' groups, links, ordering, nesting, and shared settings into one dataset. An empty installation receives the existing cloud data. Onboarding's Restore from Google Drive action reports a clear error without changing local data if no Aura Start backup exists.

Actual shared edits are queued in the extension background context. While an Aura Start page is visible and online, quiet checks look for remote changes about every five seconds. Multiple open pages share the same background checks. Opening, closing, or focusing a page does not itself start synchronization or its animation. A background alarm keeps checking about once a minute while the browser runs, including with all Aura Start pages closed. When verified remote revisions are unchanged and there are no pending local edits, checks read only small Drive file metadata: no data/media downloads, uploads, animation, or changes to the displayed last-sync time. New or unverified remote revisions are read when needed; explicit connection/restore/check actions can also request synchronization.

Offline changes stay local and retry after background startup or an online event when there are pending edits. Failed quiet checks back off before retrying. Search/filter, running timers, recovery-history changes, and unchanged settings do not start a new content sync. Browser scheduling, network access, and Google API availability can delay updates; this is periodic synchronization, not instant push delivery.

Changes to different fields merge independently. Concurrent changes to the same field resolve consistently using logical revision counters and a device identifier as a tie-breaker. Deletion records prevent an older snapshot from silently restoring a deleted item. Normal automatic sync does not ask users to choose between whole local and cloud copies. Updates to the shared file are conditional on the revision read: if another device has changed it, Aura Start reads the newer contents, merges again, and retries. An interrupted or repeatedly conflicting transfer keeps local changes pending.

Existing per-device copies are consolidated into one shared file. Migration creates a new file ID, verifies the merged data and selected media there, and only then conditionally deletes covered older copies. A copy changed during cleanup is read and merged again before deletion. If two installations create the first shared file simultaneously, more than one file can briefly appear; subsequent synchronization selects the same surviving file and consolidates the others. Update every connected installation to the latest 2.1.0 build so an older build does not keep creating per-device copies.

While sync is enabled, the saved custom background image also syncs through Google Drive, including replacement and removal. A saved image is included even when a built-in background is selected. With sync off, the image stays local.

The selected Countdown sound also syncs, including its original audio file and portable playback copy. Replacing or removing a custom sound propagates to connected devices, and the saved sound is included even when Countdown is disabled. Missing or corrupt audio blocks that transfer before local settings change or a cloud backup is overwritten. With sync off, the selected audio stays in the local profile.

Large sync snapshots upload in bounded resumable chunks so audio is not forced into one short browser-background request. A lost chunk response is checked against Drive's received position before retrying. A transfer interrupted by closing the browser can start again on a later sync; a slow or incomplete transfer does not count as a successful backup.

All saved user preferences sync, including the Notes widget's text, Save open tabs preference, and delete-backup-on-disconnect preference. Notes retain Markdown and whitespace up to 12,000 characters; edits and intentional clearing also sync while the widget is hidden. The browser's actual `tabs` permission is granted separately on each installation and is never granted by receiving a preference.

Restore Timeline, search query/filter, onboarding and demo markers, running timers, Google connection/sync mode, and account credentials remain local. Sync revisions contain a generated device identifier, but another device's identifier does not replace this installation's identity. A local restore point is created before cloud content changes are applied. Importing a JSON backup preserves the current installation's Google Drive connection. Simultaneous edits to the same note resolve to one consistent value; they are not combined as collaborative text. Recovery points retain the previous local note when cloud changes or a stale editor replace it.

Aura Start renews expired short-lived Google access tokens without opening a sign-in window and uses bounded retries for temporary authorization failures. The selected authorization flow and Device OAuth refresh credentials persist in extension-local storage across browser restarts. Network failures, rate limits and server errors retain the connection and pending edits. A confirmed unusable grant, such as Google's `invalid_grant`, requires the explicit Reconnect Google Drive action; local data and the Drive file reference are preserved. Authorization responses started before a disconnect cannot reconnect the installation afterward.

Google can still require new consent or invalidate a grant. In particular, an external OAuth project in Testing issues seven-day refresh tokens for Drive scopes; see [Google's refresh-token limits](https://developers.google.com/identity/protocols/oauth2#expiration). The current Cloud project's publishing status has not been verified here. Changing that status is a Google Cloud configuration task, not an extension setting.

Upgrading from an earlier version:

- Aura Start reads older accessible backups, including Chrome's hidden `appDataFolder`, during migration. Their data joins the shared file; covered older files are removed only after verification and a conditional revision check. Unreadable or invalid files are not discarded.
- A custom background saved in 2.0.5 is migrated automatically before the first 2.1.0 sync, including a saved image that is not currently selected. The existing image is kept until migration is durably saved, and an older cloud snapshot with no image does not delete it. Re-uploading the image is not required.
- Existing local widget notes move into shared settings before sync. Aura Start saves a local recovery point and the main document before clearing the old copy. If another explicit shared note already exists, it is kept and the older local note remains recoverable. Older snapshots without notes do not clear newer text.
- New settings receive their defaults while valid existing choices are preserved, including nested background and widget options. A setting absent from an older Drive snapshot does not reset an existing choice. The same migration applies when loading older JSON backups or Restore Points.
- Countdown starts disabled when upgrading a snapshot that predates it. Older local, cloud, or Restore Point data without timer fields does not erase a duration, volume, or custom sound already selected in a newer installation.
- Chrome may show Reconnect Google Drive once so the user can approve the new `drive.file` scope. The extension does not open a consent prompt from an unattended background task.
- Update all connected installations to the latest 2.1.0 build; earlier builds do not participate in the single-file protocol. Release clients must belong to the same Google Cloud project for access to the same Aura Start files.

Compatible future settings that this version does not display are retained through saving and synchronization when their names and values pass validation. This does not guarantee support for an incompatible future data format; keep connected installations up to date. Migration does not grant permissions, replace the current Drive connection, or interrupt the custom background migration described above.

Available actions:

- Connect Google Drive
- Reconnect Google Drive without discarding existing sync metadata
- Disconnect Google Drive and keep the Drive sync file
- Delete Drive backup and disconnect

Settings include a "Delete Drive backup when disconnecting" option, enabled by default. To keep the cloud copy, turn it off before disconnecting. When it is off, disconnecting stops sync and removes Aura Start's saved session in this browser; other installations remain connected and the shared Drive file is kept. When it is on, the confirmed action pauses sync and permanently deletes Aura Start files from normal Drive, including the shared file, any remaining old 2.0.5 files, renamed app-marked files and copies in Trash. Their synced links, settings, notes, custom backgrounds and selected audio are deleted with those files. Hidden legacy `appDataFolder` backups are included only when access is already available. Aura Start verifies removal in the accessible storage before clearing this installation's credentials and disconnecting. Local data and unrelated Drive files remain unchanged.

Disconnect does not revoke the Google project's authorization, because that would also invalidate other installations' tokens. To revoke Aura Start's access everywhere, use [Google Account connections](https://myaccount.google.com/connections). A locally disconnected installation stays disconnected until you explicitly connect it again.

The current Device OAuth configuration uses its existing `drive.file` access for deletion and does not request `drive.appdata`. It cannot read hidden legacy backups with that grant. If hidden backups cannot be checked, a persistent Settings notice records that limitation separately from verified normal-Drive deletion, including after reload, reconnection or a later cleanup of another account. It links to [Google Drive settings](https://drive.google.com/drive/u/0/settings): select the Google account used for that unverified cleanup, then Manage apps → Aura Start → Options → Delete hidden app data, if available. This does not mean hidden backups exist or that Aura Start has verified manual removal.

If authorization or deletion fails, sync stays paused and Aura Start retains the account and backup references for another attempt; it does not claim that deletion succeeded. Updated installations that detect a previously synced cloud copy has disappeared pause and request reconnection instead of recreating it automatically. Disconnect other devices first to keep the cloud empty: older versions, a remaining hidden backup on an active legacy installation, an in-flight upload, or a later explicit reconnect can upload retained data again.

Connection and reconnection merge existing local data with accessible cloud snapshots. Aura Start creates a local restore point before applying cloud content changes, including during connection or onboarding.

When Google Drive sync is enabled and connected, Aura Start shows a compact status marker in the upper-right header. The marker indicates connection/sync status only; it does not mean Aura Start has full Drive access.

Connect Google Drive opens Google's authorization prompt when the browser needs sign-in or consent. A Google Chrome installation using the configured native flow shows Chrome's extension OAuth prompt. Firefox and builds using Device fallback, including unpacked Chrome builds, open Google's device sign-in page and show a short device code until the connection finishes. Users do not enter OAuth client IDs in Aura Start settings. Importing a local JSON backup preserves the current local Google Drive connection metadata for the installed extension so sync does not disconnect just because local bookmark data changed.

## Migrate from A Fine Start

Aura Start can import A Fine Start export codes for migration. Aura Start is independent and not affiliated with A Fine Start.

1. Open A Fine Start.
2. Go to Settings.
3. Export bookmarks and copy the export code.
4. Open Aura Start.
5. Choose Import from A Fine Start.
6. Paste the code.
7. Choose Merge or Replace.
8. Done.

Aura Start converts A Fine Start groups and bookmarks into local Aura Start groups and links. Imported URLs are still validated by Aura Start, so unsupported or unsafe URL schemes are rejected instead of being saved.

You can export back to an A Fine Start-compatible export code from Aura Start if you change your mind. That compatibility format stores group names and bookmark `name`/`url` values only, so Aura Start-specific fields such as descriptions and tags are not included when exporting back to that format.

## Firefox Build

Firefox support is packaged separately from the Chrome Web Store build:

PowerShell:

```powershell
$env:AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID='PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com'
$env:AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET='PASTE_REAL_DEVICE_SECRET_HERE'
npm run build:firefox
```

POSIX shells:

```bash
AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID=PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com \
AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET=PASTE_REAL_DEVICE_SECRET_HERE \
npm run build:firefox
```

The `build:firefox` script runs TypeScript checking, Vite production build, Firefox JavaScript sanitization, Firefox manifest finalization, and Firefox package validation. The generated `dist-firefox/manifest.json` removes Chrome-only `manifest.oauth2`, removes the Chrome-only `identity` permission, uses Firefox background scripts, and sets `browser_specific_settings.gecko`.

Use `AURA_FIREFOX_ALLOW_MISSING_DEVICE_OAUTH=true npm run build:firefox` only for UI smoke builds where Google Drive sync is intentionally unavailable. Do not use that flag for the Mozilla Add-ons release package.

## Mozilla Add-ons Source Code Submission

When Mozilla Add-ons asks whether source code must be submitted, choose **Yes** for Aura Start Firefox releases. Aura Start uses Vite, TypeScript, React, Tailwind CSS, and npm dependencies, so the uploaded extension ZIP contains generated bundled code.

Upload a separate source archive in the source-code field. Do not upload the built `Firefox Submit/aura-start-<version>-firefox.zip` there; that file is the extension package. The source archive should contain the readable project source needed to reproduce the Firefox package:

- `src/`
- `public/`
- `scripts/`
- root HTML entry points: `newtab.html`, `options.html`, and `popup.html`
- build and TypeScript configuration: `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, and `postcss.config.js`
- project documentation and license files, including this `README.md`, `PRIVACY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, and `LICENSE`

Do not include generated, dependency, secret, or store-upload artifacts in the source archive:

- `node_modules/`
- `dist/`, `dist-*`, `dist-google*`, or `dist-firefox*`
- `.git/`
- `.env`, `.env.*`, or local credential files
- generated release ZIP files
- source maps

To reproduce the submitted Firefox package from the source archive:

```powershell
npm ci
$env:AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID='PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com'
$env:AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET='PASTE_REAL_DEVICE_SECRET_HERE'
npm run build:firefox
```

The release OAuth values are supplied through environment variables and are intentionally not committed to the repository. `npm run build:firefox` fails if those values are missing, which prevents accidental Firefox release packages with broken Google Drive Device OAuth sync.

After the build, zip the contents of `dist-firefox/` with `manifest.json` at the archive root, then run:

```powershell
npm run validate:firefox
npm run validate:firefox:submit
```

## Privacy

Aura Start has no backend, no analytics, no tracking scripts, no required sync, and no access to browser history or bookmarks. Optional Google Drive sync uses Google API host permissions only when the user enables it; Chrome builds also use the `identity` permission for native extension OAuth. Shared sync uses `drive.file` for the Aura Start-owned shared file and migration of older copies; Chrome retains `drive.appdata` for legacy backup migration. The `alarms` permission supports periodic background sync while the browser runs. Aura Start does not request full Drive access.

## More Docs

- [Aura Start vs A Fine Start](./docs/AURA_START_VS_A_FINE_START.md)
- [Getting Started](./docs/getting-started.html)
- [Migrate from A Fine Start](./docs/MIGRATE_FROM_A_FINE_START.md)
- [Google Drive Sync](./docs/google-drive-sync.html)
- [Public website](https://aurastart.pages.dev/)
- [Public privacy policy](https://aurastart.pages.dev/privacy-policy.html)
- [Public user documentation](https://aurastart.pages.dev/documentation.html)
- [Screenshot gallery](./docs/screenshot-gallery.html)
- [Changelog](./CHANGELOG.md)
- [Privacy Policy](./PRIVACY.md)

## License

Aura Start's application code is released under the [MIT License](./LICENSE). Bundled third-party components, including the FFmpeg decoder, retain their own licenses and redistribution requirements. See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.
