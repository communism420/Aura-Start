# Migrate from A Fine Start

Aura Start is an independent, open-source project and is not affiliated with A Fine Start. Migration support exists so users can move their own grouped links using A Fine Start export codes.

This guide describes Aura Start 2.1.1. For installation, Firefox homepage controls, and the current interface, see [Getting Started](getting-started.html).

## 1. Why migrate?

Aura Start may be a good fit if you want:

- Free and open-source extension code
- No required account
- Local-first storage by default
- No analytics or tracking
- Full ZIP backups with settings, links, notes, history, referenced backgrounds, and the selected original Countdown sound
- Multiple export formats
- Optional Google Drive sync using one shared, visible `aura-start-sync.json` across Chrome, Firefox, and compatible Chromium browsers
- Restore Timeline before destructive changes
- Nested groups, fuzzy search, backgrounds, clock/Markdown notes/Pomodoro/Countdown widgets, Command Palette, keyboard shortcuts, and Duplicate Finder

## 2. What is preserved?

Group names and links should migrate if the A Fine Start export code is valid and contains supported URL values.

Aura Start reads groups in column order and keeps the links in each group in their exported order. Groups arrive at the top level; you can organize them into nested groups afterward. The original column layout is not an imported preference.

## 3. What may not be preserved?

Some data may not exist in the A Fine Start-compatible export format. Aura Start can only import what the export code contains.

When exporting back from Aura Start to an A Fine Start-compatible export code, Aura Start writes group names and bookmark `name`/`url` values. Nested groups become separate groups named with their parent path. Descriptions, tags, notes, settings, and media are not included. Use [Full Backup ZIP](export-backup.html) to preserve an Aura Start setup.

Unsupported or unsafe URL schemes are rejected during import rather than saved.

## 4. Export from A Fine Start

1. Open A Fine Start.
2. Go to Settings.
3. Use Export bookmarks.
4. Copy the generated export code.

These steps were checked against the [official A Fine Start help](https://afinestart.me/help/) on 2026-10-04. Check the current UI if labels change.

## 5. Import into Aura Start

1. Open Aura Start.
2. Open Settings.
3. Choose Import from A Fine Start.
4. Paste the export code.
5. Review the validation summary or warnings.
6. Choose Merge or Replace.
7. Import.

## 6. Merge vs Replace

Merge adds imported groups and links to your current Aura Start data, avoids ID conflicts, and keeps your existing preferences and notes. It does not automatically remove repeated URLs; review the preview's duplicate counts and use Duplicate Finder afterward if needed.

Replace replaces current groups and shared settings with the imported data; A Fine Start link exports do not contain Aura preferences or notes, so their defaults apply. The current interface language and local Drive connection are preserved. Export a Full Backup ZIP first if you want an extra copy before replacing data. If connected automatic Drive sync is enabled, the imported changes also synchronize to other installations.

## 7. Restore Timeline

Aura Start creates a restore point before import operations. Restore Timeline shows local snapshots grouped by day with search and action filters. Restore points are local, capped at 20, and included in manual Aura backups; they are not synchronized through Google Drive.

Users should still create or export a backup before destructive operations such as replace imports, resets, restore timeline deletion, or deleting Google Drive backup data.

## 8. Export back to A Fine Start-compatible code

Aura Start can export an A Fine Start-compatible export code from the Export menu.

Use this if you change your mind or want to move a basic grouped-link list elsewhere. The compatibility export contains group names and link names/URLs, with nested groups represented by their parent path in the name. Aura Start descriptions and tags are not included.

## 9. Troubleshooting

- If Aura Start says the code is not valid JSON, copy the whole export code again from A Fine Start.
- If no bookmarks are imported, check that the export code includes groups and bookmarks.
- If a link is skipped, its URL may use an unsupported or unsafe scheme. Aura Start allows only `http` and `https` links.
- If you chose Replace by mistake, open Restore Timeline and restore the point created before import.
- If you are unsure, export a Full Backup ZIP from Aura Start before trying again.

## 10. FAQ

**Is Aura Start affiliated with A Fine Start?**

No. Aura Start is independent and not affiliated with A Fine Start.

**Does Aura Start import every possible A Fine Start setting?**

No. Aura Start imports grouped links from supported export-code shapes. It does not promise to import fields that are not present in the export code.

**Can I use Aura Start without Google Drive?**

Yes. Aura Start is local-first, and Google Drive sync is optional and off by default. After connection, installations share one visible Drive file and merge changes automatically. Visible, online pages normally check about every five seconds; background checks run about once a minute while the browser is running.

**Can I keep a normal backup file?**

Yes. In 2.1.1, Full Backup ZIP contains JSON settings, links, notes, restore history, referenced custom backgrounds, and only the currently selected original Countdown audio file. The built-in alarm and older custom sounds are excluded. Settings and links only JSON includes notes and history but omits media bytes. Both work without Drive. See [Export / Backup](export-backup.html) for import modes and compatibility with older backups.

**Can I export back to A Fine Start-compatible format?**

Yes. Aura Start can export an A Fine Start-compatible code, but that compatibility format contains only group names and bookmark names/URLs.
