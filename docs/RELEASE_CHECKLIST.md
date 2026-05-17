# Aura Start Release Checklist

Use this checklist before preparing a Chrome Web Store upload. Do not publish from automation; upload manually through the Chrome Web Store Developer Dashboard.

## Pre-Build

- Run `npm install`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Run `npm run build:store`.
- Set a real `AURA_GOOGLE_OAUTH_CLIENT_ID` for release builds.
- Set `AURA_GOOGLE_WEB_OAUTH_CLIENT_ID` too if the Web OAuth fallback is required.
- Inspect `dist/manifest.json`.
- Confirm `manifest_version` is `3`.
- Confirm no remote hosted code or remote scripts are present.
- Confirm permissions are least-privilege.
- Confirm there is no full Google Drive scope.

## Fresh Chrome Web Store ZIP

- Run `npm run build:store`.
- Confirm `dist/manifest.json`.
- Create ZIP with the contents of `dist` at the archive root.
- Verify `manifest.json` is at the ZIP root, not under `dist/`.
- Verify no source files or secrets are included.
- Verify real OAuth client ID for release build.
- Verify ZIP does not include `node_modules`, `docs`, `.git`, source files, `.env`, screenshots, or development artifacts.
- Upload ZIP manually in Chrome Web Store Developer Dashboard.

## Manual Browser Test

- Install `dist` as an unpacked extension.
- First-run onboarding.
- Add group.
- Add link.
- Edit group.
- Edit link.
- Search.
- Query modifiers, if implemented in the current build.
- Keyboard shortcuts.
- Command Palette.
- Import from A Fine Start.
- JSON import.
- JSON export.
- Browser Bookmarks HTML export.
- Markdown export.
- CSV export.
- A Fine Start-compatible export.
- Restore Points Manager.
- Duplicate Finder.
- Remove demo data.
- Reset with restore point.
- Corrupted storage recovery if feasible.
- Optional Google Drive connect.
- Optional Google Drive disconnect/delete backup.

## Chrome Web Store Manual Steps

- Upload ZIP manually.
- Fill short description from `docs/STORE_LISTING.md`.
- Fill detailed description from `docs/STORE_LISTING.md`.
- Upload screenshots using `docs/SCREENSHOTS.md`.
- Set category.
- Set privacy practices.
- Add privacy policy URL from published GitHub Pages `docs/privacy-policy.html`.
- Add support URL.
- Add source code URL.
- Add reviewer notes from `docs/STORE_LISTING.md` or `STORE_SUBMISSION.md`.
- Submit for review manually.

## Post-Launch

- Verify the public listing text and screenshots.
- Test install from the Chrome Web Store listing.
- Confirm Google Drive OAuth works for the published extension ID.
- Collect feedback through GitHub Issues or the chosen support URL.
- Triage bugs, especially import/export, restore, duplicate deletion, and Drive sync.
- Prepare 1.2.1 if launch feedback finds release-blocking issues.

## Release Blockers

- TypeScript or production build failure.
- Store validation failure.
- Placeholder OAuth client ID in a release ZIP.
- Remote code, analytics, or tracking found in the build.
- Manifest permissions beyond the documented least-privilege set.
- Screenshots or listing text claiming features not present in the local build.
