import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const src = path.join(root, 'src');
const out = path.join(root, 'dist');
const config = JSON.parse(await readFile(path.join(root, 'site.config.json'), 'utf8'));
const pageConfig = JSON.parse(await readFile(path.join(src, 'pages.json'), 'utf8'));
const routeManifest = JSON.parse(await readFile(path.join(src, 'manus-routes.json'), 'utf8'));
const template = await readFile(path.join(src, 'template.html'), 'utf8');

function invariant(condition, message) {
  if (!condition) throw new Error(`GlassChat site build: ${message}`);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
function validHttpsUrl(raw, allowedHosts) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && allowedHosts.includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
function plainDate(raw) {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 'Date not provided' : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
function prettySize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return 'size not provided';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

invariant(config.repository === 'KamekHax/GlassChat', 'repository must match the confirmed target');
const originUrl = new URL(config.origin);
invariant(originUrl.protocol === 'https:' && originUrl.pathname.replace(/\/$/, '') === '/GlassChat', 'origin must be the configured HTTPS GitHub Pages project URL');
const origin = config.origin.replace(/\/$/, '');
const apiBaseUrl = String(config.apiBaseUrl || '');
let apiOrigin = '';
if (apiBaseUrl) {
  const apiUrl = new URL(apiBaseUrl);
  invariant(apiUrl.protocol === 'https:' && apiUrl.origin === apiBaseUrl && !apiUrl.username && !apiUrl.password, 'apiBaseUrl must be a public HTTPS origin with no path, query, fragment or credentials');
  apiOrigin = apiUrl.origin;
}
const connectSources = ["'self'", ...(apiOrigin ? [apiOrigin] : [])].join(' ');
const manifestPaths = routeManifest.routes.map(route => route.path).sort();
const pagePaths = pageConfig.pages.map(page => page.route).sort();
invariant(JSON.stringify(manifestPaths) === JSON.stringify(pagePaths), 'pages.json and manus-routes.json must contain the same routes');
invariant(pagePaths.length === new Set(pagePaths).size, 'routes must be unique');
for (const page of pageConfig.pages) {
  invariant(page.route.startsWith('/') && !page.route.startsWith('//') && !/[\s?#]/.test(page.route), `invalid page route ${page.route}`);
  invariant(page.title.length >= 30 && page.title.length <= 60, `title should be 30–60 characters: ${page.title}`);
  invariant(page.description.length >= 50 && page.description.length <= 160, `description should be 50–160 characters: ${page.id}`);
  invariant(page.file.startsWith('pages/') && !page.file.includes('..'), `invalid content path for ${page.id}`);
}

async function readAllReleases() {
  const [owner, repo] = config.repository.split('/');
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GlassChat-Pages-build'
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const releases = [];
  for (let page = 1; page <= 10; page++) {
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100&page=${page}`;
    const response = await fetch(endpoint, { headers });
    if (!response.ok) throw new Error(`GitHub Releases request failed (${response.status})`);
    const batch = await response.json();
    invariant(Array.isArray(batch), 'GitHub Releases API did not return a release list');
    releases.push(...batch.filter(release => !release.draft));
    if (batch.length < 100) break;
  }
  return releases;
}

function installerAssets(release) {
  return (Array.isArray(release.assets) ? release.assets : []).flatMap(asset => {
    const name = String(asset.name || '');
    if (!/^GlassChat-(?:Setup|Portable)(?:[-.].*)?\.exe$/i.test(name)) return [];
    const url = validHttpsUrl(asset.browser_download_url, ['github.com']);
    if (!url) return [];
    return [{ name, url, size: Number(asset.size) || 0, kind: /portable/i.test(name) ? 'Portable' : 'Windows installer', sha256: null }];
  });
}

async function checksumFilesFor(release) {
  const hashes = new Map();
  for (const asset of (Array.isArray(release.assets) ? release.assets : [])) {
    const name = String(asset.name || '');
    const supported = /(?:\.sha256(?:sum)?s?|sha256sums?(?:\.txt)?|release\.json)$/i.test(name);
    const url = validHttpsUrl(asset.url, ['api.github.com']);
    if (!supported || !url || Number(asset.size) > 1024 * 1024) continue;
    try {
      const headers = { Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const response = await fetch(url, { headers });
      if (!response.ok) continue;
      const text = await response.text();
      if (text.length > 1024 * 1024) continue;
      if (/release\.json$/i.test(name)) {
        try {
          const manifest = JSON.parse(text);
          for (const item of Array.isArray(manifest.artifacts) ? manifest.artifacts : []) {
            if (typeof item.file === 'string' && /^[a-f\d]{64}$/i.test(item.sha256 || '')) hashes.set(path.basename(item.file), item.sha256.toLowerCase());
          }
        } catch { /* Non-JSON sidecars are handled by the text parser below. */ }
      }
      for (const line of text.split(/\r?\n/)) {
        const match = line.trim().match(/^([a-f\d]{64})\s+(?:\*?)(.+)$/i);
        if (match) hashes.set(path.basename(match[2].trim()), match[1].toLowerCase());
      }
      if (/\.sha256(?:sum)?s?$/i.test(name)) {
        const onlyHash = text.trim().match(/^([a-f\d]{64})$/i);
        if (onlyHash) hashes.set(name.replace(/\.sha256(?:sum)?s?$/i, ''), onlyHash[1].toLowerCase());
      }
    } catch (error) {
      console.warn(`Could not read checksum sidecar ${name}: ${error.message}`);
    }
  }
  return hashes;
}

function normalizeRelease(release, checksums) {
  const pageUrl = validHttpsUrl(release.html_url, ['github.com']);
  if (!pageUrl) return null;
  const assets = installerAssets(release).map(asset => ({ ...asset, sha256: checksums.get(asset.name) || null }));
  const tag = String(release.tag_name || '');
  const version = tag.replace(/^v(?=\d)/i, '') || String(release.name || tag || 'Version not identified');
  return {
    tag,
    version,
    name: String(release.name || tag || version),
    publishedAt: release.published_at || null,
    prerelease: Boolean(release.prerelease),
    url: pageUrl,
    notes: String(release.body || '').slice(0, 16000),
    assets
  };
}

function formatReleaseCard(release, label) {
  const assets = release.assets.length
    ? `<div class="asset-row">${release.assets.map(asset => `<a class="asset-link" href="${escapeHtml(asset.url)}" rel="noopener noreferrer">${escapeHtml(asset.kind)} · ${escapeHtml(asset.name)} · ${escapeHtml(prettySize(asset.size))}</a><span class="checksum">SHA-256: ${asset.sha256 ? escapeHtml(asset.sha256) : 'not supplied with this published release'}</span></div>`).join('')}`
    : '<div class="asset-row"><span class="checksum">No GlassChat Windows installer asset is attached to this release.</span></div>';
  const notes = release.notes.trim()
    ? `<div class="release-notes">${escapeHtml(release.notes)}</div>`
    : '<p class="release-meta">No release notes were supplied.</p>';
  return `<article class="release-card"><div class="release-head"><div><span class="release-type">${escapeHtml(label)}</span><h3>${escapeHtml(release.name)}</h3></div><span class="release-meta">${escapeHtml(release.tag)} · ${escapeHtml(plainDate(release.publishedAt))}</span></div>${notes}${assets}<div class="asset-row"><a class="asset-link" href="${escapeHtml(release.url)}" rel="noopener noreferrer">Full release page ↗</a></div></article>`;
}
function emptyReleaseCard(message) {
  return `<article class="release-card"><span class="release-type">Availability</span><h3>${escapeHtml(message)}</h3><p class="release-meta">A download link will appear here only after a matching installer is attached to a published GitHub Release.</p><div class="asset-row"><a class="asset-link" href="https://github.com/KamekHax/GlassChat/releases" rel="noopener noreferrer">Check published GitHub Releases ↗</a></div></article>`;
}

let rawReleases = [];
let apiStatus = 'ok';
try {
  rawReleases = await readAllReleases();
} catch (error) {
  apiStatus = 'unavailable';
  if (process.env.CI === 'true') throw error;
  console.warn(`Release data unavailable for local preview: ${error.message}`);
}
const normalized = [];
for (const item of rawReleases) {
  const checksums = await checksumFilesFor(item);
  const release = normalizeRelease(item, checksums);
  if (release) normalized.push(release);
}
normalized.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
const stable = normalized.filter(release => !release.prerelease);
const beta = normalized.filter(release => release.prerelease);
const latestStable = stable[0] || null;
const betaCandidate = {
  status: apiStatus,
  repository: config.repository,
  generatedAt: new Date().toISOString(),
  latestStable,
  stable,
  prereleases: beta
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const directory of ['assets', 'css', 'js', 'data']) {
  await cp(path.join(src, directory), path.join(out, directory), { recursive: true });
}
for (const file of ['robots.txt', 'manus-routes.json']) {
  try { await cp(path.join(src, file), path.join(out, file)); } catch {}
}
await writeFile(path.join(out, 'data/releases.json'), `${JSON.stringify(betaCandidate, null, 2)}\n`);
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);

const sitemapEntries = [];
for (const page of pageConfig.pages) {
  const content = await readFile(path.join(src, page.file), 'utf8');
  const routePath = page.route === '/' ? '' : page.route.replace(/^\//, '').replace(/\/$/, '');
  const depth = routePath ? routePath.split('/').length : 0;
  const rootPrefix = '../'.repeat(depth);
  const canonical = `${origin}${page.route}`;
  const ogImage = `${origin}/assets/app-preview.webp`;
  const latestCard = latestStable ? formatReleaseCard(latestStable, 'Latest stable') : emptyReleaseCard(apiStatus === 'ok' ? 'No stable release has been published yet.' : 'Release status could not be refreshed.');
  const stableHistory = stable.slice(1).length ? stable.slice(1).map(item => formatReleaseCard(item, 'Previous stable')).join('\n') : '<p class="muted">No previous stable Windows releases are available.</p>';
  const betaCards = beta.length ? beta.map(item => formatReleaseCard(item, 'Beta / prerelease')).join('\n') : '<p class="muted">No published GlassChat Beta or prerelease assets are available.</p>';
  const changelogCards = normalized.length ? normalized.map(item => formatReleaseCard(item, item.prerelease ? 'Beta / prerelease' : 'Stable release')).join('\n') : '<p class="muted">No published GitHub Releases are available yet. The local 1.0.1 candidate is not a published release.</p>';
  const renderedContent = content
    .replaceAll('{{ROOT}}', rootPrefix)
    .replaceAll('{{LATEST_STABLE}}', latestCard)
    .replaceAll('{{STABLE_HISTORY}}', stableHistory)
    .replaceAll('{{BETA_RELEASES}}', betaCards)
    .replaceAll('{{CHANGELOG_RELEASES}}', changelogCards);
  const html = template
    .replaceAll('{{TITLE}}', escapeHtml(page.title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(page.description))
    .replaceAll('{{CANONICAL}}', escapeHtml(canonical))
    .replaceAll('{{OG_IMAGE}}', escapeHtml(ogImage))
    .replaceAll('{{ROOT}}', rootPrefix)
    .replaceAll('{{PAGE_ID}}', escapeHtml(page.id))
    .replaceAll('{{CONNECT_SOURCES}}', connectSources)
    .replaceAll('{{API_BASE_URL}}', escapeHtml(apiBaseUrl))
    .replace('{{ROBOTS_META}}', page.indexable === false ? '<meta name="robots" content="noindex,nofollow">' : '')
    .replace('{{CONTENT}}', renderedContent);
  const file = path.join(out, routePath, 'index.html');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  if (page.indexable !== false) sitemapEntries.push(`  <url><loc>${escapeHtml(canonical)}</loc></url>`);
}

const notFoundFragment = await readFile(path.join(src, 'pages/404.html'), 'utf8');
const notFoundHtml = template
  .replaceAll('{{TITLE}}', 'GlassChat page not found')
  .replaceAll('{{DESCRIPTION}}', 'This GlassChat page does not exist. Return to the homepage or browse the documented routes.')
  .replaceAll('{{CANONICAL}}', `${origin}/404.html`)
  .replaceAll('{{OG_IMAGE}}', `${origin}/assets/app-preview.webp`)
  .replaceAll('{{ROOT}}', '')
  .replaceAll('{{PAGE_ID}}', 'not-found')
  .replaceAll('{{CONNECT_SOURCES}}', connectSources)
  .replaceAll('{{API_BASE_URL}}', escapeHtml(apiBaseUrl))
  .replace('{{ROBOTS_META}}', '')
  .replace('{{CONTENT}}', notFoundFragment.replaceAll('{{ROOT}}', ''))
  .replace('</head>', '  <meta name="robots" content="noindex,follow">\n</head>');
await writeFile(path.join(out, '404.html'), notFoundHtml);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.join('\n')}\n</urlset>\n`;
await writeFile(path.join(out, 'sitemap.xml'), sitemap);
console.log(`Built ${pageConfig.pages.length} static routes into ${out}; stable releases: ${stable.length}; prereleases: ${beta.length}; release API: ${apiStatus}.`);
