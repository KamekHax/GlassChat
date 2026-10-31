# GlassChat Beta Development Log

## 2026-10-31 — Beta kickoff / foundation pass

- Audited the Alpha project against the supplied Beta brief. Confirmed Electron + vanilla renderer + separate Express/Socket.IO server; no registered accounts, permissions, database, voice/video, or production security.
- Recorded existing working chat behaviors, nonfunctional controls, security blockers, measurement gaps, roadmap, and stage gates in `BETA_ROADMAP.md`.
- Added configurable `GLASSCHAT_DATA_FILE` server storage path to isolate tests from existing user/server history.
- Added `npm test` end-to-end acceptance coverage for health check, anonymous room join, realtime message delivery, channel creation, and JSON history persistence.
- Validation: `npm test` — 1 passing; `node --check` passes for server and renderer. Previously confirmed Windows portable artifact is a PE/NSIS self-extracting executable; this Linux environment does not provide Wine for a conventional installer build. The previous Socket.IO message smoke test passed.

### Known risks still open

This test coverage does not make the service safe for public/untrusted networks. Authentication, TLS, server-side identity and permissions, rate limiting, durable transactional storage, and abuse controls remain absent. There are no accounts, DMs, uploads, voice, video, or screen sharing. Performance has not yet been measured, and the ambient blur may be expensive on weaker GPUs.

### Next implementation steps

1. Add unit/integration tests for malformed events, payload limits, reconnect/disconnect, and history bounds; correct error behavior and startup/config validation.
2. Decide hosting mode and threat model before implementing identity. Then add authenticated identities, server-side authorization, rate limiting, TLS deployment path, and database migrations.
3. Set up a Windows CI build to verify signed NSIS installer, clean install/uninstall, settings persistence, and upgrade behavior.
4. Implement functional UI preferences/accessibility, removing or wiring dead controls; test reduced effects and light/dark/accent options.
5. Add profiles, communities/roles, DMs, notifications, search and uploads in dependency order; treat media as its own WebRTC/TURN milestone.


## 2026-10-31 — Central identity/auth foundation

- Recorded the user's decision: Beta is centrally hosted; GlassChat owns independent email/password identity in SQL; no ManusAI authentication; future self-hosted deployments should reuse the service by configuration.
- Added PostgreSQL schema/migration for unique case-insensitive usernames/emails, Argon2id password hashes, email verification and password-reset token digests, and hashed revocable opaque sessions.
- Added Express auth API endpoints for register, login, verify/resend email, forgot/reset password, current user, CSRF rotation, and logout. Security controls include generic login/reset responses, parameterized SQL, request JSON size limit, Helmet headers, HttpOnly/SameSite=Strict cookies (Secure in production), CSRF header validation for logout, origin checks, and per-process rate limits.
- Added SMTP adapter; production requires SMTP configuration and HTTPS base URL. Explicit console-token email mode is development-only and rejected in production.
- Added migration runner, server-only environment example, and PGlite auth lifecycle integration test. `node --test test/auth.test.js`: 1 passed, including schema migration twice, Argon2id persistence, email verification, session, CSRF rejection, logout, password reset/revocation, successful new login, and ensuring hashes are absent from API responses.
- Changed the legacy anonymous Alpha listener to bind to loopback by default; it remains unauthenticated and must not be exposed.

### Current limitations (do not advertise as complete auth release)

- No real PostgreSQL instance, SMTP credentials, public domain, TLS proxy, or hosted central infrastructure was provisioned in this coding environment. PGlite test coverage is not a production PostgreSQL/ops review.
- The Electron app is not yet integrated with registration/login/session cookies or verification/reset screens. The existing Socket.IO chat still trusts unauthenticated display names; authenticated socket handshakes and membership/permission checks are the next critical work.
- Rate limiting is per-process memory only, not shared across replicas. No production deployment review, external security audit, backup/restore drill, or abuse/load test has passed.
- Future self-hosting is an architectural intention: deploy the same API/database/mailer with per-instance configuration. It has not been validated operationally.

- Split the desktop and server manifests/lockfiles. PostgreSQL, Argon2id, and HTTP/email service dependencies now live in `server/package.json`; the Electron build includes only `src/**/*` and desktop metadata, preventing auth/database runtime dependencies from being bundled into the user client. The centrally operated service can be deployed independently. Full `npm test`: 2 passing suites (auth lifecycle plus legacy room-chat smoke/integration).
The backend's documented `npm ci --omit=dev` install was run successfully from `server/`; the root regression suite passed again afterward (2/2). Production startup now fails fast unless `APP_ORIGIN` is a strict HTTPS origin and `TRUST_PROXY=1` is set for the documented single trusted HTTPS reverse-proxy hop. No actual hosted database/mail credentials were used.


## 2026-10-31 — Beta desktop/authenticated text-chat slice

