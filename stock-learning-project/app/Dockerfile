FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY scripts ./scripts
COPY server ./server
COPY trading-config.json ./
COPY notification-config.example.json ./
COPY PRODUCT-DESIGN.md README.md ./

RUN mkdir -p /app/data /app/reports

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

EXPOSE 4173

CMD ["node", "server/server.mjs"]
