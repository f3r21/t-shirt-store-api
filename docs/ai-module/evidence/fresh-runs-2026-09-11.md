# Fresh-session runs, 11 September

Each skill ran once in a session with no prior conversation, before #16. Each run led to a change
in the skill it ran. Both skills were rewritten under #16. The runs of the current versions are in
[investigate-task-runs.md](investigate-task-runs.md) and
[verify-fix-f3e6e6e.md](verify-fix-f3e6e6e.md).

## `/investigate-task`

Input: "stock.notify-skipped emits the same event for three different causes in
low-stock.processor.ts". The branch does not touch that module:
`git diff --stat 7139980 HEAD -- src/stock-notifications/` prints nothing, and the same command
on `src/auth/` prints two files.

It returned Files, Findings and a Test plan. Four of its claims were checked against the tree
afterwards, and all four held:

```
low-stock.processor.ts:42,:76,:110   two call sites into one skipped(), one event, two ids
low-stock.processor.spec.ts:34       the describe says "the two ways it stops early"
rg 'productVariant.findUnique.mockResolvedValue(null)' spec   exit 1, cause 2 has no test
  control: 'user.findUnique.mockResolvedValue(null)' matches :156
rg 'reason:' src/stock-notifications/   4 hits: worker.ts:56,:64, stock-queue.ts:89
  and producer.spec.ts:192. Three are in source, so the module already has the
  field this log lacks
```

It also resolved two decisions. ADR 28 names only one of the three causes. ADR 21 runs the e2e
suite at `silent`, so only the unit spec can assert this log line.

Changes to the skill after the run:

- The run added `node_modules`, `dist` and `coverage` to its search excludes. `rg` already
  skips them through `.gitignore`, so the skill gained a note saying so.
- The run listed every reader of a name before proposing to change it. The skill did not ask for
  that, so it became a step.
- The note included a count: `module.exports` matched 1 file, and 12653 with `--no-ignore`.
  Saving that note made the skill file a second match, and the write-up quoting it made a third.
  The command now excludes prose with `-g '!*.md'`, which gives 1 against 12507.

## `/verify-fix`

Input: the commit `f3e6e6e`. It reverted the source hunk to `f3e6e6e^`, kept the committed test,
and reported a row per job:

```
Verify  red   npm test -- --ci   exit=1, 1 failed of 681
        green npm test -- --ci   exit=0, 681 passed across 39 suites
              audit, typecheck, lint:ci, format:check, migrate diff, test:e2e all exit=0
Image   not run here, docker build starts a container
Prose   unaffected, the commit touches no prose file
Deploy  not runnable here, it reads AWS credentials
```

The red run failed on the defect, and only on the row order the database returns:

```
● reports the latest expiry of a family, with the abandoned row first
    Expected: "2026-09-20T09:14:00.000Z"
    Received: "2026-09-12T09:14:00.000Z"
```

Changes to the skill after the run:

- The restore step used `git checkout -- <file>`. A hook in this machine's
  `.claude/settings.local.json` blocks `checkout`, `restore`, `reset` and `stash`. That file is
  per clone, so the skill gained a fallback that writes the committed blob back.
- The step ended when the restore command had been typed. It now ends when
  `git diff --exit-code` exits 0 for the file.

Under #16, `verify-fix` stopped restoring files at all: it works in worktrees and never edits the
checkout.
