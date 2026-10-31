import { readFile } from 'node:fs/promises';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const app = await readJson('package.json');
const service = await readJson('server/package.json');
const site = await readJson('website/site.config.json');
const siteInfo = await readJson('website/src/data/site-info.json');
const rootLock = await readJson('package-lock.json');
const serviceLock = await readJson('server/package-lock.json');
const mainSource = await readFile('src/main.js', 'utf8');
const semver = /^\d+\.\d+\.\d+$/;
const failures = [];
const desktopApiDefault = mainSource.match(/const DEFAULT_API = process\.env\.GLASSCHAT_API_URL \|\| '([^']+)';/)?.[1] || '';

if (!semver.test(app.version || '')) failures.push(`desktop version is not semantic MAJOR.MINOR.PATCH: ${app.version}`);
if (!semver.test(service.version || '')) failures.push(`service version is not semantic MAJOR.MINOR.PATCH: ${service.version}`);
if (app.version !== service.version) failures.push(`desktop/service versions differ: ${app.version} vs ${service.version}`);
if (app.version !== site.version) failures.push(`desktop/site versions differ: ${app.version} vs ${site.version}`);
if (app.version !== siteInfo.version) failures.push(`desktop/site-info versions differ: ${app.version} vs ${siteInfo.version}`);
if (!app.glassChatBuildId || app.glassChatBuildId !== site.buildId) failures.push(`desktop/site build IDs differ: ${app.glassChatBuildId} vs ${site.buildId}`);
if (app.glassChatBuildId !== siteInfo.buildId) failures.push(`desktop/site-info build IDs differ: ${app.glassChatBuildId} vs ${siteInfo.buildId}`);
if (site.apiBaseUrl && desktopApiDefault !== site.apiBaseUrl) failures.push(`desktop/site API bases differ: ${desktopApiDefault} vs ${site.apiBaseUrl}`);
for (const [name, lock] of [['root package-lock.json', rootLock], ['server/package-lock.json', serviceLock]]) {
  if (lock.version !== (name.startsWith('root') ? app.version : service.version)) failures.push(`${name} root version does not match its package`);
  if (lock.packages?.['']?.version !== (name.startsWith('root') ? app.version : service.version)) failures.push(`${name} packages[""] version does not match its package`);
}

if (failures.length) {
  console.error('GlassChat version check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`GlassChat versions aligned: ${app.version} / build ${app.glassChatBuildId}`);
}
