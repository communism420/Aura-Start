# Chrome Web Store Submission Notes

> Maintainer-only document. This file is for Chrome Web Store release preparation and is not needed for normal Aura Start users.

These notes are for preparing Aura Start for Chrome Web Store review. They do not guarantee approval, but they keep the submission aligned with the current Chrome Web Store review themes: single purpose, least privilege, no remote hosted code, and clear privacy disclosures.

Reviewed for Aura Start 2.1.0 on October 4, 2026. This is preparation guidance, not evidence that a store package has been uploaded or approved.

## Single Purpose

Aura Start is a local-first new tab start page for organizing user-created groups of links. Google Drive sync is optional, off by default, and limited to Aura Start-owned files.

Suggested short description:

> A local-first, private, customizable start page for your browser new tab.

Suggested positioning:

> A private, local-first start page for your links - free, open-source, and easy to export.

Suggested detailed description:

> Aura Start replaces the browser new tab page with a clean local-first start page for groups of links. Create nested groups, search saved links with fuzzy matching, personalize the page with backgrounds and lightweight widgets, save current-window tabs after an explicit optional tabs permission prompt, import from Aura Start backups or A Fine Start export codes, and export anytime as Full Backup ZIP, Settings and links only (JSON), Browser Bookmarks HTML, Markdown, CSV, or an A Fine Start-compatible export code. Restore Timeline protects important changes, while Command Palette, browser-assigned shortcuts, Cyrillic-layout shortcut handling, and Duplicate Finder keep common workflows fast. Aura Start requires no account, has no analytics or tracking, and has no backend. Optional Google Drive backup/sync is user-initiated and accesses only Aura Start's own sync snapshots and legacy backups. Aura Start is independent and not affiliated with A Fine Start. Its application source uses MIT; bundled third-party components retain their own licenses.

## Open Source Policy

Aura Start's application source is open-source under the MIT License. Bundled third-party components retain their own licenses and notices. The source code, build scripts, validation scripts, documentation, and store-submission notes should remain public and auditable.

When publishing to the Chrome Web Store, include the public source repository URL in the listing support or website fields. Rebuild from the public source with the release OAuth configuration supplied through the local environment:

```bash
npm install
npm run build:store
```

Set the real release `AURA_GOOGLE_OAUTH_CLIENT_ID` and required `AURA_GOOGLE_STORE_DEVICE_OAUTH_CLIENT_SECRET` first. `build:store` produces and validates `dist`; it does not create a ZIP. Do not print values, commit environment files, or substitute local-development credentials for release credentials. A bundled Device OAuth client secret belongs to a distributed public client and is inspectable in the package; it is not a confidential backend secret or a user's Google token.

The project workflow refreshes four folders after changes: `dist-google`, `dist-google-local`, `dist-firefox`, and `dist-firefox-local`. The standard scripts instead target `dist` (`build` and `build:store`), `dist-local` (`build:local`), and `dist-firefox` (`build:firefox`). For named four-folder builds, use Vite's explicit `--outDir` with the correct target/mode and credential role, then the matching validators: `AURA_CHROME_DIST_DIR` for Chromium; `AURA_FIREFOX_DIST_DIR` for Firefox sanitization, manifest finalization, and validation. Never treat a directory rename as changing an OAuth client's role. See the [release checklist](docs/RELEASE_CHECKLIST.md).

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
- `alarms`: checks for remote changes about once a minute while sync is enabled and the browser runs, even when all Aura Start pages are closed.
- `optional_permissions.tabs`: requested at runtime only when the user previews current-window tabs for Save open tabs.

Requested host permission:

- `https://www.googleapis.com/*`: used only for optional Google Drive API calls to read and write Aura Start's own sync files.
- `https://oauth2.googleapis.com/*`: used only for Google OAuth token exchange and refresh.

Requested OAuth scopes:

