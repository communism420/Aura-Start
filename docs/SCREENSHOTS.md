# Aura Start Screenshot Plan

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


This plan prepares Chrome Web Store and GitHub screenshots from the current Aura Start 1.2.0 feature set. It avoids unsupported claims, fake statistics, competitor criticism, and visual use of third-party brands beyond plain text references needed for migration.

Recommended base sizes:

- Chrome Web Store screenshots: 1280 x 800 or 1280 x 720 PNG
- GitHub/social crops: 1600 x 900 PNG
- Use real extension UI only. The final PNGs are captured from the current Aura Start UI with non-personal demo data and should reflect the latest Google Drive sync and shortcut layout changes.
- Final publishable screenshots live in `Photo/`; GitHub Pages copies live in `docs/assets/screenshots/`.
- `docs/screenshot-gallery.html` displays the real captured screenshots. It is not a mockup renderer.

## General Capture Rules

- Use the demo data from `docs/SCREENSHOT_DEMO_DATA.md`.
- Do not show personal bookmarks, email addresses, OAuth tokens, browser profiles, or real Drive files.
- Do not show a fake Chrome Web Store listing URL.
- Mention A Fine Start only on the migration screenshot and only as an import/export compatibility path.
- Keep wording factual: no "best", "#1", "guaranteed", "forever", or aggressive comparisons.
- Verify the screen exists in the current local build before publishing a screenshot as product UI.

## 1. Main New Tab

- Goal: show the core value: clean grouped links on the Chromium new tab page.
- Screen: real extension new tab page with demo groups.
- Demo data: Work, Development, Design, Research, Reading, Tools.
- Overlay text: "Clean groups of links on every new tab"
- Theme recommendation: light theme for the main store screenshot.
- What not to show: browser bookmarks bar, private user links, debug panels, or unpublished store links.
- Manual verification: confirm groups open, links are visible, drag handles/edit controls are not distracting unless edit mode is intentionally shown.
- Chrome Web Store-safe wording: "Clean groups of links" is factual and matches the product.
- Recommended size: 1280 x 800.
- Capture source: real extension UI.
- Trust message: Aura Start is organized, calm, and useful immediately.

## 2. Import from A Fine Start

- Goal: show a clear migration path without implying affiliation.
- Screen: Settings / Import / Import from A Fine Start flow with preview.
- Demo data: a small valid A Fine Start-compatible export code with 3-4 groups.
- Overlay text: "Import from A Fine Start in seconds"
- Theme recommendation: light theme.
- What not to show: A Fine Start UI, A Fine Start logos, or claims that Aura Start includes every A Fine Start feature.
- Manual verification: confirm preview counts appear, Merge/Replace choices are visible, and invalid data does not apply changes.
- Chrome Web Store-safe wording: include a small note if space allows: "Independent project, not affiliated with A Fine Start."
- Recommended size: 1280 x 800.
- Capture source: real extension UI.
- Trust message: users can migrate their own export code in a controlled way.

## 3. Export / Backup

- Goal: make data ownership obvious.
- Screen: Export / Backup area in Settings.
- Demo data: populated demo groups so all export formats are meaningful.
- Overlay text: "Export anytime: JSON, HTML, Markdown, CSV"
- Theme recommendation: light or system theme.
- What not to show: local filesystem paths, user downloads folder, or fake cloud upload.
- Manual verification: confirm Full Backup JSON, Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible export are visible where supported.
- Chrome Web Store-safe wording: export is local browser-generated backup/export, not a hosted service.
- Recommended size: 1280 x 800.
- Capture source: real extension UI.
- Trust message: users are not locked in.

## 4. Restore Points

- Goal: show protection around destructive operations.
- Screen: Settings / Restore Points manager.
- Demo data: several restore points with readable reasons and counts.
- Overlay text: "Restore points before destructive changes"
- Theme recommendation: dark theme can work well if contrast is checked.
- What not to show: stack traces, raw storage JSON, or corrupted data unless documenting support.
- Manual verification: confirm Restore, Export restore point, Delete restore point, and Delete old restore points are visible if included in the UI.
- Chrome Web Store-safe wording: restore points are local safety snapshots, not a guarantee against every browser/profile failure.
- Recommended size: 1280 x 800.
- Capture source: real extension UI.
- Trust message: replace, restore, reset, and duplicate deletion are guarded.

## 5. Privacy Promise

- Goal: build trust with concrete privacy claims.
- Screen: Settings / Privacy Promise.
- Demo data: not required.
- Overlay text: "No account. No analytics. No tracking."
- Theme recommendation: light theme with high readability.
- What not to show: unsupported privacy claims, full Google Drive access, or unrelated browser permissions.
- Manual verification: confirm wording matches `PRIVACY.md`, `docs/privacy-policy.html`, and manifest permissions.
- Chrome Web Store-safe wording: "No account. No analytics. No tracking." matches the local-first implementation and docs.
- Recommended size: 1280 x 800.
- Capture source: real extension UI.
- Trust message: Aura Start has no backend and does not monetize user data.

## 6. Command Palette

- Goal: show power-user navigation.
- Screen: Command Palette opened from the UI or with Ctrl+K/Cmd+K when the browser has assigned the shortcut.
- Demo data: populated groups so commands feel useful.
- Overlay text: "Press Ctrl+K and move faster"
- Theme recommendation: dark theme for contrast around the palette.
- What not to show: disabled or fake commands.
- Manual verification: confirm Enter runs selected command, arrows move selection, and Esc closes the palette.
- Chrome Web Store-safe wording: "move faster" is a workflow claim, not a performance guarantee.
- Recommended size: 1280 x 800.
- Capture source: real extension UI.
- Trust message: Aura Start is efficient without adding tracking or heavy services.

## 7. Duplicate Finder

- Goal: show cleanup with user control.
- Screen: Settings / Tools / Duplicate Finder.
- Demo data: include exact duplicates and possible http/https variants.
- Overlay text: "Find duplicate links before they become a mess"
- Theme recommendation: light theme.
- What not to show: auto-selected mass deletion, destructive action without confirmation, or all copies selected.
- Manual verification: confirm scan is read-only, exact/possible duplicates are separated, and deletion requires selection, restore point, and confirmation.
- Chrome Web Store-safe wording: "Find duplicate links" is accurate; do not claim automatic cleanup.
- Recommended size: 1280 x 800.
- Capture source: real extension UI.
- Trust message: cleanup is visible, reversible where supported, and never automatic.

## 8. Optional Google Drive Backup

- Goal: explain optional backup without implying required account or full Drive access.
- Screen: Settings / Google Drive sync.
- Demo data: local groups populated; sync disconnected or connected with non-personal account details hidden.
- Overlay text: "Optional backup through Google Drive appDataFolder"
- Theme recommendation: light theme.
- What not to show: real Google account email, OAuth client IDs, tokens, visible Drive files, or a fake success state.
- Manual verification: confirm Google Drive sync is optional/off by default, Drive access is limited to `drive.appdata`, local changes auto-sync after connection, and no redundant Sync now button is shown.
- Chrome Web Store-safe wording: "Optional backup" and "appDataFolder" match the implemented permission model.
- Recommended size: 1280 x 800.
- Capture source: real extension UI. Hide account data if a connected account is used.
- Trust message: cloud backup is opt-in and least-privilege.

## Publishing Checklist

- Screenshots match the current local build.
- No private data appears.
- No competitor logo or UI appears.
- No unsupported claims appear.
- Privacy claims match `PRIVACY.md`, `docs/privacy-policy.html`, and manifest permissions.
- The Chrome Web Store listing uses the same terminology as `docs/STORE_LISTING.md`.
