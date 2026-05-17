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
14. Submit for review manually.

Before upload, verify that the ZIP was built with the real `AURA_GOOGLE_OAUTH_CLIENT_ID` for the release extension.
