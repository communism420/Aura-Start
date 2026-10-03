# Firefox Source Build Notes — Aura Start 2.1.0

Updated October 4, 2026. These are reproducible build instructions, not a record of a completed store submission. Existing 2.0.x extension/source ZIPs in this folder have not been rebuilt. The current `dist-firefox` directory is a 2.1.0 build; it must be rebuilt and validated from the exact source revision chosen for a future upload.

Source repository: <https://github.com/communism420/Aura-Start>.

## Build Environment And Command

Use Node.js and npm, and record their exact versions with the submitted source revision. From the extracted source archive root:

```powershell
npm ci
$env:AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_ID='<Firefox Device OAuth client id>'
$env:AURA_GOOGLE_FIREFOX_DEVICE_OAUTH_CLIENT_SECRET='<matching Firefox Device OAuth client secret>'
$env:AURA_FIREFOX_EXTENSION_ID='<the existing AMO add-on id>'
npm run build:firefox
```

Use the established release OAuth client for the same Google Cloud project as the other Aura Start builds. Do not substitute an unpacked Chromium client or commit credentials. The client configuration is necessarily present in the built extension; it is not a server-side secret protecting user data. Actual Google user access/refresh tokens are stored only in the user's profile and must never be included in source or submission materials.

`build:firefox` runs, in order:

1. TypeScript checking (`tsc --noEmit`).
2. Vite production build in Firefox mode to `dist-firefox`.
3. `scripts/sanitize-firefox-js.mjs` to remove unused raw-HTML paths and reject remaining unsafe HTML sinks.
4. `scripts/finalize-firefox-build.mjs` to produce the Firefox manifest.
5. `scripts/validate-firefox-build.mjs` to validate the package, local decoder, and license notices.

Do not bypass the sanitizer by running only Vite and manifest finalization. Do not use `AURA_FIREFOX_ALLOW_MISSING_DEVICE_OAUTH=true` for a release; that flag is for UI-only smoke builds.

## Firefox Manifest

- Manifest V3, version 2.1.0.
- `background.scripts: ["background.js"]` and `type: "module"`.
- `storage` and `alarms`; optional `tabs`.
- Google API hosts `https://www.googleapis.com/*` and `https://oauth2.googleapis.com/*`.
- No Chrome `manifest.oauth2` or `identity` permission.
- Gecko ID must match the existing AMO add-on; the script's default is `aura-start@example.com` and is not a substitute for confirming that identity.
- `strict_min_version: "142.0"`.
- Data collection metadata: required `["none"]`, optional `["browsingActivity", "technicalAndInteraction"]`.
- CSP: `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'` for the packaged decoder; no ordinary `unsafe-eval` or remote executable code.

## Packaged Workers And Decoder

| Component | Source/build location | Runtime role |
| --- | --- | --- |
| ZIP worker | `src/utils/zipBackup.worker.ts`, `zipBackupFormat.ts`; built `assets/zipBackup.worker-*.js` | Local ZIP encoding/validation using `fflate` 0.8.3. |
| Audio wrapper/worker | `@ffmpeg/ffmpeg` 0.12.15; built `assets/worker-*.js` | Local fallback when browser-native audio decoding fails. |
| FFmpeg core | `vendor/ffmpeg/ffmpeg-core.js` and `ffmpeg-core.wasm` in the build | Unmodified single-thread ESM `@ffmpeg/core` 0.12.10, about 32 MB. |
| Decoder notices | `vendor/ffmpeg/NOTICE.txt`, `FFMPEG-WASM-LICENSE.txt`, `COPYING.GPLv2.txt` | Versions, hashes, licenses, and matching upstream source/build recipe. |

The wrapper is MIT; the bundled core is GPL-2.0-or-later and includes FFmpeg n5.1.4 and upstream-linked components. Aura Start's application MIT license does not replace third-party terms. Preserve notices and the corresponding source/build materials required for redistribution. `scripts/validate-audio-decoder.mjs` validates the pinned core hashes and local worker loading. The runtime never fetches decoder code from a CDN or uploads audio to a conversion service.

## Source Archive

Include `src/`, `public/`, `scripts/`, the root HTML entry points, package/lock files, Vite/TypeScript/Tailwind/PostCSS configuration, license and documentation files needed to explain and reproduce the package. Supply the build instructions and matching decoder source/build provenance with the submission. Source maps are not a substitute for readable source.

Exclude `node_modules/`, generated `dist*` directories, `.git/`, `.env*`, private credential files, real user profiles/backups, and old submission archives. Supply required OAuth build values privately through the store's reviewer mechanism if needed for reproduction; do not publish them in the public source archive.

## Future ZIP And Validation

When a release is explicitly prepared, package the **contents** of the validated `dist-firefox` directory, including `vendor/ffmpeg` and all generated workers, with `manifest.json` at the archive root. The planned name is `Firefox Submit/aura-start-2.1.0-firefox.zip`; a separate readable source archive is also needed. Neither is created by this documentation update.

Then run:

```powershell
npm run validate:firefox
npm run validate:firefox:submit
```

Run Mozilla's add-ons linter on the exact resulting ZIP, and record the command, version, and results. Install and test that exact package before upload. Do not treat an earlier `dist-firefox` or historical ZIP validation as evidence for a new archive.
