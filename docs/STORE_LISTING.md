# Chrome Web Store Listing Draft — 2.1.0

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


## Extension Name

Aura Start

## Short Description

A private, local-first, customizable start page for your browser new tab.

## Detailed Description

Aura Start replaces the browser new tab page with a clean, local-first start page for groups of links.

Create nested groups, add links with optional descriptions and tags, search across your saved links with fuzzy matching, and keep your start page fast without a required account. Aura Start stores your data locally by default and is designed around export-first data ownership: you can export Full Backup ZIP, Settings and links only (JSON), Browser Bookmarks HTML, Markdown, CSV, or an A Fine Start-compatible export code.

Aura Start supports importing A Fine Start export codes for migration and can export an A Fine Start-compatible code if you want a basic grouped-link format again later. Aura Start is an independent project and is not affiliated with A Fine Start.

For safety, Aura Start includes restore points before destructive actions, a searchable Restore Timeline, a read-only Duplicate Finder scan with user-confirmed deletion, and clear import preview flows. Power-user features include Command Palette with fuzzy command search, browser-assigned keyboard shortcuts, layout-aware Latin/Cyrillic shortcut handling, optional Save open tabs with runtime tabs permission, background images, Markdown notes with optional Google Drive sync, a header clock, a Pomodoro timer, and Countdown with pause/resume/reset, adjustable volume, and a completion alarm. The Countdown alarm requires an Aura Start page to remain open. Custom sounds are prepared locally from many common formats, including WAV, MP3, Ogg/Opus, FLAC, AAC/M4A, AIFF, and WMA; support depends on a usable decoder, with a 20 MiB import limit and a playback clip of at most 60 seconds.

Aura Start has no required account, no analytics, no tracking, no ads, and no backend. Optional Google Drive sync is off by default. Connect the same Google account on devices running the latest 2.1.0 build to share groups, links, saved preferences, Markdown notes, the custom background, and selected Countdown audio, with automatic merging of concurrent and offline edits. Aura Start uses `drive.file` for one shared `aura-start-sync.json` and consolidation of its own older copies; Chrome also retains `drive.appdata` to migrate older hidden backups. Visible online pages normally check about every five seconds. Background checks run about once a minute while the browser runs, including with Aura Start pages closed. Delivery depends on connectivity, browser scheduling, and retry delays. Polls without changes do not rewrite the file or display a sync animation. The extension does not request browser bookmarks, history, cookies, webRequest, scripting, or full Google Drive access. The `tabs` permission is optional and requested only when the user previews current-window tabs for Save open tabs.

Aura Start's application source uses MIT; bundled third-party components retain their own licenses.

## Feature Bullets

- Organize links into clean nested groups on every new tab
- Search by title, URL, description, tags, supported query modifiers, and fuzzy matches
- Customize the start page with built-in or custom background images, with optional image sync through Google Drive
- Optional widgets: clock, Markdown notes, Pomodoro, and Countdown with a custom completion sound
- Optionally save current-window tabs into a new group after explicit tabs permission approval
- Import from A Fine Start export codes
- Full Backup ZIP with settings, links, notes, restore history, custom backgrounds, and only the selected original Countdown sound
- Settings and links only JSON (includes notes/history, omits media), Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible code
- Restore Timeline before destructive actions
- Command Palette, visible UI access, and browser-assigned keyboard shortcuts
- Latin/Cyrillic layout-aware keyboard shortcuts for common actions
- Duplicate Finder with read-only scan and user-confirmed deletion
- Optional Google Drive sync across devices with automatic merging and background updates
- No required account, no analytics, no tracking
- MIT-licensed application source; third-party components retain their licenses

## Privacy Disclosure Short Text

Aura Start stores user-created groups, links, settings, widget state, background preferences, and restore timeline entries locally by default. It has no backend, no analytics, no tracking, no ads, and no required account. Optional Google Drive sync is user-initiated and accesses only Aura Start's shared sync file and its own legacy backups. The saved custom background image syncs through Google Drive when enabled, including replacement and removal. The selected custom audio is synchronized with its original file and a portable playback clip. Saved user preferences and Markdown notes also sync, including edits and clearing while the widget is hidden, the Save open tabs preference, and the delete-backup-on-disconnect preference. Restore Timeline, running timers, search/filter and onboarding/demo state, account credentials, and connection/sync mode stay local. Actual browser permission grants remain local; receiving Save open tabs never grants access. Existing local notes migrate with a recovery point before the old copy is cleared.

