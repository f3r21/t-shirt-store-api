# investigate-task in fresh sessions

Each run started a new headless session in the repository root and asked it to invoke the skill:

```sh
claude -p "Invoke the investigate-task skill with the argument: <argument>. Then print its result verbatim."
```

The skill ran as `forked execution` in the `investigator` agent. The tool calls in each session's
event log, counted with `jq`:

| Run | Argument | Glob | Grep | Read | Anything else |
| --- | --- | --- | --- | --- | --- |
| No input | none | 0 | 0 | 0 | none. It replied: "I need an issue number or a description of the task before I can investigate; which one should I look into?" |
| Issue | `19` | 10 | 20 | 13 | none |
| Free text | the stock notification request from the first runs | 8 | 27 | 9 | none |

## What the runs changed

- The first attempt with no input failed before the investigation started, because the permission
  check refused a `case` statement inside the injected command. The branching moved into
  `fetch-issue.sh`.
- The free-text run found that a directory search under `.claude/` returns nothing, and it found
  this through its own control. Grep honours `.git/info/exclude`, which holds `.claude/*`. The skill
  now lists those files with Glob and searches each one by path, and it leaves the other checkouts
  under `.claude/worktrees/` out of the report.
- The issue 19 run started while `verify-fix` was being rewritten, so it read the previous skill.
  It predicted three problems before the rewrite hit them: a worktree has no `.env`, a pinned commit
  older than #17 has no `check:*` scripts, and the local hook blocks `npm ci`. It also found that
  `check:db` must never run in two worktrees at once, because of ADR 33. `verify-fix` now says so
  in step 6.

Paths in the reports below are relative to the repository root. They are otherwise as printed.

## Report: issue 19

### Request

Rewrite `/verify-fix` so that it proves a fix by running the same reproduction at a pinned base SHA and a pinned head SHA, each in its own detached git worktree without touching the working checkout. It then reports every CI job through the shared `check:*` scripts, deletes `jobs.js`, moves sabotage into its own worktree-only section, and saves a run on `f3e6e6e` to `docs/ai-module/evidence/`.

### Files

- `.claude/skills/verify-fix/jobs.js:1`: the workflow scanner the issue deletes (108 lines, no test).
- `.claude/skills/verify-fix/SKILL.md:27`: step 1 records `git status --porcelain` and `git log --oneline -1`. It does not record `HEAD` with `git rev-parse`, which the new end check needs.
- `.../verify-fix/SKILL.md:39-66`: step 2 runs `jobs.js`, to be replaced by the job → `check:*` mapping.
- `.../verify-fix/SKILL.md:68-80`: step 3. Route A (reproduce) and Route B (sabotage) are mixed in one step. The issue splits sabotage out.
- `.../verify-fix/SKILL.md:82-94`: step 4 shows the assertion is unchanged with `git diff -- <the test file>`. That only works in one checkout.
- `.../verify-fix/SKILL.md:96-120`: step 5 restores in place (`git checkout --` or `git show > path`). The worktree design makes this step unnecessary.
- `.../verify-fix/SKILL.md:122-144`: the constraints the issue keeps (the pipe hides a failing exit status, `lint` carries `--fix`, containers) and the one it drops (`jobs.js` at `:141`).
- `package.json:31-34`: `check:unit`, `check:db`, `check:prose`, `check:image`, the scripts the new mapping calls.
- `.github/workflows/ci.yml:109,115,127,144-155,165`: Verify calls `check:unit` and `check:db`, Image calls `check:image`. Prose calls `vale-action` plus `docs:length`, not `check:prose`. Deploy uses AWS.
- `CLAUDE.md:45-51`: the table that maps each job to a local command already exists. The skill can point here instead of re-deriving it.
- `.claude/settings.local.json:23`: a local hook that blocks `git checkout|restore|reset|stash|add|rm|mv…`, `npm ci|install`, `npx prisma generate|migrate deploy` and `npm run docker:`.
- `src/auth/auth.service.ts:345-353`: the grouping loop that `f3e6e6e` fixed (the source hunk).
- `src/auth/auth.service.spec.ts:647-674`: the regression test `'reports the latest expiry of a family, with %s'`. The expected assertion is at `:672`.
- `docs/ai-module/writeup.md:27,45-54,63-66,79,109-110,170,266-293,313-318,392-394`: prose that describes the current skill and `jobs.js`.
- `docs/decisions/0033-the-e2e-suite-truncates-and-reseeds.md:22`: `maxWorkers: 1`, because the suites share one database.

