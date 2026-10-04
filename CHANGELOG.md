# Changelog

## Unreleased

## Aura Start 2.1.1 — Firefox Home And New Windows

- Added Aura Start as the Firefox homepage and new-window page, alongside the existing new-tab replacement. Firefox manages confirmation and the user's choice of homepage; restoring a previous browser session remains controlled by Firefox.
- Kept this homepage override specific to Firefox and added build validation for both browser targets. No additional extension permissions are required.
- Updated both browser extension versions to 2.1.1.
- Refreshed the user and contributor documentation, privacy and permission disclosures, separate Chrome/Firefox listing drafts, and website gallery with real-browser captures of 2.1.1.

## Aura Start 2.1.0 — Shared Google Drive Sync

Changes compared with 2.0.5. Historical 2.1.0 release notes; inclusion here is not a claim that an extension store has published that version.

- Added the optional Countdown widget with a 1-second to 24-hour duration, pause/resume/reset, a completion signal, and volume control. Timer progress is shared between this profile's Aura Start pages and survives reload; an Aura Start page must remain open for timely playback.
- Added custom timer sounds with local decoding of common and less common audio formats. Files up to 20 MiB retain their original bytes and a portable PCM WAV copy of the first 60 seconds for consistent playback across browsers; unsupported, protected, or damaged files leave the previous sound intact.
- Included a locally bundled FFmpeg WebAssembly decoder for audio formats the browser cannot decode. The roughly 32 MB decoder loads only when importing a file needs it, uses no conversion server, and requires no new browser permissions.
- Added synchronization of the selected timer sound, its original file, portable playback copy, and timer preferences through Google Drive, including replacement and removal while the widget is hidden. The running countdown remains local.
- Added Full Backup ZIP and Restore Point ZIP exports containing settings/link/note/history JSON and current/historical background files. ZIP v2 includes only the selected original Countdown audio, without a playback WAV or other historical sounds; built-in selection includes no audio. Import rebuilds playback locally, retains the Drive connection, and supports earlier v1 ZIPs and portable JSON.
- Renamed the JSON-only export to Settings and links only (JSON). It retains settings, notes, links, and Restore Points without media bytes. Custom-file references and active Custom background selections are omitted neutrally; explicit built-in choices and intentional removals remain applicable settings. Older portable JSON backups with embedded assets remain importable.
- Replaced automatic upload-only behavior with bidirectional synchronization of groups, links, their order and nesting, and shared settings across connected devices.
- Added deterministic merging of changes to individual fields, including deletion records, so concurrent and offline edits converge without a conflict-choice dialog.
- Moved shared synchronization to one Aura Start-owned `aura-start-sync.json` in normal Drive with `drive.file` access. All updated installations use the same file; conditional writes reject stale revisions and retry after reading and merging concurrent changes. Failed or repeatedly conflicting transfers keep local edits pending.
- Added consolidation of older Aura Start backups, including per-device copies and accessible hidden `appDataFolder` files. Migration creates a new shared file ID, verifies the combined data and selected media, then conditionally removes covered older copies. Concurrent first connections can briefly create duplicates, which later sync consolidates into the same surviving file; unreadable or invalid copies are never discarded.
- Keep every connected device on the latest 2.1.0 build to use the single-file protocol. Native Chrome adds `drive.file` alongside legacy `drive.appdata`; upgrading from 2.0.5 may require one reconnection to approve that access. Device OAuth continues to use `drive.file`, and no full Drive scope is requested.
- Added quiet Drive metadata checks about every five seconds while an Aura Start page is visible and online, with one shared polling cadence across open pages and backoff after failures. A background alarm keeps checking about once a minute with pages hidden or closed. Unchanged verified revisions skip payload/media transfers and last-sync-time writes. Page opening, closing, focus, and visibility changes do not themselves trigger sync or its animation; pending offline edits still recover on startup or network reconnection.
- Added the `alarms` browser permission for connected automatic background sync. Optional `tabs` remains limited to Save open tabs; custom backgrounds, audio preparation, and ZIP backups require no additional permissions.
- Added Google Drive synchronization of the saved custom background image, including replacement and removal. The image is included while sync is enabled even when a built-in background is currently selected.
- Added automatic migration of a locally stored 2.0.5 custom background before the first 2.1.0 sync. The original image is retained until migration is durably saved; older cloud snapshots without an image do not count as a removal.
- Included portable custom image assets in Full Backup ZIP and exported Restore Points. Import validates and saves referenced assets before updating local data, preventing unavailable image references from breaking display or sync.
- Added versioned settings migration for local storage, Google Drive snapshots, JSON imports, and Restore Points. New settings receive defaults without resetting existing choices, and a field missing from an older snapshot does not overwrite a newer saved choice.
- Preserved supported, safe settings fields from newer snapshots during round trips, including their sync revisions. Repeated migration does not create new user edits or discard connection metadata.
- Added shared Markdown notes, including text edits, clearing, hidden-widget synchronization, and ZIP/JSON backups. Existing local notes migrate only after the main document and a local recovery point are durably saved; older snapshots missing notes do not erase existing text.
- Included the Save open tabs and delete-backup-on-disconnect preferences in shared settings. Browser permission grants, Restore Timeline, running timers, search/filter and onboarding state, account credentials, connection/sync mode, and installation identity remain local.
- Preserved previous local notes in recovery points before cloud replacement or a stale editor write. Concurrent edits to the same setting resolve consistently; note text is not collaboratively merged.
- Rebased writes from open pages onto current stored data; Undo preserves unrelated edits received from other devices, and restoring a point preserves the current Drive connection.
- Ignored stale sync results after a connection change and corrected the published Chrome extension ID used to select OAuth.
- Made confirmed Drive backup deletion pause sync, permanently remove matching normal-Drive snapshots, including old 2.0.5 files, renamed files and copies in Trash, and verify their absence before clearing this installation's credentials. Authorized hidden legacy backups are also removed. Failures retain a paused account for retry, and local links, settings, notes, images, and audio remain intact.
- Removed the `drive.appdata` request rejected by the configured Device OAuth clients. Current Device cleanup uses its existing `drive.file` grant; if hidden legacy backups cannot be checked, a persistent notice explains how to check the same account in Google Drive settings. It does not claim hidden data exists or was deleted. Stale connection actions cannot clear a replacement connection; updated peers pause when an established cloud copy disappears instead of automatically recreating it.
- Fixed stale Web OAuth credentials overriding the active Device OAuth connection during background sync in unpacked Chromium and Firefox builds. Connecting, polling, and disconnecting now select credentials from the same authorization flow.
- Made stored credentials authoritative across open pages and background processes, preventing an old in-memory session from surviving a connection change. A paused connection also exposes reconnection without requiring cloud deletion.
- Hardened authorization recovery with a persisted choice of sign-in flow, bounded silent renewal and retries, and protection against delayed authorization results after disconnect. Temporary failures retain the connection and pending edits; a confirmed invalid grant still requires explicit reconnection.
- Made disconnect local to the selected installation instead of revoking the Google project's authorization for every browser. Manual disconnect stops sync and clears saved credentials; automatic recovery cannot reconnect it. Cloud deletion remains a separate confirmed action.
- Fixed cleanup handling for Google's "requested spaces" error. Missing hidden-app-data access on Device OAuth is reported separately from verified normal-Drive cleanup. Native Chrome/Web cleanup remains strict for both spaces, and file ACL, network, deletion, and verification errors are never treated as successful cleanup.
- Fixed delayed custom-background loading overwriting a newer document already received from another page or device, including link deletions, notes, and connection state.
- Fixed the Google Drive completion message after restoring on a new installation. Existing cloud data now reports successful synchronization; the first-copy message appears only when Aura Start's cloud storage was empty.
- Preserved compatibility with 2.0.5 JSON backups. Those exports did not contain the actual custom background image or Notes widget text; these migrate from an existing local installation instead. Import does not recreate absent files or notes.
- Bumped Chromium, Firefox, and package versions to 2.1.0.

