# CLAUDE.md

A NestJS API for a t-shirt store. Prisma over PostgreSQL, Jest for tests, Stripe for payments.

`package.json` holds the scripts and `ARCHITECTURE.md` holds the shape of the system.

## Run it

```sh
npm run docker:up          # postgres, valkey and mailpit
npm run start:dev          # the API
npm run start:worker:dev   # the queue consumer
```

`docker:up` runs `docker compose` over `docker-compose.yml`, which is where a service, a port or
an image tag changes.

The worker is a second process from the same image. Work that goes on the queue stays on the
queue until the worker runs.

## Layout

- `src/` holds one directory for each NestJS module: its controller, service, DTOs and specs.
- `prisma/schema.prisma` names every column. The comments beside a column carry its reason.
- `test/` holds the end to end suite. `contract/openapi.yaml` holds the published API.

## Tests

Unit tests sit beside the code as `*.spec.ts`. They mock Prisma, so they need no database.

End to end tests live in `test/` as `*.e2e-spec.ts`. They use a separate configuration at
`test/jest-e2e.json`. They need the three containers. They run one worker at a time. They
truncate and reseed their own data, which ADR 33 explains.

**A push runs the end to end suite.** `.husky/pre-push` calls `npm run test:e2e`, so `git push`
fails when the containers are down. A commit runs the type check and the unit suite only, so a
commit needs no containers.

## Checks

CI defines four jobs: `Verify`, `Image`, `Prose` and `Deploy`. Report all four. Each job runs
these npm scripts, and a terminal runs the same ones:

| Job | Local command | Needs |
| --- | --- | --- |
| Verify | `npm run check:unit` | the network, for `npm audit` |
| Verify | `npm run check:db` | the three containers and the `tshirt_store_test` database |
| Prose | `npm run check:prose` | Vale 3.19.0 on the path, the version CI pins. CI runs Vale through its action, then `docs:length` |
| Image | `npm run check:image` | a running Docker daemon |
| Deploy | none | AWS credentials, so it runs in CI only |

`check:db` migrates and tests `TEST_DATABASE_URL`, or `tshirt_store_test` when that is unset, and
never the development database.

Read how a run decided the jobs:

```sh
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name)  \(.conclusion)"'
```

Run `npm run lint:ci` to check the code. `npm run lint` carries `--fix` and rewrites files.

`Prose` runs Vale over `README.md`, `ARCHITECTURE.md`, `contract/README.md` and `docs/decisions`.
Vale fails the job on an error. A warning does not fail it. The same job holds `ARCHITECTURE.md`
below 650 words, and that count includes the diagram.

## Decisions

`docs/decisions/` holds one file for each decision. Comments in the code cite them by number:

```sh
rg -o --hidden 'ADR [0-9]+|DECISIONS [0-9]+' src/ prisma/ .github/
```

Resolve a citation to its file before you change the code beside it.

Migrations are additive, two aside. `20260828063219_reset_token_hash_and_indexes` drops a column
the previous image still reads, and `20260902013632_email_citext` rewrites `users` under an
ACCESS EXCLUSIVE lock. A new migration that is not additive needs expand and contract.

## Environment traps

- The shell is zsh. A pipe reports the status of its last command, so `cmd | tail` hides a
  failure. Write `cmd > /tmp/out.log 2>&1; echo "exit=$?"`, or read `$pipestatus[1]`.
- `rg` skips a directory whose name starts with a dot. Add `--hidden` to reach `.claude/`,
  `.github/` and `.vale/`.
- `git check-ignore` answers 128 for a path that goes through a symlink. The vendored skills
  under `.claude/skills/` are symlinks into `.agents/skills/`, so name the symlink itself.
- An issue needs a `## Verification` section. A hook rejects an issue without one.
- That hook reads the command before the shell expands it. Pass `--body-file` a literal path.

## Words this file uses

- **job**: one of the four units in `.github/workflows/ci.yml`. Each job holds its own steps.
- **ADR**: one decision record under `docs/decisions/`, cited from the code by its number.
- **additive**: a migration the previous image can still read. Two of the eleven are not.
- **control**: a second command, aimed at something known to be present, that proves the first
  command can return a result at all. Give every empty result a control.
