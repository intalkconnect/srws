// index.js (sem CORS)
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

// HTTP básico (só p/ health e, opcional, emissão server-to-server)
const httpServer = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  // OPCIONAL: emitir eventos via HTTP (use só server-to-server; do browser falhará sem CORS)
  if (req.method === 'POST' && req.url === '/emit') {
    try {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const { room, event = 'new_message', payload } =
        JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!room) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'room é obrigatório' }));
      }
      io.to(room).emit(event, payload);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e?.message || e) }));
    }
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// Socket.IO sem CORS e só websocket
const io = new Server(httpServer, {
  path: '/socket.io',
  transports: ['websocket'], // <- só WS (sem polling, logo sem CORS)
  allowEIO3: false            // padrão; apenas reforçando
});

// Auth opcional via JWT (não obrigatório)
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) return next();
  try {
    socket.data.user = jwt.verify(token, secret);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

// Conexões + rooms
io.on('connection', (socket) => {
  const tenant = socket.handshake.query?.tenant_id ?? null;
  if (tenant) socket.join(`tenant:${tenant}`);

  socket.on('join_room', (room) => room && socket.join(room));
  socket.on('leave_room', (room) => room && socket.leave(room));

  socket.on('disconnect', (reason) => {
    console.log('socket disconnected', socket.id, reason);
  });
});

// Start
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket server on http://0.0.0.0:${PORT}`);
});
