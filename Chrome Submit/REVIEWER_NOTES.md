# Chrome Web Store Reviewer Notes — 2.1.0

Aura Start is a single-purpose new tab extension for organizing user-created groups of links. It works locally without an account. This document reflects the current source; a fresh submission ZIP must be built and validated separately.

## Permissions and OAuth scopes

- `storage` saves links, groups, preferences, notes, sync metadata, and local restore history. Custom media is held in extension-local IndexedDB.
- `identity` enables explicitly requested Google authorization in Chrome.
- `alarms` schedules approximately one-minute background Drive checks while sync is enabled and the browser runs, including with Aura Start pages closed. It does not provide a closed-tab Countdown alarm.
- Optional `tabs` is requested only for an explicit Save open tabs preview of current-window titles/URLs.
- `https://www.googleapis.com/*` enables Drive API requests after connection.
- `https://oauth2.googleapis.com/*` enables OAuth/token operations for supported browser flows.
- `drive.file` is used for Aura Start's shared visible file and accessible legacy copies. Aura Start does not scan or read unrelated Drive files.
- `drive.appdata` is retained by native Chrome authorization for accessible hidden legacy migration/deletion, not as the destination of new shared data.

No full Drive scope, browser history, bookmarks, cookies, webRequest, scripting, content scripts, or broad website host access is requested.

The Chrome manifest contains both limited Drive scopes. Aura Start's current Device configuration in Firefox/compatible Chromium requests only `drive.file`; that grant cannot access older hidden backups. This describes the configured extension flow, not a universal limitation of Google's Device OAuth protocol.

Firefox packages are separate: they omit `identity` and Chrome's OAuth manifest block, use Device authorization, and request optional Firefox data-collection categories `browsingActivity` and `technicalAndInteraction` for user-enabled transfer to Google. These categories do not enable analytics.

## Google Drive behavior

Sync is off by default. After the user connects the same account on current installations, all supported browsers read and conditionally update one visible `aura-start-sync.json` in ordinary Drive. It contains groups, links, saved shared preferences, Markdown notes, the custom background, and selected Countdown sound (original plus portable playback clip). The file is not encrypted by Aura Start. Restore history, running timers, connection mode, credentials, onboarding, search state, and actual browser permission grants remain local.

Visible online pages normally check about every five seconds; background checks run about once a minute while the browser runs. Network conditions, browser scheduling, and retry backoff may delay delivery. Multiple pages coordinate their checks; unchanged data is not repeatedly uploaded or animated.

Concurrent and offline changes merge, with conditional retry against newer server revisions and deletion tracking. Same-field conflicts resolve deterministically. Accessible older copies are consolidated only after the shared contents are verified, with revision checks before cleanup. Simultaneous first connections may briefly produce duplicate files before consolidation.

Connecting can merge an existing backup or create the first cloud copy if none exists. A restore-only request for an absent file reports that no backup was found and leaves local data intact. Importing an Aura backup does not disconnect the current local account. New preferences are added without resetting existing values during schema migration.

Recoverable network/auth failures retain connection state for retry. Google can still revoke authorization or require consent again. Ordinary disconnect affects this installation only, keeps cloud data, and cannot be undone by a delayed sign-in callback. It does not revoke other browsers' grants.

Confirmed cloud deletion pauses sync, permanently deletes matching accessible Aura files including old/trashed copies, verifies absence, then disconnects locally. Failure retains a paused account for retry. Hidden legacy files are included only when accessible with existing authorization; otherwise the UI preserves a notice about manual cleanup. No inaccessible data is claimed as deleted. Local data remains intact. Disconnect other installations before deleting cloud data, especially older releases.

## Backups and audio

Full Backup ZIP v2 contains JSON settings, groups, links, notes, restore history, referenced background assets, and only the selected original Countdown audio file. Built-in sounds, obsolete custom sounds, and the generated playback clip are excluded; import recreates the clip locally. Settings and links only JSON includes notes/history without media bytes. Old 2.0.5 JSON backups remain importable, but cannot restore notes/media that were never stored in those files.

Countdown supports pause, resume, reset, volume, and custom alarms. Keep an Aura Start page open for its signal. Audio is decoded locally, using native support or the bundled decoder; many formats are accepted but protected, malformed, or unsupported codecs are rejected. Input is limited to 20 MiB; the alarm playback clip is limited to 60 seconds.

The CSP `wasm-unsafe-eval` allowance is for the bundled WebAssembly audio decoder. No remote runtime code or online conversion service is used.

## Privacy and compatibility

Aura Start has no application backend, analytics, tracking, or ads. Google receives user-directed Drive data only after optional connection. Local file import/export does not require Drive. A Fine Start compatibility covers basic grouped-link export codes; Aura Start is independent and not affiliated with A Fine Start.

Command Palette has a visible button and a Ctrl+K/Cmd+K manifest command. Browser assignment can be inspected at `chrome://extensions/shortcuts`.

See `docs/INSTALLED_EXTENSION_TEST_MATRIX.md` for dated test evidence and its limits. Controlled HTTP simulations are not live Google account tests or evidence of equal reliability to another product.
