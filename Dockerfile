# syntax=docker/dockerfile:1
# Web prototype only: the internal SQLite runtime is not exposed by this image.
FROM node:22.22.2-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/runtime/package.json ./apps/runtime/package.json
RUN pnpm --filter web... install --frozen-lockfile
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm --filter web build

FROM node:22.22.2-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 APP_ENV=demo
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
