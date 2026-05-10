# Aura Start

Aura Start is a local-first Chromium new tab extension for clean groups of links. It is built for people who want a fast start page without accounts, tracking, forced cloud sync, or paid data access.

Aura Start was inspired by the simplicity and bookmark-grouping idea of A Fine Start. It is an independent project, not affiliated with A Fine Start, and it focuses on local-first ownership, built-in export, and no required account or sync.

Slogan: All features of A Fine Start and even more - free and forever.

## Features

- Fully open-source under the MIT License
- Custom groups and links on the new tab page
- Local storage through `chrome.storage.local`
- Light, dark, and system themes
- Interface languages: English, Russian, Spanish, German, French, Portuguese, and Ukrainian
- Compact mode and configurable columns
- Search across title, URL, description, and tags
- Explicit edit mode: drag-and-drop and inline edit controls stay disabled until you turn editing on
- Drag and drop for groups and links, including moving links between groups
- JSON import with validation, merge, replace, and restore point protection
- A Fine Start export-code import for migration from A Fine Start
- A Fine Start export-code export for moving Aura Start links back into A Fine Start
- Restore points before destructive actions
- Undo toast for deleting links and groups
- Safe recovery screen for corrupted local data
- Export through local Blob downloads only

## Local-First Philosophy

Aura Start does not need a server to work. Your groups and links stay in your browser profile, and the extension does not use analytics, trackers, accounts, host permissions, bookmarks permission, history permission, or external APIs for core functionality.

Your data belongs to you. Export it whenever you want and keep backups in normal files.

## Open Source

Aura Start is fully open-source under the MIT License. The extension code, build scripts, validation scripts, documentation, and store-submission notes are intended to be public and auditable.

There is no proprietary server component, hidden backend, paid data lock-in, or closed sync service required for Aura Start to work. You can inspect the source, build it yourself, fork it, modify it, and redistribute it under the terms of the MIT License.

## Export Formats

Aura Start supports:

- Full Backup JSON: full Aura Start data for restore or migration
- Browser Bookmarks HTML: Netscape bookmarks HTML with groups as folders
- Markdown: readable grouped link lists
- CSV: `group,title,url,description,tags,createdAt,updatedAt`
- A Fine Start export code: JSON code compatible with A Fine Start's Import bookmarks tool

## Install In Developer Mode

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click Load unpacked.
6. Select the generated `dist` folder.

The extension overrides the Chromium new tab page with `newtab.html`.

## Development

```bash
npm install
npm run typecheck
npm run build
npm run build:store
```

In Vite development mode, Aura Start falls back to `localStorage` when `chrome.storage.local` is not available. Production extension builds use `chrome.storage.local`.

`npm run build:store` builds the extension and validates the generated `dist` package for Chrome Web Store review basics: Manifest V3, least-privilege permissions, required extension files, localized manifest messages, CSP, and no obvious remote-code patterns.

## Import And Recovery

Use Settings -> Import backup to import a Full Backup JSON file. Aura Start validates the file before applying it and lets you choose:

- Merge with current data
- Replace current data

Before import replace, group deletion, and reset actions, Aura Start creates a restore point. Restore points are kept locally and capped to avoid unbounded storage growth.

If stored data is corrupted, Aura Start shows a recovery screen instead of overwriting it. You can export the raw stored payload before resetting.

## Migrating From A Fine Start

In A Fine Start, open Settings -> Export bookmarks and copy the generated export code. In Aura Start, open Settings -> Import backup, choose A Fine Start export code, paste the code, then choose Merge or Replace.

Aura Start converts A Fine Start groups and bookmarks into local Aura Start groups and links. It supports the current A Fine Start export shape and the older v2 export shape. Imported URLs are still validated by Aura Start, so unsupported or unsafe URL schemes are rejected instead of being saved.

To move from Aura Start back to A Fine Start, use Aura Start -> Export -> A Fine Start export code. Open A Fine Start -> Settings -> Import bookmarks, paste the generated code, and import it there. A Fine Start's format stores group names and bookmark `name`/`url` values only, so Aura Start descriptions and tags are not included in that export.

## Roadmap

- Optional browser bookmarks import
- Optional HTML bookmarks import
- Favicons
- Custom icons
- Command palette
- Encrypted backup
- Optional WebDAV, GitHub, or file sync
- Firefox support later

## Privacy

Aura Start has no backend, no accounts, no analytics, no tracking scripts, no required sync, no host permissions, and no access to browser history or bookmarks.

See [PRIVACY.md](./PRIVACY.md) for the privacy policy text and [STORE_SUBMISSION.md](./STORE_SUBMISSION.md) for Chrome Web Store submission notes.

## License

Aura Start is released under the [MIT License](./LICENSE). See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.
