const crypto = require('node:crypto');
const { Server } = require('socket.io');

const sessionCookieName = () => process.env.NODE_ENV === 'production' ? '__Host-glasschat_session' : 'glasschat_session';
function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return null; }
    }
  }
  return null;
}
const roomFor = channelId => `channel:${channelId}`;

function attachRealtime(server, { pool, logger = console }) {
  const io = new Server(server, { cors: false, allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (origin && process.env.APP_ORIGIN && origin !== process.env.APP_ORIGIN) return callback('origin not allowed', false);
    if (origin && process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN) return callback('origin not configured', false);
    callback(null, true); // Electron main-process clients omit Origin but still require a valid session cookie.
  } });
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, sessionCookieName());
      if (!token || token.length > 128) return next(new Error('unauthorized'));
      const tokenHash = crypto.createHash('sha256').update(token).digest();
      const result = await pool.query(`SELECT u.id AS user_id,u.username,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.email_verified_at IS NOT NULL`, [tokenHash]);
      if (!result.rows[0]) return next(new Error('unauthorized'));
      socket.data.userId = result.rows[0].user_id;
      socket.data.username = result.rows[0].username;
      socket.data.sessionHash = tokenHash;
      socket.data.joinedChannel = null;
      socket.data.events = [];
      await socket.join(`user:${socket.data.userId}`);
      const sessionRoom = `session:${tokenHash.toString('hex')}`;
      await socket.join(sessionRoom);
      const expiryDelay = Math.min(Math.max(0, new Date(result.rows[0].expires_at).getTime() - Date.now()), 2_147_000_000);
      socket.data.expiryTimer = setTimeout(() => { io.in(sessionRoom).emit('session:expired'); io.in(sessionRoom).disconnectSockets(true); }, expiryDelay);
      socket.data.expiryTimer.unref?.();
      next();
    } catch (error) { logger.error('socket authentication failed', error); next(new Error('unauthorized')); }
  });

  async function memberChannel(channelId, userId) {
    const result = await pool.query(`SELECT ch.id,ch.name,ch.topic FROM channels ch JOIN community_memberships m ON m.community_id=ch.community_id WHERE ch.id=$1 AND m.user_id=$2`, [channelId, userId]);
    return result.rows[0] || null;
  }
  async function sessionValid(socket) {
    try {
      const result = await pool.query('SELECT 1 FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()', [socket.data.sessionHash]);
      if (result.rows[0]) return true;
      socket.emit('session:expired'); socket.disconnect(true); return false;
    } catch (error) {
      logger.error('socket session revalidation failed', error);
      socket.emit('chat:error', { error: 'CHAT_SERVICE_UNAVAILABLE' }); socket.disconnect(true); return false;
    }
  }
  function limited(socket) {
    const now = Date.now();
    socket.data.events = socket.data.events.filter(t => now - t < 10000);
    if (socket.data.events.length >= 12) return true;
    socket.data.events.push(now);
    return false;
  }
  io.on('connection', socket => {
    socket.on('channel:join', async channelId => {
      if (limited(socket)) return socket.emit('channel:error', { error: 'RATE_LIMITED' });
      if (!(await sessionValid(socket))) return;
      if (typeof channelId !== 'string' || channelId.length > 64) return socket.emit('channel:error', { error: 'CHANNEL_NOT_FOUND' });
      try {
        const channel = await memberChannel(channelId, socket.data.userId);
        if (!channel) {
          if (socket.data.joinedChannel) socket.leave(roomFor(socket.data.joinedChannel));
          socket.data.joinedChannel = null;
          return socket.emit('channel:error', { error: 'CHANNEL_NOT_FOUND' });
        }
        const previous = socket.data.joinedChannel;
        if (previous && previous !== channel.id) {
          socket.leave(roomFor(previous));
          socket.to(roomFor(previous)).emit('presence:update', { user: socket.data.username, state: 'left' });
        }
        socket.data.joinedChannel = channel.id;
        await socket.join(roomFor(channel.id));
        const history = await pool.query(`SELECT msg.id,u.username AS "user",msg.text,msg.created_at AS time FROM messages msg JOIN users u ON u.id=msg.author_id WHERE msg.channel_id=$1 ORDER BY msg.created_at DESC,msg.id DESC LIMIT 100`, [channel.id]);
        const users = new Set();
        for (const peer of io.sockets.sockets.values()) if (peer.data.joinedChannel === channel.id) users.add(peer.data.username);
        socket.emit('channel:init', { channel: { id: channel.id, name: channel.name, topic: channel.topic }, messages: history.rows.reverse(), users: [...users] });
        if (previous !== channel.id) socket.to(roomFor(channel.id)).emit('presence:update', { user: socket.data.username, state: 'joined' });
      } catch (error) { logger.error('channel join failed', error); socket.emit('channel:error', { error: 'CHAT_SERVICE_UNAVAILABLE' }); }
    });

    socket.on('message:send', async text => {
      const channelId = socket.data.joinedChannel;
      if (!channelId) return socket.emit('message:error', { error: 'CHANNEL_REQUIRED' });
      if (limited(socket)) return socket.emit('message:error', { error: 'RATE_LIMITED' });
      if (!(await sessionValid(socket))) return;
      if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 4000) return socket.emit('message:error', { error: 'INVALID_MESSAGE' });
      try {
        const channel = await memberChannel(channelId, socket.data.userId);
        if (!channel) { socket.leave(roomFor(channelId)); socket.data.joinedChannel = null; return socket.emit('message:error', { error: 'CHANNEL_NOT_FOUND' }); }
        const saved = await pool.query(`INSERT INTO messages(channel_id,author_id,text) VALUES($1,$2,$3) RETURNING id,text,created_at AS time`, [channel.id, socket.data.userId, text.trim()]);
        const row = saved.rows[0];
        io.to(roomFor(channel.id)).emit('message', { id: row.id, user: socket.data.username, text: row.text, time: row.time });
      } catch (error) { logger.error('message persistence failed', error); socket.emit('message:error', { error: 'CHAT_SERVICE_UNAVAILABLE' }); }
    });
    socket.on('typing', async active => {
      const channelId = socket.data.joinedChannel;
      if (typeof active !== 'boolean' || !channelId || limited(socket) || !(await sessionValid(socket))) return;
      try { if (await memberChannel(channelId, socket.data.userId)) socket.to(roomFor(channelId)).emit('typing', { user: socket.data.username, active }); }
      catch (error) { logger.error('typing membership check failed', error); }
    });
    socket.on('disconnect', () => {
      clearTimeout(socket.data.expiryTimer);
      if (socket.data.joinedChannel) socket.to(roomFor(socket.data.joinedChannel)).emit('presence:update', { user: socket.data.username, state: 'left' });
    });
  });
  return io;
}

module.exports = { attachRealtime };
