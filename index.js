// index.js
import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyIO from 'fastify-socket.io';

const {
  PORT = 3000,
  HOST = '0.0.0.0',
  CORS_ORIGIN = '*',
  EMIT_SECRET = 'changeme' // o worker usa Authorization: Bearer <EMIT_SECRET>
} = process.env;

async function start() {
  const app = Fastify({ logger: true });

  // CORS
  await app.register(fastifyCors, {
    origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(','),
    credentials: true
  });

  // Socket.IO no mesmo path que seu front usa
  await app.register(fastifyIO, {
    path: '/socket.io',
    cors: {
      origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(','),
      credentials: true
    },
    transports: ['websocket']
  });

  // ========= SOCKETS =========
  app.io.on('connection', (socket) => {
    app.log.info({ id: socket.id }, 'socket connected');

    // Identify: todo cliente deve mandar empresa_id ao conectar
    // front: socket.emit("identify", { empresa_id, email, rooms: userFilas })
    socket.on('identify', (payload = {}) => {
      const { empresa_id, email, rooms = [] } = payload || {};

      if (!empresa_id) {
        app.log.warn({ id: socket.id }, 'identify sem empresa_id');
        socket.disconnect(true);
        return;
      }

      // Room da empresa (multi-tenant)
      socket.join(`emp:${empresa_id}`);

      // Room do atendente (para sidebar/contadores/avisos só dele)
      if (email) socket.join(`agent:${empresa_id}:${email}`);

      // Rooms de fila por empresa (opcional, útil pra contagem/avisos por fila)
      rooms.forEach((fila) => fila && socket.join(`fila:${empresa_id}:${fila}`));

      // guardar metadados
      socket.data = { empresa_id, email };
      app.log.info({ id: socket.id, empresa_id, email, rooms }, 'identified');
    });

    // Compat: caso o front faça join_room(userId) sem prefixo
    socket.on('join_room', (roomKey) => {
      const emp = socket.data?.empresa_id;
      if (!emp || !roomKey) return;

      const room = roomKey.startsWith('user:')
        ? roomKey
        : `user:${emp}:${roomKey}`;

      socket.join(room);
      app.log.info({ id: socket.id, room }, 'joined room');
    });

    socket.on('leave_room', (roomKey) => {
      const emp = socket.data?.empresa_id;
      if (!emp || !roomKey) return;

      const room = roomKey.startsWith('user:')
        ? roomKey
        : `user:${emp}:${roomKey}`;

      socket.leave(room);
      app.log.info({ id: socket.id, room }, 'left room');
    });

    socket.on('disconnect', (reason) => {
      app.log.info({ id: socket.id, reason }, 'socket disconnected');
    });
  });

  // ========= HEALTH =========
  app.get('/health', async () => ({ ok: true }));

  // ========= AUTH simples pros endpoints de EMIT (worker) =========
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/emit')) return;
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token !== EMIT_SECRET) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // ========= ENDPOINTS PARA O WORKER =========

  // NEW MESSAGE:
  // body esperado:
  // {
  //   "empresa_id": "acme",
  //   "user_id": "USER-123",
  //   "assigned_to": "agente@acme.com",   // opcional, mas recomendado
  //   "fila": "Comercial",                // opcional (p/ eventos de fila)
  //   "message": { ...obj da mensagem... }
  // }
  app.post('/emit/new', async (req, reply) => {
    const { empresa_id, user_id, assigned_to, fila, message } = req.body || {};
    if (!empresa_id || !user_id || !message) {
      return reply.code(400).send({ error: 'empresa_id, user_id e message são obrigatórios' });
    }

    // 1) chat aberto (MessageList do usuário)
    app.io.to(`user:${empresa_id}:${user_id}`).emit('new_message', message);

    // 2) atendente dono (Sidebar/contadores/notificação só dele)
    if (assigned_to) {
      app.io.to(`agent:${empresa_id}:${assigned_to}`).emit('new_message', message);
    }

    // 3) empresa inteira (se quiser dashboards/monitores gerais)
    app.io.to(`emp:${empresa_id}`).emit('company_event', {
      type: 'new_message',
      user_id,
      fila
    });

    // 4) fila da empresa (contador/topo do Sidebar)
    if (fila) {
      app.io.to(`fila:${empresa_id}:${fila}`).emit('queue_event', {
        type: 'new_message',
        user_id,
        fila
      });
    }

    return { ok: true };
  });

  // UPDATE MESSAGE (status/edições):
  // body esperado:
  // {
  //   "empresa_id": "acme",
  //   "user_id": "USER-123",
  //   "assigned_to": "agente@acme.com",   // opcional
  //   "update": { ...obj do update... }
  // }
  app.post('/emit/update', async (req, reply) => {
    const { empresa_id, user_id, assigned_to, update } = req.body || {};
    if (!empresa_id || !user_id || !update) {
      return reply.code(400).send({ error: 'empresa_id, user_id e update são obrigatórios' });
    }

    // 1) chat aberto
    app.io.to(`user:${empresa_id}:${user_id}`).emit('update_message', update);

    // 2) atendente dono
    if (assigned_to) {
      app.io.to(`agent:${empresa_id}:${assigned_to}`).emit('update_message', update);
    }

    // 3) empresa (opcional)
    app.io.to(`emp:${empresa_id}`).emit('company_event', {
      type: 'update_message',
      user_id
    });

    return { ok: true };
  });

  await app.listen({ port: Number(PORT), host: HOST });
  app.log.info(`WS server on http://${HOST}:${PORT}`);
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
