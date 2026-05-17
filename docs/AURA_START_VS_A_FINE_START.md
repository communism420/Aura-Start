# Aura Start vs A Fine Start

## Summary

Aura Start is an independent, open-source, local-first start page inspired by simple grouped links and focused on data ownership, export, privacy, and migration.

Aura Start is not affiliated with A Fine Start. This document only makes claims about Aura Start behavior documented in this repository. For A Fine Start, check the official listing and current product documentation.

## When Aura Start is a better fit

- You want open-source
- You want local-first storage
- You want no required account
- You want export formats
- You want A Fine Start migration
- You want optional Google Drive appDataFolder backup

## Feature comparison

| Area | Aura Start | A Fine Start |
| --- | --- | --- |
| Project relationship | Independent open-source project, not affiliated with A Fine Start | Separate product; check official listing |
| Source availability | Open-source under the MIT License | Not verified here |
| Account requirement | No account required for local use | Depends on current version; check official listing |
| Default storage | Local extension storage through `chrome.storage.local` | Not claimed by Aura Start docs |
| Analytics/tracking | No analytics or tracking in Aura Start docs and source | Not verified here |
| Link organization | User-created groups of links | Depends on current version |
| Search | Search across title, URL, description, tags, and supported query modifiers | Check official listing |
| Drag and drop | Groups and links can be reordered in edit mode | Check official listing |
| Full Aura backup | Full Backup JSON export/import | Not verified here |
| Export formats | JSON, Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible export code | Depends on current version |
| A Fine Start migration | Imports A Fine Start export codes | Native format behavior depends on current version |
| Restore points | Local Restore Points Manager and safety points before destructive operations | Not verified here |
| Power-user tools | Command Palette, keyboard shortcuts, and read-only Duplicate Finder scan | Not verified here |
| Optional cloud backup | Google Drive `appDataFolder` sync file, off by default | Not claimed by Aura Start docs |
| Browser permissions | `storage`, `identity`, Google API host permission for optional Drive sync | Check official listing |

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

Optional Google Drive sync uses a hidden `aura-start-sync.json` file in the user's Google Drive `appDataFolder`. Aura Start does not request full Google Drive access and does not create visible Drive files.

When exporting back to an A Fine Start-compatible export code, Aura Start writes the compatibility fields supported by that format: group names and bookmark `name`/`url` values. Aura Start-specific fields such as descriptions and tags are not included in that compatibility export when the target format does not support them.

## Notes

Aura Start is independent and not affiliated with A Fine Start. A Fine Start is mentioned only for inspiration, migration, and compatibility context.
