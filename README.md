# Aura Start

Aura Start is a private, local-first browser new tab extension for clean groups of links. It is built for people who want a fast, exportable start page without accounts, analytics, tracking, forced cloud sync, or paid data access.

Aura Start is an independent open-source project, not affiliated with A Fine Start. It is inspired by the simple grouped-link workflow and focuses on local-first data ownership, export, privacy, and migration.

Positioning: A private, local-first start page for your links - free, open-source, and easy to export.

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
- Optional Google Drive backup/sync, with Chrome using the hidden Drive `appDataFolder` and Firefox/compatible Chromium builds using a device-code fallback when browser identity sign-in is unavailable

## Features

- Fully open-source under the MIT License
- Custom groups and links on the new tab page
- Nested groups up to two levels
- Local extension storage through the WebExtension storage API
- Light, dark, and system themes
- Interface languages: English, Russian, Spanish, German, French, Portuguese, and Ukrainian
- Compact mode and configurable columns
- Fuzzy search across title, URL, description, and tags with quick filters and result counts
- Background image presets, custom local background upload, blur, dim, and positioning controls
- Optional widgets for clock, local Markdown notes, and a Pomodoro timer
- First-run onboarding with start fresh, restore from Google Drive, A Fine Start import, and backup import options
- Empty-state actions and opt-in demo groups
- Command Palette for keyboard-first navigation, with a visible UI button and Ctrl+K/Cmd+K when the browser assigns that shortcut to Aura Start
- Layout-aware keyboard shortcuts that continue to work on Latin and Cyrillic keyboard layouts
- Duplicate Finder that scans read-only and deletes only after user selection and confirmation
- Explicit edit mode: drag-and-drop and inline edit controls stay disabled until you turn editing on
- Drag and drop for groups and links, including moving links between groups and moving groups into or out of nested parents
- Optional Save open tabs workflow with preview, duplicate filtering, and runtime `tabs` permission request
- Optional Google Drive sync/backup with automatic backup after connection
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

Google Drive sync is optional, off by default, and user-controlled. Google authorization is used only so Aura Start can read and write its own sync file; it is not used for analytics, tracking, account profiling, or broad access to Drive files.

In Google Chrome, Aura Start uses the manifest OAuth client through `chrome.identity.getAuthToken` and requests only `https://www.googleapis.com/auth/drive.appdata`. In that mode, the sync file is named `aura-start-sync.json` and is stored in Google Drive's hidden `appDataFolder`, not in the visible Drive root and not in a normal user folder.

Firefox and some Chromium browsers, such as Brave, Helium, or ungoogled Chromium builds, cannot rely on Chrome's built-in Google sign-in token flow. For those browsers, Aura Start can use a configured Google Device OAuth fallback. Google Device OAuth does not support the `appDataFolder` scope, so that fallback uses the narrower per-file `https://www.googleapis.com/auth/drive.file` scope and creates or updates only Aura Start's own `aura-start-sync.json` file marked with Aura Start app properties. Aura Start still does not request the full `https://www.googleapis.com/auth/drive` scope.

Aura Start does not request browser history, bookmarks, cookies, `webRequest`, scripting, full Drive access, or `identity.email`. The optional tabs permission is requested only when the user enables and uses Save open tabs. Manual JSON export/import remains fully available without Google Drive.

Your data belongs to you. Export it whenever you want and keep backups in normal files.

## Open Source

Aura Start is fully open-source under the MIT License. The extension code, build scripts, validation scripts, and documentation are intended to be public and auditable.

There is no proprietary server component, hidden backend, paid data lock-in, or closed sync service required for Aura Start to work. You can inspect the source, build it yourself, fork it, modify it, and redistribute it under the terms of the MIT License.

## Export Formats

Aura Start supports:

- Full Backup JSON: full Aura Start data for restore or migration
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

`npm run build:local` creates a local unpacked-extension build in `dist-local`. `npm run build:firefox` creates a Firefox-oriented package in `dist-firefox` and rewrites the built manifest for Firefox ES-module background scripts plus `browser_specific_settings.gecko`. `npm run build:store` builds the Chrome Web Store release package in `dist` and validates Manifest V3, least-privilege permissions, required extension files, localized manifest messages, CSP, OAuth configuration, and no obvious remote-code patterns. `npm run validate:zip` checks the Chrome Submit ZIP against the current `dist` package after a fresh ZIP is created.

Extension store versions are configured separately in `package.json` under `extensionVersions.chromium` and `extensionVersions.firefox`. Build-time manifest injection writes the target browser version into the generated `manifest.json`, and release validators fail if a Chromium or Firefox package contains the wrong target version. Use `AURA_CHROMIUM_EXTENSION_VERSION`, `AURA_FIREFOX_EXTENSION_VERSION`, or `AURA_EXTENSION_VERSION` only for one-off build overrides.

