import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const config = JSON.parse(await readFile(path.join(root, 'site.config.json'), 'utf8'));
const pages = JSON.parse(await readFile(path.join(src, 'pages.json'), 'utf8')).pages;
const manifest = JSON.parse(await readFile(path.join(dist, 'manus-routes.json'), 'utf8'));
const base = new URL(`${config.origin.replace(/\/$/, '')}/`);
let checkedTargets = 0;

function check(condition, message) {
  if (!condition) throw new Error(`GlassChat site check failed: ${message}`);
}
function filePathForRoute(route) {
  const relative = route === '/' ? '' : route.replace(/^\//, '').replace(/\/$/, '');
  return path.join(dist, relative, 'index.html');
}
function decodeEntities(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
async function isFile(target) {
  try { return (await stat(target)).isFile(); } catch { return false; }
}

const manifestPaths = manifest.routes.map(route => route.path).sort();
const pagePaths = pages.map(page => page.route).sort();
check(JSON.stringify(manifestPaths) === JSON.stringify(pagePaths), 'route manifest does not match the configured page routes');

for (const page of pages) {
  const file = filePathForRoute(page.route);
  const html = await readFile(file, 'utf8');
  const url = new URL(page.route.replace(/^\//, ''), base);
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] || '';
  const description = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] || '';
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)?.[1] || '';
  const ogUrl = html.match(/<meta\s+property="og:url"\s+content="([^"]*)"/i)?.[1] || '';
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1] || '';
  const apiBase = html.match(/<meta\s+name="glasschat-api-base"\s+content="([^"]*)"/i)?.[1] || '';
  const robotsNoindex = /<meta\s+name="robots"\s+content="noindex,nofollow"/i.test(html);
  check(title.length >= 30 && title.length <= 60, `${page.route}: invalid title length ${title.length}`);
  check(description.length >= 50 && description.length <= 160, `${page.route}: invalid description length ${description.length}`);
  check((html.match(/<h1\b/gi) || []).length === 1, `${page.route}: expected exactly one initial HTML h1`);
  check(canonical === url.href, `${page.route}: canonical mismatch`);
  check(ogUrl === url.href, `${page.route}: Open Graph URL mismatch`);
  check(ogImage === `${config.origin.replace(/\/$/, '')}/assets/app-preview.webp`, `${page.route}: Open Graph image mismatch`);
  check(apiBase === (config.apiBaseUrl || ''), `${page.route}: public API base metadata mismatch`);
  check(robotsNoindex === (page.indexable === false), `${page.route}: robots metadata does not match indexability`);
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i)?.[1] || '';
  check(csp.includes("connect-src 'self'"), `${page.route}: CSP must allow same-origin requests`);
  if (config.apiBaseUrl) check(csp.includes(config.apiBaseUrl), `${page.route}: CSP does not allow the configured API origin`);
  else check(!/connect-src[^;]*https?:/i.test(csp), `${page.route}: CSP contains an unconfigured external API origin`);
  check(!html.includes('{{') && !html.includes('}}'), `${page.route}: unresolved template token`);

  const attributes = html.matchAll(/\b(?:href|src)="([^"]*)"/gi);
  for (const match of attributes) {
    const value = decodeEntities(match[1]);
    if (!value || value.startsWith('#') || value.startsWith('mailto:') || value.startsWith('tel:')) continue;
    const targetUrl = new URL(value, url);
    if (targetUrl.protocol !== 'https:') {
      check(targetUrl.origin === base.origin, `${page.route}: external URL must use HTTPS (${value})`);
    }
    if (targetUrl.origin !== base.origin) continue;
    check(targetUrl.pathname.startsWith('/GlassChat/'), `${page.route}: local URL escapes the GitHub Pages project path (${value})`);
    let relative = targetUrl.pathname.slice('/GlassChat/'.length);
    let target = path.join(dist, relative);
    if (targetUrl.pathname.endsWith('/') || relative === '') target = path.join(target, 'index.html');
    if (!(await isFile(target))) {
      const indexTarget = path.join(target, 'index.html');
      check(await isFile(indexTarget), `${page.route}: missing local link or asset ${value}`);
    }
    checkedTargets++;
  }
}

const releases = JSON.parse(await readFile(path.join(dist, 'data/releases.json'), 'utf8'));
const downloads = await readFile(filePathForRoute('/downloads/'), 'utf8');
const downloadableAssets = [...releases.stable, ...releases.prereleases].flatMap(release => release.assets || []).filter(asset => asset.url);
for (const match of downloads.matchAll(/href="([^"]*\/releases\/download\/[^\"]*)"/g)) {
  const url = decodeEntities(match[1]);
  check(downloadableAssets.some(asset => asset.url === url), `download link is not backed by release API data: ${url}`);
}
if (!releases.stable.length && !releases.prereleases.length) {
  check(!downloads.includes('/releases/download/'), 'site links to a download despite there being no published release');
}

const notFound = await readFile(path.join(dist, '404.html'), 'utf8');
check(notFound.includes('content="noindex,follow"'), '404 page must be noindex');
check(notFound.includes('Return to GlassChat home'), '404 page must have a working home link');
const robots = await readFile(path.join(dist, 'robots.txt'), 'utf8');
check(robots.includes(`Sitemap: ${config.origin.replace(/\/$/, '')}/sitemap.xml`), 'robots.txt sitemap URL mismatch');
const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
for (const page of pages) {
  const pageUrl = new URL(page.route.replace(/^\//, ''), base).href;
  if (page.indexable === false) check(!sitemap.includes(pageUrl), `sitemap must not include noindex route ${page.route}`);
  else check(sitemap.includes(pageUrl), `sitemap is missing ${page.route}`);
}
const home = await readFile(filePathForRoute('/'), 'utf8');
const homeLinks = [...home.matchAll(/\bhref="([^"]*)"/gi)].map(match => new URL(decodeEntities(match[1]), base).pathname);
for (const route of ['/legal/privacy/', '/legal/terms/', '/legal/community-guidelines/', '/legal/acceptable-use/', '/legal/storage/']) {
  const expectedPath = new URL(route.replace(/^\//, ''), base).pathname;
  check(homeLinks.includes(expectedPath), `shared footer is missing legal link ${route}`);
}
for (const route of ['/verify-email/', '/reset-password/']) check(pages.some(page => page.route === route && page.indexable === false), `account-action route must be noindex: ${route}`);

console.log(`Site checks passed: ${pages.length} routes, ${checkedTargets} local links/assets, per-route metadata, sitemap/robots, 404 and release-link safeguards.`);