### Findings

- **Readers of `jobs.js`.** A search over the whole repository, hidden directories included, finds 7 lines in 3 files. `SKILL.md:45` and `SKILL.md:141` are instructions. `jobs.js:3` is its own usage line. `writeup.md:46,53,170,313,392` are prose. None is an alert, a metric filter, a contract file or a test.
  - `.github/`: the pattern `jobs\.js|verify-fix` returns nothing. Control: `check:unit` in the same scope matches `ci.yml:104,109`.
  - `.vale/`: the same pattern returns nothing. Control: `\w+` in the same scope counts 942 matches across 49 files.
  - `test/`: the pattern `\.claude|jobs\.js|verify-fix` returns 0. Control: `truncateAll` in the same scope counts 32 matches across 15 files.
- **A search anomaly to be aware of.** `verify-fix|worktree|sabotage` scoped to `.claude/` and to `.claude/skills/` returned nothing. The same content scoped to `.claude/skills/verify-fix/` returned 2 matches for `sabotage`, and the unscoped repository search found `SKILL.md:2,25,45,75,141`. A directory-scoped search at the `.claude/skills` level is unreliable here (probably the symlinks described at `CLAUDE.md:88-89`). Scope to the skill directory itself.
- **Probably a blocker (inferred, not confirmed): the `check:*` scripts may not exist at `f3e6e6e` or `f3e6e6e^`.** The git status shows `package.json` and `ci.yml` modified and uncommitted. `SKILL.md:138-141` still describes three separate Verify steps (`npx prisma migrate deploy`, `npx prisma migrate diff`, `npm run test:e2e`), where `ci.yml:115` now has the single step `check:db`. The baseline at `writeup.md:147-156` also lists individual commands. So #17 (the blocker) looks uncommitted, and a worktree at either pinned SHA would lack `npm run check:unit` and the rest. The skill has two options when a script is missing at a pinned SHA: run the CI job's commands as they stood at that SHA, or report the job as unavailable. I did not run `git show f3e6e6e:package.json` to confirm.
- **Every job has a mapping except Deploy.** Verify maps to `check:unit` + `check:db`, which needs the three containers. Image maps to `check:image`, which needs a Docker daemon (`ci.yml:127`). Deploy has none and is reported unavailable because it needs AWS credentials (`CLAUDE.md:51`, `ci.yml:189`).
  - Prose is an approximation: CI runs `vale-action` over the same files with `fail_on_error` (`ci.yml:144-150`) plus `docs:length`, while `check:prose` runs local `vale` (`package.json:17,33`). The report should state that.
- **Setting up a fresh worktree hits the local hook (`settings.local.json:23`).** A worktree has no `node_modules` and no `src/generated`, which is untracked per `ci.yml:98-99`. `npm ci` and `npx prisma generate` are both blocked. `git worktree add` and `git worktree remove` are not matched by the pattern, but `git -C <wt> checkout` would be.
  - Without dependencies, both states fail at setup, and the issue counts that as "not reproduced".
  - The unit suite also needs the env values that `validateEnv` requires (`ci.yml:62-73`). A worktree has no `.env`.
  - I could not see whether `.env`, `node_modules` or `src/generated` exist in the main checkout. Glob hides gitignored paths, and a known-present path (`node_modules/.bin/jest`) returned "No files found", so an empty Glob here tells nothing.
- **Pinning `f3e6e6e`.** The head is `f3e6e6e` itself, not the branch head, and the base is `f3e6e6e^`. The regression test has to be written into the base worktree from `f3e6e6e:src/auth/auth.service.spec.ts`. The same command, `npx jest src/auth/auth.service.spec.ts -t 'reports the latest expiry'` (`writeup.md:182`), must run in both states.
  - Expected result: the base fails at `:672` with Expected `2026-09-20T09:14:00.000Z` and Received `2026-09-12T09:14:00.000Z` (`writeup.md:186-187, 282-284`), and only the "abandoned row first" case fails. The head passes.
  - `2f52d89` later rewrote a test title in this file (`writeup.md:204`). Check that the `-t` filter matches the title at `f3e6e6e`.
