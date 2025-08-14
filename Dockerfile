# Estágio de construção
FROM node:20-alpine as builder

# Instala git e clona o repositório
RUN apk add --no-cache git && \
    git clone --depth 1 https://github.com/intalkconnect/srws.git /app_src

# Estágio final
FROM node:20-alpine

# Copia apenas o necessário
WORKDIR /app
COPY --from=builder /app_src .
RUN npm ci --omit=dev

EXPOSE 8080
CMD ["node", "index.js"]
