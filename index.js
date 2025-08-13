// server.js
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const fastify = Fastify({ logger: true });

// Registra o plugin WebSocket
fastify.register(websocket);

// Rota de conexão WebSocket (com tenant_id)
fastify.get('/ws/:tenant_id', { websocket: true }, (connection, req) => {
  const { tenant_id } = req.params;

  // Armazena o tenant_id na conexão (opcional, para referência futura)
  connection.socket.tenant_id = tenant_id;

  // Mensagem de confirmação
  connection.socket.send(JSON.stringify({ 
    status: 'connected', 
    tenant_id,
    message: 'Conexão WebSocket estabelecida para este tenant.'
  }));

  // Lógica para mensagens recebidas do frontend (opcional)
  connection.socket.on('message', (message) => {
    console.log(`Mensagem do tenant ${tenant_id}:`, message.toString());
  });

  // Fecha a conexão se o client desconectar
  connection.socket.on('close', () => {
    console.log(`Tenant ${tenant_id} desconectado.`);
  });
});

// Função para notificar um tenant específico (chamada pelo worker)
function notifyTenant(tenant_id, data) {
  fastify.websocketServer.clients.forEach((client) => {
    if (client.tenant_id === tenant_id && client.readyState === client.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Exemplo: Simulando uma notificação após 5 segundos
setTimeout(() => {
  notifyTenant('123', { event: 'nova_mensagem', data: { text: 'Olá, tenant 123!' } });
}, 5000);

// Inicia o servidor
fastify.listen({ port: 3000 }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log('Servidor WebSocket rodando em ws://localhost:3000');
});
