# EDM Task Management

Technical ticket system for Electricidade de Moçambique: complaints arrive from the Call Center system, team managers assign them, field staff fix them with the mobile app, and the Call Center confirms with the customer before the ticket closes.

Phases 1 to 5 are done: tickets, network incidents, field staff, stock, new customers, reports and KPIs.

## What is in the repo

| Path                   | What it is                                                                      |
| ---------------------- | ------------------------------------------------------------------------------- |
| `apps/api`             | NestJS API (Node.js + TypeScript, Drizzle ORM, BullMQ). Swagger at `/api/docs`  |
| `apps/web`             | React + Vite web app for team managers, NOC, BO and admins                      |
| `tools/callcenter-sim` | Command-line stand-in for the Call Center system, and the end-to-end check      |
| `infra`                | Docker Compose for local development and for staging/production, Keycloak realm |

## Run it on your machine

Needs Node 24, pnpm 10 and Docker.

```bash
cp .env.example .env
pnpm install
pnpm infra:up                      # Postgres+PostGIS, Redis, S3 storage, Keycloak (takes ~1 min the first time)
pnpm --filter @edm/api db:migrate
pnpm --filter @edm/api db:seed     # areas, teams, sample users and customers
pnpm --filter @edm/api dev         # API on http://localhost:3000 (docs: /api/docs)
pnpm --filter @edm/web dev         # web on http://localhost:5173
```

Ports are offset to avoid clashes: Postgres 55432, Redis 56379, S3 storage 59000, Keycloak 58080 (admin console: admin / admin).

### Sample accounts (development only, password `Edm@2026`)

| Username                     | Role          | Team                     |
| ---------------------------- | ------------- | ------------------------ |
| `helena.mondlane`            | Team manager  | South 1 (Matola)         |
| `joao.matsinhe`              | Team manager  | South 2 (Maputo Central) |
| `armando.cossa`, `ana.sitoe` | Field staff   | South 1                  |
| `ofelia.tembe`               | Field staff   | South 2                  |
| `nadia.mussa`                | NOC           | —                        |
| `paulo.bo`                   | BO support    | —                        |
| `carlos.nhantumbo`           | Network team  | —                        |
| `admin.edm`                  | Administrator | —                        |

The Call Center system signs in with the `call-center-system` client (client credentials, dev secret `call-center-dev-secret`).

### Try the sample flow

```bash
# 1. The Call Center sends a complaint (contract 40217735 is in Matola, team South 1)
pnpm --filter @edm/callcenter-sim sim complaint --contract 40217735 --problem no_power_single --text "No power since 07:15" --ref CC-1
# 2. Sign in to the web as helena.mondlane and assign the ticket to Armando
# 3. Sign in to the app as armando.cossa: accept, start, take a photo, "Problem fixed"
# 4. The Call Center checks with the customer:
pnpm --filter @edm/callcenter-sim sim status CC-1
pnpm --filter @edm/callcenter-sim sim check CC-1 fixed --note "Customer confirms"
```

Or run the whole flow automatically against the running stack: `pnpm e2e`.

### The mobile app

The field staff app (EDM Field, Expo / React Native) is in its own repository, **EDM-Mobile**, next to this one.
Its README explains how to run it on a phone against this stack.

### Data formats

The API's data formats (roles, ticket states and rules, request checks, response types) are defined in
`apps/api/src/contract`. The web app keeps its own copy of the types it uses in `apps/web/src/types.ts`, and the
mobile app in its `src/types.ts`: when the API changes a format, change those too. The API description at
`/api/docs` shows the current formats.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test          # shared rules, API (against the local Postgres/Redis/storage, separate test database), web
pnpm e2e           # sample flow through real Keycloak; needs the API running
```

CI (`.github/workflows/ci.yml`) runs lint, type check, tests and build on every push and pull request, then builds the API and web Docker images.

## Deploy (staging / production)

```bash
docker build -f apps/api/Dockerfile -t edm-api .
docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://... --build-arg VITE_KEYCLOAK_URL=https://... -t edm-web .
cp infra/.env.prod.example infra/.env.prod   # fill in real values
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d
```

The API container applies database migrations on start.

Keycloak imports `infra/keycloak/realm-edm.prod.json` on first start. Unlike the development realm it has no sample users and no password-grant client, requires HTTPS for outside connections, enforces a password policy and brute-force protection, and takes the Call Center and Sales client secrets from `CALL_CENTER_CLIENT_SECRET` and `SALES_CLIENT_SECRET`. After the first start, sign in to the Keycloak admin console (`KEYCLOAK_ADMIN_PASSWORD`), create the real staff accounts in realm `edm` and give each one its role. Then add each person's team in the `users` table (an admin screen for this comes in a later phase).

## Notes

- **File storage:** the code speaks the S3 protocol. Locally it uses SeaweedFS, because MinIO no longer publishes public Docker images; production can use MinIO, SeaweedFS or any S3 service.
- **SMS:** phase 1 uses a stand-in that only logs messages (`apps/api/src/notifications/sms-sender.ts`). The Portuguese SMS texts in `messages.ts` need review by a native speaker.
