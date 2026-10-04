# Aura Start Privacy Policy

Effective date: October 4, 2026

Aura Start is a local-first browser extension. It replaces the new tab page with user-created groups of links and keeps those groups under the user's control. Aura Start works without an account, and Google Drive sync is optional and off by default.

In Firefox, Aura Start 2.1.1 also declares its bundled page as the homepage used for new windows and the Home action. Firefox manages confirmation and the user's homepage choice. This browser-local setting requires no additional extension permissions, does not change the search engine, and is not sent to Google Drive. Restoring a previous browser session remains a Firefox setting.

## Scope

This policy describes the Aura Start extension's start page, settings, personalization, widgets, import/export, Restore Timeline, Save open tabs, and optional Google Drive synchronization. Visiting the public documentation website is separate from connecting the extension to Google Drive.

## Data Aura Start Handles

Aura Start handles only the data needed for its user-facing features:

- Link groups created by the user
- Link titles, URLs, optional descriptions, optional tags, and ordering
- Nested group relationships, collapsed state, and display ordering
- Extension settings such as theme, language, columns, compact mode, search visibility, link-opening behavior, background preferences, optional widgets, optional tabs capture mode, and optional sync mode
- Markdown widget notes, stored locally by default and included in Google Drive sync when enabled
- Local UI state such as the last search query, search filter, onboarding, and demo markers
- Custom background image data selected by the user, stored locally and included in Google Drive sync when enabled
- Timer audio files selected by the user, including the original filename and file bytes plus a locally prepared playback copy
- Local countdown state such as the remaining duration and running or paused status, shared only between Aura Start pages in this browser profile
- Local restore timeline entries created before imports, resets, cloud restores, group/link moves, tab saves, and destructive actions
- Backup files or A Fine Start export codes selected or pasted by the user for import
- Current-window tab titles and URLs only when the user enables Save open tabs and grants the optional `tabs` permission
- Optional Google Drive sync metadata, such as connection status, last sync time, sync file ID, account label when available from the browser, and a locally generated device ID

Aura Start does not request browser history, browser bookmarks, cookies, web requests, scripting, or full Google Drive access.

## Browser Permissions

The current 2.1.1 packages declare these permissions:

| Permission | Where used | Purpose |
| --- | --- | --- |
| `storage` | Chromium and Firefox | Save extension data and installation-local authorization state in the browser profile. |
| `alarms` | Chromium and Firefox | Schedule periodic background Drive checks while sync is enabled and the browser is running. |
| `identity` | Chromium packages | Use browser identity APIs for Google authorization where supported. Firefox packages remove this permission and the Chromium `oauth2` manifest entry. |
| `tabs` | Optional, Chromium and Firefox | Read current-window tab titles and URLs only when the user previews tabs for Save open tabs and grants access. |
| `https://www.googleapis.com/*` | Chromium and Firefox host permission | Read and write Aura Start's authorized Google Drive files. |
| `https://oauth2.googleapis.com/*` | Chromium and Firefox host permission | Obtain and renew authorization for optional Google Drive sync. |

These declarations do not turn sync on or give Aura Start access to a Google account before the user authorizes it. Save open tabs remains optional; synchronizing its preference does not grant `tabs` access on another installation. Aura Start does not monitor general browsing activity or read browser history.

Firefox builds require Firefox 142 or later and declare `data_collection_permissions.required = ["none"]` and `optional = ["browsingActivity", "technicalAndInteraction"]`. These are Firefox's data-transmission categories for optional synchronization; they are not telemetry or browser-history access. The shared content includes notes and selected background/audio files as well as saved links and settings, as detailed below. Aura Start requests the optional categories during interactive Drive connection, separately from Google's account authorization and optional tab access.

## Local Storage

Aura Start stores its primary data in browser-local extension storage inside the user's browser profile. Custom background image and timer audio assets are stored locally in IndexedDB. In development mode only, when extension storage is unavailable, it can use browser `localStorage` as a local fallback.

