# Aura Start Release Checklist

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


Use this checklist before preparing a Chrome Web Store or Firefox package. Do not publish from automation; upload manually through the relevant store dashboard.

Current target: Aura Start 2.1.0. Reviewed October 4, 2026. Checklist items describe required verification, not completed checks. Preserve dated evidence in the installed-extension matrix and record the exact build, browser, account setup, commands, results, and remaining limitations for a release.

## Pre-Build

- Run `npm install`.
- Run `npm run test`.
- Run `npm run typecheck`.
- Set a real `AURA_GOOGLE_OAUTH_CLIENT_ID` for release builds.
- Set required `AURA_GOOGLE_STORE_DEVICE_OAUTH_CLIENT_SECRET` for the configured release Device client before `npm run build:store`; do not substitute the local-development client secret.
- Run `npm run build` for `dist`, `npm run build:local` for `dist-local`, `npm run build:firefox` with the intended Firefox Device credentials for `dist-firefox`, and `npm run build:store` for validated store `dist`, as appropriate to the target. These scripts do not create submission ZIPs.
- Refresh all four workflow outputs after changes: `dist-google`, `dist-google-local`, `dist-firefox`, and `dist-firefox-local`. For non-default folders use Vite's explicit `--outDir` with the intended mode, browser target and credential role, then validate that exact output. Chromium validators use `AURA_CHROME_DIST_DIR`; Firefox sanitizer, manifest finalizer, and validator use `AURA_FIREFOX_DIST_DIR`. The `build:firefox` wrapper fixes its own output to `dist-firefox`, so a different folder needs the equivalent explicit pipeline.
- Keep release and local OAuth roles separate in all four outputs. Configure values privately and never print tokens, secrets, or environment files into public logs or documentation.
- The published Chrome Web Store installation must prefer manifest OAuth through `chrome.identity.getAuthToken` when supported. An unpacked Chrome test can use Device OAuth and is not proof of the published native identity flow.
- For Brave/Helium/ungoogled Chromium fallback support, configure the Device OAuth fallback used by store builds.
- For Firefox support, configure `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID`, `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET`, and the final `AURA_FIREFOX_EXTENSION_ID`.
- Confirm the Chrome Web Store build does not bundle or prefer the old Web OAuth redirect fallback.
- Inspect `dist/manifest.json`.
- Confirm `manifest_version` is `3`.
- Confirm `background.service_worker` and `commands` in `dist/manifest.json` match `public/manifest.json`.
- Confirm no remote hosted code or remote scripts are present.
- Confirm the packaged audio decoder, worker, WebAssembly, and applicable third-party licenses/notices are present. Confirm the fallback loads local package URLs and does not download code or send audio to a conversion service.
- Inspect both browsers' CSP for the intended local WebAssembly allowance (`wasm-unsafe-eval`) and ensure ordinary JavaScript `unsafe-eval`, remote script origins, and new timer permissions have not been added.
- Confirm Chromium required permissions are exactly `storage`, `identity`, and `alarms`; Firefox uses `storage` and `alarms`. In both targets, `tabs` remains optional and requested at runtime for Save open tabs.
- Confirm host permissions are limited to `https://www.googleapis.com/*` and `https://oauth2.googleapis.com/*`.
- Confirm there is no full Google Drive scope.
- Inspect `dist-firefox/manifest.json`.
- Confirm Firefox `background.scripts` references `background.js` with `type: module`, so Vite's generated imports execute correctly.
- Confirm Firefox `browser_specific_settings.gecko.id` is the intended add-on ID.
- Confirm Firefox build removes Chrome-only `manifest.oauth2` and `identity`.
- Confirm Firefox minimum version is `142.0` and `data_collection_permissions` has `required: ["none"]` and `optional: ["browsingActivity", "technicalAndInteraction"]`. Check interactive Drive data-transmission consent independently of Google's OAuth consent.
- Confirm `build:firefox` completed TypeScript, Vite, `sanitize-firefox-js.mjs`, `finalize-firefox-build.mjs`, and `validate-firefox-build.mjs`. Apply those post-build steps to each manually targeted Firefox folder too.
- Keep `package.json`, both extension version targets, all four built manifests, release notes, public policy, and store descriptions at 2.1.0. Do not overwrite the Google site-verification HTML.

