# Chrome Web Store Submission Notes

> Maintainer-only document. This file is for Chrome Web Store release preparation and is not needed for normal Aura Start users.

These notes are for preparing Aura Start for Chrome Web Store review. They do not guarantee approval, but they keep the submission aligned with the current Chrome Web Store review themes: single purpose, least privilege, no remote hosted code, and clear privacy disclosures.

## Single Purpose

Aura Start is a local-first new tab start page for organizing user-created groups of links. Google Drive sync is optional, off by default, and limited to the hidden Drive app data folder.

Suggested short description:

> A local-first, private, exportable start page for your Chromium new tab.

Suggested positioning:

> A private, local-first start page for your links - free, open-source, and easy to export.

Suggested detailed description:

> Aura Start replaces the Chromium new tab page with a clean local-first start page for groups of links. Create, search, and reorder link groups; import from Aura Start backups or A Fine Start export codes; export anytime as JSON, Browser Bookmarks HTML, Markdown, CSV, or an A Fine Start-compatible export code; use restore points before destructive changes; and work faster with Command Palette, browser-assigned shortcuts, Cyrillic-layout shortcut handling, and Duplicate Finder. Aura Start requires no account, has no analytics or tracking, and has no backend. Optional Google Drive backup/sync uses only the hidden Google Drive appDataFolder file and syncs local changes automatically after the user connects it. Aura Start is open-source under the MIT License and is an independent project, not affiliated with A Fine Start.

## Open Source Policy

Aura Start is fully open-source under the MIT License. The source code, build scripts, validation scripts, documentation, and store-submission notes should remain public and auditable.

When publishing to the Chrome Web Store, include the public source repository URL in the listing support or website fields once the repository is available. The submitted extension package should be reproducible from the public source with:

```bash
npm install
npm run build:store
```

## Prepared Release Materials

- Store listing draft: `docs/STORE_LISTING.md`
- Screenshot plan: `docs/SCREENSHOTS.md`
- Screenshot demo data: `docs/SCREENSHOT_DEMO_DATA.md`
- Screenshot staging gallery: `docs/screenshot-gallery.html`
- Store asset checklist: `docs/assets/store/README.md`
- Release checklist: `docs/RELEASE_CHECKLIST.md`
- Installed-extension test matrix: `docs/INSTALLED_EXTENSION_TEST_MATRIX.md`
- Promotion plan: `docs/PROMOTION_PLAN.md`
- GitHub release draft: `docs/GITHUB_RELEASE_DRAFT.md`

These files are preparation material only. They do not publish Aura Start to the Chrome Web Store and should be checked against the current local build before submission.

## Permission Justification

Requested permissions:

- `storage`: saves user-created groups, links, settings, sync metadata, and restore points in local extension storage.
- `identity`: lets the user explicitly connect optional Google Drive sync through Chrome's OAuth flow.

Requested host permission:

- `https://www.googleapis.com/*`: used only for optional Google Drive API calls to read and write Aura Start's hidden app data file.

Requested OAuth scope:

- `https://www.googleapis.com/auth/drive.appdata`: lets Aura Start read and write only its own hidden Google Drive app data.

Aura Start connects through Chrome's built-in `chrome.identity.getAuthToken` OAuth flow when the user clicks Connect Google Drive. The Chrome Web Store build must use the Chrome Extension OAuth client configured in `manifest.oauth2`; a manual `launchWebAuthFlow` URL must never be the primary auth path in Google Chrome. Users do not paste OAuth client IDs into Aura Start settings. Google requires a real OAuth client ID for Drive authorization; Aura Start does not use full Drive permission to avoid this. The submitted package must include Aura Start's configured Chrome Extension OAuth client ID in `dist/manifest.json`; set `AURA_GOOGLE_OAUTH_CLIENT_ID` before `npm run build:store` to inject it automatically. To support Brave and other Chromium browsers that reject `chrome.identity.getAuthToken`, also set `AURA_GOOGLE_WEB_OAUTH_CLIENT_ID` to a real Web OAuth client whose authorized JavaScript origin is `https://<extension-id>.chromiumapp.org` and whose exact authorized redirect URI is `https://<extension-id>.chromiumapp.org/oauth2`. That fallback is used only when Chrome identity is unavailable or explicitly unsupported; Google Chrome still uses manifest OAuth first. Example and placeholder IDs are rejected by validation because Google returns `invalid_client` for them. This does not add host permissions and does not grant access to normal Google Drive files.

The Google OAuth consent is used only to read, create, update, or delete Aura Start's hidden `aura-start-sync.json` app data file. Aura Start does not use Google authorization for analytics, tracking, advertising, account profiling, or access to visible Google Drive files. Importing local JSON data preserves the local Google Drive connection metadata for the installed extension, so changing groups or links does not disconnect sync by itself.

Aura Start intentionally does not request:

