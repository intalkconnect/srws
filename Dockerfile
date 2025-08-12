# Imagem base leve com Node LTS
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Instala curl p/ healthcheck
RUN apk add --no-cache curl

# Copia package.json e package-lock.json primeiro
COPY package*.json ./

# Instala dependências sem dev
RUN npm ci --omit=dev

# Copia o código do app
COPY . .

EXPOSE 8080

# Healthcheck usando curl
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "index.js"]
