const io = require('socket.io')(server);

// Quando um cliente se conecta, ele entra na room do seu tenant
io.on('connection', (socket) => {
  const tenant_id = socket.handshake.query.tenant_id; // Ex: ?tenant_id=123
  socket.join(`tenant_${tenant_id}`); // Entra na room do tenant
});

// Worker (ou API) emite apenas para o tenant específico
function notifyTenant(tenant_id, message) {
  io.to(`tenant_${tenant_id}`).emit('nova_mensagem', message);
}
