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

A Neon Free PostgreSQL project `glasschat-beta-eu` in AWS Europe Central 1 (Frankfurt) is connected to the temporary Render service. Tracked auth and community migrations are applied to the production branch. Regression tests use isolated PGlite/temp fixtures; production credentials belong only in the backend host's protected secret settings.

The temporary Render Free service is approved only as a 0-DKK test prototype; it may sleep, cold-start, interrupt and enforce finite quotas. Its service origin is `https://glasschat-beta-api.onrender.com`, and `/health` has returned HTTP 200. The backend listens on `AUTH_HOST` and honors Render's injected `PORT`; it expects `AUTH_HOST=0.0.0.0`, an HTTPS `APP_ORIGIN` and one trusted reverse proxy.

## Email and static account actions

The backend source includes a Gmail API adapter that sends verification and password-reset messages as the operator-authorized Gmail account. Google OAuth remains External/Testing, with the owner as the sole test user and only the sensitive `gmail.send` scope. The owner received one direct test email. The Testing refresh token expires after seven days, so email is temporary and is not production-ready. The GitHub Pages project origin is not a domain the operator controls; domain/verification requirements remain unresolved before durable public mail is promised.

The website source has no-index verification/reset pages. One-time tokens are placed in URL fragments, removed from the visible URL when the user submits, and sent to the configured API with cookies omitted. The API base now points to the temporary Render HTTPS service. The owner confirmed receipt of one direct Gmail API test email, but the actual verification/reset pages and account flows have not been exercised end to end; the Testing-mode refresh token expires after seven days.

## Current operational state

- The official 15-route site is live at <https://kamekhax.github.io/GlassChat/>. A Pages run deployed commit `2cf206573f747b8f6e99e6efdca841ded0ca6282`; follow-up source build .3 is pending publication.
- App/backend source is integrated on `KamekHax/GlassChat` `main`; CI passed the seven-test suite, site checks and Windows packaging for the previous source build.
- Temporary Render Free service `https://glasschat-beta-api.onrender.com` is Live in Frankfurt. Its `/health` endpoint returned HTTP 200 and the exact website-origin CORS preflight succeeded.
- Neon Free Frankfurt is connected; migrations `001_auth.sql` and `002_community_chat.sql` are applied. Gmail OAuth remains External/Testing with a temporary seven-day token; the owner received a test email, but no GlassChat account flow has been validated end to end.
- The current source is 1.0.1 / build `20261031.3`; earlier unsigned Windows artifacts are build `20261031.1`, not current and not published. Native Windows lifecycle testing is still required.
- The five legal pages are working drafts, not final legal advice. The operator legal name/address and complete retention/deletion/rights facts require review.
