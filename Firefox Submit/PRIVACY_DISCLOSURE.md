# Firefox Add-ons Privacy Disclosure — Aura Start 2.1.0

Updated October 4, 2026. This describes current functionality and must be checked against the exact package and AMO form before submission. It does not confirm store publication.

## Local Data

Aura Start stores user-created groups and links, titles and URLs, descriptions and tags, nesting/order, preferences, Markdown notes, Restore Points, background images, selected timer audio, running widget state and interface state in the browser profile. Settings and small state use extension storage; media also use local IndexedDB. Backup/import files are read or generated locally at the user's request.

Save open tabs optionally reads current-window tab titles and URLs only after the user invokes the feature and grants optional `tabs` access. The preview filters duplicates and unsupported URLs before confirmed saving. This is not browser history collection or ongoing tab tracking.

Aura Start has no developer-operated backend, analytics, ads, tracking or profiling. It does not sell data or use it for unrelated purposes.

## Optional Google Drive Transfers

Google Drive sync is off by default and begins after explicit connection. Firefox uses Google Device OAuth with the current `drive.file` configuration. All updated installations on the same Google account share a visible normal-Drive `aura-start-sync.json`, containing:

- Groups, links, titles, URLs, descriptions, tags, order and nesting.
- Shared preferences, including notes text and saved widget settings.
- The saved custom background image, even when a built-in background is selected.
- The selected custom Countdown sound, its original filename/bytes, and a portable playback copy, even when the widget is disabled.
- Revision counters, deletion records, and generated installation identifiers needed to merge changes.

OAuth tokens, local Restore Timeline, running timer progress, search/filter state and onboarding state are not uploaded as shared content. Credentials are stored locally for renewal and use only with Google. No audio conversion service is used.

Aura Start reads and updates its own recognized sync files, consolidates accessible older copies, and verifies merged content before removing covered duplicates. It does not request full Drive access or read unrelated Drive files. The current Device grant cannot read old hidden `appDataFolder` backups. New synchronized data uses ordinary Drive storage in Firefox and the other updated browsers.

Visible online Aura Start pages check for changes approximately every five seconds, with a shared cadence across pages. An alarm checks approximately every minute while connected automatic sync is enabled and the browser runs. Google receives those authorized requests even if Aura Start pages are closed. Quiet unchanged checks normally use only file metadata. Google handles received data under its own policies; Aura Start does not provide its own end-to-end encryption of the shared file.

## Disconnect And Delete

Turning off Delete Drive backup when disconnecting keeps the cloud copy and clears only this installation's connection. That setting defaults on; the deletion action requires confirmation. It pauses sync, removes recognized accessible Aura Start snapshots, including matching files in Trash, and verifies absence before disconnecting. Their included settings, notes and media are removed with those snapshots.

If hidden legacy data cannot be checked, a persistent notice records that limitation separately from normal-Drive deletion and points to Google Drive's app-data controls. Failed accessible-file deletion retains a paused connection for retry. Local user data remains. Other installations keep their own local data and may upload it after an explicit reconnect; disconnect peers first when the cloud should remain empty.

Ordinary disconnect does not call Google's project-wide revocation endpoint. Revocation of Aura Start everywhere is available through Google Account connections.

## Permissions And Consent

Firefox declares `storage` and `alarms`, optional `tabs`, and Google API hosts `www.googleapis.com` and `oauth2.googleapis.com`. It omits Chrome-only `identity` and `manifest.oauth2`. It does not request history, bookmarks, cookies, webRequest, scripting or all-URL permissions.

The manifest declares required data collection `["none"]` and optional `["browsingActivity", "technicalAndInteraction"]`. Aura Start requests optional Firefox data collection consent when the user starts Google Drive connection; Google OAuth consent is separate. These labels do not replace the content disclosure above: notes, backgrounds and selected sounds also transfer when sync is enabled. Declared API host access does not make sync automatic before connection.

## Backups And Audio Processing

Full Backup ZIP and settings-and-links JSON are generated locally and are readable files, without Aura Start encryption. ZIP includes settings, links, notes, history, referenced backgrounds and only the current selected original Countdown sound; JSON omits media. Tokens and running timer state are not portable backup contents. Import preserves this installation's existing Google connection.

Custom audio is decoded locally using the browser and, if needed, packaged FFmpeg WebAssembly. Its JS, WASM, workers, licenses and source/build references are packaged; there is no runtime CDN decoder or remote conversion service. `wasm-unsafe-eval` is a content security policy allowance for packaged WebAssembly, not a new browser permission.

Public policy: [Aura Start Privacy Policy](https://aurastart.pages.dev/privacy-policy.html).