- `https://www.googleapis.com/auth/drive.file`: used by Chrome identity and Device OAuth for the shared `aura-start-sync.json` in normal Drive storage, marked with Aura Start app properties. Updated installations use one common file; accessible older copies are merged and consolidated after verification.
- `https://www.googleapis.com/auth/drive.appdata`: retained in the Chrome manifest for legacy hidden Aura Start backups. Device OAuth does not request it; unavailable hidden-backup access is reported separately from verified normal-Drive cleanup.

The published Chrome Web Store installation uses Chrome's built-in `chrome.identity.getAuthToken` flow when supported. The store package must contain its configured Chrome Extension OAuth client in `manifest.oauth2`; a manual Web OAuth redirect must not replace that primary flow. Unpacked Chrome and compatible Chromium browsers can use the configured Device OAuth flow, as Firefox does. Users do not paste OAuth client IDs into Aura Start settings. Set `AURA_GOOGLE_OAUTH_CLIENT_ID` and the required store Device secret before `npm run build:store`. The current Device flow requests only `drive.file` for sync and deletion; it does not request `drive.appdata`, even though Google's protocol documentation lists that scope. Hidden legacy migration/cleanup needs an authorization flow with existing app-data access; otherwise cleanup leaves a persistent notice. Neither flow requests full Drive access. Release validation rejects placeholder OAuth values.

Firefox packages remove `identity` and Chromium's `oauth2` manifest entry. They retain `storage`, `alarms`, optional `tabs`, and the two Google API host permissions; use a module background script; require Firefox 142 or later; and declare data-collection categories `required: ["none"]`, `optional: ["browsingActivity", "technicalAndInteraction"]` for optional sync. Verify these exact declarations and the interactive consent flow in the final Firefox package.

The Google OAuth consent is used only to read, create, update, or delete Aura Start's `aura-start-sync.json` snapshots and legacy backups. Aura Start does not use Google authorization for analytics, tracking, advertising, account profiling, or access to unrelated visible Google Drive files. Importing local JSON data preserves the local Google Drive connection metadata for the installed extension, so changing groups or links does not disconnect sync by itself.

Confirmed backup deletion first pauses sync, permanently removes matching normal-Drive snapshots (including old 2.0.5 files, renamed app-marked files and Trash), and verifies empty results before clearing this installation's credentials and disconnecting. Hidden legacy app data is included only with existing access. If Device OAuth cannot check hidden data, a persistent notice explains manual checking in the account used for cleanup without claiming hidden backups exist or were deleted. A failed authorization, deletion, or verification keeps the account paused for retry and reports failure. Local links, preferences, notes, background images, audio, and Restore Points remain intact. Ordinary disconnect keeps cloud files and other installations' Google authorization. It stops local sync and rejects delayed sign-in results without calling Google's project-wide revocation endpoint. Users can revoke access everywhere through Google Account connections. Updated peers pause when an established cloud copy disappears; disconnect other devices first to cover older releases, in-flight uploads, or later explicit reconnects.

Earlier live testing of the configured local client's `/device/code` endpoint returned HTTP 200 for `drive.file` and HTTP 400 `invalid_scope` for `drive.appdata`, despite the published allowed-scopes table. This is historical configuration evidence, not a universal protocol restriction or a fresh verification of today's server. Test the implemented file-only flow: ordinary-file cleanup without a new scope prompt, hidden-space scope denial with an explicit notice, ACL/network/DELETE failures, and final absence verification. Preserve the notice after reload or later cleanup of a different account.

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

