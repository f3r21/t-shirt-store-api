# AI Module write-up

**Repository / PR:** https://github.com/f3r21/t-shirt-store-api,
[pull request #15](https://github.com/f3r21/t-shirt-store-api/pull/15), open and unmerged.

**Starting commit:** [`7139980`](https://github.com/f3r21/t-shirt-store-api/commit/7139980),
"docs: name both non-additive migrations in the architecture page". Confirmed as the base with
`git merge-base --is-ancestor 7139980 HEAD`.

**Improvement:** `GET /auth/sessions` reported an expiry date earlier than the truth for any
device holding more than one live refresh token row, which the grace window produces whenever a
second tab refreshes. Fixed in
[`f3e6e6e`](https://github.com/f3r21/t-shirt-store-api/commit/f3e6e6e). It works when the same test passes for both orders the
database can return the rows in, and when the unit count moves by exactly the two cases added.

It was chosen here rather than suggested. The brief allows a mentor's suggestion or an alternative
of the same size agreed with the mentor, and none had been suggested when the branch was cut, so
this one came from a survey of the repository. The agreement the second route asks for is
therefore still owed, and the review request on the open pull request is where it is asked for.
Choosing it from three measured candidates is the first of the judgments named below.

## Skills

| Skill (file link) | Goal, inputs → steps → output | Exact invocation |
| --- | --- | --- |
| [`.claude/skills/investigate-task/SKILL.md`](../../.claude/skills/investigate-task/SKILL.md) | Locate the code and the tests behind a request, and change neither. In: an issue number, a bug report, or a proposed change. Steps: read the issue body and comments in one call, search with `--hidden`, resolve every decision the code cites, read the tests and the comments beside the code, give every empty result a control. Out: Files, Findings, Test plan, with the entries that need containers marked. | `/investigate-task` |
| [`.claude/skills/verify-fix/SKILL.md`](../../.claude/skills/verify-fix/SKILL.md) | Prove a change works, and report per CI job rather than per verdict. In: a bug report, a diff, or a check to be tested. Steps: record the tree, enumerate the workflow's jobs at run time, reach red by a reported failure or a sabotage, apply the fix, re-run, prove the assertion held, restore the sabotaged file by name. Out: one row per job, red and green, each cell carrying its command and exit status. | `/verify-fix` |

**Notes:**

_References._ Both files follow [Agent Skills](https://code.claude.com/docs/en/skills) for format
and invocation, and [Writing for Agents](https://www.aihero.dev/skills-writing-for-agents) for how
instructions an agent parses without a human present are written: one completion criterion per
step, stated so it can be checked rather than felt; reference pushed behind a pointer instead of
inlined; behaviour prompted positively rather than by prohibition. That last reference also
supplied the rule that cost the most text: a document earns nothing by restating what one command
already answers. `CLAUDE.md` therefore opens by saying that `package.json` holds the scripts and
`ARCHITECTURE.md` holds the shape, and reproduces neither. The five scripts it does name earn it:
three because the order they run in is not in `package.json`, and the `lint` pair because the
obvious one carries `--fix` and rewrites files. `rg -n 'npm run [a-z:]+' CLAUDE.md` returns those
five, and the count is the point rather than a zero. Both skill files are procedural, so they
are written in Simplified Technical English: one instruction per sentence, active voice, and a
glossary for each project term. This write-up is the opposite case, because it argues.

_Reused tooling._ Neither skill adds a dependency. `verify-fix` ships one supporting file,
`jobs.js`, which parses `.github/workflows/ci.yml` with node alone. The first draft used
`require('js-yaml')` and worked on the first run, which is exactly the problem: `js-yaml` is not
declared in `package.json` and resolves only because `@nestjs/swagger` and `eslint` hoist it, so
the single executable step of the skill would have disappeared at the next dependency bump. The
dependency-free scan was checked against the `js-yaml` parse and agrees on all four jobs.

_Setup._ None. Both files live in the repository, so a clone carries them, and
`node .claude/skills/verify-fix/jobs.js` needs only the node the API already requires. The
invocations are `/investigate-task` and `/verify-fix`.

_What is new._ Both skills are new files rather than edits to an existing one, so there is no
prior version to diff against. The starting commit tracked no skill at all:
`git ls-tree -r --name-only 7139980 | rg -i 'skill'` returns nothing, against a control of 40
tracked `.md` files at the same commit. The four `prisma-cli` skills under `.claude/skills/` are
vendored symlinks into `.agents/skills/` and were never in the tree.

_Safety and rollback._ `investigate-task` declares `allowed-tools`, so "this skill does not edit"
is a property of the configuration rather than a sentence the model can drift from. `verify-fix`
records `git status --porcelain` in step 1 and compares against it in step 5, so an unrestored
sabotage fails the skill rather than surprising the next session; the restore names the file,
because `git checkout -- .` would discard every other change in the tree.

## Project Results

**Before → after:**

The manual version of this work is not slower. It is differently wrong, in two specific ways that
the two skills were built to close.

The first is the shape of a check run. This repository has no aggregate command, so the manual
habit is to run the four checks that are cheap and call the result green. CI defines four jobs and
`Verify` is only one of them. The branch's own starting commit is the demonstration: `Verify`,
`Image` and `Deploy` all passed while `Prose` failed on a word count, and nothing in a normal
local run would have said so. `verify-fix` enumerates the jobs from the workflow at run time for
that reason, and it reads `uses` steps as well as `run` steps, because the Prose job reaches Vale
through an action and a list of `run` steps misses the check that job exists for.

That is also how this fix was proved rather than asserted. The fresh-session run recorded under
Evidence took `f3e6e6e` red and then green with a row for each of the four jobs, including the two
that cannot run on this machine and the reason for each, where the manual habit produces one line
reporting that the tests pass. It is one run reported twice, and this is the half that says what
it did for the improvement.

The second is the order of investigation. The manual habit is to find the defect and fix it, then
discover what the fix broke. `investigate-task` reads the tests around the code before anything
changes, in its step 5, and that is what decided this improvement. There were two candidate fixes.
Sorting the query by `expires_at` is one line; rewriting the grouping loop is nine. The one-line version would
have broken `auth.service.spec.ts:733`, which pins the query order as ending in `{ id: 'desc' }`,
and the only route from there to green is to weaken that test. The skill surfaced the constraint
before a line was written rather than after a test went red, and the choice stopped being a
preference.

What still needed judgment: which of three undocumented defects to fix, whether a stale test title
was worth its own commit, and the decision to assert both row orders rather than the one the
database happens to produce. None of those is a step a skill can take.

**Evidence:**

_The requirement this closes._ Before this branch no skill in the repository ran an executable
check, which is the assignment's one hard requirement. These read the tracked tree rather than the
working directory, so they reproduce from a fresh clone:

```sh
$ git grep -l 'npm run typecheck\|npm test\|lint:ci' HEAD -- '.claude/skills/*/SKILL.md'
HEAD:.claude/skills/verify-fix/SKILL.md

$ git grep -l 'npm run typecheck\|npm test\|lint:ci' 7139980 -- '.claude/skills/*/SKILL.md'
$ echo $?
1

# positive control, same pattern and same commit, against a file that does match,
# so the zero above is an absence and not a pattern that never fires
$ git grep -l 'lint:ci' 7139980 -- '.github/workflows/ci.yml'
7139980:.github/workflows/ci.yml
```

A second obstacle had to go first. `.git/info/exclude` hid `.claude/` wholesale, so no skill file
could be committed and `git status` did not even offer one. That file is per clone and is never
published, so the problem is invisible to anyone else and cannot be fixed by a commit. The
exclusion was narrowed one directory level at a time, because gitignore cannot re-include a file
whose parent is excluded, and the replacement was validated in a throwaway repository reproducing
the layout, symlinks included, before it touched this one. It opens exactly the two authored
skills:

```sh
$ git check-ignore -q .claude/skills/verify-fix/SKILL.md ; echo $?
1
$ git check-ignore -q .claude/skills/prisma-cli ; echo $?
0
$ git check-ignore -q .claude/settings.local.json ; echo $?
0
```

The middle probe names the symlink rather than a path inside it. `git check-ignore` answers 128,
not 0, for a path that goes through one, and all four vendored Prisma skills are symlinks into
`.agents/skills/`, so the obvious spelling of that check reports an error that reads like a pass.

_Baseline._ Recorded on the branch before any change, each check as its own command, because a
pipe in zsh reports the status of its last command rather than the command under test.

```
npm audit --omit=dev --audit-level=high   exit=0   0 vulnerabilities
npm run typecheck                          exit=0
npm run lint:ci                            exit=0
npm run format:check                       exit=0
npm test -- --ci                           exit=0   679 tests, 39 suites
npx prisma migrate deploy                  exit=0   no pending migrations
npx prisma migrate diff ... --exit-code    exit=0   no difference detected
npm run test:e2e                           exit=0   294 tests, 16 suites
npm run docs:lint                          exit=0   0 errors, 138 warnings
test "$(wc -w < ARCHITECTURE.md)" -lt 650  exit=1   669 words
```

The last line is the one failure, and CI agreed with it on the same commit:

```sh
$ gh run view 34612434335 --json jobs --jq '.jobs[] | "\(.name)  \(.conclusion)"'
Verify  success
Prose  failure
Image  success
vale  neutral
Deploy  success
```

Five rows for four jobs. `vale` is not in `ci.yml`, which `jobs.js` reads as four; it is a check
run that `vale-cli/vale-action` creates from inside `Prose` with `reporter: github-check`, and
`neutral` is neither of the two answers a reader is looking for. The two surfaces disagree about
what a check even is, which is the argument for reading the workflow file rather than the run.

Its parent measured 648 words, two under the ceiling, so naming both non-additive migrations was
always going to cross it. The failure was recorded before anything changed, and repaired in its
own commit, `ebbffe3`, outside the improvement.

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

_Fresh-session runs._ Each skill was run once in a session with no prior conversation, and each
run changed the skill it exercised.

`/investigate-task`, given "stock.notify-skipped emits the same event for three different causes
in low-stock.processor.ts". The subject is deliberately not this improvement, and this branch
touches none of it: `git diff --stat 7139980 HEAD -- src/stock-notifications/` prints nothing,
against the same command on `src/auth/` which prints two files. A fresh session on the fix the
author had already made would have proved the skill can agree with a conclusion it was handed. It returned Files, Findings and a test plan, and four of its claims
were checked against the tree afterwards and held:

```
low-stock.processor.ts:42,:76,:110   two call sites into one skipped(), one event, two ids
low-stock.processor.spec.ts:34       the describe says "the two ways it stops early"
rg 'productVariant.findUnique.mockResolvedValue(null)' spec   exit 1, cause 2 has no test
  control: 'user.findUnique.mockResolvedValue(null)' matches :156, so the pattern fires
rg 'reason:' src/stock-notifications/   4 hits: worker.ts:56,:64, stock-queue.ts:89
  and producer.spec.ts:192. Three in source, so the module already carries the
  discriminating field this log lacks
```

It also resolved ADR 28 and found it names only one of the three causes, and ADR 21, which says
the e2e suite runs at `silent` so no end to end test can read a log line, which is what decides
the improvement is assertable in the unit spec alone.

What it revealed about the skill: it added `node_modules`, `dist` and `coverage` to the search
excludes defensively, because the file said `--hidden` and left the rest implied. Those excludes
change nothing, since `rg` honours `.gitignore` already. The file now carries the measurement and
a step the run performed that the file never asked for: find every reader of a name before
proposing to change it.

The measurement then did something better than illustrate the point. Written as one file matching
`module.exports` against 12653 with `--no-ignore`, it was wrong the moment it was saved, because
writing the pattern down made the skill file a second match. Repairing it to two broke it again to
three, since this page quotes the pattern as well. A count taken over a corpus that includes the
document reporting it is not a measurement. The skill now excludes prose from that command with
`-g '!*.md'`, which puts it back to one against 12507, and says why.

`/verify-fix`, given the commit `f3e6e6e`. It reverted the source hunk to `f3e6e6e^`, kept the
test exactly as committed, and reported a row per job:

```
Verify  red   npm test -- --ci   exit=1, 1 failed of 681
        green npm test -- --ci   exit=0, 681 passed across 39 suites
              audit, typecheck, lint:ci, format:check, migrate diff, test:e2e all exit=0
Image   not run here, docker build starts a container
Prose   unaffected, the commit touches no prose file
Deploy  not runnable here, it reads AWS credentials
```

The red failure was the defect and not a collateral one, and only one of the two row orders
failed:

```
● reports the latest expiry of a family, with the abandoned row first
    Expected: "2026-09-20T09:14:00.000Z"
    Received: "2026-09-12T09:14:00.000Z"
```

What it revealed about the skill: the restore step named `git checkout -- <file>` and the run was
refused, because this machine's `.claude/settings.local.json` carries a hook that blocks
`checkout`, `restore`, `reset` and `stash`. That file is gitignored and per clone, so the skill
can assume neither its presence nor its absence. It now carries the fallback, and a worse gap
than the blocked command: the step ended on having typed the restore rather than on proving it.
It now ends on `git diff --exit-code`, because a refused restore and a successful one look
identical until something else reads the file.

_What the review caught._ `code-review` ran over the branch diff against `main` on two axes
before the pull request was opened, and the Spec axis found that ticket 9 had been closed against
a probe it did not satisfy. The acceptance criterion reads `rg -c 'docker compose' CLAUDE.md`.
That returned nothing at the time, and returns `1` today, because of the repair described two
paragraphs down. The closing comment reported `docker:up 1` instead, a different probe,
chosen after the fact because it gave the answer the close wanted, with no note that the
substitution had happened.

This is the defect the whole branch is built around, committed by the author while closing the
ticket that verifies the work. Neither skill caught it, because neither was pointed at it: a
check runner proves the code, and nothing here was checking the evidence. What caught it was a
second pass with a different brief and no stake in the first answer.

Both halves were repaired rather than the criterion rewritten to match the file. `CLAUDE.md`
gained the fact it was actually missing, that `docker:up` runs `docker compose` over
`docker-compose.yml`, which is where a service, a port or an image tag changes, and the ticket
was reopened with the substitution recorded rather than quietly re-closed.

The Standards axis found the same shape in `jobs.js`. It matches indentation instead of parsing
YAML, so a workflow written differently produced no lines for a job, which reads exactly like a
job with no steps. A tool built to turn silent failures into loud ones was failing silently. It
now ends every run on a count, and a zero names its own cause: a missing file exits 2, a `jobs:`
key with no job matched exits 1 and names the indentation it expects, and a file with no `jobs:`
key exits 1 and says it is not a workflow.

A third pass, run after the branch was pushed and aimed only at the figures, found three more.
`verify-fix` claimed four steps of `Verify` need the containers and named three; there are three,
and the line now carries the command that counts them. This page quoted the CI run above as four
rows when the command prints five, the same substitution as ticket 9 and caught the same way, by
running the command rather than reading the sentence. The third was a sentence that began in
lower case.

A fourth pass read this page against the assignment and the supplied template instead of against
the code, and found nine defects, all but one of them an omission. Two matter. The brief offers a
mentor's suggestion or an agreed alternative of the same size and this improvement was chosen
here, which the Improvement field now says. The template's Evidence field asks for mocks to be
told apart from real services, which nothing here did, although that distinction decides what the
fix is actually proved against. Three more were three field names that had drifted from the
template, a missing note that neither skill needs any setup, and a paragraph arguing for
`verify-fix` in general without saying what it did for this fix.

The remaining four came from reading the page a second time after those repairs, and two of them
were made by the repairs. The mentor sentence quoted a rule with two routes and answered neither.
The paragraph written to tie `verify-fix` to this fix described the fresh-session run again with
no pointer to it, so one run read as two. The two the first reading had simply missed were a
pre-commit command quoted without the separator that makes it work, `npm test --bail` for
`npm test -- --bail --silent`, and the fact that both skills are new files, which the brief asks
to be identified and which nothing here stated. A pass that repairs its own findings needs a
second reading for the same reason the first one was needed.

A fifth pass was the first one this author did not perform. An agent with no history of this
branch was given the brief, the template and the repository, told to re-derive every figure, path,
line number and command on this page, and told explicitly not to assume the prior work was
correct. It found seven more, and they are the most useful findings in this section, because they
are the ones a self-review structurally cannot produce.

The worst is a sentence about `CLAUDE.md` that `CLAUDE.md` contradicts. The Notes field argued
that a document earns nothing by restating what one command answers, and offered as proof that
`CLAUDE.md` therefore lists no npm scripts. It lists five: `rg -c 'npm run [a-z:]+' CLAUDE.md`
returns 5. The principle is sound and the file follows it; the evidence offered for it was simply
false, and it had survived four readings by the person who wrote it.

Two more had rotted rather than started wrong. The proof that no test was weakened was
`git diff --numstat -- src/auth/auth.service.spec.ts`, which reported `40 0` from an uncommitted
tree and reports nothing at all now that the work is committed. It is now spelled against the
commit. And the ticket 9 criterion, quoted here as returning nothing, returns `1` today because
this branch repaired the file ten lines further down, so the sentence falsified itself.

The rest were figures inside the `investigate-task` transcript: two line numbers off by one and a
private method counted as a call site, one probe quoting three of its four hits, and a measurement
in the skill file that was wrong the moment it was written down, because writing the pattern down
made the file a match for it.

The pattern across all five passes is one thing: every defect was in the evidence, not in the
code. The checks were green each time. Four of the passes were the author re-reading the author,
and each found real defects, but the fifth found a claim contradicted by a file in the same
commit, which is the class of error a reader who already believes the sentence does not see.

**Limitations:**

- `investigate-task` is restricted through `allowed-tools`, and the list includes `Bash` because
  the skill runs `rg`, `gh` and `jest`. No file-editing tool is granted, which a search of the
  file confirms, but a shell can still write. The restriction is real against the tools and
  partial against the shell, and it is stated here rather than claimed as absolute.
- What `investigate-task` did for this improvement is the weakest link in the evidence. The
  constraint it surfaced is real and checkable, `auth.service.spec.ts:733` does pin the query
  order, but the artifact of that session is the decision rather than a log, and the only recorded
  run of the skill is aimed at another candidate on purpose. `verify-fix` is evidenced by its
  output; `investigate-task` is evidenced by the shape of the fix that followed it, which is
  weaker, and no probe here closes that gap.
- The two fresh-session runs are reported, not proved. Nothing in a transcript-free record
  distinguishes a session with no prior conversation from one that had it, so the corroboration is
  indirect: the probes each run quoted are re-derivable, and each run's finding is committed
  separately, in `ef728dd` and `eed5d42`.
- `.husky/pre-commit` runs `npm test -- --bail --silent`, so a commit holding a failing test is
  impossible without `--no-verify`. Red before green is evidenced by the two runs and the `numstat` above,
  not by a red commit followed by a green one.
- `jobs.js` is a scanner, not a YAML parser. It reports the first line of a block scalar with an
  ellipsis rather than the whole script, which is enough to identify a step and not enough to run
  one. A workflow that nests jobs differently would need it revisited.
- The fix is covered by unit tests only. No end to end test exercises a family with two live rows
  whose expiry dates differ, so the behaviour is proved at the service and not through the route.
- Two skills were designed and dropped. `migration-safety`, a Prisma rollout auditor, had the
  better material: this repository has exactly one `DROP COLUMN` across eleven migrations, and it
  drops `users.reset_token` in the same statement that adds `reset_token_hash`. It was cut
  because the brief asks both skills to contribute to the improvement, and an auth fix touches no
  migration. `adr-conformance` would check that every decision citation in the code resolves to one of
  the files under `docs/decisions/`. Measured on this branch with
  `rg -o --hidden 'ADR [0-9]+|DECISIONS [0-9]+' src/ prisma/ .github/ | wc -l` and
  `ls docs/decisions/ | wc -l`: 137 citations against 37 files. It was cut because that check is
  green today, so its demonstration would have rested on a sabotage rather than a defect.