The selected authorization flow, authorization generation, and any access/refresh tokens retained by Aura Start are installation-local. Tokens are used with Google authorization and Drive endpoints; they are not embedded in synchronized content or exported backup files. Browser-managed Chrome identity tokens also remain outside the shared document.

Local storage remains the default. Manual ZIP and JSON export/import continue to work independently of Google Drive.

Timer audio preparation takes place on the user's device using browser audio support and, when needed, a packaged FFmpeg WebAssembly decoder. There is no audio conversion server and no remote decoder download. Aura Start retains selected original files up to 20 MiB and a portable WAV copy of up to the first 60 seconds for the completion signal. Many common formats are supported, but decoding can fail for unsupported codecs, damaged or protected files, or preparation timeouts. Changing or removing a custom sound creates a local Restore Point; a previous sound can remain in local asset storage for recovery. The running countdown is local and is not sent to Google Drive.

## Optional Google Drive Sync

When the user explicitly connects through Chrome's native extension identity flow, Aura Start requests these manifest OAuth scopes:

- `https://www.googleapis.com/auth/drive.file`: access to Aura Start's own sync files in normal Drive storage.
- `https://www.googleapis.com/auth/drive.appdata`: access to legacy hidden Aura Start backups for migration and confirmed deletion.

The current builds use one shared `aura-start-sync.json` in normal Drive storage, marked with Aura Start app properties and visible in Google Drive. All updated installations connected to the same account read and update it. Accessible older copies, including authorized hidden backups, are merged into the shared file and conditionally deleted only after their contents have been verified there. Simultaneous first connections can briefly create duplicates before consolidation. Chrome users upgrading a 2.0.5 connection may need to reconnect once to approve `drive.file` access; the single-file protocol adds no permissions.

In Firefox and compatible Chromium browsers where Chrome's built-in identity flow is unavailable, Aura Start can use Google Device OAuth. Unpacked Chrome installations can also use this flow. Its current sync and deletion requests use only the per-file `https://www.googleapis.com/auth/drive.file` scope for Aura Start-owned sync files; Aura Start's Device flow does not request `drive.appdata`. It therefore cannot read or migrate hidden 2.0.5 backups through that authorization. If hidden legacy data cannot be checked during deletion, a persistent Settings notice explains how to check it in the Google account used for that cleanup. Aura Start does not request `https://www.googleapis.com/auth/drive` or `identity.email`. Google authorization is used only for Aura Start sync and backup cleanup and is not used for analytics, telemetry, tracking, advertising, account profiling, or reading the user's normal Drive contents. Aura Start does not read, scan, list, edit, delete, or create unrelated visible files in the user's Google Drive.

When Google Drive sync is enabled, Aura Start transmits groups, nested group relationships, links, ordering, all saved user preferences, Markdown notes, background preferences, the saved custom background image when present, the selected timer sound and its filename/original audio/portable playback copy when present, and merge metadata to Google Drive. Shared preferences include Save open tabs and the delete-backup-on-disconnect choice. Merge metadata includes logical revision counters, deletion records, and a locally generated device identifier so edits from multiple installations can be combined consistently. Account credentials, connection and sync-mode metadata, local Restore Timeline entries, running timers, search/filter and onboarding/demo state, and actual browser permission grants are not included in the shared file. Another device's merge identifier does not replace the current installation's identity. Older backups may contain fields written by earlier releases; migration preserves their synchronized content in the verified shared file before removing covered copies. Aura Start does not operate a backend service, and data is not sent to an Aura Start server.

Deleting a link or group removes it from the active list, but its previous fields can remain in synchronization deletion records so older devices cannot restore it accidentally. Local Restore Points and previously exported backups can also retain deleted content. The confirmed cloud-backup deletion described below removes the accessible sync files, including their deletion records; it does not erase local recovery data or backup files the user saved elsewhere.

Notes text is limited to 12,000 characters and is included even while the widget is hidden; edits and clearing also sync. Existing local notes migrate before sync, keeping the old copy until the main document and a local Restore Point are saved. If an explicit shared note already exists, the older local note is retained in a recovery point. Concurrent edits to the same note resolve consistently to one value rather than combining text. Previous local content is protected by recovery points before cloud replacement or a stale editor write. Notes stay local while sync is off and are included in user-created Full Backup ZIP files.

