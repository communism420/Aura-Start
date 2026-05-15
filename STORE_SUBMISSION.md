# Chrome Web Store Submission Notes

These notes are for preparing Aura Start for Chrome Web Store review. They do not guarantee approval, but they keep the submission aligned with the current Chrome Web Store review themes: single purpose, least privilege, no remote hosted code, and clear privacy disclosures.

## Single Purpose

Aura Start is a local-first new tab start page for organizing user-created groups of links. Google Drive backup is optional and works through normal user-managed export/import files.

Suggested short description:

> A local-first, private, exportable start page for your Chromium new tab.

Suggested slogan:

> All features of A Fine Start and even more - free and forever.

Suggested detailed description:

> Aura Start replaces the new tab page with a clean local-first start page. Create your own groups of links, search them, reorder groups and links, import from Aura Start backups or A Fine Start export codes, create restore points, export your data as JSON, Browser Bookmarks HTML, Markdown, CSV, or A Fine Start export code, and optionally keep exported backups in Google Drive yourself. Fully open-source under the MIT License. No required account, no analytics, no tracking, no forced cloud sync, and no backend.

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

Requested host permissions:

- None.

Requested OAuth scopes:

- None.

Aura Start does not use Google Drive API. The Google Drive panel exports a normal local backup file and includes a user-initiated link to open Google Drive in a browser tab. The user decides whether to upload or move the backup file to Google Drive.

Aura Start intentionally does not request:

- `bookmarks`
- `history`
- `tabs`
- `cookies`
- `webRequest`
- `scripting`
- `identity`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/drive.appdata`
- full Google Drive access
- broad host permissions such as `<all_urls>`

## Privacy Practices

Use the privacy policy in `PRIVACY.md` as the public privacy policy text. The Chrome Web Store Developer Dashboard requires a publicly reachable privacy policy URL if the item handles sensitive user data, even when that data is stored locally. Host this policy on the project website, GitHub Pages, or another page controlled by the publisher before submitting.

Recommended dashboard disclosure:

- Aura Start is fully open-source under the MIT License.
- Aura Start handles user-provided bookmark/link data locally.
- Google Drive backup is optional and manual.
- Aura Start does not sign in to Google and does not request Google Drive API permissions.
- Aura Start does not track, scan, read, edit, delete, or create files in Google Drive.
- The user may export a Full Backup JSON file and upload or move it to Google Drive manually.
- Aura Start does not collect or transmit user data to the developer.
- Aura Start does not sell user data.
- Aura Start does not use user data for advertising.
- Aura Start does not allow humans to read user data.
- Aura Start uses `chrome.storage.local` only for the extension's single purpose.

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

> Aura Start is a fully open-source, local-first new tab extension released under the MIT License. It uses `storage` to save user-created groups, links, settings, and restore points locally in `chrome.storage.local`. Google Drive backup is a manual file workflow: Aura Start exports a normal JSON backup file, and the user may upload or move it to Google Drive themselves. Aura Start does not request Google account access, Google Drive API scopes, host permissions, browser bookmarks/history permissions, content scripts, analytics, tracking, a backend, or remotely hosted code.
