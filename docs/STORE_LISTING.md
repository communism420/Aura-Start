# Chrome Web Store Listing Draft

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


## Extension Name

Aura Start

## Short Description

A local-first, private, exportable start page for your Chromium new tab.

## Detailed Description

Aura Start replaces the Chromium new tab page with a clean, local-first start page for groups of links.

Create focused groups, add links with optional descriptions and tags, search across your saved links, and keep your start page fast without a required account. Aura Start stores your data locally by default and is designed around export-first data ownership: you can export Full Backup JSON, Browser Bookmarks HTML, Markdown, CSV, or an A Fine Start-compatible export code.

Aura Start supports importing A Fine Start export codes for migration and can export an A Fine Start-compatible code if you want a basic grouped-link format again later. Aura Start is an independent project and is not affiliated with A Fine Start.

For safety, Aura Start includes restore points before destructive actions, a Restore Points Manager, a read-only Duplicate Finder scan with user-confirmed deletion, and clear import preview flows. Power-user features include Command Palette, keyboard shortcuts, improved search, and a focused Settings area for Import, Export / Backup, Privacy Promise, Restore Points, and optional Google Drive sync.

Aura Start has no required account, no analytics, no tracking, no ads, and no backend. Optional Google Drive backup/sync is off by default and uses only the hidden Google Drive `appDataFolder` scope for Aura Start's own `aura-start-sync.json` file. The extension does not request browser bookmarks, history, cookies, tabs, webRequest, scripting, or full Google Drive access.

Aura Start is open-source under the MIT License.

## Feature Bullets

- Organize links into clean groups on every new tab
- Search by title, URL, description, tags, and supported query modifiers
- Import from A Fine Start export codes
- Export JSON, Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible code
- Restore points before destructive actions
- Command Palette and keyboard shortcuts
- Duplicate Finder with read-only scan and user-confirmed deletion
- Optional Google Drive `appDataFolder` backup/sync
- No required account, no analytics, no tracking
- Open-source under the MIT License

## Privacy Disclosure Short Text

Aura Start stores user-created groups, links, settings, and restore points locally by default. It has no backend, no analytics, no tracking, no ads, and no required account. Optional Google Drive sync is user-initiated and uses only the hidden Google Drive `appDataFolder` file for Aura Start backup/sync.

## Permission Justification

- `storage`: saves user-created groups, links, settings, sync metadata, and restore points in local extension storage.
- `identity`: allows the user to explicitly connect optional Google Drive sync through Chrome's OAuth flow.
- `https://www.googleapis.com/*`: used only for optional Google Drive API requests after the user enables sync.
- `https://www.googleapis.com/auth/drive.appdata`: lets Aura Start read and write only its own hidden app data file, not normal visible Drive files.

Aura Start intentionally does not request bookmarks, history, cookies, tabs, webRequest, scripting, `<all_urls>`, full Google Drive access, `drive.file`, or browser-wide host permissions.

## Reviewer Notes

Aura Start is a local-first Chromium new tab extension for user-created groups of links. It uses `chrome.storage.local` for local data and uses `chrome.identity`, `drive.appdata`, and `https://www.googleapis.com/*` only for optional Google Drive sync after user action. The Drive file is `aura-start-sync.json` in Google Drive `appDataFolder`.

The extension has no content scripts, no analytics, no tracking, no backend, no ads, and no remotely hosted code. A Fine Start is mentioned only for migration compatibility; Aura Start is independent and not affiliated with A Fine Start.

## Manual Fields Checklist

- Category: Productivity
- Language: English
- Privacy policy URL: use the GitHub Pages URL for `docs/privacy-policy.html` after Pages publishes
- Screenshots: follow `docs/SCREENSHOTS.md`
- Support URL: GitHub repository issues or repository URL
- Website URL: GitHub Pages landing page or repository URL
- Source code URL: `https://github.com/communism420/Aura-Start`
- Store package: ZIP built from `dist` contents after `npm run build:store`
