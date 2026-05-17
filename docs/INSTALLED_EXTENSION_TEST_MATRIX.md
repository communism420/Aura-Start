# Installed Extension Test Matrix

> Maintainer-only document. Run this against the exact ZIP or `dist` build planned for Chrome Web Store upload.

Use a fresh Chromium profile when possible, then repeat the existing-user cases with a profile that already has Aura Start data. The final ZIP should match the package version shown in `package.json` and `dist/manifest.json`.

| Test | Steps | Expected result | Status | Notes |
| --- | --- | --- | --- | --- |
| Install unpacked build | Open `chrome://extensions`, enable Developer mode, load `dist`. | Aura Start installs without errors. | Manual | Test the same `dist` used for the ZIP. |
| Install ZIP contents | Extract the Chrome Submit ZIP to a temp folder and load it unpacked. | Extracted package behaves the same as `dist`. | Manual | Confirms ZIP root structure. |
| New tab override | Open a new tab. | Aura Start opens as the Chromium new tab page. | Manual | Address bar focus may remain browser-controlled. |
| First-run onboarding for new user | Clear extension storage, open new tab. | Onboarding appears only for an empty new profile. | Manual | |
| Existing data skips onboarding | Create at least one group/link, reload new tab. | Onboarding does not reopen automatically. | Manual | |
| Empty state | Remove all groups/links after backup. | Empty state appears with create/import/demo actions. | Manual | |
| Demo groups explicit add | Click Add demo groups. | Demo groups appear only after the click. | Manual | |
| Remove demo data safety | Add demo groups, add one user group, remove demo data. | Only tracked demo groups/links are removed. | Manual | |
| Add group | Create a new group. | Group appears and persists after reload. | Manual | |
| Edit group | Rename a group. | New title persists after reload. | Manual | |
| Delete group | Delete a group. | Confirmation/restore point safety appears; group is removed only after confirmation. | Manual | |
| Add link | Add a link with title, URL, description, tags. | Link appears and persists after reload. | Manual | |
| Edit link | Edit link fields. | Updated fields persist after reload. | Manual | |
| Delete link | Delete a link. | Link is removed after confirmation/undo flow where available. | Manual | |
| Drag groups | Enable edit mode and reorder groups. | Order persists after reload. | Manual | |
| Drag links | Enable edit mode and move links within/between groups. | Order/location persists after reload. | Manual | |
| Search | Search by title, URL, description, and tag. | Matching links are shown; clearing search restores all groups. | Manual | |
| Search modifiers | Try `tag:work`, `group:tools`, `url:github`, `title:docs`. | Results match the selected modifier. | Manual | |
| Search keyboard navigation | Use ArrowUp/ArrowDown and Enter in search results. | Selection moves predictably; Enter opens selected link. | Manual | |
| Command Palette from UI | Open Command Palette from the visible UI entry point. | Palette opens without relying on browser shortcut assignment. | Manual | |
| Command Palette shortcut | Press Ctrl+K or Cmd+K. | Palette toggles when the browser has assigned the command to Aura Start. | Manual | If not, check `chrome://extensions/shortcuts`. |
| Chrome shortcuts page | Open `chrome://extensions/shortcuts`. | Aura Start command is visible and can be assigned if browser allows it. | Manual | |
| Latin keyboard shortcuts | Test `/`, `E`, `N`, `G`, Esc, Enter on a Latin layout. | Shortcuts work outside form fields. | Manual | |
| Cyrillic keyboard shortcuts | Test physical `/`, `E`, `N`, `G` keys on a Cyrillic layout. | Shortcuts work through physical key codes where implemented. | Manual | |
| Shortcut form safety | Press shortcuts inside input, textarea, select, and modal fields. | Shortcuts do not hijack normal typing/forms. | Manual | |
| Import from A Fine Start | Paste a valid A Fine Start export code. | Preview shows group/link counts and import succeeds. | Manual | |
| Import Replace confirmation | Choose Replace and import valid data. | Explicit confirmation appears before data replacement. | Manual | |
| Import Merge | Choose Merge and import valid data. | Imported groups are appended without replacing existing data. | Manual | |
| Invalid import safety | Paste invalid JSON/export code. | No local data changes; user sees a clear error. | Manual | |
| JSON import | Import Full Backup JSON. | Data validates and imports according to selected mode. | Manual | |
| JSON export | Export Full Backup JSON. | Download contains full Aura Start data. | Manual | |
| HTML bookmarks export | Export Browser Bookmarks HTML. | Download opens as bookmark HTML with folders/links. | Manual | |
| Markdown export | Export Markdown. | Download contains grouped readable links. | Manual | |
| CSV export | Export CSV. | Download opens in a spreadsheet with escaped fields. | Manual | |
| A Fine Start-compatible export | Export A Fine Start code. | Output contains group names and bookmark name/url values. | Manual | Descriptions/tags are not expected in this format. |
| Restore Points Manager | Open Restore Points. | Existing points show reason, date, groups count, links count, and actions. | Manual | |
| Restore current state | Restore a selected point. | Current state is protected first where possible; selected point is restored. | Manual | |
| Delete restore point | Delete one restore point. | Confirmation appears; only selected point is deleted. | Manual | |
| Delete all restore points | Delete all old restore points. | Confirmation appears; current groups/links stay unchanged. | Manual | |
| Duplicate Finder scan | Open Duplicate Finder. | Scan is read-only and does not mutate data. | Manual | |
| Duplicate deletion | Select duplicate links and delete. | Restore point and confirmation are required before deletion. | Manual | |
| Undo toast | Delete a link/group where undo is available. | Toast appears and undo restores expected data. | Manual | |
| Reset all data | Trigger reset after backup. | Safety flow/restore point is used before clearing data. | Manual | |
| Corrupted storage recovery | If feasible, inject invalid storage data. | Recovery screen appears and does not overwrite silently. | Manual | |
| Google Drive connect | Connect Google Drive with release OAuth client. | Google consent uses only Drive app data scope. | Manual | Requires real OAuth setup. |
| Google Drive sync | Sync after local changes. | `aura-start-sync.json` is updated in appDataFolder. | Manual | |
| Google Drive conflict | If feasible, create local/cloud divergence. | Conflict UI offers a deliberate choice. | Manual | |
| Delete Drive backup and disconnect | Use delete backup/disconnect action. | Hidden appDataFolder file is deleted where authorized; local data remains. | Manual | |
| Privacy Promise | Open Settings privacy section. | Claims match manifest/source: no analytics, tracking, backend, broad browser permissions. | Manual | |
| Console health | Use normal flows with DevTools open. | No unexpected console errors during normal use. | Manual | |
| Final ZIP version match | Compare tested ZIP, `package.json`, and `dist/manifest.json`. | Versions match exactly. | Manual | |
