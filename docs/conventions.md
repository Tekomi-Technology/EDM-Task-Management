# Code conventions

## Layout

- One NestJS module per business area in `apps/api/src/<area>/`: `<area>.module.ts`, `<area>.controller.ts` (HTTP only), `<area>.service.ts` (changes data), `<area>.query.ts` (read models) when reads are non-trivial.
- Anything the API, web and app must agree on (roles, ticket states, allowed transitions, request schemas, response types) lives in `packages/shared`. Never copy those definitions into an app.
- Database tables: `apps/api/src/db/schema.ts`. Monthly-partitioned tables: `apps/api/src/db/partitioned.ts` plus hand-written SQL migrations.

## API rules

- Every route requires a Keycloak token unless marked `@Public()`. Limit routes with `@Roles(...)`; check team/ownership rules in the service, not the controller.
- Validate every body and query with a zod schema from `packages/shared` (`@ZodBody(schema)`, `@ZodQuery(schema)`), and document bodies with `@ApiZodBody(schema)` so Swagger stays correct for the Call Center and Sales teams.
- Errors: throw `AppError(status, CODE, message)` with a stable UPPER_SNAKE code. Clients rely on the code, not the message.
- Ticket status changes only go through `TicketsService.act()`: it locks the row, applies the shared state machine, writes the history event and records notifications in one transaction.
- Notifications: record them with `NotificationsService.record(tx, ...)` inside the transaction, then `dispatch()` after commit. Never send SMS from inside a transaction.
- Integrations with other EDM systems get their own controller under `src/intake/`, authenticated with a client-credentials Keycloak client and an `integration_*` role. Make them idempotent with the caller's reference.

## Database

- Change `schema.ts`, then `pnpm --filter @edm/api db:generate --name=<what-changed>`; review the SQL before committing.
- Never edit a migration that has run anywhere other than your machine; add a new one.
- Partitioned tables need hand-written SQL (`drizzle-kit generate --custom`).

## Tests

- API tests are integration tests against real Postgres, Redis and storage (separate `edm_test` database and bucket). Tokens are signed locally in `test/helpers.ts`; tests do not need Keycloak.
- Name tests after the behaviour a user would notice ("does not create a second ticket when the Call Center sends the same complaint again").
- Add a test for every bug before fixing it.

## Git and review

- Branch from `main` as `feature/<short-name>` or `fix/<short-name>`; open a pull request; CI must be green; one approving review.
- Keep pull requests small: one business change, with its tests and migration.
- No secrets in the repository. Local defaults are in `.env.example`; real values go in the deployment environment.

## Style

- TypeScript strict everywhere; Prettier formats (`pnpm format`); ESLint must pass (`pnpm lint`).
- User-facing text in plain language ("Waiting for check", not "RESOLVED").
