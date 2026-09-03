# 33. The end-to-end suite truncates and reseeds on the real Postgres and Valkey

Status: accepted
Date: 2026-09-02

## Context

The Week page names the isolation choice as a decision with three answers. Checkout, the
status move and the webhook each open their own transaction.

## Options

- Truncate and reseed before every test, on the compose services (chosen).
- Rollback per test: a wrapping transaction would sit inside the code's own, which Prisma
  does not do, or would watch the code commit through it.
- Testcontainers: a Docker dependency inside the test process, and a second place the engine
  version is written.

## Decision

`truncateAll` in `test/app-factory.ts` empties every table the tests write and leaves `roles`.
Fixtures come from helpers, so a test says what it needs. `maxWorkers: 1`, because the suites
share one database. The compose file and CI run `postgres:16-alpine` and
`valkey/valkey:9-alpine`, the deployed engines.

## Consequences

**Gives up:** the services must be up before the suite runs, and the wall clock is the sum of
the suites.

**Switch:** isolated databases when the suites must run in parallel.