- Aura Start's application source uses the MIT License; packaged third-party components retain their licenses.
- Aura Start handles user-provided bookmark/link data locally.
- Full Backup ZIP v2 contains JSON settings/link/note/history, current/historical background files, and only the selected original Countdown audio. It excludes playback WAV and other historical sounds; built-in selection includes no audio. Other historical audio references are omitted neutrally. Import reconstructs playback locally and supports earlier v1 ZIPs and portable JSON while retaining the local Drive connection.
- Settings and links only (JSON) excludes embedded media and neutrally omits custom-file references and active Custom background selections. Only those omitted choices retain receiving-device values or use built-in defaults on a fresh profile; explicit built-in choices and intentional media removals remain applicable settings. Other preferences, notes, links, and Restore Points remain. Older portable JSON files with media remain importable.
- Google Drive sync is optional and off by default.
- When enabled, updated Aura Start 2.1.0 installations read and update one visible `aura-start-sync.json` in normal Drive storage. Accessible legacy copies are merged, verified, and conditionally removed. Simultaneous first connections can briefly create duplicates before consolidation.
- Chrome uses `drive.file` for shared snapshots and retains `drive.appdata` to read older hidden backups during migration. Firefox and compatible Chromium fallback builds request `drive.file` for sync and deletion. They report when hidden legacy backups could not be checked and do not request `drive.appdata`.
- After connection, actual edits queue synchronization. Visible online Aura pages check remote metadata approximately every five seconds through one background schedule shared by all pages in that installation. Hidden/closed pages rely on the roughly one-minute alarm while the browser runs. Failures increase polling delay up to a minute. Opening, closing, focus, and visibility do not force an immediate transfer or sync animation; delayed polling remains active. Unchanged verified revisions skip data/media transfers and last-sync-time writes. Offline pending work retries on startup or network reconnection. These are polling intervals, not guaranteed delivery times or server push.
- Shared data includes groups, links, all saved user preferences, Markdown notes, the saved custom background image, the selected timer sound, and merge metadata. Notes edits and clearing sync even while the widget is hidden. Save open tabs and delete-backup-on-disconnect preferences are shared; actual permission grants, Restore Timeline, running timers, search/filter and onboarding/demo state, account credentials, and connection/sync mode remain local. Merge device identifiers do not replace an installation's connection identity.
- Existing local notes migrate before sync only after the main document and a local recovery point are saved. Older cloud snapshots without notes do not erase newer text; conflicting existing local notes remain recoverable. Concurrent edits to the same note resolve consistently without combining text.
- Upgrading from 2.0.5 automatically migrates the existing custom image before the first sync, retaining the original until migration is durably saved. Older snapshots with no image do not erase that image. No additional permissions or OAuth scopes are required for image sync.
- A 2.0.5 JSON export did not contain notes-widget text or custom background image bytes. Import remains supported, but cannot recover data absent from the file; updating an existing profile can migrate those local values.
- First-run onboarding can restore an existing sync file when the user chooses that action; if no file exists, Aura Start reports that and keeps local data unchanged.
- Aura Start does not request full Google Drive access and does not read, scan, edit, delete, or create unrelated visible Drive files.
- Aura Start does not use Google authorization to track users or profile their Drive contents.
- Aura Start requests the optional `tabs` permission only when the user previews current-window tabs for Save open tabs.
- Aura Start does not collect or transmit user data to the developer.
- Aura Start does not sell user data.
- Aura Start does not use user data for advertising.
- Aura Start does not provide developers with access to user content. Shared JSON and exported backups are not password-protected or end-to-end encrypted by Aura Start; users should control who can access them. Deleted link/group fields can remain in causal deletion records and local recovery copies.
- Aura Start uses extension-local storage, identity, alarms, optional tabs access, and the documented Google Drive scopes only for the extension's single purpose.

Short privacy disclosure for listing copy:

> Aura Start stores user-created groups, links, settings, widget state, background preferences, and restore timeline entries locally by default. It has no backend, no analytics, no tracking, and no required account. Optional tabs access is requested only for Save open tabs. Optional Google Drive sync is user-initiated and accesses only Aura Start's own sync snapshots and legacy backups.

## Remote Hosted Code

Aura Start should be submitted from a validated release output directory. Runtime JavaScript, workers, and WebAssembly are packaged locally, including the decoder under `vendor/ffmpeg`. The extension must not load executable code from remote URLs. The CSP permits packaged WebAssembly through `wasm-unsafe-eval`; it does not enable ordinary JavaScript `unsafe-eval`.

