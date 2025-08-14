# Imagem base
FROM node:20-alpine

# Diretório de trabalho
WORKDIR /app

# Instala dependências
COPY package*.json ./
RUN npm ci --omit=dev

# Copia o código
COPY . .

# Porta exposta
EXPOSE 8080

# Comando de inicialização
CMD ["node", "index.js"]
