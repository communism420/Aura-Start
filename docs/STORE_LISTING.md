# Chrome Web Store Listing Draft

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


## Extension Name

Aura Start

## Short Description

A private, local-first, customizable start page for your browser new tab.

## Detailed Description

Aura Start replaces the browser new tab page with a clean, local-first start page for groups of links.

Create nested groups, add links with optional descriptions and tags, search across your saved links with fuzzy matching, and keep your start page fast without a required account. Aura Start stores your data locally by default and is designed around export-first data ownership: you can export Full Backup JSON, Browser Bookmarks HTML, Markdown, CSV, or an A Fine Start-compatible export code.

Aura Start supports importing A Fine Start export codes for migration and can export an A Fine Start-compatible code if you want a basic grouped-link format again later. Aura Start is an independent project and is not affiliated with A Fine Start.

For safety, Aura Start includes restore points before destructive actions, a searchable Restore Timeline, a read-only Duplicate Finder scan with user-confirmed deletion, and clear import preview flows. Power-user features include Command Palette with fuzzy command search, browser-assigned keyboard shortcuts, layout-aware Latin/Cyrillic shortcut handling, optional Save open tabs with runtime tabs permission, background images, local Markdown notes, a header clock, and a Pomodoro timer.

Aura Start has no required account, no analytics, no tracking, no ads, and no backend. Optional Google Drive backup/sync is off by default. Google Chrome uses the hidden Google Drive `appDataFolder` scope for Aura Start's own `aura-start-sync.json` file; Firefox and compatible Chromium fallback builds can use Google Device OAuth with `drive.file` only for an Aura Start-owned sync file marked with Aura Start app properties. After connection, local changes sync automatically; onboarding can restore an existing sync file when the user chooses that path, and delete/disconnect is a confirmed action. The extension does not request browser bookmarks, history, cookies, webRequest, scripting, or full Google Drive access. The `tabs` permission is optional and requested only when the user previews current-window tabs for Save open tabs.

Aura Start is open-source under the MIT License.

## Feature Bullets

- Organize links into clean nested groups on every new tab
- Search by title, URL, description, tags, supported query modifiers, and fuzzy matches
- Customize the start page with built-in or local background images
- Optional widgets: clock, Markdown notes, and Pomodoro timer
- Optionally save current-window tabs into a new group after explicit tabs permission approval
- Import from A Fine Start export codes
- Export JSON, Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible code
- Restore Timeline before destructive actions
- Command Palette, visible UI access, and browser-assigned keyboard shortcuts
- Latin/Cyrillic layout-aware keyboard shortcuts for common actions
- Duplicate Finder with read-only scan and user-confirmed deletion
- Optional Google Drive `appDataFolder` backup/sync with automatic local-change backup after connection
- No required account, no analytics, no tracking
- Open-source under the MIT License

## Privacy Disclosure Short Text

Aura Start stores user-created groups, links, settings, widget state, background preferences, and restore timeline entries locally by default. It has no backend, no analytics, no tracking, no ads, and no required account. Optional Google Drive sync is user-initiated and syncs only Aura Start's own backup file. Optional tabs access is requested only for Save open tabs.

## Permission Justification

- `storage`: saves user-created groups, links, settings, sync metadata, and restore points in local extension storage.
- `identity`: allows the user to explicitly connect optional Google Drive sync through Chrome's OAuth flow.
- `https://www.googleapis.com/*`: used only for optional Google Drive API requests after the user enables sync.
- `optional_permissions.tabs`: requested at runtime only for Save open tabs so Aura Start can preview current-window tab titles and URLs before saving.
- `https://www.googleapis.com/auth/drive.appdata`: lets Google Chrome builds read and write only Aura Start's hidden app data file, not normal visible Drive files.
- `https://www.googleapis.com/auth/drive.file`: used only by the Firefox/compatible Chromium Device OAuth fallback for an Aura Start-owned sync file marked with Aura Start app properties.

Aura Start intentionally does not request bookmarks, history, cookies, webRequest, scripting, `<all_urls>`, full Google Drive access, required `tabs` permission, or browser-wide host permissions.

## Reviewer Notes

Aura Start is a local-first browser new tab extension for user-created groups of links. It uses extension-local storage for local data, optional runtime `tabs` access for Save open tabs, and Google OAuth scopes only for optional Google Drive sync after user action. Google Chrome uses `drive.appdata`; Firefox and compatible Chromium fallback builds can use `drive.file` only for Aura Start's own sync file.

The extension has no content scripts, no analytics, no tracking, no backend, no ads, and no remotely hosted code. A Fine Start is mentioned only for migration compatibility; Aura Start is independent and not affiliated with A Fine Start.

## Manual Fields Checklist

- Category: Productivity
- Language: English
- Privacy policy URL: `https://aurastart.pages.dev/privacy-policy.html`
- Screenshots: follow `docs/SCREENSHOTS.md`
- Support URL: GitHub repository issues or repository URL
- Website URL: `https://aurastart.pages.dev/`
- Source code URL: `https://github.com/communism420/Aura-Start`
- Store package: ZIP built from `dist` contents after `npm run build:store`