## Fresh Chrome Web Store ZIP

- Run `npm run build:store`.
- Confirm `dist/manifest.json`.
- Create the submission ZIP separately with the contents of the validated release `dist` or `dist-google` at the archive root. Rebuilding a folder does not refresh an older archive.
- Verify `manifest.json` is at the ZIP root, not under `dist/`.
- Verify `background.js` is present when `manifest.json` references it.
- Verify the packaged FFmpeg assets and their license notices are included in the final ZIP, and account for the roughly 32 MB decoder when checking package size and store requirements.
- Verify `commands.toggle-command-palette` is present when the source manifest includes it.
- Verify no source files, local configuration files, personal credentials, access/refresh tokens, or confidential backend secrets are included. The configured Device OAuth client secret is intentionally bundled for a distributed public client; it must match the release role and must not be described as confidential.
- Verify real OAuth client ID for release build.
- Verify ZIP does not include `node_modules`, `docs`, `.git`, source files, `.env`, screenshots, or development artifacts.
- Run `npm run validate:zip` against the separately prepared `Chrome Submit/aura-start-2.1.0-chrome-web-store.zip`, with `AURA_CHROME_DIST_DIR` pointing to its actual source output when it is not `dist`.
- Prepare a Firefox archive separately when publishing Firefox. Validate the actual folder with `npm run validate:firefox`, then the intended archive with `npm run validate:firefox:submit` or `AURA_FIREFOX_ZIP_PATH`. Record the archive hash/date; do not infer freshness from a successful older validation.
- Upload ZIP manually in Chrome Web Store Developer Dashboard.

## Installed Extension Test Matrix

Run the exact installed-extension matrix in [`INSTALLED_EXTENSION_TEST_MATRIX.md`](./INSTALLED_EXTENSION_TEST_MATRIX.md) against the same `dist-google` / `dist-firefox` folder or ZIP build that will be uploaded. Build checks are not enough; nested groups, fuzzy search, Save open tabs permission flow, backgrounds/widgets, import, replace, Restore Timeline, Duplicate Finder deletion, Command Palette shortcut assignment, Cyrillic keyboard layout behavior, Google Drive first-run restore, automatic Drive backup after local edits, and Google Drive connect/disconnect need browser verification.

- Test Countdown start/pause/resume/reset, 1-second and 24-hour bounds, built-in/custom completion sound, volume 0, Stop sound, and an autoplay-blocked page with Play signal.
- Test multiple Aura Start tabs and reload: one shared local run, one automatic completion sound, and stopping sound from another tab. Verify background-tab timing and explicitly check the closed-page/sleep limitations.
- Import a representative set of browser-native formats plus WMA or another file requiring FFmpeg. Verify local-only preparation, the 20 MiB original-file limit, the first-60-second playback copy, errors preserving the previous sound, and rapid replacement/removal during decoding.
- Check that new Countdown fields are neutral additions to old settings and that old JSON/Restore Points do not reset later timer preferences. Verify local sound history and compatibility imports separately from ZIP v2's single selected original audio file.
- Export ZIP v2 with current and historical media. Confirm deduplicated current/historical background images and only the selected original audio: no generated playback WAV or other historical audio, and no audio file when built-in is selected. Other historical sound references must be neutralized. Import directly into a fresh profile and verify locally rebuilt playback, current references, historical fallback, and preservation of other history fields.
- Import an earlier v1 ZIP containing playback/history assets and an older portable JSON to verify compatibility. A missing required current sound or background must fail safely; omitted historical sounds must not prevent a valid v2 export/import.
- Verify the main complete-backup actions and individual Restore Point exports use ZIP. Settings and links only (JSON) must contain no media bytes and preserve other preferences/notes/links/history. Omitted custom choices retain receiver values or use built-in defaults on a fresh profile; explicit built-in choices and media removals must still apply. Older portable JSON with embedded media must still import.
- Test truncated/corrupt ZIPs, missing required files, mismatched hashes, unsafe entry paths, and expansion limits. A failed import must leave local data and the Drive connection unchanged; a valid ZIP import must preserve the connection as well.

