# Aura Start Privacy Policy

Effective date: May 10, 2026

Aura Start is a local-first Chromium extension. It replaces the new tab page with user-created groups of links and keeps those groups under the user's control.

## Data Aura Start Handles

Aura Start handles only the data needed for its single purpose:

- Link groups created by the user
- Link titles, URLs, optional descriptions, optional tags, and ordering
- Extension settings such as theme, language, columns, compact mode, and link-opening behavior
- Local restore points created before imports, resets, and destructive actions
- Backup files or A Fine Start export codes selected or pasted by the user for import

Aura Start does not request browser history, bookmarks, tabs, cookies, web requests, identity, scripting, or host permissions.

## Local Storage

Aura Start stores its data in `chrome.storage.local` inside the user's browser profile. In development mode only, when `chrome.storage.local` is unavailable, it can use browser `localStorage` as a local fallback.

Aura Start does not operate a server-side database. Aura Start does not upload, sync, sell, rent, share, or transmit the user's groups, links, imports, exports, settings, or restore points.

## Network, Accounts, Analytics, And Tracking

Aura Start does not require an account. It does not include analytics, trackers, ads, affiliate replacement, telemetry, or remote APIs for its core functionality. Export files are created locally in the browser with Blob downloads.

## User Control

Users can create, edit, delete, export, import, reset, and restore their own data inside the extension. Full Backup JSON export is provided so users can keep independent backups of their data.

## Open Source

Aura Start is fully open-source under the MIT License. The source code, build scripts, validation scripts, and documentation can be inspected, built, forked, and modified under that license. There is no proprietary server component or closed service required for the extension to work.

## Chrome Web Store Limited Use Statement

The use of information received from Chrome APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. Aura Start uses Chrome extension storage only to provide and improve its single user-facing purpose: a local, private, exportable new tab start page.

## Security

Aura Start bundles its extension code with the extension package and does not execute remotely hosted code. Local data remains in the user's browser profile. Users should protect their operating system account and browser profile, and should store exported backup files securely.

## Contact

For privacy or security questions, use the support contact listed on the Chrome Web Store listing or the project repository.
