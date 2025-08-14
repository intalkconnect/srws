import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const fastify = Fastify({ 
  logger: true,
  trustProxy: true  // Importante para rodar atrás de proxy
});

// Configuração WebSocket
fastify.register(websocket, {
  options: {
    path: process.env.SOCKET_PATH || '/ws',
    maxPayload: 1048576, // 1MB
    clientTracking: true
  }
});

// Rota WebSocket
fastify.get('/ws/:tenant_id', { websocket: true }, (connection, req) => {
  const tenant_id = req.params.tenant_id;
  
  connection.socket.on('message', (message) => {
    console.log(`[${tenant_id}] Mensagem:`, message.toString());
    
    // Resposta automática (opcional)
    connection.socket.send(JSON.stringify({
      event: 'ack',
      data: { received: true, timestamp: Date.now() }
    }));
  });

  connection.socket.on('close', () => {
    console.log(`[${tenant_id}] Conexão fechada`);
  });
});

// Health Check
fastify.get('/healthz', async () => {
  return { status: 'ok', timestamp: Date.now() };
});

// Inicia o servidor
fastify.listen({
  port: process.env.PORT || 8080,
  host: '0.0.0.0'  # Crucial para Docker
}, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Servidor rodando em ws://0.0.0.0:${fastify.server.address().port}`);
});
