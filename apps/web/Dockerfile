# Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://tasks.example -t edm-web .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm install --frozen-lockfile --filter @edm/web... \
  && pnpm --filter @edm/web build

FROM nginx:1.27-alpine
# The security headers name the API, photo and map addresses; set them on the container (see nginx.conf.template).
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV MAP_TILE_ORIGIN=https://tile.openstreetmap.org
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
