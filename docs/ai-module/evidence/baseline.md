# Baseline and setup

Recorded before any change on the branch. `jobs.js`, mentioned below, was deleted under #16.

## The requirement this closes

The assignment requires a skill that runs an executable check. Before this branch, no skill did.
These commands read the tracked tree, so they reproduce from a fresh clone:

```sh
$ git grep -l 'npm run typecheck\|npm test\|lint:ci' HEAD -- '.claude/skills/*/SKILL.md'
HEAD:.claude/skills/verify-fix/SKILL.md

$ git grep -l 'npm run typecheck\|npm test\|lint:ci' 7139980 -- '.claude/skills/*/SKILL.md'
$ echo $?
1

# control: the same pattern at the same commit, against a file that matches
$ git grep -l 'lint:ci' 7139980 -- '.github/workflows/ci.yml'
7139980:.github/workflows/ci.yml
```

## The ignore file

`.git/info/exclude` excluded all of `.claude/`, so no skill file could be staged. That file is
per clone, so no commit can change it. The exclusion was narrowed one directory level at a time,
because git cannot re-include a file whose parent directory is excluded. The new rules were tested
first in a scratch repository with the same layout and symlinks. Under `.claude/skills/`, they open
only the two authored skills:

```sh
$ git check-ignore -q .claude/skills/verify-fix/SKILL.md ; echo $?
1
$ git check-ignore -q .claude/skills/prisma-cli ; echo $?
0
$ git check-ignore -q .claude/settings.local.json ; echo $?
0
```

The second probe names the symlink itself. For a path through a symlink, `git check-ignore`
exits 128, and the four vendored Prisma skills are symlinks into `.agents/skills/`.

## Baseline checks

Each check ran as its own command without a pipe, so each `exit=` is the check's own status:

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

CI failed the same check on the same commit:

```sh
$ gh run view 34612434335 --json jobs --jq '.jobs[] | "\(.name)  \(.conclusion)"'
Verify  success
Prose  failure
Image  success
vale  neutral
Deploy  success
```

The command prints five rows for four jobs. `vale` is a check run that `vale-cli/vale-action`
creates inside `Prose` with `reporter: github-check`.

`ARCHITECTURE.md` measured 648 words at the parent commit, and naming both non-additive
migrations took it to 669. Commit `ebbffe3` brought it back under the ceiling, separately from
the improvement.
