# Firefox Add-ons Reviewer Notes — Aura Start 2.1.0

Prepared October 4, 2026 for a future 2.1.0 submission. Existing 2.0.x archives in this folder are historical and have not been rebuilt. These notes describe the current source and `dist-firefox` behavior; run final checks against the actual upload ZIP.

Aura Start is a new tab extension for organizing user-created groups of links, with local widgets, portable backups, and optional Google Drive synchronization.

## Permissions And Manifest

- `storage`: local groups, links, settings, connection metadata and credentials, UI state, widget state, and Restore Timeline. Larger background/audio assets also use local IndexedDB.
- `alarms`: approximately minute-based checks while connected automatic Google Drive sync is enabled and the browser is running. It is not used to track browsing or guarantee a timer alarm with all pages closed.
- Optional `tabs`: requested only when the user enables and starts Save open tabs. Aura Start previews current-window titles and URLs, filters duplicates/unsupported URLs, and saves only after confirmation.
- `https://www.googleapis.com/*` and `https://oauth2.googleapis.com/*`: declared API host access for Google authorization, token renewal, and Aura Start's Drive files after explicit connection.
- Firefox omits Chrome-only `identity` and `manifest.oauth2`.
- Manifest V3; `background.scripts: ["background.js"]` with `type: "module"`.
- Gecko minimum 142.0; required data collection `["none"]`, optional `["browsingActivity", "technicalAndInteraction"]`.

The optional Firefox data collection consent is requested when the user starts Drive connection because saved links/settings and selected content may be uploaded to the user's Google Drive. It is separate from Google OAuth consent and optional tabs access. See [Privacy Disclosure](PRIVACY_DISCLOSURE.md) for the complete transferred-data description.

## Google Drive Sync

Sync is off by default and requires explicit account connection. Firefox uses the configured Google Device OAuth client: the user opens Google's verification page and enters the displayed device code. Release OAuth configuration is compiled into the extension, while actual user tokens are stored locally.

The current Device configuration requests `drive.file` only. All updated installations connected to the same Google account share `aura-start-sync.json` in ordinary Drive storage. The file contains groups, links, ordering/nesting, shared preferences, notes, the saved background, the selected original Countdown sound and portable playback copy, and merge metadata. It is visible in My Drive; Aura Start does not access unrelated files or request full Drive access.

Aura Start finds its app-marked and recognized older backups, merges them, verifies the surviving shared data, and conditionally removes covered duplicates. Hidden legacy `appDataFolder` files cannot be read with this Device grant; native Chrome with appropriate access can migrate them. Aura Start never requests broader Drive access just to search unrelated files.

Local edits queue background synchronization. Visible online pages check roughly every five seconds; hidden/closed pages fall back to roughly one-minute browser alarms. Multiple pages share the schedule. Unchanged verified files use metadata checks without uploading, downloading all media, or showing a success animation. Network/browser scheduling may delay these intervals.

Different fields merge independently. Simultaneous edits to the same field resolve deterministically; note text is not collaboratively merged. Deletion records prevent older snapshots from restoring deleted links. Conditional writes reject stale revisions; errors preserve pending local edits.

Access tokens renew silently where possible. Temporary errors retain the saved connection. A confirmed invalid grant requires explicit reconnection. Disconnecting without deletion clears this installation's saved credentials without revoking other installations. The deletion preference defaults on; deletion requires confirmation, removes recognized accessible Aura Start files including matching Trash entries, and verifies absence. Unverified hidden-backup cleanup has a persistent notice; failed accessible-file deletion leaves the connection paused for retry. Local links/media are retained.

## Backups And Local Media

- Full Backup ZIP v2: JSON settings, links, notes and Restore Points, current/historical background files, and only the main snapshot's currently selected original Countdown sound.
- No built-in signal, generated playback WAV, or other historical audio is added to that ZIP. An individually exported Restore Point includes its own selected original sound.
- Settings and links only (JSON): settings, links, notes and history without media; omitted custom choices are neutral on import.
- 2.0.5 JSON remains importable, but did not include note text or the actual background image. Existing local installations migrate those separately.
- Imports validate assets before applying data and preserve the current local Google connection. OAuth tokens and running timer progress are not portable backup contents.
- Audio imports accept up to 20 MiB and prepare up to the first 60 seconds for playback. Many formats are supported; unknown, damaged or protected codecs may be rejected.
- Countdown needs an enabled widget and an open Aura Start page for timely sound; its active deadline stays local across tabs and reloads.

## Packaged Executable Assets

All JS, workers, WebAssembly and built-in media are packaged locally. The ZIP worker uses `fflate` 0.8.3. The browser-native audio decoder is tried first; the packaged `@ffmpeg/ffmpeg` 0.12.15 wrapper and `@ffmpeg/core` 0.12.10 single-thread ESM core provide a fallback. No runtime CDN code or conversion service is used.

CSP permits `'self' 'wasm-unsafe-eval'` for local WebAssembly only, with `object-src 'none'; base-uri 'none'`. It does not permit ordinary `unsafe-eval`. Preserve `vendor/ffmpeg/ffmpeg-core.js`, `ffmpeg-core.wasm`, `NOTICE.txt`, `FFMPEG-WASM-LICENSE.txt`, and `COPYING.GPLv2.txt`, plus all generated `assets/*worker*.js`.

The decoder wrapper is MIT; the core is GPL-2.0-or-later and includes third-party components. `NOTICE.txt` records pinned hashes, versions, and matching upstream source/build recipes. Application MIT licensing does not replace those terms. See [Source Build Notes](SOURCE_BUILD_NOTES.md) for reproduction and source-material requirements.

Firefox builds run the JavaScript sanitizer before manifest finalization and validation. Do not substitute an unsanitized Vite output.

## Privacy Boundaries

Aura Start has no developer backend, ads, analytics or tracking; no content scripts; and no history, bookmarks, cookies, webRequest, scripting or all-URL permission. Loading user-saved external links remains a normal browser navigation. Google receives synchronized content only after the user connects; local mode and manual file backups need no Google account.

## Review Checklist

Test the exact release candidate in Firefox: first-run local mode, new tab, notes, Countdown/native and fallback audio, ZIP round-trip, media-free JSON, 2.0.5 import, Restore Timeline, optional tab capture, Device OAuth, cross-device updates, disconnect, and deletion notices. Keep simulated transport test evidence separate from live-account checks and UI screenshots. The new screenshot set uses synthetic data in a local 2.1.0 preview with Drive disconnected.
