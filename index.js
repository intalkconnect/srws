import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const fastify = Fastify({ logger: true });

// Registra o plugin WebSocket corretamente
fastify.register(websocket, {
  options: {
    path: '/ws/:tenant_id',  // Define o parâmetro na rota
    clientTracking: true
  }
});

// Rota WebSocket com validação
fastify.get('/ws/:tenant_id', { websocket: true }, (connection, req) => {
  try {
    // Verificação robusta do tenant_id
    const tenant_id = req?.params?.tenant_id;
    
    if (!tenant_id) {
      throw new Error('tenant_id é obrigatório');
    }

    console.log(`Novo cliente conectado: ${tenant_id}`);

    // Armazena a referência
    connection.socket.tenant_id = tenant_id;

    // Mensagem de boas-vindas
    connection.socket.send(JSON.stringify({
      event: 'connected',
      tenant_id,
      timestamp: Date.now()
    }));

    // Handler de mensagens
    connection.socket.on('message', (message) => {
      console.log(`[${tenant_id}] Mensagem:`, message.toString());
    });

    // Handler de desconexão
    connection.socket.on('close', () => {
      console.log(`[${tenant_id}] Conexão fechada`);
    });

  } catch (error) {
    console.error('Erro na conexão:', error);
    connection.socket.close(1008, error.message);
  }
});

// Health Check
fastify.get('/healthz', async () => {
  return { status: 'ok' };
});

// Inicia o servidor
fastify.listen({
  host: '0.0.0.0',
  port: 8080
}, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Servidor WebSocket rodando em ws://0.0.0.0:8080`);
});
