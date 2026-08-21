# Built from the REPO ROOT (the CDK asset sets context to ..), because pnpm
# workspace packages resolve as symlinks and a per-app context cannot follow them.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/rag/package.json packages/rag/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/rag packages/rag
COPY apps/api apps/api

# Non-root. The container has database credentials in its environment.
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
