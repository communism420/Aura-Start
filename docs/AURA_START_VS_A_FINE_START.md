# Aura Start vs A Fine Start

## Summary

Aura Start is an independent, open-source, local-first start page inspired by simple grouped links and focused on data ownership, export, privacy, and migration.

Aura Start is not affiliated with A Fine Start. This document only makes claims about Aura Start behavior documented in this repository and about A Fine Start details that were noted in the local competitive audit. A Fine Start is an established published product; check its official listing and current documentation before making purchase or migration decisions.

## When Aura Start is a better fit

- You want open-source
- You want local-first storage
- You want no required account
- You want export formats
- You want A Fine Start migration
- You want optional Google Drive appDataFolder backup with automatic backup after connection

## Feature comparison

| Area | Aura Start | A Fine Start |
| --- | --- | --- |
| Project relationship | Independent open-source project, not affiliated with A Fine Start | Separate product; check official listing |
| Source availability | Open-source under the MIT License | Not verified here |
| Published maturity | Chrome Web Store release materials exist in this repository; verify the current live listing before sharing a store link | Already published and has an existing audience according to the audit; verify current listing |
| Browser/web footprint | Chromium new tab extension | Public A Fine Start pages indicate broader browser/web availability; verify current support |
| Account requirement | No account required for local use | Depends on current version; check official listing |
| Default storage | Local extension storage through `chrome.storage.local` | Not claimed by Aura Start docs |
| Analytics/tracking | No analytics or tracking in Aura Start docs and source | Not verified here |
| Link organization | User-created groups of links | Depends on current version |
| Search | Search across title, URL, description, tags, and supported query modifiers | Check official listing |
| Drag and drop | Groups and links can be reordered in edit mode | Check official listing |
| Quick add current page | Not implemented; Aura Start avoids tabs/bookmarks permissions today | Public docs noted in the audit describe a quick-add/current-page workflow; verify current behavior |
| Full Aura backup | Full Backup JSON export/import | Not verified here |
| Export formats | JSON, Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible export code | A Fine Start has import/export tools; exact current formats should be verified |
| A Fine Start migration | Imports A Fine Start export codes | Native format behavior depends on current version |
| Restore points | Local Restore Points Manager, up to 20 local snapshots, and safety points before destructive operations | Public help checked in the audit documents restore points, including a broader every-change story and higher cap; verify current documentation |
| Power-user tools | Command Palette, visible palette button, layout-aware shortcuts where implemented, and read-only Duplicate Finder scan | A Fine Start documents a search pane shortcut; broader command palette/duplicate tooling was not verified |
| Optional cloud backup | Google Drive `appDataFolder` sync file, off by default, with automatic backup after connection and first-run restore if a sync file exists | Not claimed by Aura Start docs |
| Browser permissions | `storage`, `identity`, Google API host permission for optional Drive sync | Check official listing |

## Where A Fine Start may be stronger today

- A Fine Start is already published and has existing market proof; Aura Start's live Chrome Web Store status should be verified before using a store link in public materials.
- Public pages checked in the audit indicate a broader browser/web footprint for A Fine Start. Aura Start intentionally remains Chromium-only for now.
- Public A Fine Start docs/listing describe a quick-add/current-page workflow. Aura Start does not implement this today because doing so safely may require permissions that Aura Start currently avoids.
- A Fine Start publicly documents restore points with a broader every-bookmark-change story. Aura Start focuses restore points on destructive actions, keeps a visible manager, and recommends Full Backup JSON for long-term backups.

## Migration guide

1. Open A Fine Start.
2. Go to Settings.
3. Export bookmarks and copy the export code.
4. Open Aura Start.
5. Open Settings, then choose Import from A Fine Start.
6. Paste the export code.
7. Review the preview.
8. Choose Merge or Replace.
9. Confirm the import.

Aura Start validates imported URLs before saving them. Unsupported or unsafe URL schemes are rejected instead of being stored.

## Data ownership

Aura Start is export-first. The primary data lives in local extension storage by default, and users can export a full JSON backup at any time. Manual JSON export/import works independently of optional Google Drive sync.

Optional Google Drive sync uses a hidden `aura-start-sync.json` file in the user's Google Drive `appDataFolder`. After connection, local changes are backed up automatically. Aura Start does not request full Google Drive access and does not create visible Drive files.

When exporting back to an A Fine Start-compatible export code, Aura Start writes the compatibility fields supported by that format: group names and bookmark `name`/`url` values. Aura Start-specific fields such as descriptions and tags are not included in that compatibility export when the target format does not support them.

## Notes

Aura Start is independent and not affiliated with A Fine Start. A Fine Start is mentioned only for inspiration, migration, and compatibility context.
