FROM node:22-slim AS build

WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci
RUN npm run build -w @agent-builder/contracts \
    && npm run build -w @paul-os/runtime \
    && npm run db:generate -w @agent-builder/backend \
    && npm run build -w @paul-os/worker \
    && npm prune --omit=dev

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /workspace /workspace
USER node

CMD ["node", "apps/worker/dist/index.js"]
