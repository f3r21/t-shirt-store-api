# Fresh-session runs, 11 September

Moved unchanged from the write-up as it stood at `736e54e`. It describes the branch before the issue #16 changes, so the `jobs.js` scanner and the older skill wording it mentions no longer exist.

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
