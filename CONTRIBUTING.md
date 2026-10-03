# Contributing To Aura Start

Aura Start's application source uses the MIT License. Bundled third-party components retain their own licenses and notices. Contributions, forks, audits, and local modifications are welcome.

## Project Principles

- Keep Aura Start local-first.
- Do not add required accounts, analytics, trackers, affiliate code, forced sync, or backend requirements.
- Do not add remote hosted runtime code.
- Do not add new extension permissions unless the feature cannot work without them and the permission is clearly documented.
- Preserve user data ownership, exportability, restore points, and safe import validation.

## Development Checks

Before submitting changes, run:

```bash
npm ci
npm run typecheck
npm test
```

`npm run dev` starts a UI preview; extension APIs and real OAuth require an installed extension build. `npm run build` generates `dist`, and `npm run build:local` generates `dist-local`. `npm run build:store` requires the release Device OAuth credential in the environment and generates/validates `dist`; it does not create a ZIP. `npm run build:firefox` requires configured Device OAuth credentials and generates, sanitizes, finalizes, and validates `dist-firefox`.

For this project's delivery workflow, refresh all four browser/credential variants after changes, including documentation changes: `dist-google`, `dist-google-local`, `dist-firefox`, and `dist-firefox-local`. Follow the [release checklist](docs/RELEASE_CHECKLIST.md) for explicit output directories and matching credentials. Do not mix release and local OAuth configurations or claim UI-only builds verify OAuth.

## Data And Documentation Changes

- Follow [the settings schema contract](docs/SETTINGS_SCHEMA.md) when adding settings. Preserve explicit values, compatible unknown fields, and older backups; missing fields must not become false user edits.
- Cover meaningful sync/storage changes with regression tests for concurrent writes, deletion, offline recovery, and older data. Use the [installed-extension test matrix](docs/INSTALLED_EXTENSION_TEST_MATRIX.md) for browser checks and their recorded limits.
- Keep README, the privacy policy, the English site in `docs`, and store materials consistent with shipped behavior. Refresh screenshots when the interface changes. Keep historical release notes clearly marked as history.
- Keep `docs/google3bfd9cfed5085545.html` unchanged; it verifies the site for Google.
- Do not commit `.env.local`, credential notes, account tokens, private browser profiles, or personal test data. The bundled Device OAuth public-client credential is not a confidential server secret; unrelated secrets and personal credentials must never enter a package.
- Do not publish, push, or create submission archives as a side effect of a documentation update. Package and publish only as part of a requested release.

## License

By contributing to Aura Start, you agree that your contribution is provided under the MIT License.
