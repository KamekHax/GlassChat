# GlassChat Beta Roadmap

## Architecture decisions (2026-10-31)

- **Central hosting for Beta:** GlassChat operates accounts, communities, storage, and service infrastructure. End users do not run community servers. A future self-hosted deployment should be possible through the same service code and per-instance configuration/database, not a client-auth rewrite.
- **Independent authentication:** GlassChat owns email/password identity in SQL. ManusAI or Manus-managed authentication is not part of the account or access path. Passwords use Argon2id, and identity/session/permission checks belong on the backend.
- **Current implementation boundary:** `server/auth/` contains PostgreSQL-backed email/password auth, migrations, Gmail API/SMTP/console mail adapters, opaque revocable sessions, CSRF checks, member-scoped Commons/channel APIs, and authenticated Socket.IO text chat. Render Free is temporarily connected to the Frankfurt Neon project and the tracked migrations are applied. Google OAuth is in Testing; the owner received one direct Gmail API test email, but the refresh token expires after seven days and account flows have not been verified end to end. The Electron client derives identity from the verified session. Legacy `server/index.js` remains an anonymous local Alpha and must never be publicly exposed.
- **Client/session boundary:** the Electron main process owns auth HTTP and Socket.IO connections; a narrow preload exposes operations to the renderer. Session material is encrypted using Electron `safeStorage` when available and is never exposed as a cookie to renderer JavaScript. The desktop still supports one-time token entry. No-index verify/reset pages and a temporary Render API base are present in the unpublished build .3 website source; the current live Pages site may not yet contain that update, and the account flows remain untested.
- **Package boundary:** desktop and the deployable service have separate manifests/lockfiles. PostgreSQL, Argon2id, Gmail API/SMTP mailers, Express and Socket.IO server dependencies remain backend-only; the Socket.IO client is a desktop dependency.
- **Local-first/E2EE gap:** the current Beta message data plane is central and plaintext-in-PostgreSQL. The operator explicitly accepted this only for a clearly disclosed limited Beta; it is not local-first and does not provide E2EE. A future local-first/private-E2EE data plane would need separate design for history persistence, synchronization, device trust/key recovery and offline delivery. Do not claim those properties today.

## Starting point: Alpha audit

The repository is a small Electron 35 desktop shell (`src/main.js` and `src/preload.js`) loading a vanilla HTML/CSS/JavaScript renderer (`src/index.html`, `src/renderer.js`). The renderer connects to an Express + Socket.IO server (`server/index.js`). The server stores up to 500 messages per channel in a local JSON file and keeps presence in memory. There is no database migration framework, authentication, account model, server/tenant model, or CI/test suite in the original Alpha.

**Verified Alpha behavior:** a client can join one of three default text channels; send/receive realtime text; see ephemeral channel presence and typing events; create up to 30 channels; and reload recent text from the JSON file. An integration check and the first automated acceptance test verify server health, joining, message delivery, channel creation, and local history persistence.

**Incomplete or misleading controls:** the plus attachment button is disabled and its title says uploads are not available; the apparent theme/settings button only removes the ambient background glow; the search/discover rail icon does not navigate; the three-dot menu opens connection setup rather than an invitation flow. These should be implemented or removed/renamed before any release claims.

**Security and reliability blockers:** anyone who can reach the legacy Alpha server can choose any display name, read channel history, post, and create channels; there are no accounts, server-side roles, or permission checks. CORS allows all origins; transport is HTTP unless a reverse proxy is supplied. The listener was changed to bind loopback by default; manually setting `HOST=0.0.0.0` exposes this unauthenticated service and must not be done on untrusted networks. There are no event rate limits, anti-spam controls, upload validation, audit logging, or abuse/report tools. History writes synchronously to a JSON file on every message, with no backup/locking/retention policy. The renderer has good basic HTML escaping for text and names, and Electron uses context isolation with Node integration off, but external-link handling and CSP/origin policy need a security review. The app starts reconnecting against localhost by default; peers need the server separately installed and reachable.

**Performance evidence:** the Alpha has a small, unbundled renderer and bounded history (500/channel), but no baseline startup/RAM/idle CPU measurements, profiling, or weak-hardware run. Build output contains an 80 MB portable Windows executable; the checked-in/local dependency tree is about 384 MB and `release/` about 370 MB. Electron/runtime size dominates the desktop artifact; claims of lightweight operation are not currently substantiated. UI blur effects should be reduced or disabled on lower-end hardware and for reduced-motion/accessibility settings.

## Roadmap and gates

### Beta 0 — Stabilize and measure the Alpha foundation (in progress)

- Capture architecture, working behavior, known nonfunctional controls, and security limits (this document).
- Establish repeatable server integration tests and isolate test data from real history.
- Replace synchronous JSON storage with a versioned database only after tests pin current behavior; introduce migration/backup and retention tests.
- Add profiling baseline: cold start to usable, idle CPU, idle/active RAM, message-to-render latency, history scroll performance; record machine/OS and measurement method.
- Remove or label inert controls; persist accessible theme, accent, animation/reduced-effects preferences; add keyboard/focus testing.

**Gate:** automated tests pass; no fake controls; baseline measurements and limitations are published.

### Beta 1 — Secure identity and community model (implementation slice complete; deployment/security gates open)

