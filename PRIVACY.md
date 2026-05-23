# Aura Start Privacy Policy

Effective date: May 17, 2026

Aura Start is a local-first Chromium extension. It replaces the new tab page with user-created groups of links and keeps those groups under the user's control. Aura Start works without an account, and Google Drive sync is optional and off by default.

## Data Aura Start Handles

Aura Start handles only the data needed for its new tab and backup features:

- Link groups created by the user
- Link titles, URLs, optional descriptions, optional tags, and ordering
- Extension settings such as theme, language, columns, compact mode, search visibility, link-opening behavior, and optional sync mode
- Local restore points created before imports, resets, cloud restores, and destructive actions
- Backup files or A Fine Start export codes selected or pasted by the user for import
- Optional Google Drive sync metadata, such as connection status, last sync time, and a locally generated device ID

Aura Start does not request browser history, browser bookmarks, tabs, cookies, web requests, scripting, or full Google Drive access.

## Local Storage

Aura Start stores its primary data in `chrome.storage.local` inside the user's browser profile. In development mode only, when `chrome.storage.local` is unavailable, it can use browser `localStorage` as a local fallback.

Local storage remains the default. Manual JSON export/import continues to work independently of Google Drive.

## Optional Google Drive Sync

If the user explicitly connects Google Drive sync, Aura Start uses Google OAuth through Chromium extension identity APIs and requests only this scope:

`https://www.googleapis.com/auth/drive.appdata`

This scope allows Aura Start to store and read its own hidden application data file in Google Drive `appDataFolder`. Aura Start stores a single sync file named `aura-start-sync.json` in that hidden app data area. Google authorization is used only for this sync file and is not used for analytics, telemetry, tracking, advertising, account profiling, or reading the user's normal Drive contents.

Aura Start does not request `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/drive.file`, or `identity.email`. It does not read, scan, list, edit, delete, or create normal visible files in the user's Google Drive. It does not create a visible backup folder or visible backup JSON file in Drive.

When Google Drive sync is enabled, the user's Aura Start data may be transmitted to Google Drive API and stored in the user's Google Drive app data. This includes groups, links, settings, and restore points. The data is not sent to an Aura Start server because Aura Start does not operate a backend service.

Users can:

- Keep sync off and use Aura Start fully locally
- Restore an existing Google Drive sync file automatically when connecting sync
- Restore an existing Google Drive sync file from first-run onboarding when the user chooses that action
- Create a Google Drive sync file automatically when none exists
- Back up local changes to Google Drive automatically after connecting sync
- Delete the hidden Google Drive sync file and disconnect the Google account through one confirmed action

Deleting the Google Drive sync file and disconnecting the Google account does not delete local Aura Start data. The action is shown in a confirmation dialog before it runs. Removing the extension may not remove the hidden Google Drive app data file automatically, so Aura Start provides this explicit delete-and-disconnect action.

Users can turn cloud sync off at any time by deleting the Google Drive backup and disconnecting the Google account. This does not remove local groups, links, settings, exports, imports, or restore points.

Before replacing local data with a Google Drive restore during connection or onboarding, Aura Start creates a local restore point.

## Account Marker

When Google Drive sync is enabled and connected, Aura Start may show a compact Google Drive status marker in the top-right header. The marker is used only to show sync status, last sync time, and connected account information if Chrome exposes it through existing extension APIs. Aura Start does not request additional Google permissions only to display an avatar or email address.

## Network, Accounts, Analytics, And Tracking

Aura Start does not require an account for normal use. It does not include analytics, trackers, ads, affiliate replacement, telemetry, behavioral profiling, or hidden data collection.

Network access is used only for optional Google Drive sync after the user connects it. Google Drive sync contains no telemetry; network calls go only to Google OAuth and Google Drive API endpoints for user-requested connection, automatic sync, automatic connection-time restore/create, delete, or disconnect actions. Aura Start does not make background tracking calls and does not send data to an Aura Start server. Export files are created locally in the browser with Blob downloads. Import files are read locally by the browser and validated before they change local extension storage.

## User Control

Users can create, edit, delete, export, import, reset, sync, and restore their own data inside the extension. Full Backup JSON export is provided so users can keep independent backups of their data outside any cloud service.

## Open Source

Aura Start is fully open-source under the MIT License. The source code, build scripts, validation scripts, and documentation can be inspected, built, forked, and modified under that license. There is no proprietary server component or closed service required for the extension to work.

## Chrome Web Store Limited Use Statement

The use of information received from Chrome APIs and Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. Aura Start uses Chrome extension storage and the optional Google Drive app data scope only to provide its single user-facing purpose: a private, exportable, user-controlled new tab start page with optional backup/sync.

Aura Start does not sell user data and does not use user data for advertising.

## Security

Aura Start bundles its extension code with the extension package and does not execute remotely hosted code. Users should protect their operating system account, browser profile, Google account, and exported backup files.

## Contact

For privacy or security questions, use the project repository where Aura Start is published.
