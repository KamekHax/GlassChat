# GlassChat architecture and current boundaries

## System shape

GlassChat is an Electron desktop client connected to a separately deployable Node.js service. Users do not host their own communities. GitHub Pages serves public information only; GitHub Releases distribute published desktop artifacts. Neither service hosts the chat API or PostgreSQL.

The Electron main process owns service requests, Socket.IO connections and session handling. A narrow preload exposes typed IPC to the renderer; renderer JavaScript does not receive the raw session cookie. Client settings are written to the per-user app-data directory. Session material uses Electron `safeStorage` when the operating system provides it; otherwise the app does not persist the session token.

The service is in `server/`. `server/auth/start.js` starts Express and Socket.IO; `server/auth/app.js` owns account/API routes; `server/auth/realtime.js` owns authenticated chat events; `server/auth/migrate.js` applies versioned SQL migrations. The legacy anonymous Alpha listener in `server/index.js` is separate and must not be exposed publicly.

## Accounts and access control

GlassChat owns its SQL-backed email/password identity; no Manus-managed authentication is required. Passwords are hashed with Argon2id. Usernames/emails have database uniqueness constraints. Verification/reset tokens are random one-use values whose digests are stored in PostgreSQL. Sessions are opaque, revocable and stored as digests; account/session access and channel membership are checked server-side. The service applies input limits, per-process rate limits, CSRF checks for protected operations and origin checks.

These are code-level controls, not a production certification. Shared rate limiting, a full threat review, live-provider operations, monitoring, backups/recovery and an independent security review remain open.

## Messaging and privacy

The current text-chat slice seeds Commons and `#general`, enrolls new users in that community and provides membership-checked channel history and Socket.IO delivery. The author identity comes from the authenticated session. Tests verify membership denial and that a socket message is stored under the authenticated user.

Channel message text is stored centrally in PostgreSQL as readable plaintext at the application layer. The operator can read it. HTTPS/WSS protects transport only; it is not end-to-end encryption. The user approved this only for a clearly disclosed limited Beta. Do not describe current messages as local-only, private/E2EE, or inaccessible to the operator. Direct messages, friends, voice/video, screensharing, attachments, bots, moderation/reporting flows and account deletion are not implemented.

## Database and hosting

A Neon Free PostgreSQL project `glasschat-beta-eu` exists in AWS Europe Central 1 (Frankfurt), but it is not yet connected and no application migration has been run against it. Regression tests use isolated PGlite/temp fixtures. Production credentials belong only in the backend host's secret settings.

Render Free is approved only as a 0-DKK prototype; it may sleep, cold-start, interrupt and enforce finite quotas. No Render service exists. The user instructed that its creation wait until the email path is configured. The service listens on `AUTH_HOST` and honors Render's injected `PORT`; in production it expects `AUTH_HOST=0.0.0.0`, an HTTPS `APP_ORIGIN` and one trusted reverse proxy.

## Email and static account actions

The backend source includes a Gmail API adapter that sends verification and password-reset messages as the operator-authorized Gmail account. It is not configured: there is no OAuth client authorization, refresh token or live delivery test. The Gmail `gmail.send` scope requires Google OAuth review for public production use; a Testing-mode refresh token is temporary. The GitHub Pages project origin is not a domain the operator controls, so the domain-verification requirement must be resolved before durable public mail is promised.

The website source has no-index verification/reset pages. One-time tokens are placed in URL fragments, removed from the visible URL when the user submits, and sent to the configured API with cookies omitted. The generated API base is intentionally blank. The pages cannot complete account actions until a real HTTPS API origin and mail delivery are configured and verified.

## Current operational state

- Static website foundation is live at <https://kamekhax.github.io/GlassChat/>; the expanded 15-route source revision is not yet published.
- The target repository clone contains the imported app/backend source locally; it has not yet been pushed.
- Most recent repository tests after the mailer/CORS source changes passed 7/7.
- Neon project exists but is not connected/migrated; Render does not exist; Gmail OAuth is unconfigured.
- The current source is 1.0.1 / build `20261031.2`; earlier unsigned Windows artifacts are build `20261031.1`, not current and not published. Native Windows lifecycle testing is still required.
- The five legal pages are working drafts, not final legal advice. The operator legal name/address and complete retention/deletion/rights facts require review.
