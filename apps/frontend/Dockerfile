FROM node:22-slim AS build

WORKDIR /workspace
ARG VITE_AIM_ENABLED=true
ARG REPOSITORY_SOURCE_COMMIT
ARG VITE_VISUAL_SURFACES_ENABLED=false
ENV VITE_AIM_ENABLED=${VITE_AIM_ENABLED}
ENV REPOSITORY_SOURCE_COMMIT=${REPOSITORY_SOURCE_COMMIT}
ENV VITE_VISUAL_SURFACES_ENABLED=${VITE_VISUAL_SURFACES_ENABLED}
COPY . .
RUN npm ci
RUN npm run build -w @agent-builder/contracts \
    && npm run build -w @agent-builder/frontend

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/frontend/dist /usr/share/nginx/html

EXPOSE 8080
