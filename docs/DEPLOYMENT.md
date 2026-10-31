# GlassChat backend: Render, Neon, email, and desktop URL

**Current state (31 October 2026):** A temporary Render Free service is Live in Frankfurt at `https://glasschat-beta-api.onrender.com`; the Neon Free project `glasschat-beta-eu` is connected and its tracked auth/community migrations have been applied. A temporary Google OAuth External/Testing credential is stored in Render; the owner received a direct Gmail API test email, but GlassChat's registration/verification/reset flows are not yet verified. The refresh token expires after seven days, so this deployment is not durable production. This guide contains no credentials. Source build 1.0.1 / `20261031.3` now points the desktop default and website API base to the service; this source update is pending push and publication.

## 1. Neon PostgreSQL

Use the existing Neon project in AWS Europe Central 1 (Frankfurt). Keep the project on Free unless the owner explicitly approves a paid tier. Do not send a connection string through chat or commit it to Git.

Create two connection strings from Neon:

- **Runtime `DATABASE_URL`:** currently use the direct hostname because Neon pooling is disabled on this project; if pooling is enabled later, use the pooled hostname (typically includes `-pooler`) for runtime queries.
- **Migration `MIGRATION_DATABASE_URL`:** use the direct hostname (without `-pooler`) for schema migrations. `server/auth/migrate.js` uses a PostgreSQL advisory lock, which requires a direct/session-capable connection rather than Neon transaction pooling.

The service currently uses direct Neon URLs because pooling is disabled on the project endpoint. Both use `sslmode=verify-full` and `channel_binding=require`; Render also sets `DATABASE_SSL=true`, `DATABASE_SSL_REJECT_UNAUTHORIZED=true` and `PG_POOL_MAX=5`. The tracked migrations `001_auth.sql` and `002_community_chat.sql` have been applied to the confirmed `production` branch. Keep all connection strings in protected host settings only. If Neon pooling is enabled later, use its pooled hostname for runtime and retain the direct URL for migrations.

## 2. Temporary Gmail OAuth status and limitations

The source includes a Gmail API adapter. It uses `https://www.googleapis.com/auth/gmail.send`, sends as `kamekfnbr@gmail.com`, and requires the OAuth client ID, client secret and refresh token as backend-only secrets. The owner authorized the send-only scope in the app's External/Testing mode, and the owner confirmed receipt of one direct test email. These temporary credentials are stored only in Render's protected environment. The app's actual registration, verification-resend and password-reset flows have not yet been tested end to end.

Google classifies the Gmail send scope as sensitive. External OAuth Testing-mode refresh tokens expire after seven days with this non-basic scope, so the current token is temporary and not a durable production credential. The owner explicitly approved using it for a temporary deployment test; the app remains in Testing. Do not promote the app, imply Google verification, or treat this sender as production-ready. Review the separate Production/unverified analysis in the operator guide before any status change.

No verified no-domain option currently meets all three constraints—0 DKK/month, arbitrary-user delivery, and durable production operation:

- Gmail API can send as the authorized mailbox, but OAuth review and the no-domain constraint remain unresolved.
- Resend's shared `resend.dev` sender is limited to the Resend account owner; it is not open-registration delivery.
- Amazon SES can use an individually verified sender address, but sandbox recipients also need verification, production access requires AWS approval, and SES is metered rather than guaranteed free.
- SMTP is not suitable for Render Free: Render documents restrictions on common outbound SMTP ports.

Never paste OAuth secrets into source, website, logs, chat, or this guide. The temporary Render deployment must be treated as a time-limited test; arrange a durable provider/token strategy before the seven-day token expiry if continued public testing is required.

## 3. Current Render Free temporary test service

The existing Render **Web Service** uses `KamekHax/GlassChat` `main`, an unset Root Directory, Frankfurt region, Free plan, Node.js 22, and this build command:

```sh
cd server && npm ci --omit=dev
```

The service uses this start command so each deployment applies idempotent migrations through the direct Neon connection before starting the API:

```sh
cd server && DATABASE_URL="$MIGRATION_DATABASE_URL" npm run auth:migrate && npm run auth:start
```

The service honors Render's injected `PORT`; `AUTH_HOST=0.0.0.0` and health-check path `/health` are configured. Render Free is a prototype: cold starts, sleeping, interruptions and finite quotas are expected. The app currently uses a 15-second request timeout, so a cold-start request may require retry.

Set these service environment values. Add all items marked secret through Render's protected environment UI; never put actual values in GitHub:

```text
NODE_ENV=production
DATABASE_URL=<Neon direct connection string; current endpoint pooling is disabled>
MIGRATION_DATABASE_URL=<Neon direct connection string>
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=true
PG_POOL_MAX=5
AUTH_HOST=0.0.0.0
TRUST_PROXY=1
APP_ORIGIN=https://kamekhax.github.io
APP_BASE_URL=https://kamekhax.github.io/GlassChat
AUTH_EMAIL_MODE=gmail-api
GMAIL_OAUTH_CLIENT_ID=<secret>
GMAIL_OAUTH_CLIENT_SECRET=<secret>
GMAIL_OAUTH_REFRESH_TOKEN=<secret>
GMAIL_FROM=kamekfnbr@gmail.com
```

Important: `APP_ORIGIN` is the **website origin** used by exact-origin CORS, not the Render service URL. `APP_BASE_URL` is the GitHub Pages project URL used to build verification/reset links. Render provides the API's own `PORT` and `onrender.com` service hostname. Source build .3 sets the desktop default and website `apiBaseUrl` to the verified HTTPS service origin; the site CSP allows that origin. The update still requires a push and public Pages check.

The `/health` endpoint returned HTTP 200 with `"ok": true`; Render logs confirmed migrations and startup, and a read-only Neon table listing confirmed the expected schema. A health check does not prove account verification/reset, CORS from the live Pages origin, or chat behavior; test those with controlled accounts before claiming those flows work.

## 4. Point the desktop app at the deployed API

The Electron client saves its service URL under its per-user settings file and offers a **Service URL configuration** control on the sign-in screen. Source build `20261031.3` defaults to `https://glasschat-beta-api.onrender.com` and migrates only the prior hard-coded localhost default. Do not append `/api/auth`, `/socket.io`, a query, or a path. Saving a changed host signs out the previous session; sign in again afterward. Loopback HTTP is allowed only for local development.

`GLASSCHAT_API_URL` remains an override for local or future instances. Keep `website/site.config.json`'s `apiBaseUrl` equal to the desktop default; `npm run check:version` enforces this when the public API URL is configured. Existing intentional custom URLs are preserved.

## 5. Current limits

The central service has one seeded Commons community and `#general` text chat; channel text is stored centrally as readable plaintext at the application layer. There is no local-first history or end-to-end encryption. Direct messages, voice/video, screen sharing, account deletion, moderation/reporting and automatic updates are not implemented. The current source is build `20261031.3`; earlier Windows candidates are build `20261031.1`, do not match, and have not passed native Windows lifecycle checks.

## Official references

- [Render web services](https://render.com/docs/web-services)
- [Render regions](https://render.com/docs/regions)
- [Render Free limits](https://render.com/docs/free)
- [Neon regions](https://neon.com/docs/introduction/regions)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon pricing](https://neon.com/pricing)
- [Gmail API send guide](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google OAuth token rules](https://developers.google.com/identity/protocols/oauth2)
- [Google sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Google OAuth brand/domain verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Resend shared test-sender restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [AWS SES email identities](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html)
- [AWS SES sandbox and production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [AWS SES pricing](https://aws.amazon.com/ses/pricing/)
