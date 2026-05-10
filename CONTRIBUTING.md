# Contributing To Aura Start

Aura Start is fully open-source under the MIT License. Contributions, forks, audits, and local modifications are welcome.

## Project Principles

- Keep Aura Start local-first.
- Do not add accounts, analytics, trackers, affiliate code, forced sync, or backend requirements.
- Do not add remote hosted runtime code.
- Do not add new extension permissions unless the feature cannot work without them and the permission is clearly documented.
- Preserve user data ownership, exportability, restore points, and safe import validation.

## Development Checks

Before submitting changes, run:

```bash
npm install
npm run typecheck
npm run build:store
```

`npm run build:store` verifies the production build and Chrome Web Store readiness basics for the generated `dist` package.

## License

By contributing to Aura Start, you agree that your contribution is provided under the MIT License.
