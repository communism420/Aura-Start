# Aura Start

Aura Start is a local-first Chromium new tab extension for clean groups of links. It is built for people who want a fast start page without accounts, tracking, forced cloud sync, or paid data access.

Aura Start was inspired by the simplicity and bookmark-grouping idea of A Fine Start. It is an independent project, not affiliated with A Fine Start, and it focuses on local-first ownership, built-in export, and no required account or sync.

Slogan: All features of A Fine Start and even more - free and forever.

## Features

- Fully open-source under the MIT License
- Custom groups and links on the new tab page
- Local storage through `chrome.storage.local`
- Light, dark, and system themes
- Interface languages: English, Russian, Spanish, German, French, Portuguese, and Ukrainian
- Compact mode and configurable columns
- Search across title, URL, description, and tags
- Explicit edit mode: drag-and-drop and inline edit controls stay disabled until you turn editing on
- Drag and drop for groups and links, including moving links between groups
- Optional Google Drive sync/backup through the hidden Drive `appDataFolder`
- JSON import with validation, merge, replace, and restore point protection
- A Fine Start export-code import for migration from A Fine Start
- A Fine Start export-code export for moving Aura Start links back into A Fine Start
- Restore points before destructive actions
- Undo toast for deleting links and groups
- Safe recovery screen for corrupted local data
- Export through local Blob downloads only

## Local-First Philosophy

Aura Start does not need a server to work. Your groups and links stay in your browser profile by default, and the extension does not use analytics, trackers, bookmarks permission, history permission, Firebase, Supabase, or a custom backend.

Google Drive sync is optional, off by default, and user-controlled. When enabled, Aura Start uses Google OAuth through `chrome.identity` and only the `https://www.googleapis.com/auth/drive.appdata` scope. The Google authorization is used only so Aura Start can read and write its own hidden sync file; it is not used for analytics, tracking, account profiling, or access to normal Drive files. The sync file is named `aura-start-sync.json` and is stored in Google Drive's hidden appDataFolder, not in the visible Drive root and not in a normal user folder.

Aura Start does not request access to the user's full Google Drive, does not scan normal Drive files, does not request `identity.email`, and does not create visible Drive backup files. Manual JSON export/import remains fully available without Google Drive.

Your data belongs to you. Export it whenever you want and keep backups in normal files.

## Open Source

Aura Start is fully open-source under the MIT License. The extension code, build scripts, validation scripts, documentation, and store-submission notes are intended to be public and auditable.

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

The extension overrides the Chromium new tab page with `newtab.html`.

## Development

```bash
npm install
npm run typecheck
npm run build
npm run build:store
```

In Vite development mode, Aura Start falls back to `localStorage` when `chrome.storage.local` is not available. Production extension builds use `chrome.storage.local`.

`npm run build:store` builds the extension and validates the generated `dist` package for Chrome Web Store review basics: Manifest V3, least-privilege permissions, required extension files, localized manifest messages, CSP, and no obvious remote-code patterns.

## Import And Recovery

Use Settings -> Import backup to import a Full Backup JSON file. Aura Start validates the file before applying it and lets you choose:

- Merge with current data
- Replace current data

Before import replace, group deletion, and reset actions, Aura Start creates a restore point. Restore points are kept locally and capped to avoid unbounded storage growth.

If stored data is corrupted, Aura Start shows a recovery screen instead of overwriting it. You can export the raw stored payload before resetting.

## Optional Google Drive Sync

Google Drive Sync is available in Settings and is disabled by default. Aura Start keeps local storage as the primary source of truth unless the user connects Google Drive. After connection, local changes are queued and synced to the hidden Google Drive app data file automatically.

Available actions:

- Connect Google Drive
- Backup to Google Drive
- Restore from Google Drive
- Delete Drive backup and disconnect

Delete Drive backup and disconnect is a single destructive action with a confirmation dialog. It deletes only the hidden `aura-start-sync.json` file from the extension's Google Drive app data, clears Aura Start's cached Google access, and turns sync off. It does not delete local Aura Start data and does not touch normal Google Drive files.