## Permission Justification

- `storage`: saves user-created groups, links, settings, sync metadata, and restore points in local extension storage.
- `identity`: allows the user to explicitly connect optional Google Drive sync through Chrome's OAuth flow.
- `alarms`: schedules remote sync checks while sync is enabled and the browser runs, including when Aura Start pages are closed.
- `https://www.googleapis.com/*`: Google Drive API access after the user enables sync.
- `https://oauth2.googleapis.com/*`: Google OAuth authorization/token requests for supported browser fallback flows. These Google hosts do not grant access to arbitrary websites.
- `optional_permissions.tabs`: requested at runtime only for Save open tabs so Aura Start can preview current-window tab titles and URLs before saving.
- `https://www.googleapis.com/auth/drive.appdata`: retained by Chrome native authorization for legacy backup migration/deletion; Aura Start's current Device configuration requests only `drive.file`.
- `https://www.googleapis.com/auth/drive.file`: used by Chrome and Device OAuth for the Aura Start-owned shared sync file and older copies marked with Aura Start app properties.

Aura Start intentionally does not request bookmarks, history, cookies, webRequest, scripting, `<all_urls>`, full Google Drive access, required `tabs` permission, or browser-wide host permissions.

Confirmed Drive backup deletion pauses sync and permanently removes matching normal-Drive snapshots, including old, renamed app-marked and trashed copies, before verifying their absence and clearing this installation's credentials. Hidden legacy backups are included when already authorized; otherwise a persistent notice explains manual cleanup in the account used for deletion without claiming hidden data was deleted. Failed deletion retains a paused account for retry. Local links, preferences, notes, images, and audio remain intact; ordinary disconnect keeps cloud files. Disconnect stops this installation only, preserves other browsers' Google authorization, and cannot be undone by automatic recovery or a delayed sign-in response. Users can revoke access everywhere through Google Account connections.

## Reviewer Notes

Aura Start is a local-first browser new tab extension for user-created groups of links. It uses extension-local storage for local data, optional runtime `tabs` access for Save open tabs, and Google OAuth scopes only for optional Google Drive sync after user action. Chrome and Device OAuth use `drive.file` for the Aura Start-owned shared file and older copies; Chrome retains `drive.appdata` for legacy migration/deletion. Device OAuth deletes accessible normal-Drive snapshots and reports when hidden legacy data could not be checked. The `alarms` permission supports periodic background sync while the browser runs. All updated installations read and conditionally update one shared, visible `aura-start-sync.json` in ordinary Drive; it is not an encrypted archive. Conflicting writes are retried after reading and merging the latest cloud state. Existing accessible copies are merged and removed only after verification and conditional revision checks; simultaneous first connections can briefly create duplicates before consolidation.

Custom audio conversion runs locally with the decoder bundled in the extension. The `wasm-unsafe-eval` CSP entry permits that packaged WebAssembly decoder; it does not load remote code. Full ZIP export excludes the built-in alarm, unused custom sounds, and the generated playback clip; import rebuilds that clip locally from the original file.

Firefox packages omit Chrome's `identity` permission and OAuth manifest block, use Device authorization, and declare Firefox optional data-collection permissions (`browsingActivity` and `technicalAndInteraction`) for user-enabled Drive sync. These categories describe user-directed transfer to Google and do not enable analytics.

The extension has no content scripts, no analytics, no tracking, no application backend, no ads, and no remotely hosted code. A Fine Start is mentioned only for migration compatibility; Aura Start is independent and not affiliated with A Fine Start.

## Manual Fields Checklist

- Category: Productivity
- Language: English
- Privacy policy URL: `https://aurastart.pages.dev/privacy-policy.html`
- Screenshots: follow `docs/SCREENSHOTS.md`
- Support URL: GitHub repository issues or repository URL
- Website URL: `https://aurastart.pages.dev/`
- Source code URL: `https://github.com/communism420/Aura-Start`
- Store package: validate a fresh 2.1.0 Chrome store build with the production extension ID/OAuth configuration; local unpacked builds are not store submission packages. Follow `docs/RELEASE_CHECKLIST.md`.