- **`check:db` in two worktrees has to run one after the other.** ADR 33 (`0033-…:22`) says the suites share one database with `maxWorkers: 1`. Both worktrees would point at the same `tshirt_store_test`, so running `check:db` in them at the same time would let one state's truncation corrupt the other's run.
- **Decisions.** The ADR grep on `.claude/skills/verify-fix/` returns nothing. Control: the same pattern on `ci.yml` matches `:105` (DECISIONS 20), `:164` (DECISIONS 30) and `:195` (DECISIONS 29). None of those bears on this change. ADR 33 bears on it through `CLAUDE.md:34`, as above. ADR 2 is cited at `auth.service.spec.ts:642` for the behaviour under test and is not changed. No ADR rule is broken.
- **The evidence directory does not exist yet.** Globbing `docs/ai-module/**` finds only `writeup.md`. Nothing references `docs/ai-module`; control: `docs/decisions` matches `CLAUDE.md:64` and `package.json:17`.
  - The Prose job and `docs:lint` do not lint `docs/ai-module/`.
  - `.husky/pre-commit:9-18` rejects em and en dashes in any staged file, and the Edit/Write hook (`settings.local.json:13`) blocks em dashes. Saved output must be free of both.
- **A writeup check that depends on the SKILL.md text.** `writeup.md:109-110` greps HEAD's `SKILL.md` for `npm run typecheck|npm test|lint:ci`. It keeps matching only while the rewritten `SKILL.md` still names `lint:ci`, for example in the constraint that `lint` rewrites files.

### Test plan

- **The regression, base red and head green** → `src/auth/auth.service.spec.ts:647-674` → `npx jest src/auth/auth.service.spec.ts -t 'reports the latest expiry' > /tmp/out.log 2>&1; echo "exit=$?"` in each worktree → no services (Prisma is mocked).
- **Verify, part 1** → the unit suite → `npm run check:unit` → no services.
- **Verify, part 2** → `test/*.e2e-spec.ts` → `npm run check:db` → the three containers. Run it in one worktree at a time (ADR 33).
- **Prose** → `npm run check:prose` → `vale` on the path.
- **Image** → `npm run check:image` → a Docker daemon.
- **Deploy** → none; report it as unavailable because it needs AWS credentials.
- **Skill acceptance** → no test file. These are the issue's verification commands:
  - `test ! -e .claude/skills/verify-fix/jobs.js; echo "exit=$?"`
  - `rg -n 'worktree add|rev-parse' .claude/skills/verify-fix/SKILL.md`
  - `rg -n 'exit=' docs/ai-module/evidence/verify-fix-f3e6e6e.md`
  - `git worktree list`

  No services needed.

**Coverage gaps:**
- Nothing tests the skill or the job mapping; `jobs.js` never had a test either. The only checks are the issue's commands. A test would need a new home, for example a script under `.claude/skills/verify-fix/`, but the issue deletes the only script there.
- Nothing tests that `git status --porcelain` and `HEAD` are restored. That lives in the skill's own final step.
- No end to end test covers session expiry across a family (`writeup.md:395-396`). It would go in `test/auth.e2e-spec.ts`.

**Comments and prose the change makes false:**
- `SKILL.md:3-7` (the description says it shows red before and green after, not at two SHAs)
- `SKILL.md:34-37`
- `SKILL.md:41-56`
- `SKILL.md:75-80` (moves out)
- `SKILL.md:86-94`
- `SKILL.md:98-120`
- `SKILL.md:138-142`: already false today, since `ci.yml:115` has one step, `check:db`
- `writeup.md:27` (the steps column)
- `writeup.md:45-46` ("ships one supporting file, `jobs.js`")
- `writeup.md:53`
- `writeup.md:63-66` (the restore by file name)
- `writeup.md:79` ("enumerates the jobs from the workflow at run time")
- `writeup.md:170`
- `writeup.md:313-318`
- `writeup.md:392-394`

**Unresolved questions:**
- Do `check:*` exist in `package.json` at `f3e6e6e`? If not, how does the skill map the jobs at an older SHA?
- How does a worktree get `node_modules`, `src/generated` and the env values when the local hook blocks `npm ci` and `prisma generate`? Options include a symlink from the main checkout, the user running setup, or reporting "not reproduced".
- Should the `writeup.md` history of `jobs.js` be rewritten or kept as history?

## Report: free text

Argument: "stock.notify-skipped emits the same event for three different causes in low-stock.processor.ts".

### Request

`stock.notify-skipped` is logged for three different causes in `low-stock.processor.ts`: a `P2003` on the insert, a missing variant and a missing user. The request asks for those causes to be told apart. No issue was fetched, so this comes from the arguments only.

