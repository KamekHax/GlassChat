const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { io } = require('socket.io-client');
const { glassChatBuildId } = require('../package.json');

const DEFAULT_API = process.env.GLASSCHAT_API_URL || 'https://glasschat-beta-api.onrender.com';
const LEGACY_LOCAL_DEFAULT = 'http://127.0.0.1:3211';
const isLoopback = host => ['localhost', '127.0.0.1', '::1'].includes(host.replace(/^\[|\]$/g, '').toLowerCase());
let win, apiBase = DEFAULT_API, auth = null, socket = null, activeChannel = null, presenceUsers = [];

function configFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function sessionFile() { return path.join(app.getPath('userData'), 'session.dat'); }
function logStartup() {
  try {
    const dir = app.getPath('logs'), file = path.join(dir, 'glasschat.log');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) {
      fs.rmSync(`${file}.1`, { force: true }); fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, `${new Date().toISOString()} GlassChat ${app.getVersion()} build ${glassChatBuildId || 'dev'} started\n`);
  } catch {}
}
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    const savedApi = c.apiBase || DEFAULT_API;
    const migrateLegacyDefault = savedApi === LEGACY_LOCAL_DEFAULT && DEFAULT_API !== LEGACY_LOCAL_DEFAULT;
    apiBase = validateApiBase(migrateLegacyDefault ? DEFAULT_API : savedApi);
    if (migrateLegacyDefault) saveConfig();
  } catch { apiBase = validateApiBase(DEFAULT_API); }
}
function saveConfig() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ apiBase }), { mode: 0o600 });
}
function loadSession() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile())));
  } catch { return null; }
}
function saveSession(value) {
  auth = value;
  try {
    if (!safeStorage.isEncryptionAvailable()) { fs.rmSync(sessionFile(), { force: true }); return false; }
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const temp = `${sessionFile()}.tmp`;
    fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
    fs.renameSync(temp, sessionFile()); return true;
  } catch { return false; }
}
function clearSession() {
  auth = null;
  try { fs.rmSync(sessionFile(), { force: true }); } catch {}
  if (socket) { socket.disconnect(); socket = null; }
  activeChannel = null;
}
function validateApiBase(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { throw new Error('Enter a valid GlassChat service URL.'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || (u.protocol === 'http:' && !isLoopback(u.hostname))) throw new Error('Use an HTTPS service URL. HTTP is permitted only for localhost development.');
  return u.toString().replace(/\/$/, '');
}
function cookieFromResponse(response) {
  const headers = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  for (const line of headers) {
    const match = line.match(/(?:^|,\s*)(__Host-glasschat_session|glasschat_session)=([^;\s,]+)/);
    if (match) return `${match[1]}=${match[2]}`;
  }
  return null;
}
async function api(pathname, { method = 'GET', body, withAuth = false, csrf = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withAuth && auth?.cookie) headers.Cookie = auth.cookie;
  if (csrf && auth?.csrfToken) headers['X-CSRF-Token'] = auth.csrfToken;
  let response;
  try { response = await fetch(`${apiBase}/api/auth${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) }); }
  catch (error) { throw new Error(`Cannot reach the GlassChat service at ${apiBase}. ${error.message}`); }
  const setCookie = cookieFromResponse(response);
  let data = {};
  if (response.status !== 204) { try { data = await response.json(); } catch { data = {}; } }
  if (setCookie && auth) auth.cookie = setCookie;
  if (!response.ok) {
    const error = new Error(data.message || humanError(data.error, response.status));
    error.code = data.error || `HTTP_${response.status}`; error.status = response.status; throw error;
  }
  return { data, setCookie };
}
function humanError(code, status) {
  const known = { INVALID_CREDENTIALS: 'Email/username or password is incorrect, or the email is not verified.', INVALID_USERNAME: 'Use 3–24 lowercase letters, numbers, or underscores.', INVALID_EMAIL: 'Enter a valid email address.', INVALID_PASSWORD: 'Use a password between 12 and 128 characters.', USERNAME_UNAVAILABLE: 'That username is already taken.', INVALID_OR_EXPIRED_TOKEN: 'This verification token is invalid or expired.', INVALID_OR_EXPIRED_TOKEN_OR_PASSWORD: 'The reset token is invalid or expired, or the password does not meet requirements.', EMAIL_DELIVERY_UNAVAILABLE: 'The account was created, but verification email delivery is temporarily unavailable. Try resend verification.', AUTHENTICATION_REQUIRED: 'Please sign in again.', CSRF_CHECK_FAILED: 'Security check failed. Please sign in again.', TOO_MANY_REQUESTS: 'Too many attempts. Wait a while, then try again.' };
  return known[code] || `GlassChat service request failed (${status}).`;
}
function pushEvent(event) { if (win && !win.isDestroyed()) win.webContents.send('chat:event', event); }
async function loadCommunities() {
  const { data } = await api('/communities', { withAuth: true });
  return data.communities || [];
}
function connectRealtime() {
  if (socket) { socket.disconnect(); socket = null; }
  if (!auth?.cookie) return;
  socket = io(apiBase, { path: '/socket.io', transports: ['websocket'], reconnection: true, timeout: 8000, extraHeaders: { Cookie: auth.cookie } });
  socket.on('connect', () => { if (activeChannel) socket.emit('channel:join', activeChannel); pushEvent({ type: 'connection', online: true }); });
  socket.on('disconnect', () => pushEvent({ type: 'connection', online: false }));
  socket.on('connect_error', error => pushEvent({ type: 'connection', online: false, error: error.message }));
  for (const eventName of ['channel:init', 'message', 'typing']) socket.on(eventName, payload => {
    if (eventName === 'channel:init') { activeChannel = payload.channel?.id || activeChannel; presenceUsers = payload.users || []; }
    pushEvent({ type: eventName, ...payload });
  });
  socket.on('presence:update', payload => {
    if (!payload?.user) return;
    const members = new Set(presenceUsers);
    if (payload.state === 'joined') members.add(payload.user); else members.delete(payload.user);
    presenceUsers = [...members]; pushEvent({ type: 'presence', users: presenceUsers });
  });
  for (const eventName of ['channel:error', 'message:error', 'chat:error']) socket.on(eventName, payload => pushEvent({ type: 'error', error: payload?.error || 'CHAT_ERROR' }));
  socket.on('session:expired', () => { clearSession(); pushEvent({ type: 'session-expired' }); });
}
async function activateSession(response) {
  const cookie = response.setCookie;
  if (!cookie) throw new Error('The service did not establish a session. Please retry.');
  auth = { cookie, csrfToken: response.data.csrfToken, user: response.data.user };
  saveSession(auth);
  const communities = await loadCommunities();
  connectRealtime();
  return { user: auth.user, communities, csrfToken: auth.csrfToken };
}
async function restoreSession() {
  if (!auth) auth = loadSession();
  if (!auth?.cookie) return { user: null };
  try {
    const current = await api('/me', { withAuth: true });
    auth.user = current.data.user;
    const csrf = await api('/csrf', { withAuth: true }); auth.csrfToken = csrf.data.csrfToken;
    saveSession(auth);
    const communities = await loadCommunities(); connectRealtime();
    return { user: auth.user, communities, csrfToken: auth.csrfToken };
  } catch (error) {
    if (error.status === 401) { clearSession(); return { user: null }; }
    throw error;
  }
}
async function register(data) { return (await api('/register', { method: 'POST', body: data })).data; }
async function login(data) { return activateSession(await api('/login', { method: 'POST', body: data })); }
async function verifyEmail(data) { return activateSession(await api('/verify-email', { method: 'POST', body: data })); }
async function resendVerification(data) { return (await api('/verification/resend', { method: 'POST', body: data })).data; }
async function forgotPassword(data) { return (await api('/password/forgot', { method: 'POST', body: data })).data; }
async function resetPassword(data) { const result = (await api('/password/reset', { method: 'POST', body: data })).data; clearSession(); return result; }
async function logout() {
  try { if (auth?.cookie) await api('/logout', { method: 'POST', body: {}, withAuth: true, csrf: true }); }
  finally { clearSession(); }
}
async function setApiBaseUrl(value) {
  const next = validateApiBase(value);
  if (next !== apiBase && auth?.cookie) { try { await logout(); } catch { clearSession(); } }
  apiBase = next; saveConfig(); return apiBase;
}
function sendChat(eventName, payload) {
  if (!socket?.connected) throw new Error('Not connected to GlassChat chat. Check your network and retry.');
  socket.emit(eventName, payload);
}
function registerIpc() {
  ipcMain.handle('app:metadata', () => ({ name: 'GlassChat', version: app.getVersion(), buildId: glassChatBuildId || 'development' }));
  ipcMain.handle('auth:status', restoreSession);
  ipcMain.handle('auth:register', (_e, data) => register(data));
  ipcMain.handle('auth:login', (_e, data) => login(data));
  ipcMain.handle('auth:verify-email', (_e, data) => verifyEmail(data));
  ipcMain.handle('auth:resend-verification', (_e, data) => resendVerification(data));
  ipcMain.handle('auth:forgot-password', (_e, data) => forgotPassword(data));
  ipcMain.handle('auth:reset-password', (_e, data) => resetPassword(data));
  ipcMain.handle('auth:logout', logout);
  ipcMain.handle('auth:set-api-base-url', (_e, value) => setApiBaseUrl(value));
  ipcMain.handle('auth:get-api-base-url', () => apiBase);
  ipcMain.handle('chat:join-channel', (_e, id) => { if (typeof id !== 'string' || id.length > 64) throw new Error('Invalid channel.'); activeChannel = id; if (socket?.connected) socket.emit('channel:join', id); });
  ipcMain.handle('chat:send-message', (_e, text) => { if (typeof text !== 'string' || text.length > 4000) throw new Error('Message must be under 4,000 characters.'); sendChat('message:send', text); });
  ipcMain.handle('chat:set-typing', (_e, active) => { if (typeof active !== 'boolean') throw new Error('Invalid typing state.'); if (socket?.connected) socket.emit('typing', active); });
}
function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 880, minHeight: 600,
    backgroundColor: '#090b12', title: `GlassChat v${app.getVersion()}`, titleBarStyle: 'hidden',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file://')) event.preventDefault(); });
  win.on('closed', () => { win = null; });
}
app.whenReady().then(() => { app.setName('GlassChat'); logStartup(); loadConfig(); registerIpc(); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (socket) socket.disconnect(); if (process.platform !== 'darwin') app.quit(); });
