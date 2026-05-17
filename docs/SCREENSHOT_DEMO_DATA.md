# Screenshot Demo Data

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


This data is for manual screenshot setup, staging mockups, and local testing only. It must not be injected automatically for production users and must not change Aura Start's user data behavior.

## Groups And Links

### Work

- Project Dashboard — `https://github.com`
- Calendar — `https://calendar.google.com`
- Notes — `https://keep.google.com`

### Development

- GitHub — `https://github.com`
- Chrome Developers — `https://developer.chrome.com`
- MDN Web Docs — `https://developer.mozilla.org`
- web.dev — `https://web.dev`

### Design

- Figma — `https://figma.com`
- Material Design — `https://m3.material.io`

### Research

- Wikipedia — `https://wikipedia.org`
- Hacker News — `https://news.ycombinator.com`

### Reading

- Long Reads — `https://longreads.com`
- Documentation — `https://developer.mozilla.org`
- Saved Articles — `https://getpocket.com`

### Tools

- JSON Formatter — `https://jsonformatter.org`
- Regex Tester — `https://regex101.com`
- Color Picker — `https://coolors.co`

## Duplicate Finder Setup

For Duplicate Finder screenshots, add a few intentional duplicates manually:

- GitHub — `https://github.com`
- GitHub Home — `https://github.com/`
- Chrome Developers — `https://developer.chrome.com`
- Chrome Dev Docs — `http://developer.chrome.com`

Keep at least one item in every duplicate group unselected so the screenshot never implies automatic deletion.

## A Fine Start Import Setup

Use a small local sample export code created only from non-personal demo links. Confirm the import preview shows group/link counts before capturing the screenshot. Do not show A Fine Start branding, UI, or screenshots.

## Manual Setup Notes

1. Install the current `dist` build as an unpacked extension.
2. Create the demo groups manually or use Aura Start's opt-in demo groups only if the current UI provides enough data for the screenshot.
3. Keep account identifiers, local paths, OAuth data, and browser profile information out of screenshots.
4. Export a Full Backup JSON before replacing local screenshot data.
5. After capture, restore your real local data from a backup or restore point if needed.
