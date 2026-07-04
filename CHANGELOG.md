# Changelog

## Unreleased

- Added separate Chromium and Firefox extension version configuration with build-time manifest injection and target-specific release validation.
- Fixed group drag-and-drop target detection so bookmark groups persist after dropping and can be reordered upward, downward, or into valid nested-group drop zones.
- Fixed order normalization so group reordering is not undone during the save/touch cycle, including legacy data with missing `parentId`.
- Fixed Chromium/Helium MV3 manifests so `background.scripts` is never included outside Firefox builds, and added validation guards for browser-specific background formats.
- Bumped the extension package and manifest version to 2.0.1.
- Documented the Mozilla Add-ons source-code submission flow in README, including the required source archive contents, exclusions, and reproducible Firefox build commands.
- Refreshed README, privacy policy, public docs site, store submission notes, release checklists, comparison docs, demo screenshot data, and screenshot documentation for the current 2.0.0 feature set, including nested groups, fuzzy search, Restore Timeline, Save open tabs, Firefox support, backgrounds, and widgets.
- Updated cross-browser UI and manifest wording so data ownership and extension descriptions no longer describe Aura Start as Chromium-only.
- Updated release and store documentation to use `https://aurastart.pages.dev/` as the public Aura Start website.
- Raised the Firefox release build minimum version to 142.0 so `browser_specific_settings.gecko.data_collection_permissions` is supported by Firefox for Android validation.
- Removed React DOM raw-HTML fallback code from Firefox release bundles and added validation that blocks Firefox ZIPs containing unsafe `innerHTML`/`outerHTML`/`insertAdjacentHTML` sinks.
- Fixed Firefox AMO package validation by declaring non-empty built-in data collection consent metadata (`required: ["none"]`) and adding a build-time guard so invalid Firefox ZIPs cannot be produced unnoticed.
- Added optional visual personalization with built-in and custom local background images, blur/dim/position controls, plus lightweight Clock, Markdown Notes, and Pomodoro widgets that can be toggled in settings.
- Added Firefox-oriented build support with a WebExtension API adapter, Promise/callback-compatible storage, tabs, permissions, runtime, and identity wrappers, a `build:firefox` script, Firefox manifest finalization, and Device OAuth documentation for Google Drive sync.
- Added an optional "save current window tabs as a new group" workflow with runtime tabs permission request, preview, duplicate filtering, settings toggle, Command Palette/Header entry points, and restore-point protection.
- Reworked restore points into a searchable Restore Timeline with day grouping, action filters, richer context, and automatic snapshots before important move/reorder operations.
- Added Fuse.js-powered fuzzy link search with nested-group awareness, match highlighting, result counts, quick filters, Command Palette handoff, and a visibly restored last search query.
- Added nested groups up to two levels, including parent selection, drag-and-drop reparenting, child-group delete choices, migration for legacy flat groups, and nested-aware export/restore handling.
- Improved destructive-action safety by creating a restore point before deleting an individual link.

## Aura Start 2.0.0 — Nested Groups, Search, Timeline, Firefox, And Personalization

- Added stronger A Fine Start migration flow with safer import preview and compatibility notes.
- Added first-run onboarding, empty state actions, demo data, and Google Drive restore during setup.
- Added Export / Backup hub, Restore Timeline, Command Palette, Duplicate Finder, and Privacy Promise.
- Fixed Google Drive sync behavior across test and Chrome Web Store builds, including OAuth flow, reconnect states, token persistence, and automatic backup handling (I hope).
- Kept Google Drive sync optional, with Google Chrome using hidden appDataFolder storage and Firefox/compatible Chromium fallback builds using Drive file access only for Aura Start's own sync file.
- Improved keyboard shortcuts, Cyrillic-layout shortcut handling, search focus behavior, and Command Palette access.
- Improved destructive-action safety with restore points, confirmations, and clearer recovery messaging.
- Updated translations across all supported languages and fixed untranslated UI labels.
- Redesigned the documentation website and refreshed privacy, store listing, and release materials.
- Updated screenshots to match the new Aura Start design.
