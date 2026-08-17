FROM node:22-slim AS build

WORKDIR /workspace
ARG VITE_AIM_ENABLED=false
ENV VITE_AIM_ENABLED=${VITE_AIM_ENABLED}
COPY . .
RUN npm ci
RUN npm run build -w @agent-builder/contracts \
    && npm run build -w @agent-builder/frontend

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/frontend/dist /usr/share/nginx/html

EXPOSE 8080
