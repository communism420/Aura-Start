# Aura Start vs A Fine Start

Current Aura Start version: **2.1.0**. Public A Fine Start references checked on **2026-10-04**.

Aura Start is an independent, open-source, local-first start page focused on grouped links, data ownership, and optional Google Drive synchronization. It is not affiliated with A Fine Start.

## When Aura Start may fit your workflow

- You want MIT-licensed source code and local use without an account.
- You want nested groups, fuzzy search, a Command Palette, and Duplicate Finder.
- You want Full Backup ZIP files containing settings, links, notes, restore history, and custom media.
- You want clock, Markdown notes, Pomodoro, and Countdown widgets, including a custom Countdown alarm.
- You want optional synchronization through your own Google Drive across Chrome, Firefox, and compatible Chromium browsers such as Helium.
- You want to import or export a basic A Fine Start-compatible collection of grouped links.

## Feature comparison

The A Fine Start column describes public features only. An unverified feature is not a claim that it is absent.

| Area | Aura Start 2.1.0 | A Fine Start |
| --- | --- | --- |
| Local use | No account required; data is stored in the browser | Free local use; no account required |
| Source | MIT-licensed source in this repository | Source availability not assessed here |
| Platforms | Chrome/Chromium and Firefox extension builds | Official site links Chrome, Firefox, Edge, and Web |
| Organization | Groups nested up to two levels; descriptions, tags, drag-and-drop ordering | Grouped links with sorting and drag-and-drop |
| Search | Fuzzy search, supported query modifiers, and keyboard navigation | Search pane and keyboard navigation |
| Capturing tabs | Optional current-window preview and save flow with runtime tabs permission | Quick-add from the current page |
| Export and migration | Full Backup ZIP; Settings and links only JSON; Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible codes | Import/export codes; help states that browser-bookmark-format export is unavailable |
| Restore history | Searchable local Restore Timeline, capped at 20 snapshots | Local bookmark restore points after changes, capped at 100 |
| Personalization | Themes, background controls, clock, Markdown notes, Pomodoro, Countdown with custom audio | Multiple themes and appearance controls |
| Synchronization | Optional Google Drive connection; one shared visible file containing links, groups, saved preferences, notes, and custom media | Premium account synchronization of bookmarks, groups, and ordering |
| Additional tools | Command Palette, layout-aware shortcuts, and read-only Duplicate Finder with confirmed deletion | Broader equivalents not assessed here |

A Fine Start facts above come from its [official homepage](https://afinestart.me/) and [help](https://afinestart.me/help/). Its [changelog](https://afinestart.me/changelog/) describes fixes and product changes, including session handling; it does not establish comparative reliability or reveal the synchronization algorithm.

## Synchronization and reliability

Aura Start uses one shared, visible `aura-start-sync.json` in Google Drive across supported browsers. It merges edits to separate fields and tracks deletions. Concurrent edits to the same field resolve deterministically; both alternative values cannot remain the active value. Conditional writes prevent silently overwriting a newer cloud revision, and interrupted work can retry after recovery.

While Aura Start is visible and online, remote checks normally run about every five seconds. With pages hidden or closed, background checks run about once a minute while the browser is running. Browser scheduling, offline periods, Google responses, and retry backoff can increase delivery time. Opening an unchanged page does not itself upload data or show a sync animation. Polling without changes does not rewrite the shared file.

Accessible older copies are merged before conditional cleanup. Simultaneous first connections can briefly create duplicates before consolidation. Chrome's native authorization also retains `drive.appdata` for accessible legacy hidden backups; Aura Start's current Device authorization in Firefox/Helium requests `drive.file` only and cannot read those hidden copies with that grant. New shared data is stored in ordinary Drive in every browser.

The implementation is independent of A Fine Start. Similar goals do not establish identical internals or equal reliability. See [installed-extension test evidence](INSTALLED_EXTENSION_TEST_MATRIX.md) for the conditions actually tested; controlled Google HTTP simulations are distinguished from real-account checks.

## Data ownership and permissions

Full Backup ZIP contains JSON data and referenced custom background images, plus only the currently selected original Countdown audio file. The built-in alarm, obsolete custom sounds, and a separate generated playback copy are not exported. Settings and links only JSON still includes notes and restore history, but omits image/audio bytes. Manual backups work without Google Drive.

Drive synchronization includes saved preferences, notes, the custom background, and the selected audio together with its portable playback clip. Restore history, running timers, account credentials, connection mode, and browser permission grants remain local. New settings are added without resetting existing preferences. Aura Start has no application backend, analytics, tracking, ads, or required account; optional sync sends the selected data to Google.

Chrome builds use `storage`, `identity`, and `alarms`; Firefox builds omit `identity`. Both declare only Google API/OAuth hosts and optional runtime `tabs` for Save open tabs. Firefox also asks for its optional data-collection permissions when enabling Drive sync. No full Drive access, browser history, cookies, content scripts, or remote runtime code is requested. See [Privacy Policy](https://aurastart.pages.dev/privacy-policy.html) for the complete disclosure.

Ordinary disconnect affects this installation and keeps the cloud file. Confirmed cloud deletion pauses synchronization, deletes and verifies accessible Aura Start copies, and then disconnects locally. Failures retain a paused account for retry; inaccessible hidden legacy data is reported rather than claimed as deleted. Local data remains intact. Disconnect other installations before cloud deletion to avoid older installations recreating a copy.

## Migration

1. In A Fine Start, open Settings and choose Export bookmarks.
2. Copy the whole export code.
3. In Aura Start, open Settings and choose Import from A Fine Start.
4. Paste the code, review the validation preview, and choose Merge or Replace.
5. Confirm the import. A restore point is created before it is applied.

Only supported grouped-link data can migrate; HTTP/HTTPS URLs are validated. Exporting back preserves basic group names and link names/URLs, not Aura-specific notes, media, tags, descriptions, or preferences. See the [migration guide](MIGRATE_FROM_A_FINE_START.md).

## Practical differences

A Fine Start offers a web version, a direct quick-add workflow, and a longer documented local bookmark history. Aura Start offers an auditable MIT codebase, a wider set of backup formats, custom media and widgets, and Google Drive as its optional synchronization destination. Choose based on those workflows rather than an unsupported claim that either product cannot lose data.