The saved custom background image is included in the shared Aura Start sync file even if a built-in background is currently selected. Replacing or removing the image synchronizes that choice to connected devices. When upgrading from 2.0.5, Aura Start migrates the existing local image before the first sync, keeps the original until migration is durably saved, and does not treat older cloud snapshots without image data as a removal. Syncing images uses the existing Drive permissions and sends no image data while sync is off.

The selected custom timer sound is included even when the Countdown widget is disabled. Replacing the sound or returning to the built-in signal synchronizes that choice. Older snapshots without timer settings do not erase newer selections. Audio uses the existing Drive permissions and is not sent to Google Drive while sync is off; local playback and preparation also work without a Google connection.

Users can:

- Keep sync off and use Aura Start fully locally
- Receive and merge existing Aura Start cloud data when connecting sync
- Restore an existing Google Drive sync file from first-run onboarding when the user chooses that action
- Create the shared Aura Start sync file when connecting if no shared file exists
- Send and receive changes automatically, including nested group changes, link moves, and shared settings
- Disconnect while keeping the Drive backup, or choose the confirmed delete-backup-and-disconnect action

The Delete Drive backup when disconnecting preference is on by default, but deletion requires a separate confirmation. Turn it off to disconnect while retaining cloud files. The confirmed delete-backup-and-disconnect action pauses sync and permanently deletes matching Aura Start snapshots in normal Drive, including old 2.0.5 files, renamed app-marked snapshots and copies in Trash. Hidden legacy `appDataFolder` backups are included only when access is already available. These snapshots include synced links, settings, notes, custom background images and selected audio. Aura Start verifies removal in the accessible storage before clearing this installation's credentials and disconnecting; local Aura Start data and unrelated Drive files are retained. If authorization or deletion fails, sync remains paused with the account and backup references available for retry, and the action reports failure instead of a completed deletion.

