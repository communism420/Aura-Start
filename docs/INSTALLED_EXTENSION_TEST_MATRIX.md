# Installed Extension Test Matrix

> Maintainer-only document. Run this against the exact ZIP or `dist-google` / `dist-firefox` build planned for store upload.

Use a fresh browser profile when possible, then repeat the existing-user cases with a profile that already has Aura Start data. The final ZIP should match the package version shown in `package.json` and the built `manifest.json`.

| Test | Steps | Expected result | Status | Notes |
| --- | --- | --- | --- | --- |
| Install Chrome unpacked build | Open `chrome://extensions`, enable Developer mode, load `dist-google`. | Aura Start installs without errors. | Manual | Test the same build used for the Chrome ZIP. |
| Install Firefox temporary build | Open `about:debugging#/runtime/this-firefox` and load `dist-firefox/manifest.json`. | Aura Start installs without errors. | Manual | Test the same build used for the Firefox ZIP. |
| Install ZIP contents | Extract the store ZIP to a temp folder and load it unpacked or temporarily. | Extracted package behaves the same as the tested dist folder. | Manual | Confirms ZIP root structure. |
| New tab override | Open a new tab. | Aura Start opens as the browser new tab page. | Manual | Address bar focus may remain browser-controlled. |
| First-run onboarding for new user | Clear extension storage, open new tab. | Onboarding appears only for an empty new profile. | Manual | |
| First-run Restore from Google Drive with existing sync file | On a fresh profile, choose Restore from Google Drive after a Drive sync file already exists for the account. | Aura Start connects, creates a local restore point, restores the Drive data, and marks onboarding complete. | Manual | Requires real OAuth setup and an existing `aura-start-sync.json`. |
| First-run Restore from Google Drive with no sync file | On a fresh profile with no Aura Start Drive file, choose Restore from Google Drive. | A clear no-file message appears and local data is not changed. | Manual | |
| Existing data skips onboarding | Create at least one group/link, reload new tab. | Onboarding does not reopen automatically. | Manual | |
| Empty state | Remove all groups/links after backup. | Empty state appears with create/import/demo actions. | Manual | |
| Demo groups explicit add | Click Add demo groups. | Demo groups appear only after the click. | Manual | |
| Remove demo data safety | Add demo groups, add one user group, remove demo data. | Only tracked demo groups/links are removed. | Manual | |
| Add group | Create a new group. | Group appears and persists after reload. | Manual | |
| Add nested group | Create a child group under an existing parent. | Child group appears under the parent and persists after reload. | Manual | Maximum supported depth is 2 levels. |
| Edit group | Rename a group. | New title persists after reload. | Manual | |
| Delete parent group | Delete a parent group that has children. | Confirmation offers the supported child handling choice; restore point safety appears before removal. | Manual | Confirm child links/groups are handled exactly as selected. |
| Add link | Add a link with title, URL, description, tags. | Link appears and persists after reload. | Manual | |
| Edit link | Edit link fields. | Updated fields persist after reload. | Manual | |
| Delete link | Delete a link. | Link is removed after confirmation/undo flow where available. | Manual | |
| Drag groups | Enable edit mode and reorder groups. | Order persists after reload. | Manual | |
| Drag group into parent | Enable edit mode and drag a group into another group. | The moved group becomes a child where allowed and depth never exceeds 2 levels. | Manual | |
| Drag child group to root | Enable edit mode and drag a child group out to root level. | The group becomes root-level and order persists after reload. | Manual | |
| Drag links | Enable edit mode and move links within/between groups. | Order/location persists after reload. | Manual | |
| Fuzzy search | Search by title, URL, description, and tag, including a typo such as `dashbord`. | Matching links are shown with typo-tolerant fuzzy results, result count, and highlighting where supported; clearing search restores all groups. | Manual | |
| Nested search results | Search for a link inside a child group. | Result appears with enough parent/child group context to locate it. | Manual | |
| Search modifiers | Try `tag:work`, `group:tools`, `url:github`, `title:docs`. | Results match the selected modifier. | Manual | |
| Search quick filters | Use the available search filter controls. | Result count and visible results update without mutating data. | Manual | |
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
| JSON import preserves Drive connection metadata | Connect Google Drive, then import a Full Backup JSON. | Imported data is applied without clearing local Google Drive sync metadata. | Manual | Local changes should continue to auto-sync after import. |
| JSON export | Export Full Backup JSON. | Download contains full Aura Start data. | Manual | |
| HTML bookmarks export | Export Browser Bookmarks HTML. | Download opens as bookmark HTML with folders/links. | Manual | |
| Markdown export | Export Markdown. | Download contains grouped readable links. | Manual | |
| CSV export | Export CSV. | Download opens in a spreadsheet with escaped fields. | Manual | |
| A Fine Start-compatible export | Export A Fine Start code. | Output contains group names and bookmark name/url values. | Manual | Descriptions/tags are not expected in this format. |
| Restore Timeline | Open Restore Timeline. | Existing points are grouped by day, searchable/filterable by action type, and show reason/date/count context. | Manual | |
| Restore current state | Restore a selected point. | Current state is protected first where possible; selected point is restored. | Manual | |
| Delete restore point | Delete one restore point. | Confirmation appears; only selected point is deleted. | Manual | |
| Delete all restore points | Delete all old restore points. | Confirmation appears; current groups/links stay unchanged. | Manual | |
| Duplicate Finder scan | Open Duplicate Finder. | Scan is read-only and does not mutate data. | Manual | |
| Duplicate deletion | Select duplicate links and delete. | Restore point and confirmation are required before deletion. | Manual | |
| Save open tabs disabled | Disable Save open tabs in settings and open Command Palette/header action. | Save open tabs command/action is hidden or disabled according to current UI rules. | Manual | |
| Save open tabs permission prompt | Enable Save open tabs and start preview without existing `tabs` permission. | Browser asks for optional `tabs` permission before Aura Start reads current-window tab titles/URLs. | Manual | |
| Save open tabs preview | Preview current-window tabs with duplicates and unsupported browser pages present. | Preview excludes already-saved duplicate URLs and unsupported pages, shows the number to save, and does not save before confirmation. | Manual | |
| Save open tabs as group | Confirm the preview. | A new group is created with deduplicated links and a restore point is created before saving. | Manual | |
| Background presets | Choose a built-in background, blur, dim, and position. | Background renders clearly, text remains readable, settings persist after reload. | Manual | |
| Custom local background | Upload a local image as background. | Image is stored locally, can be removed, and does not leave the browser profile. | Manual | |
| Widgets toggle | Enable/disable clock, Markdown notes, and Pomodoro. | Widgets appear/disappear without changing link data and settings persist after reload. | Manual | |
| Markdown notes widget | Edit notes content. | Markdown preview/content persists locally and export/import handles it where supported. | Manual | |
| Pomodoro widget | Start, pause, reset, and change mode if available. | Timer updates without affecting drag/search performance. | Manual | |
| Undo toast | Delete a link/group where undo is available. | Toast appears and undo restores expected data. | Manual | |
| Reset all data | Trigger reset after backup. | Safety flow/restore point is used before clearing data. | Manual | |
| Corrupted storage recovery | If feasible, inject invalid storage data. | Recovery screen appears and does not overwrite silently. | Manual | |
| Google Drive connect in Chrome | Connect Google Drive with release Chrome Extension OAuth client. | Google consent uses only Drive app data scope. | Manual | Requires real OAuth setup. |
| Google Drive connect in Firefox/fallback | Connect Google Drive with configured Device OAuth fallback. | Device flow uses `drive.file` only for Aura Start's own sync file. | Manual | Requires real OAuth setup. |
| Google Drive sync | Sync after local changes. | `aura-start-sync.json` is updated in appDataFolder or Aura Start-owned fallback file, depending on browser flow. | Manual | |
| Automatic Google Drive backup after edit | With Drive connected, add/edit/delete a group or link. | Local change persists and Aura Start updates the hidden Drive sync file automatically. | Manual | There is no separate Sync now button in the current UI. |
| No manual sync button | Open Google Drive Sync settings after connection. | Settings show status and disconnect/delete action; no redundant Sync now button is shown. | Manual | |
| Google Drive conflict | If feasible, create local/cloud divergence. | Conflict UI offers a deliberate choice. | Manual | |
| Delete Drive backup and disconnect | Use delete backup/disconnect action. | Hidden appDataFolder file is deleted where authorized; local data remains. | Manual | |
| Privacy Promise | Open Settings privacy section. | Claims match manifest/source: no analytics, tracking, backend, broad browser permissions, and optional-only tabs access. | Manual | |
| Console health | Use normal flows with DevTools open. | No unexpected console errors during normal use. | Manual | |
| Final ZIP version match | Compare tested ZIP, `package.json`, and `dist/manifest.json`. | Versions match exactly. | Manual | |
