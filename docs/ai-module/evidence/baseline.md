# Baseline and setup

Moved unchanged from the write-up as it stood at `736e54e`. It describes the branch before the issue #16 changes, so the `jobs.js` scanner and the older skill wording it mentions no longer exist.

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