- `bookmarks`
- `history`
- `tabs`
- `cookies`
- `webRequest`
- `scripting`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/drive.file`
- full Google Drive access
- broad host permissions such as `<all_urls>`

## Privacy Practices

Use the privacy policy in `PRIVACY.md` as the public privacy policy text. The Chrome Web Store Developer Dashboard requires a publicly reachable privacy policy URL if the item handles sensitive user data, even when that data is stored locally. Host this policy on the project website, GitHub Pages, or another page controlled by the publisher before submitting.

Recommended dashboard disclosure:

- Aura Start is fully open-source under the MIT License.
- Aura Start handles user-provided bookmark/link data locally.
- Google Drive sync is optional and off by default.
- When enabled, Aura Start stores one hidden `aura-start-sync.json` file in the user's Google Drive `appDataFolder`.
- After connection, local Aura Start changes are queued and synced automatically.
- First-run onboarding can restore an existing hidden Drive sync file when the user chooses that action; if no file exists, Aura Start reports that and keeps local data unchanged.
- Aura Start does not request full Google Drive access and does not read, scan, edit, delete, or create visible Drive files.
- Aura Start does not use Google authorization to track users or profile their Drive contents.
- Aura Start does not collect or transmit user data to the developer.
- Aura Start does not sell user data.
- Aura Start does not use user data for advertising.
- Aura Start does not allow humans to read user data.
- Aura Start uses `chrome.storage.local`, optional `chrome.identity`, and the Google Drive `drive.appdata` scope only for the extension's single purpose.

Short privacy disclosure for listing copy:

> Aura Start stores user-created groups, links, settings, and restore points locally by default. It has no backend, no analytics, no tracking, and no required account. Optional Google Drive sync is user-initiated and uses only the hidden Google Drive appDataFolder file for Aura Start backup/sync.

## Remote Hosted Code

Aura Start should be submitted from the built `dist` directory. All runtime JavaScript is bundled in `dist/assets`. The extension must not load JavaScript, WASM, or logic from remote URLs.

Before packaging, run:

```bash
npm run build:store
npm run validate:zip
```

This runs TypeScript, production build, a Chrome Web Store validation pass over `dist`, and a ZIP freshness/content check after the Chrome Submit ZIP is created.

## Store Package

Submit the contents of `dist` as the extension package. Do not include source files, `node_modules`, screenshots, or development artifacts in the uploaded ZIP.

Required generated files:

- `dist/manifest.json`
- `dist/newtab.html`
- `dist/options.html`
- `dist/popup.html`
- `dist/logo.png`
- `dist/icons/icon-16.png`
- `dist/icons/icon-32.png`
- `dist/icons/icon-48.png`
- `dist/icons/icon-128.png`
- `dist/_locales/*/messages.json`

The final ZIP must include `manifest.json` at archive root, include `background.js` when the manifest references it, keep `commands.toggle-command-palette` in sync with the source manifest, and exclude `src`, `docs`, `Photo`, `Chrome Submit`, `node_modules`, `.git`, `.env`, source files, screenshots, and development artifacts.

## Manual Release Steps

- Publish GitHub Pages from the `docs` folder and use the resulting `docs/privacy-policy.html` URL as the Chrome Web Store privacy policy URL.
- Build the store package with a real Chrome Extension `AURA_GOOGLE_OAUTH_CLIENT_ID` for the final published extension ID and a real `AURA_GOOGLE_WEB_OAUTH_CLIENT_ID` for Brave/Chromium fallback support with the final extension redirect URI.
- Verify the Google Cloud project has Google Drive API enabled and a Chrome Extension OAuth client for the final extension ID.
- Inspect `dist/manifest.json` and the ZIP manifest after build; the only OAuth scope must be `https://www.googleapis.com/auth/drive.appdata`.
- Capture fresh Chrome Web Store screenshots from the current local build.
- Run `docs/INSTALLED_EXTENSION_TEST_MATRIX.md` against the exact ZIP/dist build for import, export, replace confirmation, restore points, Duplicate Finder, Command Palette UI/shortcut assignment, keyboard layout behavior, and optional Google Drive sync.

## Screenshots Checklist

1. Main page with groups
2. Import from A Fine Start
3. Export / Backup formats
4. Restore Points
5. Privacy Promise / local-first data ownership
6. Optional Google Drive sync
7. Command Palette
8. Duplicate Finder
9. Keyboard Shortcuts help

## Reviewer Notes

Suggested note for reviewers:

> Aura Start is a fully open-source, local-first new tab extension released under the MIT License. It uses `storage` to save user-created groups, links, settings, sync metadata, and restore points locally in `chrome.storage.local`. It uses `identity`, the `https://www.googleapis.com/auth/drive.appdata` OAuth scope, and the `https://www.googleapis.com/*` host permission only when the user explicitly enables optional Google Drive sync. The sync file is `aura-start-sync.json` in Google Drive `appDataFolder`, so Aura Start does not request full Drive access and does not touch visible Drive files. Aura Start has no content scripts, no browser bookmarks/history permissions, no analytics, no tracking, no backend, and no remotely hosted code. Aura Start can import/export A Fine Start-compatible export codes for migration, includes local restore points and a read-only Duplicate Finder scan before user-confirmed deletion, and is independent, not affiliated with A Fine Start. Command Palette is available from the UI; Ctrl+K/Cmd+K is registered as an extension command and may need browser assignment in `chrome://extensions/shortcuts`.
