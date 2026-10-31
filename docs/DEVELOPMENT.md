# GlassChat development

## Prerequisites

Use Node.js 20 or newer. The repository has two Node packages: the Electron desktop project at the root and the independently deployable backend under `server/`. Install dependencies separately with the checked-in lockfiles. Do not commit actual `.env` files, database URLs, OAuth secrets, refresh tokens or generated runtime data.

## Desktop application

From the repository root:

```sh
npm ci
npm start
```

The desktop app reads the default service URL from `GLASSCHAT_API_URL` or falls back to `http://127.0.0.1:3211` for local development. The sign-in screen also has a service URL setting, saved in the current user's app-data directory. Use HTTPS for a deployed backend. Do not set a public production URL until that API has actually been deployed and verified.

## Backend service

The centrally operated account/chat API is separate from the legacy anonymous Alpha listener. Do not expose `server/index.js` or use its local JSON data store for public service. The Beta API is `server/auth/start.js` and requires PostgreSQL.

In one terminal, install the server package and configure environment variables in your shell or a private local environment file that is excluded from Git. For a local database, set a PostgreSQL `DATABASE_URL`, a local `APP_BASE_URL`, and `AUTH_EMAIL_MODE=console` only in development. Console mode writes one-time links to the development log; it is forbidden in production. Then:

```sh
cd server
npm ci
npm run auth:migrate
npm run auth:start
```

`auth:migrate` applies tracked SQL migrations. `auth:start` starts Express and Socket.IO. Local defaults are `127.0.0.1:3211`; production requires an HTTPS `APP_ORIGIN`, `TRUST_PROXY=1`, and `AUTH_HOST=0.0.0.0`. The service honors a hosting platform's injected `PORT`, falling back to `AUTH_PORT` and then 3211. The backend returns health status at `/health`.

## Regression tests

From the repository root:

```sh
npm test
```

The auth and realtime tests use isolated PGlite/temp fixtures. Do not point them at the live Neon database: test writes/deletes can affect a shared database. Tests do not prove live Gmail OAuth, a production PostgreSQL connection, Render availability, external security review or Windows installer lifecycle behavior.

## Website

The static site is in `website/`. Build and check it from the repository root:

```sh
node website/scripts/build-site.mjs
node website/scripts/check-site.mjs
```

The build reads public routes from `website/src/pages.json` and `website/src/manus-routes.json`, and actual releases from GitHub Releases. Its generated `website/dist/` is output, not source. Do not set `apiBaseUrl` in `website/site.config.json` until an HTTPS backend origin is live. Keep the five legal pages marked as working drafts until reviewed.

## Windows distribution

The existing Electron Builder setup can build NSIS and portable artifacts from Windows-capable packaging tools:

```sh
npm run dist:win
npm run dist:win:installer
npm run dist:win:portable
```

Outputs go under `release/`. Current source build `20261031.2` has not yet been packaged. Earlier `20261031.1` candidates are unsigned and do not represent the current source. Do not publish artifacts until the version, Windows install/upgrade/data-retention/uninstall behavior, checksum and release provenance are verified on Windows.
