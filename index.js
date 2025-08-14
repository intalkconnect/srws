// index.js (sem CORS, sem autenticação)
import { createServer } from 'node:http';
import { Server } from 'socket.io';

// HTTP básico (health e, opcional, emissão server-to-server)
const httpServer = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  // OPCIONAL: emitir eventos via HTTP (use só server-to-server)
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

// Socket.IO (sem CORS; só WebSocket)
const io = new Server(httpServer, {
  path: '/socket.io',
  transports: ['websocket'],
  allowEIO3: false
});

// Conexões + rooms (sem auth)
io.on('connection', (socket) => {
  console.log('[io] connected', socket.id);

  const tenant = socket.handshake.query?.tenant_id ?? null;
  if (tenant) {
    socket.join(`tenant:${tenant}`);
    console.log(`[io] joined tenant room: tenant:${tenant}`);
  }

  socket.on('join_room', (room) => {
    if (!room) return;
    socket.join(room);
    console.log(`[io] ${socket.id} joined: ${room}`);
  });

  socket.on('leave_room', (room) => {
    if (!room) return;
    socket.leave(room);
    console.log(`[io] ${socket.id} left: ${room}`);
  });

  socket.on('disconnect', (reason) => {
    console.log('[io] disconnected', socket.id, reason);
  });
});

// Start
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket server on http://0.0.0.0:${PORT}`);
});
