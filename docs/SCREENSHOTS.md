# Aura Start Screenshot Plan

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.

This plan prepares Chrome Web Store, Firefox Add-ons, and public website screenshots from the current Aura Start 2.1.0 feature set. It avoids unsupported claims, fake statistics, competitor criticism, and visual use of third-party brands beyond plain text references needed for migration.

Recommended base sizes:

- Chrome Web Store and Firefox Add-ons screenshots: 1280 x 800 PNG
- Public website screenshots: 1280 x 800 PNG
- Use real extension UI only. The final PNGs are captured from the current Aura Start UI with non-personal demo data.
- Store screenshots live in `Chrome Submit/Photo/` and `Firefox Submit/Photo/`.
- Public site copies live in `docs/assets/screenshots/` and use `*-20261004.png` filenames for the October 4, 2026 refresh.
- `docs/screenshot-gallery.html` displays the real captured screenshots. It is not a mockup renderer.

## General Capture Rules

- Use non-personal demo data.
- Do not show personal bookmarks, email addresses, OAuth tokens, browser profiles, or real Drive files.
- Do not show a fake store listing URL.
- Mention A Fine Start only as an import/export compatibility path.
- Keep wording factual: no "best", "#1", "guaranteed", "forever", or aggressive comparisons.
- Verify the screen exists in the current local build before publishing a screenshot as product UI.

## Store Screenshot Set

The maintained store set contains five images. Use these files in filename order and confirm the current dashboard requirements before uploading:

1. `01-new-tab-overview-1280x800.png` - nested groups, background, and widgets, with Drive disconnected.
2. `02-search-mode-1280x800.png` - fuzzy search with typo-tolerant results and count.
3. `03-import-export-1280x800.png` - import/export and migration workflow.
4. `04-settings-1280x800.png` - background and widget settings.
5. `05-restore-points-1280x800.png` - Restore Timeline with grouped snapshots.

## Public Website Screenshot Set

The public website can show more than 5 screenshots. Use these files:

1. `01-new-tab-overview-20261004.png` - nested groups, background, and widgets, with Drive disconnected.
2. `02-fuzzy-search-20261004.png` - fuzzy search and quick filters.
3. `03-import-export-20261004.png` - import/export workflow.
4. `04-backgrounds-widgets-20261004.png` - personalization settings.
5. `05-restore-timeline-20261004.png` - Restore Timeline.
6. `06-save-open-tabs-20261004.png` - optional tabs preview and duplicate filtering.
7. `07-command-palette-20261004.png` - fuzzy Command Palette search.

8. `08-countdown-20261004.png` - the optional Countdown widget and its controls.

Run `node scripts/generate-store-photos.mjs` after building `dist` to refresh these images. The script renders the actual built UI in a local Vite preview with synthetic storage/tab APIs, an isolated temporary Chrome profile, and external HTTPS requests blocked. These captures do not test native extension permissions or real Google OAuth. Run the installed-extension matrix separately.

Promotional composites in `Chrome Submit/Promo/` can then be refreshed with `node scripts/generate-promo-assets.mjs`; these are marketing layouts using the real captures, not additional interface screenshots.

## Publishing Checklist

- Screenshots match the current local build.
- No private data appears.
- No competitor logo or UI appears.
- No unsupported claims appear.
- Privacy claims match `PRIVACY.md`, `docs/privacy-policy.html`, and manifest permissions.
- Store listing text uses the same terminology as `Chrome Submit/STORE_LISTING.md` and `Firefox Submit/ADDON_LISTING.md`.
