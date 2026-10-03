# Chrome Web Store Privacy Disclosure — 2.1.0

Updated 2026-10-04. Use this together with `PRIVACY.md`, the public privacy policy, and the exact submission manifest when completing store forms.

## Data handled by the extension

- User-created group/link names, URLs, descriptions, tags, and ordering.
- Saved preferences, Markdown notes, and local restore history.
- Custom background images and selected Countdown audio (original file plus local playback clip).
- User-selected import/export files.
- Current-window tab titles/URLs only when the user grants optional `tabs` and explicitly previews Save open tabs.
- Local Google credentials, optional account identity information when available, and synchronization metadata after connection.

Data is stored locally by default in extension storage and IndexedDB. Aura Start has no application backend, analytics, tracking, profiling, or ads; it does not sell user data or transfer it for unrelated purposes. Google processes the explicitly requested authorization and Drive requests under its own policies.

## Optional transfer to Google Drive

Drive sync is off by default and requires user action. Current Chrome, Firefox, and compatible Chromium builds use one visible `aura-start-sync.json` in ordinary Drive via `drive.file`. It carries links, groups, shared preferences, notes, the custom background, and selected Countdown audio including its portable playback clip. Aura Start does not add file-level encryption; ordinary Drive sharing/account controls apply. Credentials are not embedded in the sync file or backup exports.

Restore Timeline, running timer state, account credentials, local connection mode, browser permission grants, search state, and onboarding remain local. Receiving a Save open tabs preference from another device does not grant browser access.

Chrome native authorization additionally retains `drive.appdata` for accessible hidden legacy backup migration/deletion. Aura Start's current Device authorization requests only `drive.file` and cannot read those hidden copies with that grant. Aura Start does not request full Drive access or read unrelated visible files.

Visible online pages normally check about every five seconds, and background checks run about once a minute while the browser runs. Polling can be delayed by browser/network conditions. No-change checks do not rewrite the file. Background polling is the purpose of `alarms`.

## Local files and permissions

Full Backup ZIP contains settings, links, notes, restore history, referenced custom backgrounds, and only the selected original custom sound. Settings and links only JSON includes notes/history but omits media bytes. Exported files are not encrypted by Aura Start. Manual import/export and audio conversion work locally; connected installations subsequently synchronize imported shared changes through the normal Drive flow.

Custom audio conversion uses native decoding or packaged WebAssembly, with a 20 MiB input limit and a playback clip of at most 60 seconds. No remote conversion service is contacted. The Countdown alarm needs an Aura Start page to remain open.

Chrome uses `storage`, `identity`, `alarms`, Google API/OAuth hosts, and optional `tabs`. Optional tab capture does not provide ongoing browsing-history collection. There are no content scripts or broad website permissions. Firefox has separate packages without Chrome `identity` and requests optional data-collection categories for user-enabled Google transfer, not analytics.

## Disconnect and delete

Ordinary disconnect clears this installation's connection and keeps the cloud file and local data. It does not revoke other installations or automatically sign the user back in. Revocation across applications remains available in Google Account connections.

Confirmed cloud deletion pauses sync and removes/verifies accessible Aura copies, including matching old and trashed copies, before local disconnection. Inaccessible hidden legacy data is disclosed with cleanup guidance rather than claimed deleted. Failure preserves a paused account for retry. Local links, settings, notes, image, and sound remain intact. Disconnect other installations before deleting cloud data to prevent an older installation from recreating a backup.

Public policy: https://aurastart.pages.dev/privacy-policy.html

Verify the deployed policy matches this release before submission. This documentation update does not publish the site or submit a store package.
