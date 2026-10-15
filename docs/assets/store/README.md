# Store Asset Checklist

> Maintainer-only document. This file is for project release preparation and is not needed for normal Aura Start users.

Current gallery: **Aura Start 2.1.2**, captured on October 15, 2026 in Chrome 155 from a fresh source build. The five 1280 x 800 RGB PNGs show the real application with non-personal demo data and Drive disconnected. This is a local UI preview, not an authenticated Drive or native Firefox test.

Run `npm run screenshots` to prepare new store images. Each run writes a separate `Chrome Submit/Screenshots/<version>/<run-id>/` and `Firefox Submit/Screenshots/<version>/<run-id>/` folder. Both contain the five shared screenshots; Chrome also receives 440 x 280 and 1400 x 560 promotional PNGs made with that run's real overview screenshot. These local submission folders stay outside Git. See the [capture guide](../../SCREENSHOTS.md).

The current public images are byte-for-byte copies of capture run `20261015T101432Z-175107ab`. They use versioned filenames under `docs/assets/screenshots/` so the website does not serve cached older artwork. Their public [capture record](../screenshots/capture-2-1-2-20261015.json) records the browser, version, source build fingerprint, and PNG hashes without local paths or credentials.

Store filenames:

1. `01-links-and-groups-1280x800.png`
2. `02-notes-and-countdown-1280x800.png`
3. `03-full-backup-zip-1280x800.png`
4. `04-custom-timer-sound-1280x800.png`
5. `05-google-drive-sync-1280x800.png`

Public site filenames:

1. `01-links-and-groups-2-1-2-20261015.png`
2. `02-notes-and-countdown-2-1-2-20261015.png`
3. `03-full-backup-zip-2-1-2-20261015.png`
4. `04-custom-timer-sound-2-1-2-20261015.png`
5. `05-google-drive-sync-2-1-2-20261015.png`

The website gallery and home page use these current images. Older public PNGs and local `Photo/`, `Screenshots 2.1.0/`, and `Promo/` folders are retained as historical artwork, not the current upload source. The screenshot command does not update website copies automatically; copy a reviewed run and update the gallery, captions, and capture record together.

The current screenshots intentionally omit connected-account identity and contain no animated drag sequence. Version 2.1.2 supports both verified Drive account details and smooth neighboring-link placement; use the product guides to explain them without implying that these disconnected static scenes prove either integration or animation behavior.

Source documents:

- Screenshot plan: [Screenshot plan](../../SCREENSHOTS.md)
- Demo data: [Demo data](../../SCREENSHOT_DEMO_DATA.md)
- Screenshot gallery: [Gallery](../../screenshot-gallery.html)

Capture rules:

- Capture the current Aura Start version; older 2.1.0 images remain dated reference material.
- Do not use drawn mockups that differ from the real extension design.
- Do not show personal data, OAuth tokens, email addresses, or browser profile details.
- Do not use A Fine Start screenshots or logos.
- Do not claim Chrome Web Store or Firefox Add-ons availability before the listing is live.
