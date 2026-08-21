FROM node:22-slim AS build

WORKDIR /workspace
ARG REPOSITORY_SOURCE_COMMIT
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci
RUN npm run build -w @agent-builder/contracts \
    && npm run build -w @paul-os/runtime \
    && npm run build -w @agent-builder/generator-cli \
    && npm run build -w @agent-builder/backend \
    && node scripts/write-build-metadata.mjs apps/backend/dist/build-identity.json "${REPOSITORY_SOURCE_COMMIT}" \
    && npm prune --omit=dev

FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV PAUL_OS_BUILD_METADATA_PATH=/workspace/apps/backend/dist/build-identity.json
WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /workspace /workspace
USER node

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@agent-builder/backend"]