Before restoring from Google Drive, Aura Start creates a local restore point named `Before Google Drive restore`.

When Google Drive sync is enabled and connected, Aura Start shows a compact status marker in the upper-right header. The marker indicates connection/sync status only; it does not mean Aura Start has full Drive access.

Connect Google Drive uses Chrome's built-in `chrome.identity.getAuthToken` OAuth flow and may open a Google authorization prompt when Chrome needs explicit sign-in or consent. The consent screen requests only the minimal `drive.appdata` permission and no full Drive scope. The OAuth client ID identifies the Aura Start app package to Google; it is not a user tracking ID, not a user secret, and not entered by users in Aura Start settings. Google requires an OAuth client ID for Drive authorization, so there is no Client-ID-free Google Drive API flow.

Google Drive sync can use either Chrome's built-in token flow or a Web OAuth fallback. For Google Chrome Web Store builds, create a Chrome Extension OAuth client. For Brave, Edge, or profiles where `chrome.identity.getAuthToken` opens a `Custom URI scheme is not supported on Chrome apps` error, also create a Web Application OAuth client and add this authorized redirect URI:

```text
https://pdhhhnmcammpmmklkbbfbmnijimgjiabi.chromiumapp.org/oauth2
```

For release builds, do not edit `public/manifest.json` manually. Create a real OAuth client for the Aura Start extension in Google Cloud Console, enable the Google Drive API for that project, then set `AURA_GOOGLE_OAUTH_CLIENT_ID` before running the build. Vite will inject it into `dist/manifest.json`.

Do not copy the placeholder below as-is. Google will reject placeholder or example values with `invalid_client`.

```bash
AURA_GOOGLE_OAUTH_CLIENT_ID=PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com npm run build:store
```

On PowerShell:

```powershell
$env:AURA_GOOGLE_OAUTH_CLIENT_ID="PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com"; npm run build:store
```

For repeat local builds, put the value in `.env.local`:

```env
AURA_GOOGLE_OAUTH_CLIENT_ID=PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com
AURA_GOOGLE_WEB_OAUTH_CLIENT_ID=PASTE_REAL_WEB_CLIENT_ID_HERE.apps.googleusercontent.com
```

If Google shows `invalid_client`, the generated `dist/manifest.json` contains a Client ID that Google does not recognize. Recreate the OAuth client in Google Cloud Console, make sure it belongs to the same extension/app setup, rebuild with `AURA_GOOGLE_OAUTH_CLIENT_ID`, and reload the extension from `dist`.

If Google shows `invalid_request` with `Custom URI scheme is not supported on Chrome apps`, create the Web Application OAuth client above, set `AURA_GOOGLE_WEB_OAUTH_CLIENT_ID`, rebuild, and reload the extension.

## Migrating From A Fine Start

In A Fine Start, open Settings -> Export bookmarks and copy the generated export code. In Aura Start, open Settings -> Import backup, choose A Fine Start export code, paste the code, then choose Merge or Replace.

Aura Start converts A Fine Start groups and bookmarks into local Aura Start groups and links. It supports the current A Fine Start export shape and the older v2 export shape. Imported URLs are still validated by Aura Start, so unsupported or unsafe URL schemes are rejected instead of being saved.

To move from Aura Start back to A Fine Start, use Aura Start -> Export -> A Fine Start export code. Open A Fine Start -> Settings -> Import bookmarks, paste the generated code, and import it there. A Fine Start's format stores group names and bookmark `name`/`url` values only, so Aura Start descriptions and tags are not included in that export.

## Roadmap

- Firefox support later

## Privacy

Aura Start has no backend, no analytics, no tracking scripts, no required sync, and no access to browser history or bookmarks. Optional Google Drive sync uses `identity`, `drive.appdata`, and Google API host access only when the user enables it, and only for Aura Start's hidden Google Drive app data file.

See [PRIVACY.md](./PRIVACY.md) for the privacy policy text and [STORE_SUBMISSION.md](./STORE_SUBMISSION.md) for Chrome Web Store submission notes.

## License

Aura Start is released under the [MIT License](./LICENSE). See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.