## Google Drive OAuth Release Verification

- Create a Chrome Extension OAuth client for the final published extension ID.
- Create or verify Device OAuth credentials for Firefox and Chromium browsers that reject Chrome's built-in identity token flow.
- Enable the Google Drive API for the Google Cloud project used by Aura Start.
- Set `AURA_GOOGLE_OAUTH_CLIENT_ID` before `npm run build:store`.
- Set `AURA_GOOGLE_STORE_DEVICE_OAUTH_CLIENT_SECRET` before `npm run build:store`.
- Set `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID` and `AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET` before `npm run build:firefox`.
- Confirm the Chrome Web Store package does not contain an active Web OAuth fallback client or manual redirect URI path.
- Confirm the published Chrome installation uses manifest OAuth first through the Chrome Extension client; verify unpacked Chrome's Device flow separately.
- Confirm the current Firefox Device flow uses only `drive.file` for sync and deletion. Earlier live testing of the configured client rejected `drive.appdata`, although Google's allowed-scopes documentation lists it. Do not confuse that observation or the current implementation with a universal protocol ban. Verify normal-Drive cleanup without a permission-upgrade prompt; unavailable hidden access must produce a persistent, accurate notice and same-account Drive settings link.
- Inspect `dist/manifest.json` and the final ZIP manifest after build.
- Confirm the Chrome manifest OAuth scopes are exactly `https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/drive.appdata` (legacy migration).
- Confirm there is no full Drive scope, and release Chrome/Device OAuth clients use the same Google Cloud project so they can access the same shared Aura Start file and older copies.
- Confirm the Firefox build has no full Drive scope and uses Device OAuth only.
- Install the final build as unpacked, then test connect, automatic backup after local edits, first-run restore from an existing Drive sync file, accurate restore/create/no-file messaging, disconnect, and delete-backup flows. A clean installation receiving cloud content must not claim that a nonexistent file was replaced with local content.
- Start an automatic upload, immediately close every Aura Start page, then verify from a newly opened page that the background upload completed and the latest local revision is recorded as synced.
- Run the 2.1.0 two-device matrix, including a clean receiver, closed-page background reception, concurrent field edits/deletes/moves, overlapping uploads, offline/restart recovery, and local edits made while a remote response is pending.
- Confirm all installations in shared-sync trials run the latest 2.1.0 build and converge in both directions without a conflict-choice dialog. All must record the same shared file ID, and the final listing must contain one shared file. Overlapping uploads must use conditional writes and re-merge after conflicts.
- After a completed sync, open/close new tabs, popup and Settings pages and change focus/visibility. Those events must not force an immediate transfer or show its animation. After the delayed interval, visible online pages should poll approximately every five seconds. Local search/filter, runtime timers, recovery-history changes, and unchanged explicit settings must not create shared edits.
- Compare one visible page with several visible pages in the same installation. The background must share the polling cooldown, join an in-flight pass without queuing another poll, retain real edits during that pass, and follow the remaining deadline after a skipped poll. Failures must back off to approximately 10, 20, 40 and at most 60 seconds. Replacing or disabling the connection must reset or stop the appropriate scheduling state.
- Verify that hidden/offline pages skip visible-page polling and closed/hidden pages still receive the roughly one-minute background alarm while the browser runs. With verified unchanged cloud revisions, both polling routes should read only metadata: no payload/media transfers, main-data writes, or changed displayed last-sync time. New/unverified revisions may be read. Real local/remote edits must converge. Explicit connect/reconnect/restore actions can request synchronization; offline pending work retries on startup/online recovery. Record measured delivery times without turning the configured cadence into a guaranteed deadline.
- Upgrade a real appData-only Chrome connection, approve `drive.file` through the explicit reconnect action when required, and verify legacy data is merged into a new shared file ID before covered older files are conditionally removed. Repeat with a legacy Device OAuth file. Change an older copy during cleanup and verify it is read and merged again before deletion; unreadable or invalid copies must remain available.
- Verify the shared file includes the saved custom background image, even when a built-in background is selected. Test image replacement, removal, concurrent choices, offline recovery, and 2.0.5 upgrade migration with an older cloud snapshot that has no image.
- Verify the selected timer sound includes its original audio, filename, and portable WAV copy, even when Countdown is disabled. Test Chrome-to-Firefox playback after a WMA import, replacement/removal, simultaneous sound choices, volume 0, offline recovery, and missing/corrupt asset rejection.
- Throttle a large audio snapshot transfer so it lasts more than 25 seconds. Verify resumable upload chunks, recovery from a lost chunk response, bounded failure on a stalled session, and retry after browser/worker restart without replacing the shared file with partial JSON.
- Verify the running countdown and pause/deadline state stay local even while timer preferences sync. Distinguish successful mocked transport tests from the real two-device OAuth/playback checks; record manual evidence before claiming those checks passed.
- Follow [`SETTINGS_SCHEMA.md`](./SETTINGS_SCHEMA.md) for stored-settings changes. Verify older local/cloud/backup/Restore Point fixtures, missing nested defaults, preservation of explicit values and compatible unknown fields, and repeat migration without new edit revisions.
- Import an actual 2.0.5 JSON backup separately from updating a 2.0.5 browser profile. The old JSON never contained widget-note text or custom image bytes; missing data must not be reported as recovered. Profile migration should retain those local values, while current ZIP exports transfer them explicitly.
- Verify all saved preferences are included, especially `notes.text`, `captureOpenTabs`, and `sync.deleteCloudFileOnDisconnect`. Test notes edits, clearing, hidden widgets, Unicode/newlines, the 12,000-character boundary, and unchanged repeated sync cycles.
- Upgrade two profiles with different legacy widget notes. Verify durable migration and local recovery points, preservation of existing explicit shared text, no erasure from older snapshots without notes, cleanup retry, and safe recovery from failed main storage writes. Exercise concurrent note edits and a stale editor write; both devices must converge while prior local text remains recoverable.
- Verify the shared file excludes Restore Timeline, running timers, search/filter and onboarding/demo state, account credentials, connection/sync mode, and actual browser permission grants. A generated device ID may appear in causal stamps but must not replace another installation's connection identity. Verify a local restore point precedes application of cloud content changes, and synced Save open tabs still requires local permission approval.
- Confirm privacy disclosures explain that deleted entity fields can remain in causal deletion records and previously created backups. Do not describe ordinary link deletion as secure erasure of every copy or claim that Aura Start encrypts ZIP/JSON content end to end.
- Disconnect other test devices, then verify confirmed deletion permanently removes normal-Drive snapshots, including old 2.0.5 files, renamed app-marked files and copies in Trash. Verify empty listings before this installation's credentials are cleared; local links/settings/notes/images/audio and unrelated Drive files must remain. With native Chrome/Web access, also verify hidden legacy cleanup.
- With Device OAuth lacking hidden-app-data access, verify successful normal-Drive deletion returns an explicit unverified-legacy result. Its notice and Manage apps instructions for the account used in that cleanup must survive reload, ordinary disconnect, reconnect and later verified cleanup of another account, without claiming hidden backups exist or were deleted. Network/ACL/DELETE/verification errors must still fail and retain the paused connection for retry.
- Inject missing account authorization, missing normal-Drive scope, partial DELETE failure, and a file that appears during verification. A failure must pause sync, preserve the account and references for retry, and never report completed deletion. Verify deletion waits for an existing local upload and that stale results or a changed connection cannot clear the replacement connection.
- Reproduce Google's exact `The granted scopes do not give access to all of the requested spaces.` response with file-only and appData-only tokens. Device normal-Drive denial must fail; only its recognized hidden-space scope denial permits verified normal-Drive cleanup with an explicit notice. Native Chrome/Web must require both spaces. No Device permission upgrade is attempted, and file ACL errors must not be treated as missing scope.
- Seed an obsolete Web OAuth cache alongside the active Device credentials in `dist-google-local` and `dist-firefox-local`. Connect, background polling, account display, and disconnect must consistently use the Device connection; an absent or expired Device session must not fall back to another cached account.
- Warm a page/background credential cache, then replace or remove its local storage entry from another context. The next operation must use the stored replacement or require sign-in; a stale session mirror or storage read failure must not restore the previous account. A delayed 401 for the old grant must not retry using a replacement account's token. Paused connections must expose reconnection without cloud deletion.
- Delay IndexedDB background loading while a storage event delivers a link deletion, changed notes, or a disconnect with an unchanged document timestamp. Finishing the old image read must not restore the stale document or image.
- Verify updated peers pause when an established cloud copy disappears rather than upload retained data automatically. Test explicit reconnect separately; older installations and in-flight uploads still require disconnecting other devices first to keep the cloud empty.
- Expire or invalidate only the current access token, then verify that Aura Start silently renews authorization, retries the Drive request once, and remains connected.
- Simulate a temporary token refresh failure (`429`, `5xx`, or network loss), then verify that the stored Device OAuth refresh token and sync metadata remain intact and a later sync succeeds without another sign-in.
- Simulate a confirmed `invalid_grant`, then verify that Aura Start preserves local data and the Drive file reference, displays Reconnect Google Drive, and reconnects only after the user clicks it.
- Disconnect one of two connected browsers with cloud deletion disabled. Verify local credentials are cleared, no Google revocation request is sent, and the other browser keeps syncing without new consent. Restart the disconnected browser and verify it stays disconnected.
- Delay Device/Web sign-in and token renewal, disconnect before the response arrives, then release it. No late result may restore credentials or the connection. Repeat with a replacement account and after background restart; the saved authorization flow must remain stable.
- Check the OAuth project's publishing status before release. External Testing projects have Google's seven-day refresh-token limit for Drive scopes; retries cannot bypass it. Record the actual status rather than inferring it from an extension test.
- Install `dist-firefox` in Firefox (`about:debugging` -> This Firefox -> Load Temporary Add-on -> choose `manifest.json`) and repeat the Google Drive connect, automatic backup, restore, disconnect, and delete-backup flows through the device-code UI.
- Re-check any reviewer notes accompanying the chosen archive against `STORE_SUBMISSION.md`, the public privacy policy, and the store privacy form. Do not assume an existing submission folder or ZIP reflects the current source.
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
- Prepare a follow-up patch release if launch feedback identifies release-blocking issues; choose its version explicitly rather than reusing an old draft number.

## Release Blockers

- TypeScript or production build failure.
- Store validation failure.
- Placeholder OAuth client ID in a release ZIP.
- Remote code, analytics, or tracking found in the build.
- Manifest permissions beyond the documented least-privilege set.
- Screenshots or listing text claiming features not present in the local build.
- Stale submission archives, missing decoder notices, wrong local/release OAuth roles, or missing/incorrect Firefox consent declarations.
- Lost edits, resurrection of deleted links, persistent duplicate sync files, or deletion reported as complete without checking accessible copies.
- Claims of real Google authorization, quota behavior, or delivery guarantees supported only by a local HTTP simulator. Keep previous controlled evidence and manual live-account evidence distinct.
