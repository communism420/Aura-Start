# Chrome Web Store Submission Notes

> Maintainer-only document. This file is for Chrome Web Store release preparation and is not needed for normal Aura Start users.

These notes are for preparing Aura Start for Chrome Web Store review. They do not guarantee approval, but they keep the submission aligned with the current Chrome Web Store review themes: single purpose, least privilege, no remote hosted code, and clear privacy disclosures.

## Single Purpose

Aura Start is a local-first new tab start page for organizing user-created groups of links. Google Drive sync is optional, off by default, and limited to the hidden Drive app data folder.

Suggested short description:

> A local-first, private, customizable start page for your browser new tab.

Suggested positioning:

> A private, local-first start page for your links - free, open-source, and easy to export.

Suggested detailed description:

> Aura Start replaces the browser new tab page with a clean local-first start page for groups of links. Create nested groups, search saved links with fuzzy matching, personalize the page with backgrounds and lightweight widgets, save current-window tabs after an explicit optional tabs permission prompt, import from Aura Start backups or A Fine Start export codes, and export anytime as JSON, Browser Bookmarks HTML, Markdown, CSV, or an A Fine Start-compatible export code. Restore Timeline protects important changes, while Command Palette, browser-assigned shortcuts, Cyrillic-layout shortcut handling, and Duplicate Finder keep common workflows fast. Aura Start requires no account, has no analytics or tracking, and has no backend. Optional Google Drive backup/sync is user-initiated and syncs only Aura Start's own backup file. Aura Start is open-source under the MIT License and is an independent project, not affiliated with A Fine Start.

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
- `optional_permissions.tabs`: requested at runtime only when the user previews current-window tabs for Save open tabs.

Requested host permission:

- `https://www.googleapis.com/*`: used only for optional Google Drive API calls to read and write Aura Start's own sync file.
- `https://oauth2.googleapis.com/*`: used only to revoke cached Google OAuth tokens during disconnect.

Requested OAuth scope:

- `https://www.googleapis.com/auth/drive.appdata`: lets Aura Start read and write only its own hidden Google Drive app data.
- `https://www.googleapis.com/auth/drive.file`: used only by the configured Device OAuth fallback for Brave, Helium, Firefox, and compatible Chromium browsers where Chrome identity is unavailable. The fallback can create or update only Aura Start's own sync file marked with Aura Start app properties.

Aura Start connects through Chrome's built-in `chrome.identity.getAuthToken` OAuth flow when the user clicks Connect Google Drive in Google Chrome. The Chrome Web Store build must use the Chrome Extension OAuth client configured in `manifest.oauth2`; a manual `launchWebAuthFlow` URL must never be the primary auth path in Google Chrome. Users do not paste OAuth client IDs into Aura Start settings. Google requires a real OAuth client ID for Drive authorization. The submitted package must include Aura Start's configured Chrome Extension OAuth client ID in `dist/manifest.json`; set `AURA_GOOGLE_OAUTH_CLIENT_ID` before `npm run build:store` to inject it automatically. To support Brave, Helium, ungoogled Chromium, Firefox, and other browsers that cannot use `chrome.identity.getAuthToken`, use the configured Google Device OAuth fallback. Device OAuth does not support Chrome's hidden `drive.appdata` scope, so that fallback uses `drive.file` only for Aura Start's own sync file and never requests full Drive access. Example and placeholder IDs are rejected by validation because Google returns `invalid_client` for them.

The Google OAuth consent is used only to read, create, update, or delete Aura Start's `aura-start-sync.json` sync file. Aura Start does not use Google authorization for analytics, tracking, advertising, account profiling, or access to unrelated visible Google Drive files. Importing local JSON data preserves the local Google Drive connection metadata for the installed extension, so changing groups or links does not disconnect sync by itself.

Aura Start intentionally does not request:

- `bookmarks`
- `history`
- required `tabs`
- `cookies`
- `webRequest`
- `scripting`
- `https://www.googleapis.com/auth/drive`
- full Google Drive access
- broad host permissions such as `<all_urls>`

## Privacy Practices

Use the privacy policy in `PRIVACY.md` as the public privacy policy text. The Chrome Web Store Developer Dashboard requires a publicly reachable privacy policy URL if the item handles sensitive user data, even when that data is stored locally. Use `https://aurastart.pages.dev/privacy-policy.html` before submitting.

