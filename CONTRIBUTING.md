# Contributing

Thanks for helping improve Swiss Scooters.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Keep changes focused and explain user-visible behavior.
- Do not add provider feeds without documenting their redistribution terms.
- Do not commit credentials, `.env` files, signing material, device identifiers,
  or precise user-location data.

## Development workflow

1. Fork or clone the repository.
2. Create a branch from `main`.
3. Install dependencies with `npm ci`.
4. Make the change and add proportionate tests.
5. Run:

   ```bash
   npm audit --audit-level=moderate
   npm run lint
   npm test
   npm run build
   npm run test:e2e
   ```

6. If native code changed, run the `SwissScooters` unit-test scheme in Xcode.
7. Open a pull request using the repository template.

## Style and scope

- Follow the existing TypeScript, React, Swift, and SwiftUI conventions.
- Keep the map usable without an account.
- Preserve accessibility, localization, privacy, and upstream fair-use behavior.
- Use source attribution anywhere new data is displayed.

By contributing, you agree that your contribution is licensed under the MIT
License included in this repository.