## Aura Start 2.0.5 And Earlier Updates

- Added automatic Google Drive access-token recovery: a Drive API `401` now refreshes or reacquires the short-lived token and retries the failed request once.
- Hardened Device OAuth persistence so temporary network, rate-limit, server, storage, and OAuth client-configuration errors never erase the stored refresh token; only Google's confirmed `invalid_grant` response does.
- Added an explicit reconnect-required state and action that preserve local data, sync metadata, and the Drive file reference instead of silently disconnecting the account.
- Moved automatic Google Drive synchronization into the extension background context so closing the Aura Start page no longer interrupts an active sync.
- Added a serialized background sync queue, storage-change triggering, browser-start retry, and race-safe tracking of the exact local data revision uploaded to Drive.
- Kept sync status, conflicts, errors, and success toasts live while an Aura Start page is open without making the background task depend on that page.
- Fixed Firefox release finalization to load the generated background entry as an ES module, and hardened validation so a classic-script/background-import mismatch cannot ship again.
- Bumped both Chromium and Firefox extension build versions to 2.0.5.
- Added a success toast after every completed Google Drive sync, including automatic background uploads and already-synchronized checks.
- Bumped both Chromium and Firefox extension build versions to 2.0.4.
- Added an explicit GitHub Pages deployment workflow for the static `docs` site and disabled Jekyll processing with `docs/.nojekyll`.
- Added a public docs-site download section with Chrome Web Store and Firefox Add-ons links.
- Added official Chrome Web Store and Firefox Add-ons download links to README.
- Fixed Firefox Google Drive restore/connect so a failed optional data-collection permission prompt no longer blocks the real Google OAuth flow when Firefox rejects it outside a direct user-input stack.
- Bumped the Firefox extension build version to 2.0.3 while keeping the Chromium extension version at 2.0.1.
- Fixed Firefox Google Drive connection by removing the async permission preflight before the Firefox data collection consent request.
- Bumped the Firefox extension build version to 2.0.2 while keeping the Chromium extension version at 2.0.1.
- Added separate Chromium and Firefox extension version configuration with build-time manifest injection and target-specific release validation.
- Fixed group drag-and-drop target detection so bookmark groups persist after dropping and can be reordered upward, downward, or into valid nested-group drop zones.
- Fixed order normalization so group reordering is not undone during the save/touch cycle, including legacy data with missing `parentId`.
- Fixed Chromium/Helium MV3 manifests so `background.scripts` is never included outside Firefox builds, and added validation guards for browser-specific background formats.
- Bumped the extension package and manifest version to 2.0.1.
- Documented the Mozilla Add-ons source-code submission flow in README, including the required source archive contents, exclusions, and reproducible Firefox build commands.
- Refreshed README, privacy policy, public docs site, store submission notes, release checklists, comparison docs, demo screenshot data, and screenshot documentation for the current 2.0.0 feature set, including nested groups, fuzzy search, Restore Timeline, Save open tabs, Firefox support, backgrounds, and widgets.
- Updated cross-browser UI and manifest wording so data ownership and extension descriptions no longer describe Aura Start as Chromium-only.
- Updated release and store documentation to use `https://aurastart.pages.dev/` as the public Aura Start website.
- Raised the Firefox release build minimum version to 142.0 so `browser_specific_settings.gecko.data_collection_permissions` is supported by Firefox for Android validation.
- Removed React DOM raw-HTML fallback code from Firefox release bundles and added validation that blocks Firefox ZIPs containing unsafe `innerHTML`/`outerHTML`/`insertAdjacentHTML` sinks.
- Fixed Firefox AMO package validation by declaring non-empty built-in data collection consent metadata (`required: ["none"]`) and adding a build-time guard so invalid Firefox ZIPs cannot be produced unnoticed.
- Added optional visual personalization with built-in and custom local background images, blur/dim/position controls, plus lightweight Clock, Markdown Notes, and Pomodoro widgets that can be toggled in settings.
- Added Firefox-oriented build support with a WebExtension API adapter, Promise/callback-compatible storage, tabs, permissions, runtime, and identity wrappers, a `build:firefox` script, Firefox manifest finalization, and Device OAuth documentation for Google Drive sync.
- Added an optional "save current window tabs as a new group" workflow with runtime tabs permission request, preview, duplicate filtering, settings toggle, Command Palette/Header entry points, and restore-point protection.
- Reworked restore points into a searchable Restore Timeline with day grouping, action filters, richer context, and automatic snapshots before important move/reorder operations.
- Added Fuse.js-powered fuzzy link search with nested-group awareness, match highlighting, result counts, quick filters, Command Palette handoff, and a visibly restored last search query.
- Added nested groups up to two levels, including parent selection, drag-and-drop reparenting, child-group delete choices, migration for legacy flat groups, and nested-aware export/restore handling.
- Improved destructive-action safety by creating a restore point before deleting an individual link.

## Aura Start 2.0.0 — Nested Groups, Search, Timeline, Firefox, And Personalization

- Added stronger A Fine Start migration flow with safer import preview and compatibility notes.
- Added first-run onboarding, empty state actions, demo data, and Google Drive restore during setup.
- Added Export / Backup hub, Restore Timeline, Command Palette, Duplicate Finder, and Privacy Promise.
- Fixed Google Drive sync behavior across test and Chrome Web Store builds, including OAuth flow, reconnect states, token persistence, and automatic backup handling (I hope).
- Kept Google Drive sync optional, with Google Chrome using hidden appDataFolder storage and Firefox/compatible Chromium fallback builds using Drive file access only for Aura Start's own sync file.
- Improved keyboard shortcuts, Cyrillic-layout shortcut handling, search focus behavior, and Command Palette access.
- Improved destructive-action safety with restore points, confirmations, and clearer recovery messaging.
- Updated translations across all supported languages and fixed untranslated UI labels.
- Redesigned the documentation website and refreshed privacy, store listing, and release materials.
- Updated screenshots to match the new Aura Start design.
