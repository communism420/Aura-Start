# Store Listing Drafts — 2.1.1

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


Use the separate Chrome Web Store and Firefox Add-ons fields below. Copy only the appropriate description into that store's English description field. The remaining sections are preparation notes, not extra description text. Do not append feature lists, a changelog, technical format lists, or reviewer notes to a public description.

This copy reflects the current 2.1.1 source. It does not confirm a store upload, approval, or publication. Only the project owner publishes official releases; contributors can propose improvements to these materials.

## Extension Name

Aura Start

## Chrome Web Store

### Short Description

A private, local-first, customizable start page for your browser new tab.

### Detailed Description

Aura Start turns your new tab into a personal start page for the links you use every day. Organize links into nested groups, add descriptions and tags, and find what you need with search.

Choose a theme or your own background image. Keep notes on the page and use the optional clock, Pomodoro timer, or Countdown widget. Countdown supports a custom alarm sound and adjustable volume; leave an Aura Start page open to hear the alarm. Audio files are prepared on your device, with a 20 MiB import limit and a playback clip of up to 60 seconds.

Your data stays on your device by default, and no account is required. Google Drive sync is optional and off by default. Connect the same Google account on your devices to share links, settings, notes, your custom background, and the selected Countdown sound. Concurrent changes merge automatically, and pending offline edits are retried when a connection is available.

Create a full backup with your settings and custom media, or export your links for use elsewhere. Import previews and local restore points help you review and recover changes. You can also find duplicate links and save tabs from the current window after granting optional tab access.

Import earlier Aura Start backups or an A Fine Start export code. Aura Start is an independent project and is not affiliated with A Fine Start.

The application is open source and has no ads, analytics, or tracking.

## Firefox Add-ons

### Summary

A private, local-first start page for your Firefox homepage, new windows, and new tabs.

### Description

Aura Start turns your Firefox homepage, new windows, and new tabs into a personal start page for the links you use every day. Organize links into nested groups, add descriptions and tags, and find what you need with search.

Firefox may ask you to confirm the homepage change, which also applies to the Home button. You can change it in Firefox's Home settings. Your preference to restore previous windows and tabs stays unchanged.

Choose a theme or your own background image. Keep notes on the page and use the optional clock, Pomodoro timer, or Countdown widget. Countdown supports a custom alarm sound and adjustable volume; leave an Aura Start page open to hear the alarm. Audio files are prepared on your device, with a 20 MiB import limit and a playback clip of up to 60 seconds.

Your data stays on your device by default, and no account is required. Google Drive sync is optional and off by default. Connect the same Google account on your devices to share links, settings, notes, your custom background, and the selected Countdown sound. Concurrent changes merge automatically, and pending offline edits are retried when a connection is available.

Create a full backup with your settings and custom media, or export your links for use elsewhere. Import previews and local restore points help you review and recover changes. You can also find duplicate links and save tabs from the current window after granting optional tab access.

Import earlier Aura Start backups or an A Fine Start export code. Aura Start is an independent project and is not affiliated with A Fine Start.

The application is open source and has no ads, analytics, or tracking.

Requires Firefox 142 or newer.

## Privacy Disclosure Short Text

Aura Start stores user-created groups, links, settings, widget state, background preferences, and restore timeline entries locally by default. It has no backend, no analytics, no tracking, no ads, and no required account. Optional Google Drive sync is user-initiated and accesses only Aura Start's shared sync file and its own legacy backups. The saved custom background image syncs through Google Drive when enabled, including replacement and removal. The selected custom audio is synchronized with its original file and a portable playback clip. Saved user preferences and Markdown notes also sync, including edits and clearing while the widget is hidden, the Save open tabs preference, and the delete-backup-on-disconnect preference. Restore Timeline, running timers, search/filter and onboarding/demo state, account credentials, and connection/sync mode stay local. Actual browser permission grants remain local; receiving Save open tabs never grants access. Existing local notes migrate with a recovery point before the old copy is cleared.

## Permission Justification

- `storage`: saves user-created groups, links, settings, sync metadata, and restore points in local extension storage.
- `identity`: declared by Chromium packages for explicitly requested Google authorization where the browser supports it. Firefox packages omit it and the Chromium `oauth2` manifest entry.
- `alarms`: schedules remote sync checks while sync is enabled and the browser runs, including when Aura Start pages are closed.
- `https://www.googleapis.com/*`: Google Drive API access after the user enables sync.
- `https://oauth2.googleapis.com/*`: Google OAuth authorization/token requests for supported browser fallback flows. These Google hosts do not grant access to arbitrary websites.
- `optional_permissions.tabs`: requested at runtime only for Save open tabs so Aura Start can preview current-window tab titles and URLs before saving.
- `https://www.googleapis.com/auth/drive.appdata`: retained by Chrome native authorization for legacy backup migration/deletion; Aura Start's current Device configuration requests only `drive.file`.
- `https://www.googleapis.com/auth/drive.file`: used by Chrome and Device OAuth for the Aura Start-owned shared sync file and older copies marked with Aura Start app properties.

