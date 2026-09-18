# AI Module write-up

**Repository / PR:** https://github.com/f3r21/t-shirt-store-api,
[pull request #15](https://github.com/f3r21/t-shirt-store-api/pull/15), open and unmerged.

**Starting commit:** [`7139980`](https://github.com/f3r21/t-shirt-store-api/commit/7139980),
"docs: name both non-additive migrations in the architecture page". Confirmed as the base with
`git merge-base --is-ancestor 7139980 HEAD`.

**Improvement:** `GET /auth/sessions` reported an expiry earlier than the real one for any device
holding more than one live refresh token row, which the grace window produces whenever a second
tab refreshes. Fixed in [`f3e6e6e`](https://github.com/f3r21/t-shirt-store-api/commit/f3e6e6e).
The test supplies both row orders the database can return. Before the fix, the order the
database produces fails. After it, both pass.

No improvement had been suggested when the branch was cut, so this one came from a survey of the
repository. The brief then asks for an alternative of the same size agreed with the mentor, and
the review request on the pull request is where that agreement is asked for.

## Skills

| Skill (file link) | Goal, inputs → steps → output | Exact invocation |
| --- | --- | --- |
| [`.claude/skills/investigate-task/SKILL.md`](../../.claude/skills/investigate-task/SKILL.md) | Locate the code, the decisions and the tests behind a request, and change nothing. In: an issue number or a description. Steps: a script fetches the issue before the investigation starts, then a subagent limited to `Read`, `Grep` and `Glob` finds the code, resolves the cited ADRs, lists the readers of each name the change would touch, and plans the tests without running them. Out: the report in [`report-template.md`](../../.claude/skills/investigate-task/report-template.md), with Files, Findings and a Test plan. | `/investigate-task <issue-number \| "description">` |
| [`.claude/skills/verify-fix/SKILL.md`](../../.claude/skills/verify-fix/SKILL.md) | Prove a fix at two pinned commits without touching the working checkout. In: the head SHA, the base SHA and a reproduction command. Steps: one detached worktree per commit, the regression test copied into the base when it is new, the identical command in both, then every CI job at the head through the shared `check:*` scripts, then cleanup checked against the starting state. Out: the two SHAs with exit status and assertion, a row for each job, and the cleanup output. | `/verify-fix <head-sha> <base-sha> <command>` |

**Notes:**

_References._ Both files follow [Agent Skills](https://code.claude.com/docs/en/skills) for format,
arguments, forked execution and injected context. They follow
[Writing for Agents](https://www.aihero.dev/skills-writing-for-agents) for style: one action per
instruction, a checkable completion condition, and reference material kept behind a pointer.

_Reused tooling._ Neither skill adds a dependency. `verify-fix` runs the same `check:*` npm
scripts that CI runs, so the list of checks lives in `package.json` and nothing parses the
workflow. `investigate-task` ships one script, `fetch-issue.sh`, because the permission check
refuses a shell `case` statement inside an injected command.

_Setup._ None. Both skills and the `investigator` agent live in the repository. The check scripts
need the containers for `check:db` and a Docker daemon for `check:image`, and the skill reports a
job as unavailable when they are missing.

_What is new._ Both skills are new files. The starting commit tracked no skill:
`git ls-tree -r --name-only 7139980 | rg -i 'skill'` returns nothing, against a control of 40
tracked `.md` files at the same commit.

_Safety and rollback._ `investigate-task` runs in a subagent whose tools are `Read`, `Grep` and
`Glob`. Its only shell grant is `fetch-issue.sh`, which runs before the subagent starts.
`verify-fix` never switches, resets or edits the working checkout. It works in worktrees under
`$TMPDIR`, outside the repository, and it ends by checking that `HEAD` and
`git status --porcelain` match what it recorded at the start.

## Project Results

**Before → after:**

Checks. Before: a local run covered the `Verify` steps. On `7139980`, `Verify`, `Image` and
`Deploy` passed in CI while `Prose` failed on a word count. After: `verify-fix` reports a row for
each of the four jobs, and each row runs the npm script that CI runs.

Investigation. Before: the fix came first and the broken tests showed up afterwards. After:
`investigate-task` reads the tests before any edit. Here it found that
`auth.service.spec.ts:733` pins the query order. Sorting the query by `expires_at` would have
broken that test, so the fix rewrites the grouping loop and leaves the query alone.

`verify-fix` then proved the fix at pinned commits. The base `af19d13` fails on the expected
assertion and the head `736e54e` passes. Each commit ran in its own worktree, and the checkout
never moved.

What still needed judgment: which of three undocumented defects to fix, whether a stale test
title was worth its own commit, asserting both row orders instead of the one the database
happens to produce, and each finding of the reviews listed below.

**Evidence:**

| What | Where |
| --- | --- |
| Red at the base, green at the head, in separate worktrees, with every job and the cleanup | [`evidence/verify-fix-f3e6e6e.md`](evidence/verify-fix-f3e6e6e.md) |
| The revised `investigate-task` in fresh sessions, on issue #19 and on a free-text request | [`evidence/investigate-task-runs.md`](evidence/investigate-task-runs.md) |
| The first red and green, the proof the assertion did not change, and mocks against real services | [`evidence/failing-then-passing.md`](evidence/failing-then-passing.md) |
| The baseline of every check, the CI run that disagreed with it, and the ignore-file repair | [`evidence/baseline.md`](evidence/baseline.md) |
| The first fresh-session runs of both skills, and what each changed | [`evidence/fresh-runs-2026-09-11.md`](evidence/fresh-runs-2026-09-11.md) |
| Five review passes over this page and the branch, and what each caught | [`evidence/review-passes.md`](evidence/review-passes.md) |
| The measurements and rationale that #16 moved out of the skills | [`evidence/removed-from-skills.md`](evidence/removed-from-skills.md) |

The core figures:

```
npx jest src/auth/auth.service.spec.ts -t 'reports the latest expiry'
  af19d13 (base)   exit=1   Expected "2026-09-20T09:14:00.000Z", received "2026-09-12T09:14:00.000Z"
  736e54e (head)   exit=0   2 passed
git show --numstat --format= f3e6e6e -- src/auth/auth.service.spec.ts   40 0
npm run check:unit    exit=0   681 tests across 39 suites, 679 before the fix
```

The fix is proved against a mock. `auth.service.spec.ts` supplies the rows through
`prisma.refreshToken.findMany.mockResolvedValue`, so the new cases test the grouping loop and not
the query. That is why they supply both row orders. The end to end suite, 294 tests against
Postgres, Valkey and Mailpit, passed before and after the change, but it does not cover this
behaviour.

The review in issue #16 found the defects below, and each one is fixed:

- `investigate-task` pre-approved an unrestricted shell. It now runs in a read-only subagent.
- `verify-fix` depended on `jobs.js`, a scanner that relied on indentation. Shared check scripts
  replaced it.
- `verify-fix` proved red by breaking the working checkout. It now uses a pinned base in a
  worktree, and it treats sabotage as a separate exercise.

**Limitations:**

- The fix is covered by unit tests only. No end to end test exercises a family with two live rows
  whose expiry dates differ.
- `.husky/pre-commit` runs the unit suite, so no commit on the branch can hold the failing test.
  The red state exists only in a worktree at the base, as recorded in the evidence.
- The jobs table in the `verify-fix` evidence was taken at `736e54e`, which predates the check
  scripts, so it reads `Missing script`. CI run 35371898230 ran the scripts at `876fe9d`, and
  all four jobs passed there.
- The Prose job runs Vale 3.19.0 through its action, which keeps the annotations. Locally,
  `check:prose` needs the same Vale version on the path.
- The investigator cannot see gitignored paths, because Glob and Grep honour the ignore files.
  It cannot confirm that `.env`, `node_modules` or `src/generated` exist, and it reports that
  as unresolved.
- `investigate-task` in a fresh session is reported, not proved: nothing in a saved report shows
  that the session had no history. The probes each report quotes can be re-derived.
- Two skills were designed and then dropped. `migration-safety` was cut because an auth fix
  touches no migration. `adr-conformance` was cut because its check passes today: 137 citations
  resolve to 37 files, so the only demonstration available was a sabotage.
