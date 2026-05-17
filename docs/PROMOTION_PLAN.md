# Aura Start Promotion Plan

This plan supports launch communication after publication without spam, fake reviews, or aggressive competitor language.

## 1. Positioning

Aura Start is a local-first, open-source, exportable start page for people who want grouped links without account lock-in.

Core message:

- Your links belong to you.
- No required account.
- No analytics or tracking.
- Export anytime.
- Import from A Fine Start export codes.
- Optional Google Drive backup through `appDataFolder`.
- Open-source under the MIT License.

## 2. Target Users

- People who want a clean Chromium new tab page with grouped links.
- Users who care about local-first software and exportable data.
- Users migrating from A Fine Start export codes.
- Power users who value Command Palette, keyboard shortcuts, and Duplicate Finder.
- Open-source users who prefer auditable browser extensions.

## 3. Launch Channels

- GitHub release
- Chrome Web Store listing after manual publication
- Personal website or project page
- Privacy/open-source communities where self-promotion is allowed
- Browser extension communities
- Productivity communities with clear disclosure that you are the maintainer

Do not post identical text everywhere. Adapt each post to the community rules and ask for honest feedback, not ratings.

## 4. Reddit / Forum Post Draft: Open-Source And Privacy

Title:

> I built Aura Start, a local-first open-source new tab page for grouped links

Body:

> Aura Start is a Chromium new tab extension for people who want clean groups of links without a required account. It stores data locally by default, has no analytics or tracking, and supports export to JSON, browser bookmarks HTML, Markdown, CSV, and an A Fine Start-compatible code.
>
> Optional Google Drive sync is off by default and uses only the hidden Drive `appDataFolder` scope. The project is open-source under MIT, and I would appreciate honest feedback on the UX, privacy wording, and migration flow.

## 5. Reddit / Forum Post Draft: Migration From A Fine Start

Title:

> Aura Start supports importing A Fine Start export codes

Body:

> Aura Start is an independent open-source start page inspired by the simple grouped-link workflow. It can import A Fine Start export codes and export an A Fine Start-compatible code for a basic grouped-link format later.
>
> The goal is not to criticize A Fine Start. Aura Start focuses on local-first data ownership, export formats, restore points, and optional Google Drive `appDataFolder` backup. Feedback from people who use grouped-link start pages would be useful.

## 6. Reddit / Forum Post Draft: Power-User Workflow

Title:

> Aura Start 1.2.0 adds Command Palette and Duplicate Finder for grouped links

Body:

> Aura Start is a local-first Chromium new tab extension for grouped links. The 1.2.0 release focuses on migration and data ownership, with Command Palette, keyboard shortcuts, Restore Points, Export / Backup, and a Duplicate Finder that scans read-only and deletes only after confirmation.
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
- Independent project, not affiliated with A Fine Start

Avoid:

- Claiming A Fine Start is bad
- Claiming feature parity unless verified
- Using A Fine Start screenshots or branding

## 9. Open-Source / Privacy-Focused Post

Focus on:

- MIT source code
- Local-first storage
- No account
- No analytics/tracking/ads/backend
- Least-privilege permissions
- Optional Google Drive `appDataFolder` backup
- Export formats and restore points

## 10. What Not To Say

- Do not say Aura Start is the best or #1.
- Do not ask for fake reviews or five-star ratings.
- Do not criticize competitors or imply affiliation.
- Do not promise "forever" support.
- Do not claim Chrome Web Store availability before the listing is live.
- Do not imply Google Drive sync is required.
- Do not claim full compatibility with fields not supported by an export format.

## 11. First Feedback Checklist

- Installation problems
- Import from A Fine Start errors
- Export file correctness
- Restore point clarity
- Duplicate Finder false positives
- Keyboard shortcut conflicts
- Google Drive OAuth setup issues
- Privacy wording questions
- Dark/light theme readability

## 12. First 30 Reviews Strategy

- Ask early users for honest feedback after they have tried the extension.
- Do not ask specifically for five-star ratings.
- Reply politely to bug reports.
- Convert repeated feedback into GitHub issues.
- Prepare a 1.2.1 patch if reviewers find release-blocking issues.

## 13. Bug Triage Plan After Launch

1. Label data-loss, import/export, and Drive sync issues as high priority.
2. Reproduce with a fresh profile before changing logic.
3. Preserve user data samples only when users explicitly provide them.
4. Patch narrowly and add validation/tests where possible.
5. Update docs and store notes if a behavior changes.