Aura Start intentionally does not request bookmarks, history, cookies, webRequest, scripting, `<all_urls>`, full Google Drive access, required `tabs` permission, or browser-wide host permissions.

Firefox 142 or later declares required data collection `["none"]` and optional `["browsingActivity", "technicalAndInteraction"]`. Aura Start requests the optional categories when the user connects Google Drive, separately from Google authorization and optional `tabs` access. These categories describe optional transfer to the user's Drive, including saved notes, backgrounds, and selected audio; they do not enable analytics or browser-history access.

Both packages replace new tabs with the bundled `newtab.html`. Firefox 2.1.1 additionally declares that page as its homepage for new windows and the Home button. Firefox controls confirmation and user choice; session restore is unchanged. This adds no permission, remote navigation, or synchronized browser setting. Chromium builds do not override the homepage.

Confirmed Drive backup deletion pauses sync and permanently removes matching normal-Drive snapshots, including old, renamed app-marked and trashed copies, before verifying their absence and clearing this installation's credentials. Hidden legacy backups are included when already authorized; otherwise a persistent notice explains manual cleanup in the account used for deletion without claiming hidden data was deleted. Failed deletion retains a paused account for retry. Local links, preferences, notes, images, and audio remain intact; ordinary disconnect keeps cloud files. Disconnect stops this installation only, preserves other browsers' Google authorization, and cannot be undone by automatic recovery or a delayed sign-in response. Users can revoke access everywhere through Google Account connections.

## Reviewer Notes

Aura Start is a local-first browser new tab extension for user-created groups of links. It uses extension-local storage for local data, optional runtime `tabs` access for Save open tabs, and Google OAuth scopes only for optional Google Drive sync after user action. Chrome and Device OAuth use `drive.file` for the Aura Start-owned shared file and older copies; Chrome retains `drive.appdata` for legacy migration/deletion. Device OAuth deletes accessible normal-Drive snapshots and reports when hidden legacy data could not be checked. The `alarms` permission supports periodic background sync while the browser runs. All updated installations read and conditionally update one shared, visible `aura-start-sync.json` in ordinary Drive; it is not an encrypted archive. Conflicting writes are retried after reading and merging the latest cloud state. Existing accessible copies are merged and removed only after verification and conditional revision checks; simultaneous first connections can briefly create duplicates before consolidation.

Custom audio conversion runs locally with the decoder bundled in the extension. The `wasm-unsafe-eval` CSP entry permits that packaged WebAssembly decoder; it does not load remote code. Full ZIP export excludes the built-in alarm, unused custom sounds, and the generated playback clip; import rebuilds that clip locally from the original file.

Firefox uses a module background script instead of Chrome's service worker and requires Firefox 142 or later. Its homepage and data-collection declarations are described above. Test native Firefox confirmation, new window, Home, new tab, and preservation of session restore against the exact Firefox package; a Chromium UI screenshot is not evidence of Firefox integration.

The extension has no content scripts, no analytics, no tracking, no application backend, no ads, and no remotely hosted code. A Fine Start is mentioned only for migration compatibility; Aura Start is independent and not affiliated with A Fine Start.

## Manual Fields Checklist

- Category: Productivity
- Language: English
- Privacy policy URL: `https://aurastart.pages.dev/privacy-policy.html`
- Screenshots: follow `docs/SCREENSHOTS.md`
- Support URL: GitHub repository issues or repository URL
- Website URL: `https://aurastart.pages.dev/`
- Source code URL: `https://github.com/communism420/Aura-Start`
- Store package: validate a fresh 2.1.1 Chrome store build with the production extension ID/OAuth configuration; local unpacked builds are not store submission packages. Follow `docs/RELEASE_CHECKLIST.md`.
- Firefox package: use a separately validated Firefox 2.1.1 build, the established AMO add-on ID, and matching release Device OAuth configuration. Supply readable source and reproducible build instructions to AMO; do not submit a Chromium ZIP.
- Private preparation materials: `Chrome Submit/`, `Firefox Submit/`, and root `STORE_SUBMISSION.md` stay local and are excluded from Git. They may contain artifact-specific verification notes; public source and documentation remain auditable in the repository.
- Screenshots must come from the actual current interface. Run `npm run screenshots`; review its five shared 1280 × 800 screenshots and the Chrome-only 440 × 280 and 1400 × 560 promotional images. Historical image and archive names are not proof of the current release.
