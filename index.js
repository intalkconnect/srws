import Fastify from 'fastify';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const PORT  = Number(process.env.SOCKET_PORT || 8080);
const PATH  = process.env.SOCKET_PATH || '/socket.io';
const KEY   = process.env.WORKER_JWT_KEY || 'dev-secret'; // use RS256 em prod
const ORIGINS = (process.env.SOCKET_CORS_ORIGINS || '').split(',').filter(Boolean);

const app = Fastify({ logger: true });
const io  = new Server(app.server, {
  path: PATH,
  transports: ['websocket', 'polling'],
  cors: { origin: ORIGINS.length ? ORIGINS : undefined, credentials: true },
  connectionStateRecovery: { maxDisconnectionDuration: 60_000 },
});

// ——— Auth básica para marcar sockets ———
io.use((socket, next) => {
  try {
    const hdr = socket.handshake?.headers?.authorization || '';
    const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7) : undefined;
    const token = socket.handshake?.auth?.token || bearer;
    if (!token) return next(); // front anônimo/sem JWT (ok)
    const claims = jwt.verify(token, KEY, { algorithms: ['HS256', 'RS256'] });
    socket.data.claims = claims || {};
    socket.data.isWorker = claims?.role === 'worker';
    socket.data.workerTenant = claims?.tenant || null;
    next();
  } catch (e) {
    socket.data.isWorker = false;
    next();
  }
});

// ——— Um único namespace ———
io.on('connection', (socket) => {
  app.log.info({ id: socket.id, isWorker: socket.data.isWorker }, 'socket conectado');

  socket.on('join_room', ({ tenantId, userId }) => {
    if (!tenantId) return;
    socket.join(`tenant:${tenantId}`);
    if (userId) socket.join(`tenant:${tenantId}:user:${userId}`);
    app.log.info({ id: socket.id, tenantId, userId }, 'join_room');
  });

  socket.on('leave_room', ({ tenantId, userId }) => {
    if (!tenantId) return;
    socket.leave(`tenant:${tenantId}`);
    if (userId) socket.leave(`tenant:${tenantId}:user:${userId}`);
    app.log.info({ id: socket.id, tenantId, userId }, 'leave_room');
  });

  const EVENT_WHITELIST = new Set(['notify', 'message_saved', 'job_progress', 'job_done']);

  socket.on('server_emit', (p = {}, ack) => {
    if (!socket.data.isWorker) {
      app.log.warn('server_emit negado (não é worker)');
      return ack?.({ ok: false, error: 'not_worker' });
    }
    const { tenantId, target = 'tenant', userId, event, data } = p;
    if (!tenantId || !event || !EVENT_WHITELIST.has(String(event))) {
      return ack?.({ ok: false, error: 'invalid_payload' });
    }
    if (socket.data.workerTenant !== tenantId) {
      app.log.warn({ tokenTenant: socket.data.workerTenant, tenantId }, 'tenant mismatch');
      return ack?.({ ok: false, error: 'tenant_mismatch' });
    }

    const room =
      target === 'user' && userId
        ? `tenant:${tenantId}:user:${userId}`
        : `tenant:${tenantId}`;

    io.to(room).emit(String(event), data);
    ack?.({ ok: true });
  });

  socket.on('disconnect', (r) => {
    app.log.info({ id: socket.id, reason: r }, 'socket desconectado');
  });
});

app.get('/healthz', async () => ({ ok: true }));

app.listen({ host: '0.0.0.0', port: PORT })
  .then(() => app.log.info(`🔌 Socket.IO :${PORT}${PATH} (rooms por tenant)`))
  .catch((e) => { app.log.error(e); process.exit(1); });

export { io };
