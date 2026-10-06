# Test plan

**A commit is releasable when CI is green on it and no open risk scores 6 or more without a
named mitigation.** CI runs on every push (`.github/workflows/ci.yml`). This plan says what it
runs, on what, and when a result counts.

## Scope

- **In:** the 41 operations of `contract/openapi.yaml`, the Stripe webhook, the low-stock worker,
  and the served OpenAPI document against the contract.
- **Out:** load and soak tests, a penetration test, live Stripe, real SES delivery, the
  CloudFront distribution beyond one request after a deploy, and any browser front end.
  `test-map.md` says what each suite does not prove.

## Levels

| Level | Command | What it runs on |
|---|---|---|
| Static | `npm run typecheck`, `npm run lint:ci`, `npm run format:check` | The source |
| Unit | `npm test` | Jest, with Prisma replaced by `src/prisma/prisma.service.mock.ts` |
| End to end | `npm run test:e2e` | The whole Nest application on a real Postgres 16 and Valkey, Stripe's network calls stubbed |
| Contract | `test/openapi-contract.e2e-spec.ts`, inside the end-to-end run | The served document against `contract/openapi.yaml` |
| Dependencies | `npm audit --omit=dev --audit-level=high` | The tree the image ships |
| Image | `npm run check:image` | `docker build` of the runtime image |
| Prose | `npm run check:prose` | Vale on the README, the architecture page, the contract README and the ADRs |
| Pilot | `docs/research/friction-log.md` | One developer and the deployed store, by hand |

## Environments and data

- **Local:** `npm run docker:up` starts Postgres on 5433, Valkey and Mailpit. The end-to-end
  suite uses its own `tshirt_store_test` database, because it truncates it.
- **CI:** service containers `postgres:16-alpine` and `valkey/valkey:9-alpine`. The migrations
  run first, and `prisma migrate diff --exit-code` fails the job when the schema and the
  migrations disagree (`check:db` in `package.json`).
- **Data:** each end-to-end suite truncates and reseeds what it needs (ADR 33). Stripe events are
  signed in the test with the same secret the server verifies.

## Entry criteria

A run starts when all of these hold:

1. `npm ci` and `npx prisma generate` succeed.
2. Postgres and Valkey answer, and `prisma migrate deploy` applies every migration to an empty
   database.
3. The environment carries every variable `src/config/env.validation.ts` requires, or the
   application refuses to boot.

For the pilot, also the friction log's "Dependencies": a product with stock, and a reachable
store in Stripe test mode.

## Exit criteria

A commit passes when, on that commit:

1. The type checker, the linter and the formatter report nothing.
2. All 39 unit suites pass. Today: 681 tests.
3. All 16 end-to-end suites pass, the contract test among them. Today: 296 tests.
4. `npm audit --omit=dev --audit-level=high` exits 0: no high or critical advisory. (On
   2026-10-06 it lists 2 moderate ones, `js-yaml` through `@nestjs/swagger`.)
5. The image builds, and Vale reports no error.
6. Every risk in `risk-register.md` scored 6 or more has a mitigation, or a line that accepts it.

A failure is fixed or explained in the pull request before merge. No test is skipped to pass.
The counts are from CI run 37494753506 (2026-10-06), on the branch that added two contract
tests, and from a local run the same day.

## Known limits of this plan

- No coverage threshold is enforced, so a new branch with no test fails nothing.
- CI keeps no test report artifact; the counts live in the job log.
- After a release, only the deploy job's own check touches the stack: the running task carries
  this commit's tag, and `GET /v1` answers through CloudFront. That job runs only while the
  repository variable `DEPLOY_ENABLED` is `true`.