Run these release stages, creating the archive between the build and its ZIP validation:

```bash
npm run build:store
# Create the submission ZIP separately from the verified output.
npm run validate:zip
```

Run `build:store`, create the intended submission ZIP separately from that verified output, then run `validate:zip`. The build command runs TypeScript, Vite, and store validation; the ZIP validator checks an existing `Chrome Submit/aura-start-2.1.0-chrome-web-store.zip`. It neither creates nor updates an archive. Set `AURA_CHROME_DIST_DIR=dist-google` when validating an archive prepared from that folder rather than `dist`.

## Store Package

Submit the contents of `dist` as the extension package. Do not include source files, `node_modules`, screenshots, or development artifacts in the uploaded ZIP.

Required generated files:

- `dist/manifest.json`
- `dist/newtab.html`
- `dist/options.html`
- `dist/popup.html`
- `dist/background.js`
- `dist/logo.png`
- `dist/icons/icon-16.png`
- `dist/icons/icon-32.png`
- `dist/icons/icon-48.png`
- `dist/icons/icon-128.png`
- `dist/_locales/*/messages.json`
- `dist/vendor/ffmpeg/` and its applicable third-party notices

The final ZIP must include `manifest.json` at archive root, include `background.js` when the manifest references it, keep `commands.toggle-command-palette` in sync with the source manifest, and exclude `src`, `docs`, `Photo`, `Chrome Submit`, `node_modules`, `.git`, `.env`, source files, screenshots, and development artifacts.

## Manual Release Steps

- Publish the `docs` site to `https://aurastart.pages.dev/` and use `https://aurastart.pages.dev/privacy-policy.html` as the Chrome Web Store privacy policy URL.
- Build the store package with a real Chrome Extension `AURA_GOOGLE_OAUTH_CLIENT_ID` for the final published extension ID.
- For Brave/Helium/Chromium fallback support, provide the configured Google Device OAuth client and secret through the release build environment. The fallback requests `drive.file` for sync and deletion and never requests `drive.appdata`. Verify the persistent notice when hidden legacy backups cannot be checked.
- Verify the Google Cloud project has Google Drive API enabled and a Chrome Extension OAuth client for the final extension ID.
- Inspect `dist/manifest.json` and the ZIP manifest after build; Chrome manifest OAuth scopes must be exactly `https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/drive.appdata`. Confirm `alarms` is declared and `tabs` remains optional.
- Use the same Google Cloud project for release Chrome and Device OAuth clients so they can access the same Aura Start files. Upgrade all test installations to 2.1.0 and verify one-time Chrome consent migration from an existing appData-only connection.
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

> Aura Start is a local-first new tab extension whose application source is MIT-licensed. It uses `storage` for local links, settings, sync metadata and Restore Timeline; optional runtime `tabs` only for Save open tabs; and `alarms` for background Drive checks. Optional Google sync uses one visible Aura Start-owned `aura-start-sync.json`, shared by updated installations. Chrome identity additionally retains `drive.appdata` for authorized legacy migration/deletion; the current Device flow uses `drive.file` only and reports unverified hidden cleanup. Visible online pages poll approximately every five seconds through a shared background schedule; hidden/closed pages use a minute alarm. Shared content includes preferences, notes, the saved background image, the selected custom audio and its prepared playback copy, and causal merge records. Restore Timeline, running timers, actual permission grants, credentials, and connection state remain local. Disconnect clears this installation's authorization without revoking other devices. Aura Start has no content scripts, browser history/bookmarks permissions, telemetry, backend, remote executable code, or full Drive access. The audio decoder and its third-party notices are packaged locally. Aura Start is independent and not affiliated with A Fine Start. Command Palette is available from the UI; Ctrl+K/Cmd+K may need assignment in `chrome://extensions/shortcuts`.
