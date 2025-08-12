# Imagem base leve com Node LTS
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Instala curl p/ healthcheck (wget nem sempre vem completo no alpine)
RUN apk add --no-cache curl

# Só package* primeiro para cache de dependências
COPY package*.json ./
RUN npm ci --omit=dev

# Copia o restante do código
COPY . .

# Porta do app
EXPOSE 8080

# Healthcheck simples
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "index.js"]
