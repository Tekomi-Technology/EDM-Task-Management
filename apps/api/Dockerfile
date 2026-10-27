# Build from the repository root: docker build -f apps/api/Dockerfile -t edm-api .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @edm/api... \
  && pnpm --filter @edm/api build \
  && pnpm --filter @edm/api deploy --legacy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 3000
# Applies pending migrations, then starts the API.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
