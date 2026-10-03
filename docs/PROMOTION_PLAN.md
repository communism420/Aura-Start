# Aura Start Promotion Plan

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.


This plan covers Aura Start 2.1.0 and was updated on 2026-10-04. It supports release communication without spam, fake reviews, or unsupported competitor claims. Verify live store links before publication.

## 1. Positioning

Aura Start is a local-first, open-source, customizable start page for people who want nested grouped links, fast search, and exportable data without account lock-in.

Core message:

- Your links belong to you.
- No required account.
- No analytics or tracking.
- Export anytime.
- Import from A Fine Start export codes.
- Optional Google Drive sync through one shared, visible `aura-start-sync.json` across Chrome, Firefox, and compatible Chromium browsers.
- Optional Save open tabs with an explicit runtime tabs permission prompt.
- Backgrounds, notes, and Countdown with custom audio, including optional sync of that media.
- MIT-licensed application source; third-party components retain their licenses.

## 2. Target Users

- People who want a clean browser new tab page with grouped links.
- Users who care about local-first software and exportable data.
- Users migrating from A Fine Start export codes.
- Power users who value fuzzy search, Command Palette, keyboard shortcuts, Restore Timeline, and Duplicate Finder.
- Open-source users who prefer auditable browser extensions.

## 3. Launch Channels

- GitHub release
- Chrome Web Store listing after publication or after the live listing URL is verified
- Personal website or project page
- Privacy/open-source communities where self-promotion is allowed
- Browser extension communities
- Productivity communities with clear disclosure that you are the maintainer

Do not post identical text everywhere. Adapt each post to the community rules and ask for honest feedback, not ratings.

## 4. Reddit / Forum Post Draft: Open-Source And Privacy

Title:

> I built Aura Start, a local-first open-source new tab page for grouped links

Body:

> Aura Start is a browser new tab extension for people who want clean nested groups of links without a required account. It stores data locally by default, has no analytics or tracking, supports fuzzy search, backgrounds, Countdown with custom audio, and Full Backup ZIP export with settings, notes, links, restore history, and custom media. Media-free JSON, browser bookmarks HTML, Markdown, CSV, and an A Fine Start-compatible code are also available.
>
> Optional Google Drive sync is off by default. Supported browsers share one visible Aura Start file in your Drive, including notes, the custom background, and selected Countdown audio. Chrome also retains limited access for old hidden backups; the current Device grant in Firefox/Helium does not access those hidden copies. Aura Start never requests full Drive access. Save open tabs asks for the optional tabs permission only when you preview tabs. The application source is open-source under MIT, with separate licenses for bundled dependencies, and I would appreciate honest feedback on the UX, privacy wording, and migration flow.

## 5. Reddit / Forum Post Draft: Migration From A Fine Start

Title:

> Aura Start supports importing A Fine Start export codes

Body:

> Aura Start is an independent open-source start page inspired by the simple grouped-link workflow. It can import A Fine Start export codes and export an A Fine Start-compatible code for a basic grouped-link format later.
>
> The goal is not to criticize A Fine Start. Aura Start focuses on local-first data ownership, nested groups, export formats, Restore Timeline, optional Google Drive synchronization, and explicit runtime permission for saving open tabs. Feedback from people who use grouped-link start pages would be useful.

## 6. Reddit / Forum Post Draft: Power-User Workflow

Title:

> Aura Start 2.1.0 adds shared Drive sync, Countdown, and full ZIP backups

Body:

> Aura Start is a local-first browser new tab extension for grouped links. The 2.1.0 release unifies Drive synchronization across browsers, including notes, the custom background, and custom Countdown audio. It adds the Countdown widget, full ZIP backups, and migration of new preferences without resetting existing settings. Visible online pages normally check for remote changes about every five seconds; background checks continue about once a minute while the browser runs. It also retains nested groups, fuzzy search, Restore Timeline, Save open tabs, Command Palette, and Duplicate Finder.
>
> It has no required account, no analytics, no tracking, and no backend. I am looking for honest feedback from people who keep many saved links on their start page.

## 7. GitHub Release Text

Use `docs/GITHUB_RELEASE_DRAFT.md` as the release body. Keep the Chrome Web Store availability line accurate at the time of publishing.

## 8. Migration-Focused Post

Focus on:

- Import from A Fine Start export codes
- Preview and validation before import
- Merge or Replace choice
- Restore point protection
- Export back to A Fine Start-compatible code
- Nested groups and fuzzy search after migration
- Independent project, not affiliated with A Fine Start

Avoid:

- Claiming A Fine Start is bad
- Claiming feature parity unless verified
- Using A Fine Start screenshots or branding

## 9. Open-Source / Privacy-Focused Post

Focus on:

- MIT source code
- Local-first storage
- No account required for local use
- No analytics/tracking/ads/backend
- Least-privilege permissions
- Optional shared Google Drive sync through one visible file, with conditional merging and limited legacy backup migration/cleanup
- Optional tabs access only when Save open tabs is used
- Export formats and Restore Timeline

## 10. What Not To Say

- Do not say Aura Start is the best or #1.
- Do not ask for fake reviews or five-star ratings.
- Do not criticize competitors or imply affiliation.
- Do not promise "forever" support.
- Do not claim Chrome Web Store availability before the listing is live.
- Do not imply Google Drive sync is required.
- Do not claim full compatibility with fields not supported by an export format.
- Do not claim identical internals or equal reliability to A Fine Start.
- Do not promise instant delivery, an exact five-second maximum, or permanent authorization: polling can be delayed and Google can revoke access.
- Do not say every audio codec is supported; imported audio is decoded locally, limited to 20 MiB, with an alarm playback clip of at most 60 seconds.
- Do not describe the shared Drive file as hidden or encrypted by Aura Start.
- Explain that the Countdown alarm needs an Aura Start page to remain open.

## 11. First Feedback Checklist

- Installation problems
- Import from A Fine Start errors
- Export file correctness
- Nested group drag-and-drop issues
- Fuzzy search relevance
- Save open tabs permission confusion
- Restore Timeline clarity
- Duplicate Finder false positives
- Keyboard shortcut conflicts
- Google Drive connection, reconnection, deliberate disconnect, and deletion behavior
- Concurrent edits and link deletions across Chrome, Helium, and Firefox
- Background/notes/custom-audio sync and full ZIP restore
- Upgrade and older JSON compatibility
- Background/widget readability or performance
- Privacy wording questions
- Dark/light theme readability

## 12. First 30 Reviews Strategy

- Ask early users for honest feedback after they have tried the extension.
- Do not ask specifically for five-star ratings.
- Reply politely to bug reports.
- Convert repeated feedback into GitHub issues.
- Prepare a focused follow-up patch if reviewers find release-blocking issues.

## 13. Bug Triage Plan After Launch

1. Label data-loss, import/export, and Drive sync issues as high priority.
2. Reproduce with a fresh profile before changing logic.
3. Preserve user data samples only when users explicitly provide them.
4. Patch narrowly and add validation/tests where possible.
5. Update docs and store notes if a behavior changes.
