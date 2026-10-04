# Screenshot Demo Data

> Maintainer-only document. These fixtures are for isolated screenshot capture and manual preview only.

`npm run screenshots` uses non-personal data to render the current Aura Start application in a real installed Chromium browser. The executable fixture lives in `scripts/lib/screenshot-fixture.mjs`; the [capture guide](SCREENSHOTS.md) describes the command and output. The fixture is not shipped as user data and does not change production defaults.

## Data Boundaries

- Use example links and public reference URLs, never a personal bookmark export or browsing session.
- Keep all fixture storage inside the run's isolated preview and temporary browser profile.
- Keep Google Drive off and disconnected. Do not seed credentials, a fake connected account, cloud files, successful uploads, or sync timestamps.
- Use the application's real settings schema, controls, and bundled assets. Do not replace the interface with screenshot-specific HTML or CSS.
- Derive release/version information from the current package and rendered application. Do not hardcode a future version into the screenshot.
- Do not claim that these local-preview screenshots test native browser permissions or Google Drive integration.

The preview supplies a synthetic extension API surface so the built application can run on its loopback page. It does not load a user's installed Aura Start profile. External requests are blocked; visible example links are not opened during capture.

## The Five Scenes

### Links And Groups

Use a small, readable collection of everyday groups, such as Daily, Research, Tools, and Personal, with a nested group to demonstrate organization. Suitable links include a project dashboard on `example.com`, public documentation, a reading list, and planning notes. Keep titles and descriptions short enough for the actual layout.

Choose the theme, built-in background, columns, and other appearance options through valid application settings. Those settings change the real interface in the same way as a user's preferences; they do not introduce a separate screenshot design.

### Notes And Countdown

Use a short Markdown note about planning or reviewing a project. Enable Notes and Countdown for this scene and show their real controls without a long-running or completed personal timer.

Store notes under `settings.notes.text`, timer preferences under `settings.timer`, and widget visibility under `settings.widgets`. Do not seed the legacy `uiState.widgetNotes` field. Google Drive stays disconnected even though the feature can synchronize notes and timer preferences in a connected installation.

### Full Backup ZIP

Open Aura Start's actual export/backup interface and show its Full Backup ZIP choice. Use the ordinary sample groups and settings; no private backup is imported. The screenshot documents the visible export feature, not the contents of a user's archive.

### Custom Timer Sound

Generate a small sample WAV in the run's temporary workspace. Supply it through the real audio file input and wait for Aura Start's normal import/preparation workflow to finish. Capture the resulting custom-sound setting and its controls.

Do not seed a fake processed file, borrow a user's recording, or rename an unrelated file to suggest codec support. This scene demonstrates the actual WAV import path; it does not certify every supported audio format.

### Google Drive Sync

Open the real Google Drive settings with synchronization off and the account disconnected. Show the connection controls and explanatory text as the application renders them. Do not click Connect, authorize a real account, or manufacture a successful sync state for a screenshot.

## Manual Capture And Review

For manual captures, use an isolated test browser profile and equivalent public/example data. Follow the same privacy and authenticity rules as the automated workflow. Never clear or replace a personal Aura Start installation just to prepare store images.

Review every image before uploading. Check readability, scene framing, the visible release version where present, and the absence of account information, local paths, or browser profile data. If an application change breaks automated navigation, update the capture script to use the new real controls; do not draw substitute controls or edit product text into the image.

New automated captures are stored as separate runs under the ignored Chrome and Firefox submission folders. The public website's October 4, 2026 gallery and older local `Photo` artwork are historical captures, maintained separately.
