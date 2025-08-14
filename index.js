import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const fastify = Fastify({ logger: true });
const rooms = new Map(); // Mapa de rooms por tenant

fastify.register(websocket, {
  options: {
    maxPayload: 1048576, // 1MB
    clientTracking: false // Gerenciamos manualmente
  }
});

fastify.get('/ws/:tenant_id', { websocket: true }, (connection, req) => {
  const tenant_id = req.params.tenant_id;
  
  // Adiciona à room do tenant
  if (!rooms.has(tenant_id)) {
    rooms.set(tenant_id, new Set());
  }
  rooms.get(tenant_id).add(connection.socket);

  // Remove ao desconectar
  connection.socket.on('close', () => {
    rooms.get(tenant_id)?.delete(connection.socket);
    if (rooms.get(tenant_id)?.size === 0) {
      rooms.delete(tenant_id);
    }
  });
});

// Rota para enviar mensagens (chamada via HTTP)
fastify.post('/notify/:tenant_id', (req, reply) => {
  const { tenant_id } = req.params;
  const clients = rooms.get(tenant_id) || [];

  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(req.body));
    }
  }
  
  reply.send({ success: true });
});

fastify.listen({ 
  host: '0.0.0.0',
  port: 8080 
});
