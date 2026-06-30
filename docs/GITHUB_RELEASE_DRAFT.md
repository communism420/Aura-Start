# Aura Start 2.0.0 - Nested Groups, Search, Timeline, Firefox, and Personalization

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


Aura Start 2.0.0 focuses on nested organization, faster search, safer recovery, optional tab capture, Firefox support, personalization, and local-first data ownership.

## Highlights

- Improved A Fine Start migration flow with preview, validation, Merge/Replace choices, and restore point protection.
- Added first-run onboarding, better empty states, and opt-in demo groups.
- Added nested groups up to 2 levels with drag-and-drop reparenting.
- Added Fuse.js fuzzy search across title, URL, description, and tags, with result counts and quick filters.
- Added a visible Export / Backup hub for Full Backup JSON, Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible export.
- Reworked restore points into a searchable Restore Timeline grouped by day.
- Added optional Save open tabs with runtime `tabs` permission, preview, duplicate filtering, and restore point protection.
- Added background image presets, custom local background uploads, blur, dim, and position controls.
- Added optional widgets: header clock, Markdown notes, and Pomodoro timer.
- Added Privacy Promise in Settings.
- Added Command Palette, visible palette access, and keyboard shortcuts help.
- Added Duplicate Finder with read-only scan and user-confirmed deletion.
- Added Firefox build support with WebExtension-compatible APIs and Google Device OAuth fallback.
- Improved Google Drive sync behavior, including manifest OAuth first in Google Chrome, Device OAuth fallback for Firefox/compatible Chromium browsers, automatic backup after connection, and onboarding restore from Drive.
- Improved Chrome Web Store and Firefox Add-ons submission notes, refreshed screenshots, and migration/comparison documentation.

## Migration From A Fine Start

Aura Start can import A Fine Start export codes and can export an A Fine Start-compatible code for a basic grouped-link format later. Aura Start is independent and not affiliated with A Fine Start.

See `docs/MIGRATE_FROM_A_FINE_START.md` for the full migration guide.

## Privacy And Local-First Storage

Aura Start stores groups, nested group relationships, links, settings, widget state, background preferences, and restore timeline entries locally by default. It has no required account, no analytics, no tracking, no ads, and no backend.

Optional Google Drive sync is off by default. Google Chrome uses the hidden Google Drive `appDataFolder` scope for Aura Start's own `aura-start-sync.json` file. Firefox and compatible Chromium fallback builds can use Google Device OAuth with `drive.file` only for Aura Start's own sync file. After connection, local changes are backed up automatically. Aura Start does not request full Google Drive access or browser history/bookmarks permissions. Optional tabs access is requested only when the user previews current-window tabs for Save open tabs.

## Export And Backup

Supported export formats:

- Full Backup JSON
- Browser Bookmarks HTML
- Markdown
- CSV
- A Fine Start-compatible export code

## Chrome Web Store

Chrome Web Store availability: add or update the live listing URL in the final release notes after verifying the published item.

Do not upload from automation. Build the package locally, verify the ZIP, then upload manually in the Chrome Web Store Developer Dashboard.

## Manual Install From Source

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `dist`. For Firefox, run `npm run build:firefox`, open `about:debugging`, choose This Firefox, and load `dist-firefox/manifest.json`.

## Google Drive OAuth Setup

For Chrome release builds with Google Drive sync, build with a real Chrome Extension OAuth client ID:

```bash
AURA_GOOGLE_OAUTH_CLIENT_ID=PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com npm run build:store
```

Google Chrome should use the Chrome Extension OAuth client in `manifest.oauth2` through `chrome.identity.getAuthToken`. Firefox and Chromium fallback builds should use the configured Google Device OAuth flow with the `drive.file` scope because Device OAuth cannot request Chrome's hidden `drive.appdata` scope. Do not publish a package containing placeholder OAuth values or an unapproved bundled OAuth client ID.

For Firefox builds, provide real Device OAuth credentials:

```bash
AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID=PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com \
AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET=PASTE_REAL_DEVICE_SECRET_HERE \
npm run build:firefox
```

When testing the release, verify that onboarding can restore an existing `aura-start-sync.json` file from Google Drive and that it shows a clear no-file message without changing local data when no sync file exists.

## Fresh Chrome Web Store ZIP

Create the Chrome Web Store ZIP from the contents of `dist-google` or the release `dist` after `npm run build:store`. Create the Firefox ZIP from `dist-firefox` after `npm run build:firefox`. Each archive root should contain `manifest.json`, `newtab.html`, `options.html`, `popup.html`, `logo.png`, `_locales/`, `icons/`, and `assets/`.

## Checks Run

- `npm run typecheck`
- `npm run build`
- `npm run build:store`
- `npm run build:firefox`

Update this section with the final command results before publishing the GitHub release.
