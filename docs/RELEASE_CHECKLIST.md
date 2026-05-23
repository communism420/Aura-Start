# Aura Start Release Checklist

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


Use this checklist before preparing a Chrome Web Store upload. Do not publish from automation; upload manually through the Chrome Web Store Developer Dashboard.

## Pre-Build

- Run `npm install`.
- Run `npm run test`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Run `npm run build:store`.
- Set a real `AURA_GOOGLE_OAUTH_CLIENT_ID` for release builds.
- Store builds must use manifest OAuth through `chrome.identity.getAuthToken` in Google Chrome.
- Set `AURA_GOOGLE_WEB_OAUTH_CLIENT_ID` for Brave/Chromium fallback support with a Web OAuth client whose authorized redirect URI is `https://<extension-id>.chromiumapp.org/oauth2`.
- Inspect `dist/manifest.json`.
- Confirm `manifest_version` is `3`.
- Confirm `background.service_worker` and `commands` in `dist/manifest.json` match `public/manifest.json`.
- Confirm no remote hosted code or remote scripts are present.
- Confirm permissions are least-privilege.
- Confirm there is no full Google Drive scope.

## Fresh Chrome Web Store ZIP

- Run `npm run build:store`.
- Confirm `dist/manifest.json`.
- Create ZIP with the contents of `dist` at the archive root.
- Verify `manifest.json` is at the ZIP root, not under `dist/`.
- Verify `background.js` is present when `manifest.json` references it.
- Verify `commands.toggle-command-palette` is present when the source manifest includes it.
- Verify no source files or secrets are included.
- Verify real OAuth client ID for release build.
- Verify ZIP does not include `node_modules`, `docs`, `.git`, source files, `.env`, screenshots, or development artifacts.
- Run `npm run validate:zip` against `Chrome Submit/aura-start-<version>-chrome-web-store.zip`.
- Upload ZIP manually in Chrome Web Store Developer Dashboard.

## Installed Extension Test Matrix

Run the exact installed-extension matrix in [`INSTALLED_EXTENSION_TEST_MATRIX.md`](./INSTALLED_EXTENSION_TEST_MATRIX.md) against the same `dist`/ZIP build that will be uploaded. Build checks are not enough; import, replace, restore, Duplicate Finder deletion, Command Palette shortcut assignment, Cyrillic keyboard layout behavior, Google Drive first-run restore, automatic Drive backup after local edits, and Google Drive connect/disconnect need browser verification.

## Google Drive OAuth Release Verification

- Create a Chrome Extension OAuth client for the final published extension ID.
- Enable the Google Drive API for the Google Cloud project used by Aura Start.
- Set `AURA_GOOGLE_OAUTH_CLIENT_ID` before `npm run build:store`.
- Set `AURA_GOOGLE_WEB_OAUTH_CLIENT_ID` before `npm run build:store` so Brave/Chromium browsers can fall back when `chrome.identity.getAuthToken` is rejected.
- Confirm the Web OAuth client has the final extension redirect URI `https://<extension-id>.chromiumapp.org/oauth2` and that Google Chrome still uses manifest OAuth first.
- Inspect `dist/manifest.json` and the final ZIP manifest after build.
- Confirm the OAuth scope is only `https://www.googleapis.com/auth/drive.appdata`.
- Confirm there is no full Drive scope and no `drive.file` scope.
- Install the final build as unpacked, then test connect, automatic backup after local edits, first-run restore from an existing Drive sync file, no-file messaging when no Drive sync file exists, disconnect, and delete-backup flows.
- Re-check `Chrome Submit/REVIEWER_NOTES.md` and the Chrome Web Store privacy form before submission.
- If Drive OAuth causes review friction, consider a local-only first submission or make reviewer notes extremely explicit; do not broaden permissions.

## Chrome Web Store Manual Steps

- Upload ZIP manually.
- Fill short description from `docs/STORE_LISTING.md`.
- Fill detailed description from `docs/STORE_LISTING.md`.
- Upload screenshots using `docs/SCREENSHOTS.md`.
- Set category.
- Set privacy practices.
- Add privacy policy URL from published GitHub Pages `docs/privacy-policy.html`.
- Add support URL.
- Add source code URL.
- Add reviewer notes from `docs/STORE_LISTING.md` or `STORE_SUBMISSION.md`.
- Submit for review manually.

## Post-Launch

- Verify the public listing text and screenshots.
- Test install from the Chrome Web Store listing.
- Confirm Google Drive OAuth works for the published extension ID.
- Collect feedback through GitHub Issues or the chosen support URL.
- Triage bugs, especially import/export, restore, duplicate deletion, and Drive sync.
- Prepare 1.2.1 if launch feedback finds release-blocking issues.

## Release Blockers

- TypeScript or production build failure.
- Store validation failure.
- Placeholder OAuth client ID in a release ZIP.
- Remote code, analytics, or tracking found in the build.
- Manifest permissions beyond the documented least-privilege set.
- Screenshots or listing text claiming features not present in the local build.
