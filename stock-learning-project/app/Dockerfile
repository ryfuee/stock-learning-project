FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY requirements-data.txt ./
COPY public ./public
COPY scripts ./scripts
COPY server ./server
COPY trading-config.json ./
COPY notification-config.example.json ./
COPY PRODUCT-DESIGN.md README.md ./

RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements-data.txt

RUN mkdir -p /app/data /app/reports

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV PYTHON_BIN=python3

EXPOSE 4173

CMD ["node", "server/server.mjs"]
