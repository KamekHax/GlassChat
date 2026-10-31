# GlassChat backend: Render, Neon, email, and desktop URL

**Current state:** Neon Free `glasschat-beta-eu` exists in Frankfurt, but it is not connected or migrated. No Render service or Gmail OAuth sender exists. The user asked to hold Render until email is configured. This guide is preparation only; it does not deploy services or contain credentials. It reflects source build 1.0.1 / `20261031.2` and the current Gmail API adapter.

## 1. Neon PostgreSQL

Use the existing Neon project in AWS Europe Central 1 (Frankfurt). Keep the project on Free unless the owner explicitly approves a paid tier. Do not send a connection string through chat or commit it to Git.

Create two connection strings from Neon:

- **Runtime `DATABASE_URL`:** use the pooled hostname (typically includes `-pooler`) for the service's short-lived application queries.
- **Migration `MIGRATION_DATABASE_URL`:** use the direct hostname (without `-pooler`) for schema migrations. `server/auth/migrate.js` uses a PostgreSQL advisory lock, which requires a direct/session-capable connection rather than Neon transaction pooling.

For a production connection, configure `DATABASE_SSL=true`, `DATABASE_SSL_REJECT_UNAUTHORIZED=true` and a conservative `PG_POOL_MAX` such as 5. Keep these connection strings in the backend host's secret settings only. Before the first migration, review the SQL files and make sure the target is the correct Neon project/branch. No app migration has been applied to Neon yet.

## 2. Email must be configured before creating Render

The source includes a Gmail API adapter. It uses `https://www.googleapis.com/auth/gmail.send`, sends as `kamekfnbr@gmail.com`, and requires the OAuth client ID, client secret and refresh token as backend-only secrets. No OAuth authorization or live delivery test has occurred because Google Cloud Console is signed out in both available browsers and the user cannot take over the browser.

Google classifies the Gmail send scope as sensitive. External OAuth Testing-mode refresh tokens expire after seven days, so a testing token is not a durable production credential. Google's production verification may require an owned/verified domain; GlassChat currently has no custom domain, and `github.io` is not owned by the project. Resolve this with Google's OAuth console before calling the email service production-ready. Do not bypass Google verification or create a public service with a known-expiring test token without the owner's explicit acceptance of that limitation.

No verified no-domain option currently meets all three constraints—0 DKK/month, arbitrary-user delivery, and durable production operation:

- Gmail API can send as the authorized mailbox, but OAuth review and the no-domain constraint remain unresolved.
- Resend's shared `resend.dev` sender is limited to the Resend account owner; it is not open-registration delivery.
- Amazon SES can use an individually verified sender address, but sandbox recipients also need verification, production access requires AWS approval, and SES is metered rather than guaranteed free.
- SMTP is not suitable for Render Free: Render documents restrictions on common outbound SMTP ports.

Do not create the Render service until OAuth authorization is durable enough for the intended test and a controlled verification/reset email has actually been received. Never paste OAuth secrets into source, website, logs, chat, or this guide.

## 3. Render Free prototype (after email gate)

When the sender is configured, create a Render **Web Service** from `KamekHax/GlassChat` with **Root Directory** `server`, region Frankfurt, Free plan, Node.js 20 or newer, and build command:

```sh
npm ci --omit=dev
```

Use this start command so migrations use the direct Neon connection before the API starts using the pooled runtime `DATABASE_URL`:

```sh
DATABASE_URL="$MIGRATION_DATABASE_URL" npm run auth:migrate && npm run auth:start
```

The service now honors Render's injected `PORT`; set `AUTH_HOST=0.0.0.0`. Set the health-check path to `/health`. Render Free is a prototype: cold starts, sleeping, interruptions and finite quotas are expected. The app currently uses a 15-second request timeout, so a cold-start request may require retry.

Set these service environment values. Add all items marked secret through Render's protected environment UI; never put actual values in GitHub:

```text
NODE_ENV=production
DATABASE_URL=<Neon pooled connection string>
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

Important: `APP_ORIGIN` is the **website origin** used by exact-origin CORS, not the Render service URL. `APP_BASE_URL` is the GitHub Pages project URL used to build verification/reset links. Render provides the API's own `PORT` and `onrender.com` service hostname. Do not set the website CSP/API base to a Render URL until that service is deployed and health-checked.

After deployment, the service's `/health` endpoint should return JSON containing `"ok": true`. A working health check alone does not prove email, authentication, database migrations or chat behavior; test these with controlled accounts before publishing a service-available status.

## 4. Point the desktop app at the deployed API

The Electron client saves its service URL under its per-user settings file and offers a **Service URL configuration** control on the sign-in screen. After a real Render HTTPS service exists, enter its exact origin, for example `https://<service-name>.onrender.com`, and save. Do not append `/api/auth`, `/socket.io`, a query, or a path. Saving a changed host signs out the previous session; sign in again afterward. Loopback HTTP is allowed only for local development.

To set the production default for future builds, use `GLASSCHAT_API_URL` or update the guarded default in `src/main.js` to the verified service origin, then rebuild the desktop app. Do not ship a hard-coded example hostname. Existing installations can use the settings control without reinstalling.

## 5. Current limits

The central service has one seeded Commons community and `#general` text chat; channel text is stored centrally as readable plaintext at the application layer. There is no local-first history or end-to-end encryption. Direct messages, voice/video, screen sharing, account deletion, moderation/reporting and automatic updates are not implemented. The current Windows candidates are build `20261031.1`; they do not match source build `20261031.2` and have not passed native Windows lifecycle checks.

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
