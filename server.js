// server.js
// Node >= 18
const Fastify = require('fastify');
const fastifyIO = require('fastify-socket.io');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

// Adapter Redis (opcional, liga se REDIS_URL estiver setado)
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const REDIS_URL = process.env.REDIS_URL || ''; // ex: redis://localhost:6379

// ----------------- Utils de room (com prefixo por tenant) -----------------
const key       = (t, ...parts) => ['t', t, ...parts].join(':');
const roomUser  = (t, userId)   => key(t, 'user', userId);
const roomAgent = (t, email)    => key(t, 'agent', email);
const roomFila  = (t, fila)     => key(t, 'fila', fila);
const roomTenant= (t)           => key(t, 'global'); // opcional

// ----------------------------- Fastify ------------------------------------
const app = Fastify({ logger: true });

// Registra Socket.IO no Fastify (sem CORS)
app.register(fastifyIO, {
  path: '/socket.io',
  // teu cliente usa ['websocket']; manter apenas websocket evita preflight de polling
  transports: ['websocket'],
  serveClient: false,
});

let io;               // socket.io Server
let pubClient=null;   // redis publisher
let subClient=null;   // redis subscriber

// --------------------- Inicialização assíncrona ----------------------------
async function start() {
  await app.ready();
  io = app.io;

  // Adapter Redis (opcional)
  if (REDIS_URL) {
    pubClient = createClient({ url: REDIS_URL });
    subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    app.log.info('Socket.IO usando Redis adapter.');
  } else {
    app.log.warn('REDIS_URL vazio — rodando sem adapter (apenas 1 instância).');
  }

  // 🔐 Auth/JWT por tenant no handshake
  io.use((socket, next) => {
    try {
      const authToken =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      if (!authToken) return next(new Error('missing token'));
      const payload = jwt.verify(authToken, JWT_SECRET); // precisa ter tenant_id
      if (!payload?.tenant_id) return next(new Error('invalid tenant'));
      socket.data.tenantId = String(payload.tenant_id);
      socket.data.email = payload.email || null;
      socket.data.filas = [];
      socket.data.currentUserRoom = null;
      return next();
    } catch (e) {
      return next(new Error('unauthorized'));
    }
  });

  // --------------------------- Eventos Socket -----------------------------
  io.on('connection', (socket) => {
    const tenantId = socket.data.tenantId;
    app.log.info({ id: socket.id, tenantId }, '[socket] connected');

    // identify: front envia { email, rooms: [filas...] }
    socket.on('identify', ({ email, rooms = [] } = {}, ack) => {
      try {
        socket.data.email = email || null;
        socket.data.filas = Array.isArray(rooms) ? rooms : [];
        if (email) socket.join(roomAgent(tenantId, email));
        socket.data.filas.forEach((f) => f && socket.join(roomFila(tenantId, f)));
        socket.join(roomTenant(tenantId)); // opcional
        ack && ack({ ok: true });
      } catch (e) {
        ack && ack({ ok: false, error: e.message });
      }
    });

    socket.on('join_room', (userId) => {
      const newRoom = roomUser(tenantId, userId);
      if (socket.data.currentUserRoom && socket.data.currentUserRoom !== newRoom) {
        socket.leave(socket.data.currentUserRoom);
      }
      socket.join(newRoom);
      socket.data.currentUserRoom = newRoom;
    });

    socket.on('leave_room', (userId) => {
      const r = roomUser(tenantId, userId);
      socket.leave(r);
      if (socket.data.currentUserRoom === r) {
        socket.data.currentUserRoom = null;
      }
    });

    socket.on('disconnect', (reason) => {
      app.log.info({ id: socket.id, reason }, '[socket] disconnected');
    });
  });

  // ------------------------- Helpers de emissão ---------------------------
  function emitNewMessage(tenantId, msg) {
    const { user_id, assigned_to, fila } = msg || {};
    if (!tenantId || !user_id) return;
    io.to(roomUser(tenantId, user_id)).emit('new_message', msg);
    if (assigned_to) io.to(roomAgent(tenantId, assigned_to)).emit('new_message', msg);
    if (fila)        io.to(roomFila(tenantId, fila)).emit('new_message', msg);
  }

  function emitUpdateMessage(tenantId, msg) {
    const { user_id, assigned_to, fila } = msg || {};
    if (!tenantId || !user_id) return;
    io.to(roomUser(tenantId, user_id)).emit('update_message', msg);
    if (assigned_to) io.to(roomAgent(tenantId, assigned_to)).emit('update_message', msg);
    if (fila)        io.to(roomFila(tenantId, fila)).emit('update_message', msg);
  }

  function emitFilaCount(tenantId, fila, count) {
    if (!tenantId || !fila) return;
    io.to(roomFila(tenantId, fila)).emit('fila_count', { fila, count });
  }

  // Exponho no app pra usar em outros módulos (ex.: service que grava no DB)
  app.decorate('wsEmit', { emitNewMessage, emitUpdateMessage, emitFilaCount });

  // ---------------------- Endpoints de teste (opcional) -------------------
  // 👉 Use só pra validar em dev; em produção, emita via seu service de mensagens.
  app.post('/dev/message', async (req, reply) => {
    const tenantId = (req.headers['x-tenant-id'] || req.body?.tenant_id || '').toString();
    const {
      user_id,
      content,
      direction = 'incoming',     // 'incoming' | 'outgoing'
      assigned_to,                // email do atendente
      channel = 'whatsapp',
      ticket_number = '000000',
      fila = 'Orçamento',
    } = req.body || {};

    if (!tenantId || !user_id || !content) {
      return reply.code(400).send({ error: 'Informe tenant_id, user_id e content' });
    }

    const msg = {
      id: randomUUID(),
      user_id,
      direction,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      timestamp: new Date().toISOString(),
      status: 'sent',
      channel,
      ticket_number,
      assigned_to,
      fila,
    };

    // Na vida real: salvar no DB e só depois emitir
    emitNewMessage(tenantId, msg);
    return reply.send({ ok: true, emitted: msg });
  });

  app.post('/dev/message/update', async (req, reply) => {
    const tenantId = (req.headers['x-tenant-id'] || req.body?.tenant_id || '').toString();
    const msg = req.body || {};
    if (!tenantId || !msg?.user_id || !msg?.id) {
      return reply.code(400).send({ error: 'Informe tenant_id, user_id e id' });
    }
    msg.timestamp = msg.timestamp || new Date().toISOString();
    emitUpdateMessage(tenantId, msg);
    return reply.send({ ok: true });
  });

  app.post('/dev/fila', async (req, reply) => {
    const tenantId = (req.headers['x-tenant-id'] || req.body?.tenant_id || '').toString();
    const { fila, count } = req.body || {};
    if (!tenantId || !fila || typeof count !== 'number') {
      return reply.code(400).send({ error: 'Informe tenant_id, fila e count (number)' });
    }
    emitFilaCount(tenantId, fila, count);
    return reply.send({ ok: true });
  });

  // --------------------------- Start server -------------------------------
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`HTTP & WebSocket on http://localhost:${PORT}`);

  // Graceful shutdown
  const close = async () => {
    app.log.info('Shutting down...');
    try {
      await app.close();
      if (pubClient) await pubClient.quit();
      if (subClient) await subClient.quit();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
