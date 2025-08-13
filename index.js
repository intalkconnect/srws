const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // Permite conexões de qualquer origem (ajuste em produção)
});

// Lógica de tenants (rooms)
io.on('connection', (socket) => {
  const tenant_id = socket.handshake.query.tenant_id; // Ex: ?tenant_id=123
  socket.join(`tenant_${tenant_id}`);
  console.log(`Cliente do tenant ${tenant_id} conectado.`);
});

// Inicia o servidor na porta 8080
server.listen(8080, () => {
  console.log('WebSocket rodando na porta 8080');
});
