# Firefox Add-ons Upload Checklist — Aura Start 2.1.0

Updated October 4, 2026. This is a preparation checklist, not evidence that a package has been uploaded or approved. Existing 2.0.x archives in this folder remain historical. The documentation update does not create a 2.1.0 extension/source ZIP or publish the extension.

## Prepare The Exact Release Candidate

1. Select the source revision and review application, documentation, dependency and license changes.
2. Follow [Source Build Notes](SOURCE_BUILD_NOTES.md): `npm ci`, matching release Device OAuth configuration, established AMO ID, then `npm run build:firefox`.
3. Confirm the build ran typecheck, Vite, Firefox JavaScript sanitizer, manifest finalizer, and Firefox package validator.
4. Confirm manifest version 2.1.0, minimum Firefox 142.0, the existing Gecko add-on ID, and ES-module `background.scripts`.
5. Confirm required permissions are `storage` and `alarms`; `tabs` is optional. Chrome `identity` and `manifest.oauth2` must be absent.
6. Confirm only the two Google API hosts are declared; full Drive access, history/bookmarks permissions, and all-URL access are absent.
7. Confirm required Firefox data collection is `["none"]`; optional categories are `browsingActivity` and `technicalAndInteraction`. Compare the current AMO form and disclosures against actual synchronized notes, background and audio as well as links/settings; manifest categories are not a complete privacy statement.
8. Confirm local CSP allows only `'self' 'wasm-unsafe-eval'`, with no ordinary `unsafe-eval` or remote executable code.
9. Confirm all local ZIP/audio workers and `vendor/ffmpeg` JS, WASM and three notices are included. Preserve matching decoder source/build provenance and third-party licenses.
10. Package the contents of the validated `dist-firefox` as the planned `Firefox Submit/aura-start-2.1.0-firefox.zip`, with `manifest.json` at archive root. This is a future release step; no such archive was created by the documentation update.
11. Prepare a separate readable source archive and build instructions. Exclude secrets, real user data, generated builds, dependency directories and historical release ZIPs; include the files required to reproduce the package.
12. Run `npm run validate:firefox` and `npm run validate:firefox:submit` after creating the exact candidate, followed by Mozilla's add-ons linter against that ZIP. Record versions and results; prior build validation does not validate a new ZIP.

## Test Before Upload

- Load the candidate temporarily through `about:debugging` (select the candidate ZIP or its extracted root manifest). Temporary installation is not equivalent to persistent signed installation after browser restart.
- Verify local use without Google, first run, editing, notes, search, tab preview, restore and Undo.
- Verify Countdown pause/resume/reset, volume, custom native/fallback audio, and signal while a page is open.
- Round-trip Full Backup ZIP with a custom background and sound; inspect that only the selected original sound is included.
- Verify JSON has notes/history but no media; test an actual 2.0.5 JSON and missing-field migration.
- On a test Google account, verify Device OAuth, shared updates with another updated browser, concurrent edits/deletions, reconnect, local-only disconnect, confirmed cloud deletion, and any hidden-data notice.
- Record full-browser restart evidence separately from temporary add-on reloads, local HTTP simulation, or UI previews.

## Store Form And Assets

1. Open the existing Aura Start listing in Firefox Add-ons Developer Hub; upload only the validated release candidate.
2. Use [Add-on Listing](ADDON_LISTING.md), category Productivity, and the public website, support, source and privacy URLs listed there.
3. Use the eight `*-20261004.png` screenshots in `docs/assets/screenshots/`, in filename order. They show synthetic demo data in the 2.1.0 local preview, with Drive disconnected. Older `Firefox Submit/Photo/` images are not the current set.
4. Review promotional artwork in `Firefox Submit/Promo/` separately for current wording and store dimensions.
5. Add [Reviewer Notes](REVIEWER_NOTES.md), [Privacy Disclosure](PRIVACY_DISCLOSURE.md), and the source archive/build instructions. Use private reviewer fields for any required release build configuration.
6. Verify listing, data-collection answers, permissions and screenshots against the exact ZIP, then submit through the developer's authorized store workflow.
7. Record the uploaded ZIP/source hashes, source revision, submission date and store outcome. Do not mark publication complete before the store confirms it.