If hidden backups could not be checked, a local notice remains after reload, disconnect, reconnect or later cleanup of another account. Its [Google Drive settings](https://drive.google.com/drive/u/0/settings) link directs users to the account used for that unverified cleanup, then Manage apps → Aura Start → Options → Delete hidden app data, if available. This does not claim hidden data exists or that Aura Start has verified a manual cleanup.

Removing the extension does not automatically remove its Google Drive files. Updated installations pause when a previously synced cloud copy disappears and require an explicit reconnect before creating another copy. Disconnect other devices first if the cloud backup should stay empty: older installations, uploads already underway, or later explicit reconnection can upload retained local data again.

Users can turn cloud sync off at any time by disconnecting the Google account, with or without deleting the Drive backup. This stops synchronization and removes the saved authorization from this installation. It does not remove local groups, links, settings, exports, imports, or restore points, and it does not revoke other installations' Google sessions. To revoke Aura Start's authorization everywhere, use [Google Account connections](https://myaccount.google.com/connections). Background recovery and delayed sign-in responses cannot undo a manual disconnect.

Before applying cloud content changes, including connection or onboarding restore, Aura Start creates a local restore point. While an Aura Start page is visible and online, it schedules quiet Drive metadata checks approximately every five seconds. Pages in the same installation share the background check schedule, so several open pages do not multiply checks. If all pages are hidden or closed, a background alarm checks approximately once a minute while the browser runs. Failures increase the polling delay, up to about a minute. These are polling intervals, not guaranteed delivery times: network requests, media transfers, browser suspension, and Google availability can add delay.

Opening, closing, focusing, or showing a page does not itself force an immediate transfer or start the sync animation. The delayed visible-page polling schedule still checks for remote changes. Unchanged verified revisions do not download/upload data or media or update the displayed last-sync time. New or unverified revisions are read when needed. Local content changes queue synchronization; offline edits stay local and retry on background startup or network reconnection when pending work exists. Explicit connect, reconnect, and restore actions can also request synchronization. Aura Start uses polling, not server push.

## Account Marker

When Google Drive sync is enabled and connected, Aura Start may show a compact Google Drive status marker in the top-right header. The marker is used only to show sync status, last sync time, and connected account information if the browser exposes it through existing extension APIs. Aura Start does not request additional Google permissions only to display an avatar or email address.

## Network, Accounts, Analytics, And Tracking

Aura Start does not require an account for normal use. It does not include analytics, trackers, ads, affiliate replacement, telemetry, behavioral profiling, or hidden data collection.

Aura Start's service requests are used only for optional Google authorization and Drive synchronization initiated by the user's connection choice. They go to Google OAuth and Drive API endpoints for connection, token renewal, automatic sync, explicit connection/reconnection, connection-time restore/create, and backup cleanup. Google's sign-in pages open as part of authorization. Aura Start does not make background tracking calls or send data to an Aura Start server. Opening a saved link or an external help page navigates to the chosen website normally. Export files are created locally in the browser with Blob downloads. Import files are read locally by the browser and validated before they change local extension storage.

## User Control

Users can create, edit, delete, export, import, reset, sync, and restore their own data inside the extension. Full Backup ZIP contains JSON settings, links, notes, and Restore Points alongside current and historical background files. ZIP v2 includes only the selected original Countdown audio, with no playback WAV or other historical audio. Built-in sound selection produces no audio file; other historical sound references are omitted neutrally. Playback is prepared locally on import, and older v1 ZIPs and portable JSON remain importable. These bytes are read locally, and exporting or importing the ZIP does not upload the archive. Importing a backup preserves this installation's Google Drive connection; normal sync of imported content remains subject to the user's sync setting.

Settings and links only (JSON) is a separate export without embedded image or audio bytes. It retains preferences, notes, links, and history while omitting custom-file references and active Custom background selections neutrally. These omitted choices preserve existing receiving-device values or use built-in defaults on a fresh profile. Explicit built-in choices and intentional media removals remain part of the settings and can apply on import. Use ZIP to transfer custom files. Older portable JSON backups containing media remain importable. Users should protect both ZIP and JSON files because they contain their saved content.

JSON backups exported by 2.0.5 remain importable, but that version did not include the notes widget's text or custom background image bytes in its JSON export. Those items can migrate when updating an existing browser profile, but cannot be recovered from an old JSON file that never contained them. New preferences receive compatible defaults without replacing existing explicit settings.

## Open Source

Aura Start's application source is open-source under the MIT License. Bundled third-party components retain their respective licenses and notices. The source code, build scripts, validation scripts, and documentation can be inspected; there is no proprietary server component or closed service required for the extension to work.

## Data Sharing And Sale

Aura Start does not sell, rent, or trade user data. It does not disclose user-created content to the developer or send it to third parties, except for the Google authorization and Drive requests described above when the user enables or uses Google Drive sync. Opening a saved link or external help page is a normal navigation to the chosen website, subject to that website's practices.

## Chrome Web Store Limited Use Statement

The use of information received from browser extension APIs and Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements where applicable. Aura Start uses extension storage, optional runtime tabs access, and optional Google Drive sync scopes only to provide its single user-facing purpose: a private, exportable, user-controlled start page with optional backup/sync.

Aura Start does not sell user data and does not use user data for advertising.

## Security

Aura Start bundles its extension code, audio decoder, and WebAssembly with the extension package and does not execute remotely hosted code. The content security policy permits packaged WebAssembly through `wasm-unsafe-eval`; the timer adds no browser permissions. Users should protect their operating system account, browser profile, Google account, and exported backup files.

Drive requests use HTTPS. Aura Start does not add password encryption or end-to-end encryption to the shared JSON or exported ZIP/JSON files. The shared file is visible in the connected user's Google Drive, and anyone given access to that file or a backup can read its content. Media encoding and asset checksums are not encryption.

## Changes To This Policy

This policy may be updated when Aura Start changes. Any updated policy should remain consistent with the extension's actual behavior and public privacy disclosures.

## Contact

For privacy or security questions, use the [Aura Start project repository](https://github.com/communism420/Aura-Start).
