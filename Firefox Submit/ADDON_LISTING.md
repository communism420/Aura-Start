# Aura Start Firefox Add-ons Listing

Copy prepared for Aura Start 2.1.0, reviewed October 4, 2026. This document does not confirm publication or preparation of a 2.1.0 submission ZIP. Older ZIPs in this folder are historical artifacts.

## Extension Name

Aura Start

## Summary

A private, local-first, customizable start page for your Firefox new tab.

## Description

Aura Start replaces the new tab page with nested groups of links, local-first storage, and exportable backups.

Organize links with descriptions and tags, find them with fuzzy search, and use Command Palette for quick actions. Choose themes and backgrounds, show a clock or Markdown notes, and use Pomodoro or Countdown. Countdown has pause, resume, reset, volume control, and a built-in or custom completion sound. Audio preparation runs locally and supports many formats; an Aura Start page must stay open for a timely signal.

Full Backup ZIP keeps settings, links, notes, Restore Points, background files, and the currently selected original Countdown sound together. Settings and links only (JSON) keeps settings, links, notes, and history without media. Browser Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible codes are also available. Existing 2.0.5 JSON backups remain importable; their missing notes text and image files cannot be recreated from that JSON.

Restore Timeline protects important changes, and Duplicate Finder scans local links before user-confirmed deletion. Save open tabs previews the current window and requests optional tabs access only when used.

Google Drive sync is optional and off by default. Connect the same Google account in updated Aura Start installations to share groups, links, settings, notes, a saved background image, and the selected Countdown sound in one normal-Drive file. Visible online Aura Start pages check for changes about every five seconds; background checks continue about once a minute while the browser runs. Concurrent edits merge automatically, and pending offline changes retry later. Network and browser scheduling can delay updates.

Firefox uses Google Device OAuth with drive.file access for Aura Start's own files; it does not request full Google Drive access. The current Device configuration cannot read old hidden appDataFolder backups. Running timers, local Restore Timeline, and Google credentials stay on each installation. Disconnecting without deleting the cloud copy affects only that installation.

Aura Start needs no account for local use and has no analytics, tracking, ads, or developer-operated backend. Its application code is open-source under the MIT License; bundled third-party components retain their licenses. Aura Start is independent and not affiliated with A Fine Start.

Requires Firefox 142 or newer.

## Feature Bullets

- Nested groups, descriptions, tags, and fuzzy search
- Themes, compact mode, columns, and custom backgrounds
- Clock, Markdown notes, Pomodoro, and Countdown with custom sounds
- Optional current-window tab capture with preview and permission approval
- Full Backup ZIP and media-free settings-and-links JSON, including notes and history
- Bookmarks HTML, Markdown, CSV, and A Fine Start-compatible export
- A Fine Start import and older Aura Start JSON migration
- Local Restore Timeline, Undo, and confirmed duplicate cleanup
- Optional Google Drive synchronization of links, settings, notes, background, and selected sound
- No account required, analytics, tracking, or ads

## Suggested Category

Productivity

## Support And Source

- [Website](https://aurastart.pages.dev/)
- [Support](https://github.com/communism420/Aura-Start/issues)
- [Source code](https://github.com/communism420/Aura-Start)
- [Privacy policy](https://aurastart.pages.dev/privacy-policy.html)

## Screenshots

Use the eight `*-20261004.png` files in `docs/assets/screenshots/`, in filename order. They show the real 2.1.0 UI using synthetic data in a local preview with Google Drive disconnected. They are UI illustrations, not proof of an installed-extension OAuth test. `Firefox Submit/Photo/` currently contains older images; do not describe those as current 2.1.0 captures. Check any promotional artwork separately before upload.
