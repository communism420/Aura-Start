# Chrome Web Store Submission Notes

These notes are for preparing Aura Start for Chrome Web Store review. They do not guarantee approval, but they keep the submission aligned with the current Chrome Web Store review themes: single purpose, least privilege, no remote hosted code, and clear privacy disclosures.

## Single Purpose

Aura Start is a local-first new tab start page for organizing user-created groups of links. Google Drive sync is optional, off by default, and limited to the hidden Drive app data folder.

Suggested short description:

> A local-first, private, exportable start page for your Chromium new tab.

Suggested slogan:

> All features of A Fine Start and even more - free and forever.

Suggested detailed description:

> Aura Start replaces the new tab page with a clean local-first start page. Create your own groups of links, search them, reorder groups and links, import from Aura Start backups or A Fine Start export codes, create restore points, export your data as JSON, Browser Bookmarks HTML, Markdown, CSV, or A Fine Start export code, and optionally back up/sync through Google Drive app data. Fully open-source under the MIT License. No required account, no analytics, no tracking, no forced cloud sync, and no backend.

## Open Source Policy

Aura Start is fully open-source under the MIT License. The source code, build scripts, validation scripts, documentation, and store-submission notes should remain public and auditable.

When publishing to the Chrome Web Store, include the public source repository URL in the listing support or website fields once the repository is available. The submitted extension package should be reproducible from the public source with:

```bash
npm install
npm run build:store
```

## Permission Justification

Requested permissions:

- `storage`: saves user-created groups, links, settings, imports, exports metadata, and restore points in local extension storage.
- `identity`: lets the user explicitly connect optional Google Drive sync through Chrome's OAuth flow.

Requested host permission:

- `https://www.googleapis.com/*`: used only for optional Google Drive API calls to read and write Aura Start's hidden app data file.

Requested OAuth scope:

- `https://www.googleapis.com/auth/drive.appdata`: lets Aura Start read and write only its own hidden Google Drive app data.

Aura Start opens Google's authorization window through `chrome.identity.launchWebAuthFlow` when the user clicks Connect Google Drive. The flow uses the same extension redirect URL and only the `drive.appdata` OAuth scope. Users do not paste OAuth client IDs into Aura Start settings. Google requires an OAuth client ID for Drive authorization; Aura Start does not use full Drive permission to avoid this. The submitted package must include Aura Start's configured Chrome Extension OAuth client ID in `dist/manifest.json`; set `AURA_GOOGLE_OAUTH_CLIENT_ID` before `npm run build:store` to inject it automatically. This does not add host permissions and does not grant access to normal Google Drive files.

The Google OAuth consent is used only to read, create, update, or delete Aura Start's hidden `aura-start-sync.json` app data file. Aura Start does not use Google authorization for analytics, tracking, advertising, account profiling, or access to visible Google Drive files.

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
- Aura Start does not request full Google Drive access and does not read, scan, edit, delete, or create visible Drive files.
- Aura Start does not use Google authorization to track users or profile their Drive contents.
- Aura Start does not collect or transmit user data to the developer.
- Aura Start does not sell user data.
- Aura Start does not use user data for advertising.
- Aura Start does not allow humans to read user data.
- Aura Start uses `chrome.storage.local`, optional `chrome.identity`, and the Google Drive `drive.appdata` scope only for the extension's single purpose.

## Remote Hosted Code

Aura Start should be submitted from the built `dist` directory. All runtime JavaScript is bundled in `dist/assets`. The extension must not load JavaScript, WASM, or logic from remote URLs.

Before packaging, run:

```bash
npm run build:store
```

This runs TypeScript, production build, and a Chrome Web Store validation pass over `dist`.

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

## Reviewer Notes

Suggested note for reviewers:

> Aura Start is a fully open-source, local-first new tab extension released under the MIT License. It uses `storage` to save user-created groups, links, settings, and restore points locally in `chrome.storage.local`. It uses `identity`, the `https://www.googleapis.com/auth/drive.appdata` OAuth scope, and the `https://www.googleapis.com/*` host permission only when the user explicitly enables optional Google Drive sync. The sync file is `aura-start-sync.json` in Google Drive `appDataFolder`, so Aura Start does not request full Drive access and does not touch visible Drive files. Aura Start has no content scripts, no browser bookmarks/history permissions, no analytics, no tracking, no backend, and no remotely hosted code.
