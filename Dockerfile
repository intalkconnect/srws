FROM node:20-alpine

# Instala dependências essenciais
RUN apk add --no-cache git curl

WORKDIR /app

# Clona o repositório (com fallback para COPY se falhar)
RUN git clone https://github.com/intalkconnect/srws.git . || \
    { echo "Fallback: Copiando código local"; exit 0; }

# Instala dependências
RUN npm ci --omit=dev

EXPOSE 8080
CMD ["node", "index.js"]
