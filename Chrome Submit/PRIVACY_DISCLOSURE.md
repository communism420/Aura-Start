# Chrome Web Store Privacy Disclosure

Aura Start handles user-created start page data:

- group names
- link titles
- URLs
- optional descriptions
- optional tags
- ordering
- settings
- restore points
- backup/import files selected by the user
- optional Google Drive sync metadata when sync is enabled

Data is stored locally by default in extension storage. Aura Start has no backend and does not collect, sell, share, or use user data for ads, analytics, tracking, profiling, or unrelated purposes.

Optional Google Drive sync is off by default and starts only after user action. It uses Chrome identity/OAuth and only the Google Drive `drive.appdata` scope. The sync file is `aura-start-sync.json` in the hidden Google Drive `appDataFolder`. After connection, local changes are backed up automatically to that hidden file. Aura Start does not request full Drive access and does not read visible Drive files.

On first run, users can choose to restore an existing Aura Start sync file from Google Drive. If no sync file exists, Aura Start reports that and does not overwrite local data.

Use this privacy policy URL after GitHub Pages is published:

`https://communism420.github.io/Aura-Start/privacy-policy.html`

If GitHub Pages is not published yet, publish it before submitting the Chrome Web Store item.