- Replaced the Alpha client account/server-name flow with a Liquid Glass desktop auth experience: register, sign in, email verification/resend, password recovery/reset, service URL configuration, sign-out, one Commons community and `#general` text channel.
- Main/preload now use a narrow IPC surface. The Electron main process performs API requests, reads the auth `Set-Cookie`, stores the opaque session encrypted with `safeStorage` when available, and opens Socket.IO with that session cookie. Renderer JavaScript never receives a cookie/token/hash. Renderer has strict CSP, no remote font fetches, and `contextIsolation`, Node integration disabled, and sandbox enabled.
- Added the `002_community_chat.sql` PostgreSQL migration for Commons, membership, channels and messages; registration enrolls new users and the migration enrolls existing users. Authenticated REST routes return only member communities/history. Socket handshake requires a live verified SQL session; channel membership is checked on join and each send; author identity comes from SQL session; messages persist in SQL. Added per-socket message/typing/join throttles, presence, room switching, and session-expiry checks.
- Logout disconnects the matching live Socket.IO session; password reset disconnects the user's sessions; a one-minute backend sweep disconnects expired sessions. Socket browser origins are checked against `APP_ORIGIN`; native Electron clients use the cookie handshake without a browser Origin.
- Account verification/reset UX currently requires users to copy the one-time token from the email link into the app. There is no app deep-link handler or hosted landing page. The app is not preconfigured with an official public GlassChat server URL.
- Verification: `npm test` passes 3/3 suites (auth lifecycle incl. resend/token invalidation and reset revocation, community/membership/realtime plus live socket revocation, and legacy server regression). `node --check` passes for desktop, auth server, and test JavaScript. Electron was launched under Xvfb for a renderer startup smoke test; initial launch surfaced the missing-CSP warning, which was corrected with a restrictive self-only policy. GPU warnings under Xvfb are environment-related; visual QA was not performed.
- No real PostgreSQL, SMTP credentials, public domain, HTTPS reverse proxy, central infrastructure, or Windows clean-install test was provisioned. HTTP/socket rate limiting remains process/connection-local; deployment, backups, load/security review, and Windows signed NSIS installer remain open. See README and roadmap for details.


## 2026-10-31 — Security regression review and fixes

- Re-ran the regression suite (3/3 pass) and syntax checks. Read-only review identified a live-message event-shape mismatch, idle Socket.IO sessions that could remain connected until the periodic cleanup, and Argon2 hashing before password-reset-token validation. Corrected renderer message handling, added exact session-expiry disconnect timers plus the existing cleanup sweep as backup, and moved password hashing after the valid one-use reset token is locked. Added an idle-session-expiry regression test. Socket-session database revalidation now fails closed without an unhandled async rejection.
- Full desktop `npm audit` initially found two high-severity Electron-related advisories and moderate build-tool findings. Upgraded the packaged Electron runtime from 35.7.5 to 45.2.1, then reran tests and an Xvfb renderer-startup smoke test. The high findings cleared; backend full audit and desktop production-dependency audit report zero findings. The desktop full development/build dependency tree still reports 15 moderate transitive advisories, primarily in packaging/build tools; no forced breaking downgrade was applied.
- Confirmed the source/runtime manifests and account implementation contain no Manus authentication or SDK references. No real PostgreSQL deployment, SMTP delivery, TLS host, Windows install/upgrade test, penetration test, or external security review was performed.
- Clarified a newly raised architecture gap: the current Beta stores channel message text centrally in PostgreSQL and is not local-first or E2EE. Central GlassChat identity/authentication and future local-first chat can be separated, but private E2EE and local history require a designed change to storage/sync/key management/offline delivery. This run documented that impact only; it did not begin the redesign.


## 2026-10-31 — Windows distribution build 1.0.1

- Kept the existing account, chat, storage, and transport architecture unchanged. This release work is packaging/versioning only; channel messages remain centrally stored in PostgreSQL in the current Beta, and no local conversation-history store or E2EE was added.
- Advanced the desktop package from 1.0.0 to semantic version 1.0.1 (build ID `20261031.1`), keeping package name `glasschat-desktop` and app ID `com.glasschat.desktop` stable for profile and installer identity. Version/build appears in the renderer, native title, startup log, installer filenames, and release notes.
- Added a GlassChat-branded multi-size Windows icon, assisted per-user NSIS setup configuration, Start Menu/desktop shortcuts, data-preservation configuration, differential-package support, and a semantic-version downgrade guard. Created `GlassChat-Setup-1.0.1.exe`, the requested `GlassChat-Setup.exe` alias, and `GlassChat-Portable-1.0.1.exe`.
- Added release SHA-256 checksums/JSON manifest, release notes, and `WINDOWS_DISTRIBUTION.md`. The same stable `%APPDATA%\\glasschat-desktop` data folder was used by the previous 1.0.0 package and this release. No local conversation data currently exists to preserve.
- Verification: `npm test` passed 3/3; changed desktop/auth/server/test JavaScript syntax checks passed; package and lockfile versions/app ID matched; SHA-256 checksums passed. PE resource inspection verified version 1.0.1, GlassChat product/company metadata, and icon resources in installer, portable artifact, and packaged app. The app executable's ProductVersion uses Windows' normal four-part `1.0.1.0` representation. Linux Electron smoke remained open to the expected timeout and logged the version/build.
- Wine limitations: setup execution returned without installing for both the release installer and a disposable no-guard control build, so the custom guard is compile-tested only. The packaged Windows app logged the correct version but exited with Wine-specific network/cache/crashpad errors. Install, first-launch, shortcut, upgrade, user-data-retention, downgrade, and uninstall tests therefore remain **not passed/not verified**; native Windows 10/11 validation is a public-release gate.
- Distribution limits: artifacts are unsigned; no signing certificate, official download host, deployed GlassChat backend, or active automatic-update feed/client was configured. Differential metadata and stable identity are preparation only, not automatic updates. The generated icon is based on the existing in-app G mark and still needs brand-owner approval if pre-approved official artwork is required.
