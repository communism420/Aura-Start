# Aura Start Privacy Policy

Effective date: May 15, 2026

Aura Start is a local-first Chromium extension. It replaces the new tab page with user-created groups of links and keeps those groups under the user's control. Aura Start works without an account, and Google Drive backup is an optional manual file workflow.

## Data Aura Start Handles

Aura Start handles only the data needed for its new tab and backup features:

- Link groups created by the user
- Link titles, URLs, optional descriptions, optional tags, and ordering
- Extension settings such as theme, language, columns, compact mode, search visibility, and link-opening behavior
- Local restore points created before imports, resets, and destructive actions
- Backup files or A Fine Start export codes selected or pasted by the user for import

Aura Start does not request browser history, browser bookmarks, tabs, cookies, web requests, scripting, Google account access, or Google Drive API access.

## Local Storage

Aura Start stores its primary data in `chrome.storage.local` inside the user's browser profile. In development mode only, when `chrome.storage.local` is unavailable, it can use browser `localStorage` as a local fallback.

Local storage remains the default. Manual JSON export/import continues to work independently of Google Drive.

## Optional Google Drive Backup

Aura Start does not connect to Google Drive directly, does not use Google Drive API, and does not request OAuth scopes. If the user wants to keep an Aura Start backup in Google Drive, Aura Start creates a local Full Backup JSON file and the user can upload or move that file to Google Drive manually.

Aura Start does not track, scan, read, edit, delete, or list files in Google Drive. It cannot see whether the user uploads a backup file to Google Drive, changes it, or deletes it. Google Drive backup is not required for using Aura Start.

Users can:

- Use Aura Start fully locally
- Export a Full Backup JSON file
- Upload or move that file to Google Drive manually
- Import a backup file selected by the user
- Ignore Google Drive entirely

Before replacing local data through import, Aura Start creates a local restore point.

## Network, Accounts, Analytics, And Tracking

Aura Start does not require an account for normal use. It does not include analytics, trackers, ads, affiliate replacement, telemetry, behavioral profiling, or hidden data collection.

Aura Start does not make network requests for core functionality or backup/export/import. Export files are created locally in the browser with Blob downloads. Import files are read locally by the browser and validated before they change local extension storage. The settings screen may include a normal link to open Google Drive in a browser tab; that navigation is user-initiated and does not give Aura Start access to Google Drive.

## User Control

Users can create, edit, delete, export, import, reset, and restore their own data inside the extension. Full Backup JSON export is provided so users can keep independent backups of their data outside any cloud service.

## Open Source

Aura Start is fully open-source under the MIT License. The source code, build scripts, validation scripts, and documentation can be inspected, built, forked, and modified under that license. There is no proprietary server component or closed service required for the extension to work.

## Chrome Web Store Limited Use Statement

The use of information received from Chrome APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. Aura Start uses Chrome extension storage only to provide its single user-facing purpose: a private, exportable, user-controlled new tab start page with optional manual backup files.

Aura Start does not sell user data and does not use user data for advertising.

## Security

Aura Start bundles its extension code with the extension package and does not execute remotely hosted code. Users should protect their operating system account, browser profile, Google account, and exported backup files.

## Contact

For privacy or security questions, use the support contact listed on the Chrome Web Store listing or the project repository.
