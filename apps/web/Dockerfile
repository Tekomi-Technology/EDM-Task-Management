# Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://tasks.example --build-arg VITE_KEYCLOAK_URL=https://sso.example -t edm-web .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
ARG VITE_API_URL=http://localhost:3000
ARG VITE_KEYCLOAK_URL=http://localhost:58080
ARG VITE_KEYCLOAK_REALM=edm
ARG VITE_KEYCLOAK_CLIENT_ID=edm-web
ENV VITE_API_URL=$VITE_API_URL VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
RUN pnpm install --frozen-lockfile --filter @edm/web... \
  && pnpm --filter @edm/shared build \
  && pnpm --filter @edm/web build

FROM nginx:1.27-alpine
# The security headers name the API, sign-in, photo and map addresses; set them on the container (see web.conf.template).
COPY infra/nginx/web.conf.template /etc/nginx/templates/default.conf.template
ENV MAP_TILE_ORIGIN=https://tile.openstreetmap.org
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
