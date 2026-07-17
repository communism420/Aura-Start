# Aura Start Release Checklist

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


Use this checklist before preparing a Chrome Web Store or Firefox package. Do not publish from automation; upload manually through the relevant store dashboard.

## Pre-Build

- Run `npm install`.
- Run `npm run test`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Run `npm run build:firefox` with real Firefox Device OAuth credentials.
- Run `npm run build:store`.
- Set a real `AURA_GOOGLE_OAUTH_CLIENT_ID` for release builds.
- Store builds must use manifest OAuth through `chrome.identity.getAuthToken` in Google Chrome.
- For Brave/Helium/ungoogled Chromium fallback support, configure the Device OAuth fallback used by store builds.
- For Firefox support, configure `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID`, `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET`, and the final `AURA_FIREFOX_EXTENSION_ID`.
- Confirm the Chrome Web Store build does not bundle or prefer the old Web OAuth redirect fallback.
- Inspect `dist/manifest.json`.
- Confirm `manifest_version` is `3`.
- Confirm `background.service_worker` and `commands` in `dist/manifest.json` match `public/manifest.json`.
- Confirm no remote hosted code or remote scripts are present.
- Confirm permissions are least-privilege.
- Confirm there is no full Google Drive scope.
- Inspect `dist-firefox/manifest.json`.
- Confirm Firefox `background.scripts` references `background.js` with `type: module`, so Vite's generated imports execute correctly.
- Confirm Firefox `browser_specific_settings.gecko.id` is the intended add-on ID.
- Confirm Firefox build removes Chrome-only `manifest.oauth2`.

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

Run the exact installed-extension matrix in [`INSTALLED_EXTENSION_TEST_MATRIX.md`](./INSTALLED_EXTENSION_TEST_MATRIX.md) against the same `dist-google` / `dist-firefox` folder or ZIP build that will be uploaded. Build checks are not enough; nested groups, fuzzy search, Save open tabs permission flow, backgrounds/widgets, import, replace, Restore Timeline, Duplicate Finder deletion, Command Palette shortcut assignment, Cyrillic keyboard layout behavior, Google Drive first-run restore, automatic Drive backup after local edits, and Google Drive connect/disconnect need browser verification.

## Google Drive OAuth Release Verification

- Create a Chrome Extension OAuth client for the final published extension ID.
- Create or verify Device OAuth credentials for Firefox and Chromium browsers that reject Chrome's built-in identity token flow.
- Enable the Google Drive API for the Google Cloud project used by Aura Start.
- Set `AURA_GOOGLE_OAUTH_CLIENT_ID` before `npm run build:store`.
- Set `AURA_GOOGLE_STORE_DEVICE_OAUTH_CLIENT_SECRET` before `npm run build:store`.
- Set `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID` and `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET` before `npm run build:firefox`.
- Confirm the Chrome Web Store package does not contain an active Web OAuth fallback client or manual redirect URI path.
- Confirm Google Chrome still uses manifest OAuth first through the Chrome Extension OAuth client.
- Confirm Firefox uses Device OAuth and the `drive.file` scope.
- Inspect `dist/manifest.json` and the final ZIP manifest after build.
- Confirm the Chrome manifest OAuth scope is only `https://www.googleapis.com/auth/drive.appdata`.
- Confirm the Chrome manifest has no full Drive scope and no `drive.file` scope.
- Confirm the Firefox build has no full Drive scope and uses Device OAuth only.
- Install the final build as unpacked, then test connect, automatic backup after local edits, first-run restore from an existing Drive sync file, no-file messaging when no Drive sync file exists, disconnect, and delete-backup flows.
- Start an automatic upload, immediately close every Aura Start page, then verify from a newly opened page that the background upload completed and the latest local revision is recorded as synced.
- Expire or invalidate only the current access token, then verify that Aura Start silently renews authorization, retries the Drive request once, and remains connected.
- Simulate a temporary token refresh failure (`429`, `5xx`, or network loss), then verify that the stored Device OAuth refresh token and sync metadata remain intact and a later sync succeeds without another sign-in.
- Simulate a confirmed `invalid_grant`, then verify that Aura Start preserves local data and the Drive file reference, displays Reconnect Google Drive, and reconnects only after the user clicks it.
- Install `dist-firefox` in Firefox (`about:debugging` -> This Firefox -> Load Temporary Add-on -> choose `manifest.json`) and repeat the Google Drive connect, automatic backup, restore, disconnect, and delete-backup flows through the device-code UI.
- Re-check `Chrome Submit/REVIEWER_NOTES.md` and the Chrome Web Store privacy form before submission.
- If Drive OAuth causes review friction, consider a local-only first submission or make reviewer notes extremely explicit; do not broaden permissions.

## Chrome Web Store Manual Steps

- Upload ZIP manually.
- Fill short description from `docs/STORE_LISTING.md`.
- Fill detailed description from `docs/STORE_LISTING.md`.
- Upload screenshots using `docs/SCREENSHOTS.md`.
- Set category.
- Set privacy practices.
- Add privacy policy URL `https://aurastart.pages.dev/privacy-policy.html`.
- Add support URL.
- Add source code URL.
- Add reviewer notes from `docs/STORE_LISTING.md` or `STORE_SUBMISSION.md`.
- Submit for review manually.

## Post-Launch

- Verify the public listing text and screenshots.
- Test install from the Chrome Web Store listing.
- Confirm Google Drive OAuth works for the published extension ID.
- Collect feedback through GitHub Issues or the chosen support URL.
- Triage bugs, especially nested groups, search, open-tabs capture, import/export, restore, duplicate deletion, widgets, backgrounds, and Drive sync.
- Prepare 2.0.1 if launch feedback finds release-blocking issues.

## Release Blockers

- TypeScript or production build failure.
- Store validation failure.
- Placeholder OAuth client ID in a release ZIP.
- Remote code, analytics, or tracking found in the build.
- Manifest permissions beyond the documented least-privilege set.
- Screenshots or listing text claiming features not present in the local build.