### Files

- `src/stock-notifications/low-stock.processor.ts:41`: cause 1. The insert fails with `P2003` (foreign key: the user or the variant was deleted before the row was written). It calls `skipped` at :42 and deletes nothing, because no row exists.
- `src/stock-notifications/low-stock.processor.ts:74`: causes 2 and 3. After the row is written, `variant === null || user === null` joins both lookups into one branch. It deletes the row at :75 and calls `skipped` at :76. Both lookups have already resolved here, so the code knows which one is null, or whether both are.
- `src/stock-notifications/low-stock.processor.ts:110`: `skipped(userId, variantId)` takes no cause.
- `src/stock-notifications/low-stock.processor.ts:112`: `msg: 'the user or the variant is gone'`, one message for every cause.
- `src/stock-notifications/low-stock.processor.ts:113`: `event: 'stock.notify-skipped'`, the only place the literal is emitted.
- `src/stock-notifications/low-stock.processor.ts:12` and `:52`: the comments that cite ADR 28.
- `src/stock-notifications/low-stock.processor.spec.ts:155`: the unit test for "person is gone" (user null). It asserts the event at :162-164.
- `src/stock-notifications/low-stock.processor.spec.ts:167`: the unit test for the `P2003` path. It asserts the event at :173-175.
- `src/stock-notifications/low-stock.processor.spec.ts:34`: the describe comment ("a person or a variant that is gone").
- `test/stock-notifications.e2e-spec.ts:306`: the worker e2e block. Its cases at :356, :386, :402 and :423 include no skip path.
- `test/setup-e2e.ts:38`: `LOG_LEVEL ??= 'silent'`, so no e2e test can see the event.
- `docs/decisions/0028-the-worker-writes-the-row-before-the-mail.md:28`: "A `P2003` on a deleted person or variant is a skip."
- `docs/decisions/0021-logs-are-pino-json-with-a-request-id.md:28`: "no end-to-end test reads a log line … No metric exists."
- `docs/decisions/0027-low-stock-is-a-crossing.md:31`: the producer's `stock.notify-failed`, a sibling event name that a new name must not collide with.
- `.claude/worktrees/dash-guards/src/stock-notifications/low-stock.processor.ts:113` and `.claude/worktrees/readme-trim/src/stock-notifications/low-stock.processor.ts:113`: copies of the same line in two other worktrees.

### Findings

- **The three causes are confirmed, and there is a fourth case.** They are `P2003` on insert (:41), variant null (:74) and user null (:74). Both can be null at once, which is a fourth case. All four reach `skipped` (:110), which logs one event (:113) with one message (:112) and only `userId` and `variantId`. The log line cannot tell the causes apart, and none of the paths keeps the cause.
- **The `P2003` path cannot say which parent is gone** without reading the Prisma error. The processor reads only `err.code` (:32, :41). Splitting this cause needs either `err.meta` (which field failed) or a single "pair gone at insert" cause. This is unresolved (see below).
- **ADR 28 does not block the change.** Grepping for `ADR [0-9]+|DECISIONS [0-9]+` in the two files from step 2 finds only ADR 28 (processor.ts:12, :52). ADR 28:28-29 says a `P2003` "is a skip". Changing the event name or adding a cause field keeps it a skip. A change that retried or threw on `P2003` would break ADR 28 and would have to revise it.
- **ADR 21 is relevant but not cited.** It says no metric exists and no e2e test reads a log line (0021:28-29). That matches the search results below: the only readers of the event are unit tests.
- **Consumers of the literal `stock.notify-skipped`.** Search: `notify-skipped|notified-already|stock\.notified` from the repo root.
  - `src/stock-notifications/low-stock.processor.ts:113`: the emitter.
  - `src/stock-notifications/low-stock.processor.spec.ts:163`: **test**.
  - `src/stock-notifications/low-stock.processor.spec.ts:174`: **test**.
  - `docs/ai-module/writeup.md:232`: prose that quotes this request. It is not a reader.
  - The two `.claude/worktrees/*` copies at :113 are separate checkouts, not readers. They go stale if they are not rebased.
  - There is no alert, no metric filter and no contract file. Both unit assertions use `expect.objectContaining({ event: 'stock.notify-skipped' })`, so renaming the event breaks them. Adding a field such as `reason` and keeping the event name does not break them.
