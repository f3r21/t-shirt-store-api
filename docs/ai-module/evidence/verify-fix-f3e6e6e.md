# verify-fix on the session expiry fix

The fix is `f3e6e6e`, "report a device's latest expiry, not its highest row id". This run follows
`.claude/skills/verify-fix/SKILL.md` as rewritten for issue #19. Nothing ran in the working
checkout. The run put the worktrees under `.claude/worktrees/`. The code review moved them into
`$TMPDIR` afterwards, because `.claude/worktrees/` is ignored only in this clone's
`.git/info/exclude`.

## Reproduction

| | SHA | Worktree |
| --- | --- | --- |
| Base | `af19d1393d4b67c80184fca6f423f76e3042f80f` (`f3e6e6e^`) | `.claude/worktrees/verify-736e54e/base` |
| Head | `736e54e1057bb7b6e8d0855d96cfe9aa70599678` (the pull request head) | `.claude/worktrees/verify-736e54e/head` |

Provisioning: `git diff --quiet <sha> HEAD -- package-lock.json prisma/schema.prisma` exited 0 for
both commits, so each worktree links the checkout's `node_modules` and `.env` and copies
`src/generated`.

The regression test is new at the head (`git diff --quiet af19d13 736e54e -- <spec>` exited 1), so
the base received the head's copy, and that was its only change:

```sh
git show 736e54e:src/auth/auth.service.spec.ts > base/src/auth/auth.service.spec.ts
```

The command, identical in both:

```sh
npx jest src/auth/auth.service.spec.ts -t 'reports the latest expiry'
```

```
base  ● AuthService › listSessions, GET /auth/sessions › reports the latest expiry of a family,
        with the abandoned row first
        Expected: "2026-09-20T09:14:00.000Z"
        Received: "2026-09-12T09:14:00.000Z"
      Tests:       1 failed, 47 skipped, 1 passed, 49 total
      exit=1

head  Tests:       47 skipped, 2 passed, 49 total
      exit=0
```

Result: **verified**. The base fails on the expected assertion, and only the row order the
database returns fails. The head passes both orders.

## Jobs

| Job | Status | Command | Exit | Reason |
| --- | --- | --- | --- | --- |
| Verify | unavailable at `736e54e` | `npm run check:unit` | `exit=1` | `Missing script: "check:unit"`. The scripts arrive with #17, after this commit |
| Verify | unavailable | `npm run check:db` | not run | the Docker daemon is not running here |
| Prose | unaffected | `npm run check:prose` | not run | the diff touches none of its inputs, see below |
| Image | unavailable | `npm run check:image` | not run | the Docker daemon is not running here |
| Deploy | unavailable | none | not run | it needs AWS credentials |

`git diff --name-only af19d13 736e54e` touches `src/auth/` (two files), the two skills,
`CLAUDE.md` and `docs/ai-module/writeup.md`. `src/` feeds Verify and the image build. Prose reads
`README.md`, `ARCHITECTURE.md`, `contract/README.md` and `docs/decisions`, and the diff touches
none of them, so Prose is unaffected.

The same scripts run in the working checkout, with #17 applied over `736e54e`, gave these results:

```
npm run check:unit    exit=0   0 vulnerabilities, 681 tests across 39 suites
npm run check:prose   exit=0   ARCHITECTURE.md at 642 words
npm run check:image   exit=0   t-shirt-store-api:local built
npm run check:db      exit=0   "tshirt_store_test": no pending migrations, no difference,
                               294 tests across 16 suites
```

## Cleanup

```
git rev-parse HEAD        736e54e1057bb7b6e8d0855d96cfe9aa70599678   (as at the start)
git status --porcelain    identical to the start (diff exit=0)
git worktree list         neither verify worktree remains
```

## Check sensitivity

A separate run for #17 created a scratch worktree at `736e54e` and copied in the working
checkout's `package.json`, because the `check:*` scripts are not committed at that SHA. It wrote
`f3e6e6e^`'s `auth.service.ts` into the worktree and ran `check:unit` there: `exit=1`, with 1
failed of 681 on the same assertion.

The first attempt also failed `AppModule`, because the worktree had no `.env`. That failure came
from setup, so step 4 now links `.env` into each worktree.
