# Screenshot Demo Data

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.

This data is for manual screenshot setup, staging mockups, and local testing only. It must not be injected automatically for production users and must not change Aura Start's user data behavior.

The automated screenshot script (`node scripts/generate-store-photos.mjs`) prepares equivalent non-personal demo data before capture. Use the same shape for manual screenshots so documentation, store assets, and the public site stay consistent.

## Groups And Links

### Daily

- Project dashboard - `https://example.com/dashboard`
- Inbox - `https://mail.example.com`
- Calendar - `https://calendar.google.com`

### Research

- Design notes - `https://example.com/design-notes`
- Reading list - `https://example.com/reading`
- Archive - `https://example.com/archive`

### Deep dives

Child group under **Research**.

- MDN Web Docs - `https://developer.mozilla.org`
- Wikipedia - `https://wikipedia.org`

### Tools

- Figma - `https://figma.com`
- GitHub - `https://github.com`
- Service status - `https://status.example.com`

### Personal

- Notes - `https://notes.example.com`
- Travel ideas - `https://example.com/travel`

## Settings For Screenshots

- Theme: dark or system-dark, depending on contrast.
- Background: built-in forest preset.
- Background dim: enabled enough for text readability.
- Widgets: header clock, Markdown notes, and Pomodoro enabled.
- Notes widget sample: a short launch note with two checklist items.
- Search query sample: a typo-tolerant query such as `dashbord`.
- Google Drive: disconnected. Do not fabricate a connected account, successful upload, or sync timestamp.
- Countdown: a separate capture shows a five-minute timer with built-in sound; the main overview keeps its original clock/notes/Pomodoro layout.
- Store Markdown notes under `settings.notes.text`, timer preferences under `settings.timer`, and optional widgets under `settings.widgets`; do not seed the old `uiState.widgetNotes` field.

## Save Open Tabs Setup

For the Save open tabs screenshot, use only synthetic or public URLs. Include at least one already-saved duplicate and one unsupported browser URL so the preview demonstrates duplicate/unsupported filtering without showing private browsing data.

Recommended preview tabs:

- Aura Start repository - `https://github.com/communism420/Aura-Start`
- Cloudflare Pages docs - `https://developers.cloudflare.com/pages/`
- Project dashboard - `https://example.com/dashboard` (duplicate)
- Firefox Add-ons Developer Hub - `https://addons.mozilla.org/developers/`
- Browser settings - `chrome://extensions` or `about:addons` (unsupported)

## A Fine Start Import Setup

Use a small local sample export code created only from non-personal demo links. Confirm the import preview shows group/link counts before capturing the screenshot. Do not show A Fine Start branding, UI, or screenshots.

## Duplicate Finder Setup

For Duplicate Finder screenshots or manual QA, add a few intentional duplicates manually:

- GitHub - `https://github.com`
- GitHub Home - `https://github.com/`
- MDN Web Docs - `https://developer.mozilla.org`
- MDN Docs - `http://developer.mozilla.org`

Keep at least one item in every duplicate group unselected so the screenshot never implies automatic deletion.

## Manual Setup Notes

1. Use an isolated test profile or the automated local-preview capture; never replace a personal profile for screenshots.
2. Build the current UI, then create demo groups in the isolated installation or run the capture script. The automated preview supplies synthetic extension storage and tabs, blocks external HTTPS requests, and uses its own temporary Chrome profile.
3. Keep account identifiers, local paths, OAuth data, and browser profile information out of screenshots.
4. Keep demo captures separate from integration tests and real Google accounts.
5. Verify all output images visually and remove only temporary resources owned by the capture process.
