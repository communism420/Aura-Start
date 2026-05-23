# Migrate from A Fine Start

Aura Start is an independent, open-source project and is not affiliated with A Fine Start. Migration support exists so users can move their own grouped links using A Fine Start export codes.

## 1. Why migrate?

Aura Start may be a good fit if you want:

- Free and open-source extension code
- No required account
- Local-first storage by default
- No analytics or tracking
- Full JSON backups
- Multiple export formats
- Optional Google Drive backup through the hidden Drive `appDataFolder`, with automatic backup after connection
- Restore points before destructive changes
- Command Palette, keyboard shortcuts, and Duplicate Finder

## 2. What is preserved?

Group names and links should migrate if the A Fine Start export code is valid and contains supported URL values.

Aura Start also keeps the order provided by the parsed export structure as far as the export code makes that order available.

## 3. What may not be preserved?

Some data may not exist in the A Fine Start-compatible export format. Aura Start can only import what the export code contains.

When exporting back from Aura Start to an A Fine Start-compatible export code, Aura Start writes group names and bookmark `name`/`url` values. Aura Start-specific fields such as descriptions and tags may not be preserved when exporting back to that format if the format does not support them.

Unsupported or unsafe URL schemes are rejected during import rather than saved.

## 4. Export from A Fine Start

1. Open A Fine Start.
2. Go to Settings.
3. Use Export bookmarks.
4. Copy the generated export code.

Check the official A Fine Start UI or listing if these labels change in a future version.

## 5. Import into Aura Start

1. Open Aura Start.
2. Open Settings.
3. Choose Import from A Fine Start.
4. Paste the export code.
5. Review the validation summary or warnings.
6. Choose Merge or Replace.
7. Import.

## 6. Merge vs Replace

Merge adds imported groups to your current Aura Start data and avoids ID conflicts.

Replace replaces current groups and settings with the imported data. Export a Full Backup JSON first if you want an extra copy before replacing data.

## 7. Restore points

Aura Start creates a restore point before import operations. Restore points are local and capped to avoid unbounded storage growth.

Users should still create or export a backup before destructive operations such as replace imports, resets, restore point deletion, or deleting Google Drive backup data.

## 8. Export back to A Fine Start-compatible code

Aura Start can export an A Fine Start-compatible export code from the Export menu.

Use this if you change your mind or want to move a basic grouped-link list elsewhere. The compatibility export contains group names and link names/URLs. Aura Start descriptions and tags are not included when the target format does not support them.

## 9. Troubleshooting

- If Aura Start says the code is not valid JSON, copy the whole export code again from A Fine Start.
- If no bookmarks are imported, check that the export code includes groups and bookmarks.
- If a link is skipped, its URL may use an unsupported or unsafe scheme. Aura Start allows only `http` and `https` links.
- If you chose Replace by mistake, open Restore points and restore the point created before import.
- If you are unsure, export a Full Backup JSON from Aura Start before trying again.

## 10. FAQ

**Is Aura Start affiliated with A Fine Start?**

No. Aura Start is independent and not affiliated with A Fine Start.

**Does Aura Start import every possible A Fine Start setting?**

No. Aura Start imports grouped links from supported export-code shapes. It does not promise to import fields that are not present in the export code.

**Can I use Aura Start without Google Drive?**

Yes. Aura Start is local-first, and Google Drive backup/sync is optional and off by default. After you connect Google Drive, local Aura Start changes are backed up automatically to the hidden app data file.

**Can I keep a normal backup file?**

Yes. Use Full Backup JSON export from Aura Start to keep an independent backup file.

**Can I export back to A Fine Start-compatible format?**

Yes. Aura Start can export an A Fine Start-compatible code, but that compatibility format contains only group names and bookmark names/URLs.
