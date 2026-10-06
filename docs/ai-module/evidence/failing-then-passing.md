# Failing, then passing

The first red and green runs of the fix, recorded in the checkout before #16. The worktree run
in [verify-fix-f3e6e6e.md](verify-fix-f3e6e6e.md) repeats them at pinned commits.

## The same test, before and after `f3e6e6e`

```sh
$ npx jest src/auth/auth.service.spec.ts -t 'reports the latest expiry'
```

```
before   Expected: "2026-09-20T09:14:00.000Z"
         Received: "2026-09-12T09:14:00.000Z"
         Tests: 1 failed, 47 skipped, 1 passed, 49 total

after    Tests: 47 skipped, 2 passed, 49 total
```

The fix commit only adds lines to the spec:

```sh
$ git show --numstat --format= f3e6e6e -- src/auth/auth.service.spec.ts
40      0       src/auth/auth.service.spec.ts
```

The command reads the commit, so its answer does not change as the branch moves. One later
commit, `2f52d89`, touches the same file at `1 1`. It rewrites a test title.

The test covers both row orders. Only one fails before the fix: the order the database returns,
because every row in a family copies the founder's `created_at` and the sort falls back to
`id desc`. The unit count moved from 679 to 681, which matches the two cases added.

Every check after the change: `typecheck`, `lint:ci` and `format:check` exit 0. `npm test`
exits 0 with 681 tests across 39 suites. `npm run test:e2e` exits 0 with 294 tests across 16
suites. `docs:lint` exits 0, and the word count exits 0 at 642.

## Mocks and real services

The fix is tested against a mock. `auth.service.spec.ts` stubs
`prisma.refreshToken.findMany.mockResolvedValue`, so the two new cases test the grouping loop
with no Postgres, no query and no `ORDER BY`. A mock returns rows in the order it is given, so the
cases supply both orders.

The real services cover the rest. `npm run test:e2e` runs 294 tests against Postgres, Valkey and
Mailpit from `docker-compose.yml`. `npx prisma migrate deploy` and `npx prisma migrate diff` read
the real schema. None of them covers this behaviour. The write-up lists that as a limitation.
