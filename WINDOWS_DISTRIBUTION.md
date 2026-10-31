# GlassChat Windows Distribution

## Release identity

The current application and service source use semantic version **1.0.1** and build identifier **20261031.2**. The available local Windows candidates were built earlier as **20261031.1** and do not match the current source. No installer has yet been rebuilt from build .2, verified on native Windows, or published. `package.json` is the version source of truth; the lockfiles follow it. Use `npm version patch`, `npm version minor`, or `npm version major` for later releases so npm updates the package and lockfile together. Assign a fresh, monotonically increasing build ID to each distributable build.

The earlier .1 candidates reported version/build metadata in the app footer, native title, startup log and Windows resources. Those metadata results describe only the older binaries, not the current .2 source. Rebuild and inspect all versioned artifacts before using `GlassChat-Setup-1.0.1.exe`, the `GlassChat-Setup.exe` alias, or `GlassChat-Portable-1.0.1.exe` as a current distribution.

## Installer behavior (configured; installation not yet verified)

The installer uses electron-builder's NSIS assisted installer, retaining the existing app ID `com.glasschat.desktop` to preserve upgrade/uninstall identity. It is configured for a per-user install at `%LOCALAPPDATA%\Programs\GlassChat`, without requiring administrator elevation. Electron, Chromium, Node.js, and client dependencies are packaged; users do not install Node.js or developer tools. GlassChat's central auth/chat service is separate and is not bundled with database credentials or SMTP secrets.

A fresh setup is configured to create a Start Menu shortcut and a desktop shortcut by default. The assisted NSIS template exposes a no-desktop-shortcut option if the user does not want the desktop link; the default update path recreates shortcuts, so use the same option on reinstall/updates when omission is desired. The uninstaller is configured to remove installed app files and shortcuts but not per-user application data. These expected install/uninstall actions still require native Windows confirmation.

The package name was `glasschat-desktop` in both the previous 1.0.0 source release and this build. Electron's current settings/session folder is therefore `%APPDATA%\glasschat-desktop` (the Windows test launch created its diagnostic log there). This directory is intentionally outside the install directory and remains stable across the package-version update. Current settings and encrypted session material can be retained through upgrades/reinstalls; uninstall has `deleteAppDataOnUninstall=false`.

The current Beta has **no local conversation-history database**: channel messages are stored on the central service. There is no local message history to preserve today. If local history is added, store it under the app-data folder and keep it out of installer cleanup. The packaged client still defaults to the local development service URL; it cannot support internet chat until an HTTPS GlassChat backend is deployed and configured.

An NSIS initialization guard reads the installed `DisplayVersion` and refuses to install an older semantic version over a newer one. Reinstalling the same version and upgrading to a newer version are allowed. This guard compiled successfully; its behavior is not yet confirmed on native Windows.

## Future automatic updates

The packaging is update-ready, not an active updater: it uses a stable app ID, versioned NSIS artifacts, and electron-builder differential-package support. No update client/feed URL is activated because GlassChat has no official download host or signing certificate configured. A production updater will additionally need an update client (for example, `electron-updater`), HTTPS hosting for its feed metadata and installer/blockmap artifacts, and an Authenticode signing certificate. Until then, users must download and run newer releases manually. Do not publish unsigned binaries as trusted automatic updates.

## Publishing on the official GlassChat website

1. Upload the versioned installer, portable executable (if offered), release notes, and SHA-256 release manifest to an HTTPS-controlled downloads location. Keep versioned files immutable; publish `GlassChat-Setup.exe` only after the versioned artifact is verified.
2. Link to the versioned installer from the Windows download page and state semantic version, architecture (Windows x64), publisher, and signed/unsigned status. Show release notes and SHA-256 alongside the download.
3. Serve installers as `application/octet-stream` (or the platform's standard Windows executable MIME type), with `Content-Disposition: attachment`, HTTPS, and a stable certificate. Do not put environment files, database credentials, or SMTP secrets alongside desktop binaries.
4. Host the central GlassChat API separately. Configure a public HTTPS API URL only after that endpoint is deployed and tested.
5. For future automatic updates, publish only signed releases and the feed/blockmap files required by the chosen updater. Publish a new feed only after the complete native Windows validation passes.

## Verification results and remaining gates

- Latest repository regression run after the Gmail adapter and origin-restricted CORS changes: `npm test` — 7 tests passed, 0 failed. This does not verify Gmail OAuth or a live PostgreSQL service.
- Linux development Electron smoke: the app remained open until the expected timeout, and wrote `GlassChat 1.0.1 build 20261031.1` to its startup log.
- Windows build: NSIS installer and x64 portable executable compiled. PE resource inspection confirms the release version, product name, company, description, and icon resources.
- Wine: the packaged Windows executable wrote the correct version/build log, but exited with Wine-specific networking/cache/crashpad errors. NSIS setup exited without installing in both the release build and a disposable no-guard control build. Thus Wine did **not** verify Windows first-launch, installation, shortcuts, upgrade, data preservation, downgrade refusal, or uninstall.
- Native Windows 10/11 testing remains a release gate. On a clean Windows x64 machine, verify install, first launch, both shortcuts, a 1.0.0-to-1.0.1 in-place upgrade, settings/session persistence, refusal of a 1.0.1-to-1.0.0 downgrade, uninstallation, user-data retention, and Add/Remove Programs/file-version metadata. Record the exact Windows build. Until that is done, do not claim those lifecycle tests passed.

## Branding and signing

The source project did not include separately approved icon artwork. This build uses a newly created GlassChat speech-loop icon based on the existing in-app G mark. If “official icon” means previously approved corporate artwork, obtain brand-owner approval or supply the approved asset before public release. The binaries are **unsigned** because no GlassChat Authenticode certificate was provided; Windows SmartScreen may warn, and signing is required for broad public distribution and trusted automatic updates.
