FROM node:22-slim AS build

WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci
RUN npm run build -w @agent-builder/contracts \
    && npm run build -w @agent-builder/generator-cli \
    && npm run build -w @agent-builder/backend \
    && npm prune --omit=dev

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /workspace /workspace
USER node

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@agent-builder/backend"]
