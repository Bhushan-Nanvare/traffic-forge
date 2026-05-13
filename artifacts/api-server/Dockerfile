# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

# Playwright needs these for headless chromium at runtime; install in the
# builder so the final image doesn't pay for the package list.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace manifests first so Docker can cache the install layer
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/

RUN pnpm install --frozen-lockfile

# Now copy sources and build
COPY lib lib
COPY artifacts/api-server artifacts/api-server

# Compile the db package's TypeScript declarations (api-server consumes them)
RUN pnpm --filter @workspace/db exec tsc

# Build the api-server bundle
RUN pnpm --filter @workspace/api-server run build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runtime

WORKDIR /app

# Copy built bundle, package manifest, and node_modules (playwright is external)
COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/api-server/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Health check that exits non-zero if the server isn't responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://localhost:${PORT}/api/healthz" || exit 1

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
