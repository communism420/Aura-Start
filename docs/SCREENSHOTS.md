# Aura Start Screenshot Plan

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.

This plan prepares Chrome Web Store, Firefox Add-ons, and public website screenshots from the current Aura Start 2.0.0 feature set. It avoids unsupported claims, fake statistics, competitor criticism, and visual use of third-party brands beyond plain text references needed for migration.

Recommended base sizes:

- Chrome Web Store and Firefox Add-ons screenshots: 1280 x 800 PNG
- Public website screenshots: 1280 x 800 PNG
- Use real extension UI only. The final PNGs are captured from the current Aura Start UI with non-personal demo data.
- Store screenshots live in `Chrome Submit/Photo/` and `Firefox Submit/Photo/`.
- Public site copies live in `docs/assets/screenshots/` and use `*-20260630.png` filenames to avoid stale cached images after the 2.0.0 design refresh.
- `docs/screenshot-gallery.html` displays the real captured screenshots. It is not a mockup renderer.

## General Capture Rules

- Use non-personal demo data.
- Do not show personal bookmarks, email addresses, OAuth tokens, browser profiles, or real Drive files.
- Do not show a fake store listing URL.
- Mention A Fine Start only as an import/export compatibility path.
- Keep wording factual: no "best", "#1", "guaranteed", "forever", or aggressive comparisons.
- Verify the screen exists in the current local build before publishing a screenshot as product UI.

## Store Screenshot Set

Chrome Web Store allows a maximum of 5 screenshots. Use these files in filename order for Chrome Web Store and Firefox Add-ons:

1. `01-new-tab-overview-1280x800.png` - nested groups, background, widgets, and connected sync marker.
2. `02-search-mode-1280x800.png` - fuzzy search with typo-tolerant results and count.
3. `03-import-export-1280x800.png` - import/export and migration workflow.
4. `04-settings-1280x800.png` - background and widget settings.
5. `05-restore-points-1280x800.png` - Restore Timeline with grouped snapshots.

## Public Website Screenshot Set

The public website can show more than 5 screenshots. Use these files:

1. `01-new-tab-overview-20260630.png` - nested groups, background, widgets, and sync status.
2. `02-fuzzy-search-20260630.png` - fuzzy search and quick filters.
3. `03-import-export-20260630.png` - import/export workflow.
4. `04-backgrounds-widgets-20260630.png` - personalization settings.
5. `05-restore-timeline-20260630.png` - Restore Timeline.
6. `06-save-open-tabs-20260630.png` - optional tabs preview and duplicate filtering.
7. `07-command-palette-20260630.png` - fuzzy Command Palette search.

Run `node scripts/generate-store-photos.mjs` after building the screenshot dist to refresh all of these images.

## Publishing Checklist

- Screenshots match the current local build.
- No private data appears.
- No competitor logo or UI appears.
- No unsupported claims appear.
- Privacy claims match `PRIVACY.md`, `docs/privacy-policy.html`, and manifest permissions.
- Store listing text uses the same terminology as `Chrome Submit/STORE_LISTING.md` and `Firefox Submit/ADDON_LISTING.md`.
