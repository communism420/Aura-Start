# Manual Chrome Web Store Upload Checklist

Codex cannot publish this extension for you. The final Chrome Web Store upload must be done manually by the developer.

1. Open Chrome Web Store Developer Dashboard manually.
2. Create or edit the Aura Start item.
3. Upload the fresh ZIP from `Chrome Submit/aura-start-1.2.0-chrome-web-store.zip`.
4. Fill the short description from `Chrome Submit/STORE_LISTING.md`.
5. Fill the detailed description from `Chrome Submit/STORE_LISTING.md`.
6. Upload screenshots from `Photo/` in filename order.
7. Set category to Productivity.
8. Set language to English.
9. Set privacy policy URL after GitHub Pages is published.
10. Fill privacy practices from `Chrome Submit/PRIVACY_DISCLOSURE.md`.
11. Add support/source URL.
12. Add reviewer notes from `Chrome Submit/REVIEWER_NOTES.md`.
13. Confirm permissions match `storage`, `identity`, `https://www.googleapis.com/*`, and `drive.appdata`.
14. Confirm `manifest.json` in the ZIP includes the current `background.service_worker` and `commands.toggle-command-palette` entries.
15. Confirm the ZIP contains `manifest.json` at archive root and does not contain `dist/`, `src/`, `docs/`, `Photo/`, `Chrome Submit/`, `node_modules/`, `.git`, `.env`, or source files.
16. Run `npm run validate:zip` against the final Chrome Submit ZIP.
17. Complete the installed-extension test matrix in `docs/INSTALLED_EXTENSION_TEST_MATRIX.md` against the exact ZIP build.
18. Submit for review manually.

Before upload, verify that the ZIP was built with the real Chrome Extension `AURA_GOOGLE_OAUTH_CLIENT_ID` for the published extension ID. Use `AURA_ENABLE_GOOGLE_WEB_OAUTH_FALLBACK=true` and `AURA_GOOGLE_WEB_OAUTH_CLIENT_ID` only if Brave/Chromium fallback support is intentionally tested with the final redirect URI `https://<extension-id>.chromiumapp.org/oauth2`. Confirm the final ZIP requests only `https://www.googleapis.com/auth/drive.appdata`, not full Drive or `drive.file`, and does not contain any unapproved bundled OAuth client ID.
