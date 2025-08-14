// server.js
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyIO from '@fastify/socket.io';

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: (origin, cb) => cb(null, true), // ajuste para produção
  credentials: true
});

await fastify.register(fastifyIO, {
  path: '/socket.io',
  cors: { origin: true, methods: ['GET','POST'] }
});

// Health check HTTP
fastify.get('/healthz', async () => ({ status: 'ok' }));

// Eventos socket
fastify.io.on('connection', (socket) => {
  const tenant_id = socket.handshake.query?.tenant_id || null;

  fastify.log.info({ id: socket.id, tenant_id }, 'socket connected');

  // se quiser agrupar por tenant:
  if (tenant_id) socket.join(`tenant:${tenant_id}`);

  // compatível com seu front:
  socket.on('identify', ({ email, rooms = [] } = {}) => {
    rooms.forEach((room) => socket.join(room));
  });

  socket.on('join_room', (room) => socket.join(room));
  socket.on('leave_room', (room) => socket.leave(room));

  socket.on('disconnect', (reason) => {
    fastify.log.info({ id: socket.id, reason }, 'socket disconnected');
  });
});

// Exemplo de endpoint HTTP que dispara evento para uma sala
fastify.post('/messages', async (req, reply) => {
  const { room, event = 'new_message', payload } = req.body || {};
  if (!room) return reply.code(400).send({ error: 'room é obrigatório' });

  // Envia para quem está nessa sala
  fastify.io.to(room).emit(event, payload);
  return { ok: true };
});

await fastify.listen({ host: '0.0.0.0', port: 8080 });