- Central deployment is selected; keep secrets and signing keys server-side. Preserve future self-hosting through configuration and separate deployments rather than provider-specific identity.
- Implemented and tested registration/login with Argon2id, verification/resend/reset tokens, hashed opaque sessions, CSRF checks, logout/revocation and per-process HTTP limits. Never trust client-supplied identity. Desktop account flows are wired. A temporary Render service is live and connected to Frankfurt Neon; the migrations are applied. Google OAuth is in Testing, and the owner received one direct Gmail API test email; its refresh token expires after seven days. **Remaining:** end-to-end registration/verification/login/chat checks, durable OAuth authorization, shared rate limiting, session lifecycle/threat review, and UX/security review.
- PostgreSQL migrations define users, email tokens, sessions, seeded Commons, memberships, channels, and messages. They have been applied to the temporary Neon deployment. PGlite integration tests cover repeated migrations, persistence, and access denial. **Remaining:** backup/restore tests, rollback strategy, monitoring, and production operations.
- Implemented Commons membership and `#general` text chat. History and channel joins are membership-checked; Socket.IO handshake is session-authenticated and derives user identity server-side; message writes recheck membership and persist in SQL. Roles are stored only as member/admin scaffolding; administration, invites, blocks/reports, and community/channel management are not implemented.
- Require HTTPS/WSS in production, exact-origin CORS between GitHub Pages and the API, CSP, input/rate/size limits, structured audit events, secret management, dependency scanning and security test cases.

**Gate:** automated tests prove a second non-member cannot list/read/join another user's channel and an authenticated socket message is stored under its session identity. Before a public service, establish durable email delivery, formalize the production database/backup/restore operations, run two-client tests, add shared throttles, and complete abuse/security review with no unresolved critical/high findings.

### Beta 2 — Useful text and social communication

- Implement profiles and free customization with safe upload pipeline (type/size limits, generated variants, malware checks as appropriate, object storage quotas); custom statuses and privacy controls.
- Implement friends/requests, DMs/group DMs, server invitations, message history/search, replies/threads, edit/delete, reactions, pins, mentions, notifications, optional read receipts, and blocks/reports.
- Add validated image/file attachments with storage quotas, signed access, deletion/retention behavior, and user reporting. Do not market voice messages/GIFs as supported until tested end-to-end.
- Add pagination/virtualized lists, indexes, caching and rate limits; verify performance at representative channel/history sizes.

**Gate:** multi-account scenario suite covers membership, message lifecycle, search, privacy, notifications, reconnects and upload abuse cases.

### Beta 3 — Voice, video, and screen sharing

- Introduce WebRTC with a signaling service and provisioned STUN/TURN (TURN bandwidth and regional availability have real operating costs); implement device selection, mute/deafen, VAD, push-to-talk, per-user volume, echo cancellation/noise suppression where supported, camera controls and screen sharing.
- Define call consent, permissions, encryption posture, quality telemetry with privacy limits, reconnect handling, and bandwidth adaptation.
- Test on Windows devices/networks, NATs, low bandwidth, sleep/resume, device removal, and multi-user sessions before public claims.

**Gate:** published device/OS/network matrix, latency and packet-loss measures, load and reconnect tests; no voice/video claims before these pass.

### Beta 4 — Release candidate and Windows distribution

- Earlier GlassChat 1.0.1 Windows x64 NSIS setup and portable artifacts were built as build `20261031.1`; the current app source is build `20261031.3`, so the older binaries do not match it. The next CI run will rebuild unsigned candidates for .3; no installer is published as a Release.
- Native install, first launch, shortcuts, 1.0.0-to-1.0.1 upgrade, data retention, downgrade rejection, and uninstall remain unverified: Wine setup execution failed even for a no-guard control build. Validate on clean Windows 10/11 VMs and non-admin accounts before public release.
- Future automatic updates are not enabled. Stable identity and differential NSIS packaging are in place; a signed update client/feed, code-signing certificate, HTTPS hosting, and signature verification are still required. Crash reporting is also not implemented.
- Add accessibility checks, keyboard navigation, high contrast, light/dark themes, configurable accent, reduced motion/effects, and hardware-accelerated blur fallback.
- Publish architecture, supported deployment model, data retention, backups, security limits, and operational cost/fair-use guidance.

**Gate:** native release test matrix passes, signed reproducible artifacts, uninstall/data retention verified, update signatures verified if updates are enabled, no known critical/high security issue, and performance targets reported with measurement methodology.

## Suggested performance targets (provisional; baseline first)

These are targets to test, not claims: warm navigation under 100 ms; server-to-render message p95 below 250 ms on a local network; no sustained idle polling; no unbounded renderer message DOM; startup and RAM targets set after measuring target low-end Windows hardware. Profile image dimensions/formats and history page size should be bounded. The 500-message Alpha history cap must become cursor-based pagination, not an unlimited DOM.

## Approved choices and remaining gates

- The approved hosting budget is 0 DKK/month, in Europe, without a custom domain. Neon Free Frankfurt and a temporary Render Free service are live for testing; Render may sleep or be interrupted. No paid service may be enabled without new approval.
- The operator approved centrally stored, application-readable channel text for a clearly disclosed limited Beta. This does not satisfy local-first/E2EE expectations; those remain future architecture work and must not be claimed.
- The user chose Gmail API/OAuth for low-volume verification/reset mail and approved publishing `kamekfnbr@gmail.com`. OAuth is configured in Testing and one direct test email reached the owner, but GlassChat account flows have not been exercised end to end. Google marks `gmail.send` sensitive; Testing refresh tokens expire after seven days, and production verification/domain requirements must be resolved before durable public delivery.
- Keep both Pages workflow files. `glasschat-pages.yml` is the only automatic publisher; `jekyll-gh-pages.yml` is retained for manual non-publishing validation.
- Legal pages are working drafts. Operator legal name/address and final processing/retention details are unresolved and require appropriate review before public account launch.
