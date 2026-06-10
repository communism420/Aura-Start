# Manual Chrome Web Store Upload Checklist

Codex cannot publish this extension for you. The final Chrome Web Store upload must be done manually by the developer.

1. Open Chrome Web Store Developer Dashboard manually.
2. Create or edit the Aura Start item.
3. Upload the fresh ZIP from `Chrome Submit/aura-start-1.2.3-chrome-web-store.zip`.
4. Fill the short description from `Chrome Submit/STORE_LISTING.md`.
5. Fill the detailed description from `Chrome Submit/STORE_LISTING.md`.
6. Upload the 5 screenshots from `Chrome Submit/Photo/` in filename order.
7. Upload promotional images from `Chrome Submit/Promo/`:
   - Small promotional image: `small-promo-440x280.png`
   - Very large promotional image: `large-promo-1400x560.png`
8. Set category to Productivity.
9. Set language to English.
10. Set privacy policy URL after GitHub Pages is published.
11. Fill privacy practices from `Chrome Submit/PRIVACY_DISCLOSURE.md`.
12. Add support/source URL.
13. Add reviewer notes from `Chrome Submit/REVIEWER_NOTES.md`.
14. Confirm permissions match `storage`, `identity`, `https://www.googleapis.com/*`, and `drive.appdata`.
15. Confirm `manifest.json` in the ZIP includes the current `background.service_worker` and `commands.toggle-command-palette` entries.
16. Confirm the ZIP contains `manifest.json` at archive root and does not contain `dist/`, `src/`, `docs/`, `Photo/`, `Chrome Submit/`, `node_modules/`, `.git`, `.env`, or source files.
17. Run `npm run validate:zip` against the final Chrome Submit ZIP.
18. Complete the installed-extension test matrix in `docs/INSTALLED_EXTENSION_TEST_MATRIX.md` against the exact ZIP build.
19. Submit for review manually.

Before upload, verify that the ZIP was built with the real Chrome Extension `AURA_GOOGLE_OAUTH_CLIENT_ID` for the published extension ID and the real `AURA_GOOGLE_WEB_OAUTH_CLIENT_ID` for Brave/Chromium fallback support. The Web OAuth client must authorize the final redirect URI `https://<extension-id>.chromiumapp.org/oauth2`. Confirm the final ZIP requests only `https://www.googleapis.com/auth/drive.appdata`, not full Drive or `drive.file`, and does not contain any unapproved bundled OAuth client ID.

Before submission, install the exact ZIP build and verify Google Drive connect, automatic backup after local edits, first-run restore from an existing Drive sync file, no-file messaging when no sync file exists, and delete-backup/disconnect behavior.
