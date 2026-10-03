# Chrome Web Store Upload Checklist — 2.1.0

Updated 2026-10-04. Publishing requires a separate explicit release action. This documentation update did not rebuild, sign, upload, or publish any ZIP. Older archives in this folder are historical.

## Prepare the exact package

1. Follow `docs/RELEASE_CHECKLIST.md` to build Chrome store version 2.1.0 with the production extension ID and matching Chrome Extension OAuth client, plus the intended Device fallback configuration. Do not submit an unpacked/local build.
2. Create `Chrome Submit/aura-start-2.1.0-chrome-web-store.zip` from the exact store build contents with `manifest.json` at archive root. A filename in this checklist does not mean that artifact has been generated or validated.
3. Confirm required permissions `storage`, `identity`, `alarms`; optional `tabs`; only `https://www.googleapis.com/*` and `https://oauth2.googleapis.com/*` hosts; and both limited OAuth scopes `drive.file` and `drive.appdata`. Do not add full Drive access.
4. Confirm the 2.1.0 manifest, background service worker, command entry, packaged decoder assets, and CSP match the validated build. Firefox packages use their own manifest and must not be uploaded as Chrome packages.
5. Check that the ZIP excludes source/dependency directories, screenshots, repository metadata, local env files, and local credential/config documents. Never copy secrets into reviewer notes or public listings.
6. Run `npm run validate:zip` with the correct `AURA_CHROME_DIST_DIR` if the store build is not in the default `dist` folder. Run the release checks required by `docs/RELEASE_CHECKLIST.md`. Record actual results; this document is not a passed-test report.
7. Install the exact build and complete `docs/INSTALLED_EXTENSION_TEST_MATRIX.md`. Include current shared-file sync, notes/media, deletion propagation, concurrent changes, restart recovery, intentional disconnect, cloud deletion, existing-file restore, first connection without a file, old JSON import, ZIP restore, and Countdown audio. Keep controlled simulations separate from live-account checks.

## Prepare listing and assets

1. Use `STORE_LISTING.md` for descriptions and feature text, `PRIVACY_DISCLOSURE.md` for store disclosures, and `REVIEWER_NOTES.md` for review instructions.
2. Verify the public policy at `https://aurastart.pages.dev/privacy-policy.html` reflects the release. This local update does not deploy it.
3. Review the five 1280 × 800 screenshots in `Photo/` in filename order. They were captured from 2.1.0 on 2026-10-04 with synthetic demo fixtures and Drive disconnected; see `SCREENSHOTS_CHECKLIST.md`.
4. Review the `Promo/` composites regenerated on 2026-10-04 from the current 2.1.0 screenshots. Confirm current size requirements in the developer dashboard. The wide asset is `marquee-promo-1400x560.png`.
5. Confirm category, language, support/source links, and live store/site URLs. Do not publish an unverified store link or claim equal reliability to A Fine Start.

## Submit after release approval

Open the Chrome Web Store Developer Dashboard, select the correct item, upload the newly validated 2.1.0 package and reviewed assets, fill the matching privacy fields, attach reviewer notes, and submit for review. Verify the resulting release status before changing public availability claims.
