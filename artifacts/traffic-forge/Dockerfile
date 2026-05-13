# syntax=docker/dockerfile:1.7

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY artifacts/traffic-forge/package.json artifacts/traffic-forge/
COPY lib/api-zod/package.json lib/api-zod/

RUN pnpm install --frozen-lockfile

COPY lib/api-zod lib/api-zod
COPY artifacts/traffic-forge artifacts/traffic-forge

RUN pnpm --filter traffic-forge-frontend run build

# ─── Runtime stage (nginx serving the static SPA) ─────────────────────────────
FROM nginx:1.27-alpine

# SPA fallback to index.html so client-side routes work
RUN <<EOF cat > /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files \$uri \$uri/ /index.html;
  }

  # Proxy API + WebSocket to the api-server container
  location /api/ {
    proxy_pass http://api-server:8080/api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }

  location /ws/ {
    proxy_pass http://api-server:8080/ws/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
EOF

COPY --from=builder /app/artifacts/traffic-forge/dist /usr/share/nginx/html

EXPOSE 80
