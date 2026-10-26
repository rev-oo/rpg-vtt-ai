# syntax=docker/dockerfile:1
# The VTT server with the built web app (specs §4.2, T-0703). Build from the repository root:
#   docker build -f docker/Dockerfile -t vtt .

FROM node:24-bookworm-slim AS builder
ENV HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
# Packages are fetched from the lockfile alone, so source changes reuse this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@vtt/server --filter=@vtt/web
# The server and its production dependencies only, workspace packages included.
RUN pnpm --filter @vtt/server deploy --prod /out/server

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web
WORKDIR /app
# Owned by root, so the server cannot change its own code.
COPY --from=builder /out/server ./server
COPY --from=builder /repo/apps/web/build/client ./web
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/dist/src/main.js"]