For a release build with Google Drive sync, provide real OAuth configuration through environment variables instead of committing secrets:

- `AURA_GOOGLE_OAUTH_CLIENT_ID`: Chrome Extension OAuth client ID for the final extension ID.
- `AURA_GOOGLE_STORE_DEVICE_OAUTH_CLIENT_SECRET`: release Device OAuth client secret used by `npm run build:store` for Chromium browsers where Chrome identity sign-in is unavailable.
- `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID` and `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET`: Device OAuth credentials used by `npm run build:firefox` for Firefox Google Drive sync.
- `AURA_FIREFOX_EXTENSION_ID`: optional Firefox add-on ID for `browser_specific_settings.gecko.id`; defaults to `aura-start@example.com` for local builds.
- Local development builds can use `.env.local` for local-only OAuth values; do not commit that file.

## Import And Recovery

Use Settings -> Import backup to import a Full Backup JSON file. Aura Start validates the file before applying it and lets you choose:

- Merge with current data
- Replace current data

Before import replace, restore, group deletion, group moves, tab saves, reset, demo-data removal, duplicate deletion, and cloud restore actions, Aura Start creates a restore point. Restore Timeline shows these local snapshots grouped by day with search and action filters. Restore points are kept locally and capped to 20 snapshots to avoid unbounded storage growth. Use Full Backup JSON for long-term backup history.

If stored data is corrupted, Aura Start shows a recovery screen instead of overwriting it. You can export the raw stored payload before resetting.

## Optional Google Drive Sync

Google Drive Sync is available in Settings and is disabled by default. Aura Start keeps local storage as the primary source of truth unless the user connects Google Drive. On connection, Aura Start looks for its existing sync file. If the file exists, Aura Start restores it after creating a local restore point. If the file does not exist, Aura Start creates it from the current local data. New users can also choose Restore from Google Drive during onboarding; if no sync file exists, Aura Start shows a clear error and leaves local data unchanged. After connection, local changes are queued and synced automatically by the extension background context. Closing the Aura Start page does not cancel an active upload; an interrupted pending upload is retried when the browser starts again.

Aura Start automatically renews expired short-lived Google access tokens and retries a failed Drive request once. Device OAuth refresh credentials are stored in extension-local storage and are retained across temporary network failures, Google rate limits, server errors, and OAuth client-configuration errors. Aura Start removes them automatically only when Google explicitly reports `invalid_grant`, which means the grant is no longer usable. In that case the existing sync metadata and Drive file reference are preserved, and Settings shows an explicit Reconnect Google Drive action.

Storage mode depends on the browser authentication path:

- Google Chrome built-in identity flow: hidden Google Drive `appDataFolder` file with the `drive.appdata` scope.
- Device-code fallback for Firefox and Chromium browsers without Chrome sign-in support: an Aura Start-created Drive file with the `drive.file` scope, marked with Aura Start app properties.

Available actions:

- Connect Google Drive
- Reconnect Google Drive without discarding existing sync metadata
- Disconnect Google Drive and keep the Drive sync file
- Delete Drive backup and disconnect

Settings include a "Delete Google Drive sync file when disconnecting" option. When it is off, disconnecting clears Aura Start's local Google access and keeps the Drive sync file available for future reconnects. When it is on, Delete Drive backup and disconnect is a destructive action with a confirmation dialog. It deletes only Aura Start's `aura-start-sync.json` sync file, clears Aura Start's cached Google access, and turns sync off. It does not delete local Aura Start data and does not touch unrelated Google Drive files.

Before restoring from Google Drive during connection or onboarding, Aura Start creates a local restore point named `Before Google Drive restore`.

When Google Drive sync is enabled and connected, Aura Start shows a compact status marker in the upper-right header. The marker indicates connection/sync status only; it does not mean Aura Start has full Drive access.

Connect Google Drive opens Google's authorization prompt when the browser needs sign-in or consent. In Google Chrome this is the native Chrome extension OAuth prompt. In Firefox and supported Chromium fallback mode, Aura Start opens Google's device sign-in page and shows a short device code until the connection finishes. Users do not enter OAuth client IDs in Aura Start settings. Importing a local JSON backup preserves the current local Google Drive connection metadata for the installed extension so sync does not disconnect just because local bookmark data changed.

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

Aura Start has no backend, no analytics, no tracking scripts, no required sync, and no access to browser history or bookmarks. Optional Google Drive sync uses Google API host permissions only when the user enables it; Chrome builds also use the `identity` permission for native extension OAuth. Google Chrome uses the `drive.appdata` scope for Aura Start's hidden app data file. Device-code fallback builds use `drive.file` only for Aura Start's own sync file and do not request full Drive access.

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

Aura Start is released under the [MIT License](./LICENSE). See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.
