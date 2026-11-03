# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Production dependencies for the Prisma CLI (`migrate deploy`), tsx and the demo seed. Browser-only and
# build-only packages are removed; the standalone server brings its own traced copies of what it needs.
FROM base AS deps
ENV DATABASE_URL=file:/tmp/build.db
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
 && npm cache clean --force \
 && cd node_modules \
 && rm -rf next @next react react-dom @img sharp lucide-react recharts es-toolkit radix-ui @radix-ui \
    pdfjs-dist @napi-rs tesseract.js tesseract.js-core playwright playwright-core @playwright sonner

FROM base AS build
ENV DATABASE_URL=file:/tmp/build.db
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/data/brickflow.db \
    STORAGE_DRIVER=local \
    STORAGE_DIR=/app/data/storage \
    SEED_ON_START=false

RUN groupadd --system --gid 1001 brickflow \
 && useradd --system --uid 1001 --gid brickflow --home-dir /app --no-create-home --shell /usr/sbin/nologin brickflow

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build --chown=brickflow:brickflow /app/.next/static ./.next/static
COPY --from=build /app/package.json /app/prisma.config.ts /app/tsconfig.json ./
COPY --from=build /app/prisma/schema.prisma /app/prisma/seed.ts ./prisma/
COPY --from=build /app/prisma/migrations ./prisma/migrations
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/src/lib ./src/lib
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/data/storage /app/.next/cache \
 && chown -R brickflow:brickflow /app/data /app/.next/cache

USER brickflow
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
