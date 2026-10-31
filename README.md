# GlassChat

GlassChat is an independent desktop community-chat project with a Liquid Glass-inspired interface. Its architecture uses a centrally operated backend and GlassChat-owned accounts. Users do not host their own servers. The public website is hosted on GitHub Pages; actual desktop installers belong in GitHub Releases.

**Public website:** <https://kamekhax.github.io/GlassChat/><br>
**Repository:** <https://github.com/KamekHax/GlassChat>

Maintainer references: [architecture](docs/ARCHITECTURE.md), [development](docs/DEVELOPMENT.md), [Render/Neon/email deployment guide](docs/DEPLOYMENT.md), [Beta roadmap](BETA_ROADMAP.md), and [Windows distribution](WINDOWS_DISTRIBUTION.md).

## Beta scope and current limitations

The verified application slice includes a Windows-oriented Electron client, email/password registration and login, SQL-backed accounts with Argon2id password hashing, community membership, `Commons/#general` text chat, authenticated Socket.IO delivery, channel history, basic presence/typing, and a locally configurable service URL. The account/authentication implementation is GlassChat-owned; Manus authentication is not used.

This is not yet a full Discord replacement. Direct messages, friend relationships, community administration, voice/video, screen sharing, attachments, bots, account deletion, moderation/reporting workflows and automatic updating are not complete. The central service has not yet been deployed or connected to the Neon project. Do not use this Beta for private/E2EE conversations: channel messages are currently stored centrally in PostgreSQL as readable plaintext at the application layer. HTTPS/WSS protects transport, not server-side content. The operator accepted this architecture only for a clearly disclosed limited Beta.

Email verification and password recovery require a configured provider and working public token-link destinations. Until these are verified, do not treat public account registration as operational. The Neon Free project exists in Frankfurt but is not yet connected or migrated. A Render Free deployment is planned only as a prototype, subject to cold starts, interruptions and quotas.

## Development

Use Node.js 22. At the repository root:

```sh
npm ci
npm run check:version
npm test
npm start
```

The desktop app uses a service URL saved per user under Electron's user-data directory. In a local development build, the default is `http://127.0.0.1:3211`. A deployed service must use HTTPS/WSS. Until a verified GlassChat backend exists, the packaged app will not be able to register, sign in or chat over the internet.

The legacy `server/index.js` listener is a local Alpha prototype using a JSON data file. **Do not expose it publicly.** The centrally hosted Beta API is `server/auth/start.js` and uses PostgreSQL. Keep `server/data.json` as local runtime data; it is deliberately excluded from the repository.

## Backend and database

The backend has its own package manifest and lockfile in `server/`:

```sh
cd server
npm ci --omit=dev
npm run auth:migrate
npm run auth:start
```

Production deployment requires a PostgreSQL `DATABASE_URL`, HTTPS origin and reverse-proxy configuration, private environment variables and a configured email provider. Never commit passwords, tokens, database URLs or OAuth credentials. `.env.auth.example` contains variable names and placeholders only. Use tracked SQL migrations; do not apply an unreviewed migration to a production database.

## Windows builds and releases

The Electron Builder configuration creates an NSIS installer named `GlassChat-Setup-<version>.exe` and a portable candidate. Current local candidates are unsigned and have not passed native Windows installation/upgrade/uninstallation testing. They are not public downloads. Do not publish an installer until its version, contents, checksum and Windows lifecycle behavior are verified.

When a stable installer is actually released, publish it as an asset on a GitHub Release. The website reads published releases and only offers real attached assets. No installer should be advertised as available until it exists in a published release.

## Website and deployment

The official static site is under `website/` and deploys to GitHub Pages with `.github/workflows/glasschat-pages.yml`. Build and check it locally with:

```sh
cd website
node scripts/build-site.mjs
node scripts/check-site.mjs
```

The repository currently retains both Pages workflow files by owner decision. The GlassChat workflow is the automatic publisher; the Jekyll workflow must remain non-publishing/manual validation to avoid competing deployments. The published site is not a host for GlassChat authentication or messaging.

`.github/workflows/glasschat-ci.yml` runs the app/backend tests, verifies package/lockfile/site versions, builds and checks the static site, then builds Windows NSIS/portable candidates without creating or publishing a GitHub Release.

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for privacy-safe bug reports, pull-request checks and release boundaries.

## Privacy and security

Do not claim local-only history, end-to-end encryption, or that GlassChat operators cannot read channel messages. Authentication and messaging behavior must be described from verified implementation, not roadmap goals. For support, privacy requests, security reports and legal correspondence, use the operator-approved contact address: <kamekfnbr@gmail.com>.

## License

See [LICENSE](LICENSE).
