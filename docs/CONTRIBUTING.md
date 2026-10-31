# Contributing to GlassChat

GlassChat is an early Beta project. Before investing in a larger change, open an issue or discussion in the official repository so scope and compatibility can be agreed. Small documentation fixes and reproducible bug reports are welcome.

## Before opening a pull request

- Keep changes focused and preserve the existing Electron, Node.js, Socket.IO, PostgreSQL and static-site architecture unless a design change is explicitly approved.
- Describe which behavior exists today and which behavior is proposed; do not claim that planned features, end-to-end encryption, local-only message storage or a production service are available unless implementation and deployment have been verified.
- Do not include passwords, access tokens, OAuth material, database URLs, signing keys, real account data or private diagnostics in source, issues, screenshots or logs.
- Run the checks relevant to your change from the repository root:

  ```sh
  npm ci
  npm run check:version
  npm test
  ```

- For website changes, also run:

  ```sh
  cd website
  node scripts/build-site.mjs
  node scripts/check-site.mjs
  ```

- For packaging-related changes, run the Windows packaging workflow or build on Windows. CI packaging candidates are validation artifacts only; they are not official releases.
- Update the applicable documentation, changelog and public status descriptions alongside behavior changes.

## Bug reports and security issues

A useful bug report includes the GlassChat version/build, Windows version (if applicable), steps to reproduce, expected and observed behavior, and a sanitized error message. Remove usernames, email addresses, tokens, database details and message content from logs before sharing.

For suspected vulnerabilities, use the contact and reporting guidance on the [GlassChat security page](https://kamekhax.github.io/GlassChat/security/). Do not publish exploit details or another person's data in a public issue before maintainers have had a chance to respond.

## Releases

Only maintainers should publish a GitHub Release. A successful build or a CI artifact is not a release. Follow the repository's Windows distribution and deployment guides, verify the installer and checksums, and confirm that each download link points to an asset that actually exists before announcing a release.
