# Aura Start 1.2.0 — Migration & Data Ownership Release

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


Aura Start 1.2.0 focuses on migration, local-first data ownership, safer recovery, and faster power-user workflows.

## Highlights

- Improved A Fine Start migration flow with preview, validation, Merge/Replace choices, and restore point protection.
- Added first-run onboarding, better empty states, and opt-in demo groups.
- Added a visible Export / Backup hub for Full Backup JSON, Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible export.
- Added Restore Points Manager for local recovery snapshots.
- Added Privacy Promise in Settings.
- Improved search and keyboard navigation.
- Added Command Palette, visible palette access, and keyboard shortcuts help.
- Added Duplicate Finder with read-only scan and user-confirmed deletion.
- Improved Google Drive sync behavior, including manifest OAuth first in Google Chrome, redirect-free device-code OAuth fallback for compatible Chromium browsers, automatic backup after connection, and onboarding restore from Drive.
- Improved Chrome Web Store submission notes, refreshed screenshots, and migration/comparison documentation.

## Migration From A Fine Start

Aura Start can import A Fine Start export codes and can export an A Fine Start-compatible code for a basic grouped-link format later. Aura Start is independent and not affiliated with A Fine Start.

See `docs/MIGRATE_FROM_A_FINE_START.md` for the full migration guide.

## Privacy And Local-First Storage

Aura Start stores groups, links, settings, and restore points locally by default. It has no required account, no analytics, no tracking, no ads, and no backend.

Optional Google Drive sync is off by default and uses only the hidden Google Drive `appDataFolder` scope for Aura Start's own `aura-start-sync.json` file. After connection, local changes are backed up automatically. Aura Start does not request full Google Drive access or browser history/bookmarks permissions.

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

Then open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `dist`.

## Google Drive OAuth Setup

For release builds with Google Drive sync, build with a real Chrome Extension OAuth client ID:

```bash
AURA_GOOGLE_OAUTH_CLIENT_ID=PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com npm run build:store
```

Google Chrome should use the Chrome Extension OAuth client in `manifest.oauth2` through `chrome.identity.getAuthToken`. For Brave/Chromium fallback support, set `AURA_GOOGLE_DEVICE_OAUTH_CLIENT_ID` and `AURA_GOOGLE_DEVICE_OAUTH_CLIENT_SECRET` from a Google OAuth client of type "TVs and Limited Input devices". Do not publish a package containing placeholder OAuth values or an unapproved bundled OAuth client ID.

When testing the release, verify that onboarding can restore an existing `aura-start-sync.json` file from Google Drive and that it shows a clear no-file message without changing local data when no sync file exists.

## Fresh Chrome Web Store ZIP

Create the Chrome Web Store ZIP from the contents of `dist` after `npm run build:store`. The archive root should contain `manifest.json`, `newtab.html`, `options.html`, `popup.html`, `logo.png`, `_locales/`, `icons/`, and `assets/`.

## Checks Run

- `npm run typecheck`
- `npm run build`
- `npm run build:store`

Update this section with the final command results before publishing the GitHub release.
