# Reviewer Notes

Aura Start is a single-purpose Chromium new tab extension for organizing user-created groups of links.

## Permissions

- `storage`: saves user-created groups, links, settings, sync metadata, and restore points in local extension storage.
- `identity`: used only when the user explicitly connects optional Google Drive sync through Chrome's OAuth flow.
- `https://www.googleapis.com/*`: used only for optional Google Drive API calls after the user enables sync.
- `https://www.googleapis.com/auth/drive.appdata`: lets Aura Start read and write only its own hidden Google Drive app data file.

## Google Drive Sync

Google Drive sync is optional and user-initiated. It is off by default. When enabled, Aura Start stores one hidden file named `aura-start-sync.json` in Google Drive `appDataFolder`.

Aura Start does not request full Google Drive access, does not read visible Drive files, and does not scan normal Drive folders.

## Privacy And Code

Aura Start has:

- no analytics
- no tracking
- no ads
- no backend
- no content scripts
- no remote hosted code
- no bookmarks permission
- no history permission
- no tabs permission
- no cookies permission
- no webRequest permission
- no scripting permission
- no `<all_urls>` permission

## A Fine Start Compatibility

Aura Start can import A Fine Start export codes and export an A Fine Start-compatible code for migration. Aura Start is independent and not affiliated with A Fine Start.
