# Failing, then passing

Moved unchanged from the write-up as it stood at `736e54e`. It describes the branch before the issue #16 changes, so the `jobs.js` scanner and the older skill wording it mentions no longer exist.

_Failing, then passing._ The same test, run with the same command, before and after `f3e6e6e`:

```sh
$ npx jest src/auth/auth.service.spec.ts -t 'reports the latest expiry'
```

```
before   Expected: "2026-09-20T09:14:00.000Z"
         Received: "2026-09-12T09:14:00.000Z"
         Tests: 1 failed, 47 skipped, 1 passed, 49 total

after    Tests: 47 skipped, 2 passed, 49 total
```

The assertion did not change between the two runs, and the proof is arithmetic rather than
assertion:

```sh
$ git show --numstat --format= f3e6e6e -- src/auth/auth.service.spec.ts
40      0       src/auth/auth.service.spec.ts
```

Forty lines gained and none lost, so nothing was loosened to reach green. The command reads the
commit rather than the working tree, because a `git diff` spelled without a revision answers about
whatever is uncommitted today and stops being a proof the moment the branch moves on. One later
commit touches the same file, `2f52d89` at `1 1`, and the line it replaces is a test title.

Two details are worth more than the pass. The test asserts both row orders, and only one of the
two fails before the fix: the failing one is the order the database actually returns, because
every row of a family copies the founder's `created_at` and the sort collapses to `id desc`. A
test written for a single order would have passed without the fix. And the unit count moved from
679 to 681, exactly the two cases added, which is what distinguishes a test that ran from a test
that was collected and skipped.

Every check after the change: `typecheck`, `lint:ci`, `format:check` all `exit=0`; `npm test`
`exit=0` with 681 tests across 39 suites; `npm run test:e2e` `exit=0` with 294 across 16;
`docs:lint` `exit=0`; the word count `exit=0` at 642.

_Mocks, and real services._ The fix is proved against a mock and the baseline against real
services, and the two prove different things. `auth.service.spec.ts` replaces the client with
`prisma.refreshToken.findMany.mockResolvedValue`, so the two new cases assert the grouping loop and
nothing under it: no Postgres, no query, no `ORDER BY`. That is also why they supply both row
orders. A mock returns whatever order it is handed, so the order the database produces is an
assumption, and a test that depends on it proves the fix only on the day the assumption holds.

The real services carry the rest. `npm run test:e2e` runs 294 tests against the three containers of
`docker-compose.yml`, Postgres, Valkey and Mailpit, and `npx prisma migrate deploy` and
`npx prisma migrate diff` read the real schema. None of them covers this behaviour, which the
limitations record.