Recommended dashboard disclosure:

- Aura Start is fully open-source under the MIT License.
- Aura Start handles user-provided bookmark/link data locally.
- Google Drive sync is optional and off by default.
- When enabled in Google Chrome, Aura Start stores one hidden `aura-start-sync.json` file in the user's Google Drive `appDataFolder`.
- Firefox and compatible Chromium fallback builds can use Google Device OAuth with `drive.file`, limited to Aura Start's own sync file marked with Aura Start app properties.
- After connection, local Aura Start changes are queued and synced automatically.
- First-run onboarding can restore an existing sync file when the user chooses that action; if no file exists, Aura Start reports that and keeps local data unchanged.
- Aura Start does not request full Google Drive access and does not read, scan, edit, delete, or create unrelated visible Drive files.
- Aura Start does not use Google authorization to track users or profile their Drive contents.
- Aura Start requests the optional `tabs` permission only when the user previews current-window tabs for Save open tabs.
- Aura Start does not collect or transmit user data to the developer.
- Aura Start does not sell user data.
- Aura Start does not use user data for advertising.
- Aura Start does not allow humans to read user data.
- Aura Start uses `chrome.storage.local`, optional `chrome.identity`, and the Google Drive `drive.appdata` scope only for the extension's single purpose.

Short privacy disclosure for listing copy:

> Aura Start stores user-created groups, links, settings, widget state, background preferences, and restore timeline entries locally by default. It has no backend, no analytics, no tracking, and no required account. Optional tabs access is requested only for Save open tabs. Optional Google Drive sync is user-initiated and syncs only Aura Start's own backup file.

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

- Publish the `docs` site to `https://aurastart.pages.dev/` and use `https://aurastart.pages.dev/privacy-policy.html` as the Chrome Web Store privacy policy URL.
- Build the store package with a real Chrome Extension `AURA_GOOGLE_OAUTH_CLIENT_ID` for the final published extension ID.
- For Brave/Helium/Chromium fallback support, provide the configured Google Device OAuth client and secret through the release build environment. The fallback uses `drive.file` only for Aura Start's own sync file because Device OAuth cannot request Chrome's `drive.appdata` scope.
- Verify the Google Cloud project has Google Drive API enabled and a Chrome Extension OAuth client for the final extension ID.
- Inspect `dist/manifest.json` and the ZIP manifest after build; the only manifest OAuth scope must be `https://www.googleapis.com/auth/drive.appdata`, and `tabs` must remain optional rather than required.
- Capture fresh Chrome Web Store screenshots from the current local build.
- Run `docs/INSTALLED_EXTENSION_TEST_MATRIX.md` against the exact ZIP/dist build for nested groups, fuzzy search, Save open tabs, backgrounds/widgets, import, export, replace confirmation, Restore Timeline, Duplicate Finder, Command Palette UI/shortcut assignment, keyboard layout behavior, and optional Google Drive sync.

## Screenshots Checklist

1. New tab overview with nested groups and widgets
2. Fuzzy search across title, URL, description, and tags
3. Import / Export hub
4. Backgrounds and widgets settings
5. Restore Timeline
6. Save open tabs preview
7. Command Palette

## Reviewer Notes

Suggested note for reviewers:

> Aura Start is a fully open-source, local-first new tab extension released under the MIT License. It uses `storage` to save user-created groups, links, settings, widget state, sync metadata, and restore timeline entries locally in extension storage. It uses optional runtime `tabs` access only when the user previews current-window tabs for Save open tabs. Google Drive sync is optional: Google Chrome uses `identity`, `https://www.googleapis.com/auth/drive.appdata`, and Google API host permissions only after user action; compatible fallback builds can use Device OAuth with `drive.file` only for Aura Start's own sync file. Aura Start has no content scripts, no browser bookmarks/history permissions, no analytics, no tracking, no backend, no remotely hosted code, and no full Drive access. Aura Start can import/export A Fine Start-compatible export codes for migration, includes Restore Timeline and a read-only Duplicate Finder scan before user-confirmed deletion, and is independent, not affiliated with A Fine Start. Command Palette is available from the UI; Ctrl+K/Cmd+K is registered as an extension command and may need browser assignment in `chrome://extensions/shortcuts`.
