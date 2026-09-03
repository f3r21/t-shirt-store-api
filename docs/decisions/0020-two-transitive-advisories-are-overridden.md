# 20. Two transitive advisories are overridden, not accepted

Status: accepted
Date: 2026-09-01

## Context

`npm audit` reported `mysql2@3.15.3` (GHSA-3f6p-5ww8-9rcr) and `deepmerge-ts@7.1.5`
(GHSA-ggr8-5vv4-36mx), both through `prisma@7.10.0`. `@prisma/client` depends on the CLI, so
the runtime image ships both. No fixed Prisma 7 exists, and `npm audit fix --force` offers a
downgrade to 6.19.3.

## Options

- An `overrides` block with floors, `mysql2 >=3.22.0` and `deepmerge-ts >=8.0.0` (chosen).
- Accept the findings: the CI audit gate stays red.
- Downgrade Prisma: a major version, for a driver this service never loads.

## Decision

`mysql2` is a MySQL driver in a Postgres service, so the override changes bytes no code path
reaches. `@prisma/config` does call `deepmerge`, and `prisma generate` and `migrate diff` ran
through 8.0.0 before this was committed. `npm audit --omit=dev --audit-level=high` in the
Verify job is the one assertion that fails when this stops being true.

## Consequences

**Gives up:** a future advisory in either package is accepted silently until the audit says
otherwise.

**Switch:** delete the block when `npm view prisma@<version> dependencies.mysql2` answers a
fixed range, or when Prisma 8 lands. On 2026-09-02, 7.10.0 still ships 3.15.3.
