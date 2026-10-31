# GlassChat website

This folder contains the independent static GlassChat website. GitHub Pages serves the generated `dist/` folder; it does not host GlassChat accounts, PostgreSQL or chat traffic.

## Local build

From the repository root, run:

```sh
node website/scripts/build-site.mjs
python3 -m http.server 3000 --directory website/dist
```

The builder uses only Node.js built-ins. It reads public metadata from `website/site.config.json`, route/page content from `website/src/`, and published releases from the GitHub Releases API. For a local preview it continues with an explicit unavailable/no-release panel if the public API cannot be reached. In GitHub Actions, an API failure stops the build so it cannot deploy stale or unverified release links.

The current source snapshot is version 1.0.1 / build `20261031.2`, marked unpublished. `apiBaseUrl` is deliberately blank until a real HTTPS backend has been configured and verified. The source declares 15 routes, including five legal working drafts and two `noindex,nofollow` account-action pages. Keep `website/src/pages.json` and `website/src/manus-routes.json` synchronized when adding a route.

## GitHub Pages deployment

The workflow at `.github/workflows/glasschat-pages.yml` builds `website/dist/` and deploys it through the official Pages artifact actions. It runs for pushes to `main`, published releases and manual dispatch. The repository's Pages source must be **GitHub Actions**. The workflow uses the repository-provided token with read-only contents access plus the Pages write and OIDC deployment permissions needed by Pages. It does not expose the token in generated files.

After a deployment, open `https://kamekhax.github.io/GlassChat/` and verify the workflow's `github-pages` environment URL. The source and route manifests live in `website/src/pages.json` and `website/src/manus-routes.json`; update both when adding a page. The builder emits route-specific title/description, canonical/Open Graph metadata, `sitemap.xml`, `robots.txt`, a true Pages 404 document and `/manus-routes.json`.

The repository retains `.github/workflows/jekyll-gh-pages.yml` by owner choice. It is manual validation only, has no Pages deployment permissions or artifact publishing, and must not gain a push trigger or deploy step.

## Publishing desktop releases

Use the repository's **Releases** tab to publish a GlassChat release and attach only release-ready files. Name Windows assets `GlassChat-Setup-<version>.exe` and/or `GlassChat-Portable-<version>.exe`. Stable releases must not be marked as prereleases; Beta builds must be. The site reads actual, non-draft GitHub Releases during each build and displays stable and prerelease assets separately. It never links a local build or invents a checksum.

To display SHA-256 values, attach a sidecar such as `GlassChat-Setup-<version>.exe.sha256`, a `SHA256SUMS.txt` manifest, or a JSON release manifest with an `artifacts` array containing `file` and `sha256` fields. Verify checksums against the exact uploaded release binaries. Missing sidecars are shown as not supplied.

Update `website/site.config.json` only when the public origin, repository or current app version/build changes. The current 1.0.1 / `20261031.2` source candidate is unpublished; the older 1.0.1 Windows binaries are build `20261031.1` and do not match. No matching installer exists in a published release. The API base is intentionally blank, automatic updates are disabled, and the central service is not deployed. Do not describe downloads or the public service as available until those facts change and are verified.

No API keys, deployment credentials, database secrets or SMTP passwords belong in this folder or the public site.
