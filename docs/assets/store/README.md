# Store Asset Checklist

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.

This folder tracks the Chrome Web Store, Firefox Add-ons, and public site screenshot set. The final store PNG files are captured from the real Aura Start 2.1.0 UI and stored in `Chrome Submit/Photo/` and `Firefox Submit/Photo/`, with public site copies in `docs/assets/screenshots/`.

The public site uses the `*-20261004.png` screenshot copies to avoid stale cached images after the 2.1.0 documentation refresh.

Store filenames:

1. `01-new-tab-overview-1280x800.png`
2. `02-search-mode-1280x800.png`
3. `03-import-export-1280x800.png`
4. `04-settings-1280x800.png`
5. `05-restore-points-1280x800.png`

Public site filenames:

1. `01-new-tab-overview-20261004.png`
2. `02-fuzzy-search-20261004.png`
3. `03-import-export-20261004.png`
4. `04-backgrounds-widgets-20261004.png`
5. `05-restore-timeline-20261004.png`
6. `06-save-open-tabs-20261004.png`
7. `07-command-palette-20261004.png`

8. `08-countdown-20261004.png`

The capture script uses a local preview, synthetic storage/tabs, and an isolated temporary Chrome profile. Drive is disconnected; these images do not establish OAuth or native permission behavior. Promotional composites in `Chrome Submit/Promo/` are generated separately from the same refreshed screenshots.

Source documents:

- Screenshot plan: [Screenshot plan](../../SCREENSHOTS.md)
- Demo data: [Demo data](../../SCREENSHOT_DEMO_DATA.md)
- Screenshot gallery: [Gallery](../../screenshot-gallery.html)

Capture rules:

- Use current Aura Start 2.1.0 UI.
- Do not use drawn mockups that differ from the real extension design.
- Do not show personal data, OAuth tokens, email addresses, or browser profile details.
- Do not use A Fine Start screenshots or logos.
- Do not claim Chrome Web Store or Firefox Add-ons availability before the listing is live.
