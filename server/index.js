const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const fs = require('node:fs');
const path = require('node:path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 2e6 });
const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || '127.0.0.1'; // Alpha-only, anonymous server: do not expose to untrusted networks.
const file = process.env.GLASSCHAT_DATA_FILE || path.join(__dirname, 'data.json');
let data = { channels: ['general', 'introductions', 'random'], messages: {} };
try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
function save() { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
const users = new Map();
app.get('/health', (_req, res) => res.json({ ok: true, name: 'GlassChat', channels: data.channels }));
io.on('connection', socket => {
  socket.on('join', ({ name, channel }) => {
    name = String(name || 'Guest').trim().slice(0, 32) || 'Guest';
    channel = data.channels.includes(channel) ? channel : data.channels[0];
    users.set(socket.id, { name, channel }); socket.join(channel);
    socket.emit('init', { channels: data.channels, channel, messages: data.messages[channel] || [], users: [...users.values()].filter(u => u.channel === channel).map(u => u.name) });
    socket.to(channel).emit('presence', { users: [...users.values()].filter(u => u.channel === channel).map(u => u.name) });
  });
  socket.on('switch-channel', channel => {
    const u = users.get(socket.id); if (!u || !data.channels.includes(channel)) return;
    socket.leave(u.channel); u.channel = channel; socket.join(channel);
    socket.emit('init', { channels: data.channels, channel, messages: data.messages[channel] || [], users: [...users.values()].filter(x => x.channel === channel).map(x => x.name) });
    io.to(channel).emit('presence', { users: [...users.values()].filter(x => x.channel === channel).map(x => x.name) });
  });
  socket.on('message', text => {
    const u = users.get(socket.id); if (!u || typeof text !== 'string') return;
    text = text.trim().slice(0, 4000); if (!text) return;
    const msg = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, user: u.name, text, time: new Date().toISOString() };
    const list = data.messages[u.channel] || (data.messages[u.channel] = []); list.push(msg); if (list.length > 500) list.splice(0, list.length - 500);
    save(); io.to(u.channel).emit('message', msg);
  });
  socket.on('create-channel', raw => {
    const channel = String(raw || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
    if (!channel || data.channels.includes(channel) || data.channels.length >= 30) return;
    data.channels.push(channel); data.messages[channel] = []; save(); io.emit('channels', data.channels);
  });
  socket.on('typing', () => { const u = users.get(socket.id); if (u) socket.to(u.channel).emit('typing', u.name); });
  socket.on('disconnect', () => { const u = users.get(socket.id); if (u) { users.delete(socket.id); io.to(u.channel).emit('presence', { users: [...users.values()].filter(x => x.channel === u.channel).map(x => x.name) }); } });
});
server.listen(port, host, () => console.log(`GlassChat Alpha server listening on ${host}:${port} (unauthenticated; loopback-only by default)`));
