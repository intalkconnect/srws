// index.js
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

// -------- HTTP server (sem framework) --------
const httpServer = createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Endpoint opcional para emitir eventos via HTTP:
  // POST /emit { room, event='new_message', payload }
  if (req.method === 'POST' && req.url === '/emit') {
    try {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');

      const { room, event = 'new_message', payload } = body;
      if (!room) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'room é obrigatório' }));
        return;
      }

      io.to(room).emit(event, payload);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// -------- Socket.IO --------
const io = new Server(httpServer, {
  path: '/socket.io',
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : true, // ajuste em produção
    credentials: true
  },
  transports: ['websocket'] // prioriza WS
});

// Middleware de auth opcional (JWT)
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  const secret = process.env.JWT_SECRET; // defina em produção

  if (!secret || !token) return next(); // sem auth obrigatória

  try {
    socket.data.user = jwt.verify(token, secret);
    return next();
  } catch (e) {
    return next(new Error('unauthorized'));
  }
});

// Conexão
io.on('connection', (socket) => {
  const tenant = socket.handshake.query?.tenant_id ?? null;

  // room por tenant (opcional)
  if (tenant) socket.join(`tenant:${tenant}`);

  // ====== Rooms compatíveis com seu front ======
  socket.on('join_room', (room) => room && socket.join(room));
  socket.on('leave_room', (room) => room && socket.leave(room));

  // útil para testes: emitir do cliente
  // socket.emit('new_message', { ... })

  socket.on('disconnect', (reason) => {
    // log simples
    console.log('socket disconnected', socket.id, reason);
  });
});

// Sobe servidor
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket server on http://0.0.0.0:${PORT}`);
});
