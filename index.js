// index.js
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyIO from 'fastify-socket.io'; // <- usa o plugin que você instalou
import jwt from 'jsonwebtoken';

const fastify = Fastify({ logger: true });

// CORS para o front (ajuste "origin" na produção)
await fastify.register(cors, {
  origin: (origin, cb) => cb(null, true),
  credentials: true,
});

// Socket.IO plugin
await fastify.register(fastifyIO, {
  path: '/socket.io',
  cors: { origin: true, methods: ['GET', 'POST'], credentials: true },
  serveClient: false,
});

// Health check HTTP
fastify.get('/healthz', async () => ({ status: 'ok' }));

// Helper de auth via JWT (opcional, dado que você incluiu jsonwebtoken)
function authFromSocket(socket) {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.query?.token ||
    null;

  if (!token) return { ok: false, reason: 'missing token' };

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || 'dev-secret' // troque em produção
    );
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, reason: 'invalid token' };
  }
}

// Eventos Socket.IO
fastify.io.on('connection', (socket) => {
  const tenant_id = socket.handshake.query?.tenant_id ?? null;
  const auth = authFromSocket(socket);

  fastify.log.info(
    { sid: socket.id, tenant_id },
    'socket connected attempt'
  );

  if (!auth.ok) {
    socket.emit('unauthorized', { reason: auth.reason });
    socket.disconnect(true);
    return;
  }

  // anexa info do usuário para uso posterior
  socket.data.user = auth.payload;

  // agrupa por tenant (sala)
  if (tenant_id) socket.join(`tenant:${tenant_id}`);

  // ===== Handlers compatíveis com seu front =====
  // entrar em salas específicas (ex.: conversa/user_id)
  socket.on('join_room', (room) => {
    if (room) socket.join(room);
  });

  socket.on('leave_room', (room) => {
    if (room) socket.leave(room);
  });

  // identificação opcional (caso seu front envie)
  socket.on('identify', ({ rooms = [] } = {}) => {
    rooms.forEach((r) => r && socket.join(r));
  });

  socket.on('disconnect', (reason) => {
    fastify.log.info({ sid: socket.id, reason }, 'socket disconnected');
  });
});

// Endpoint HTTP para disparar eventos a uma sala (ex.: nova mensagem)
fastify.post('/messages', async (req, reply) => {
  const { room, event = 'new_message', payload } = req.body || {};
  if (!room) return reply.code(400).send({ error: 'room é obrigatório' });

  fastify.io.to(room).emit(event, payload);
  return { ok: true };
});

// Sobe o servidor
await fastify.listen({ host: '0.0.0.0', port: 8080 });
fastify.log.info('Socket server on http://0.0.0.0:8080');