- **`infra/` has no metric filter or alarm.** The search `notify|stock|Metric|Alarm|LogGroup` in `infra/` returned only the log group (`infra/stack.yml:279`, `:284`) and `infra/ci.yml:30`, `:139`. The `infra/stack.yml:279` result is also the control that proves the search works. There is no `MetricFilter` in `infra/`.
- **Empty search in `.github/`:** `notify-skipped` returned nothing. Control: `npm run` in `.github/` returned 4 in `.github/workflows/ci.yml`.
- **Empty search in `.vale/`:** `notify-skipped` returned nothing. Control: `\S` in `.vale/` returned 960 matches across 49 files.
- **Empty search in `contract/`:** `notify-skipped|notify|skipped` found only `contract/openapi.yaml:2190`, which is about pagination and unrelated. Control: `stock|Stock` returned 37 matches in `contract/openapi.yaml`.
- **Searching `.claude/` as a directory returns nothing at all.**
  - `notify-skipped` in `.claude/` returned nothing, but the control `investigate-task|ADR` in `.claude/` also returned 0, and so did `investigate` in `.claude/skills`. Searching the file itself, `investigate` in `.claude/skills/investigate-task/SKILL.md`, returned 3. A directory search under `.claude/` gives no evidence either way. The cause is not established; symlinks or a nested `.git` are possible.
  - The fallback was a per-file search of the six files Glob lists under `.claude/agents` and `.claude/skills`: `verify-fix/jobs.js`, `verify-fix/SKILL.md`, `agents/investigator.md`, `investigate-task/SKILL.md`, `investigate-task/fetch-issue.sh` and `investigate-task/report-template.md`. Each returned 0 for `notify-skipped`, with the SKILL.md control above at 3. The search of report-template.md is not shown above, but that file was read in full and does not contain the literal.
  - A per-file search of the worktree copies found `:113` in both.
- **Build output is not a source reader.** Glob lists `dist/src/stock-notifications/low-stock.processor.js` and `coverage/lcov-report/.../low-stock.processor.ts.html`, but the root Grep did not report them because both directories are gitignored. They are regenerated, not edited.
- **Comments the change would make false or stale:**
  - `low-stock.processor.ts:112`, `msg: 'the user or the variant is gone'`: false for any split-out cause unless it is rewritten for each cause.
  - `low-stock.processor.spec.ts:34-37` (describe comment): stays true only while the causes are grouped as "a person or a variant that is gone". Update it if the spec gains one case per cause.
  - `low-stock.processor.ts:8-13`, `:49-52`, and ADR 28:28-29: stay true as long as every cause is still a skip with no retry.

### Test plan

- **`P2003` on insert (skip, no mail, event logged):** `src/stock-notifications/low-stock.processor.spec.ts:167`. Command: `npm test -- src/stock-notifications/low-stock.processor.spec.ts`. Services: none (Prisma is mocked).
- **User null after the row (row deleted, skip, event logged):** the same file, :155. Same command. Services: none.
- **Variant null after the row: no test covers this.** It belongs in `src/stock-notifications/low-stock.processor.spec.ts`. The test should mock `prisma.productVariant.findUnique` to resolve `null` and assert the row is deleted, no mail is sent, and the cause-specific event or `reason` is logged. Services: none.
- **Both null: no test covers this.** It belongs in the same unit spec, and it pins which cause wins, or a combined cause. Services: none.
- **Telling the causes apart:** once the change lands, each of the cases above needs to assert its own event name or `reason` field. The assertions at :163 and :174 have to change if the event is renamed.
- **End to end: no worker e2e test covers a skip path.** A test would go in `test/stock-notifications.e2e-spec.ts` under `describe('the worker')` (:306). For example: delete the user or variant, then add a job straight to the queue as :410-414 does, and expect no mail, no row and a completed job. Command: `npm run test:e2e -- test/stock-notifications.e2e-spec.ts`. Services: the three containers (`npm run docker:up`). It cannot assert the event, because the suite logs at `silent` (`test/setup-e2e.ts:38`, ADR 21:28).
- **Unresolved questions:**
  - Should the `P2003` cause read `err.meta` to name the missing parent, or stay a single "gone at insert" cause?
  - Should the fix rename the event (breaking both unit assertions, with no other readers) or keep `stock.notify-skipped` and add a `reason` field (backward compatible)?
  - Does anything outside the repo read `/ecs/tshirt` (`infra/stack.yml:284`) for this event, such as a saved CloudWatch query? The repository cannot answer this.
