---
name: verify-fix
description: |-
  Prove a fix works. Run one reproduction at the commit before the fix and at the pull request
  head, each in its own worktree, then report every CI job.
  Use to confirm a fix, to reproduce a reported failure, or to prepare a pull request.
argument-hint: <head-sha> <base-sha> <reproduction command>
---

# Verify a fix

Run the same reproduction at two pinned commits: the base, before the fix, and the head, the pull
request. A fix passes this skill when the base fails with the expected assertion and the head
passes. Then report every CI job at the head.

Do not switch, reset or edit the working checkout at any step. Do all the work in worktrees.

`CLAUDE.md` defines **job**. Its Checks section maps each job to its local command.

Each Bash call starts a new shell, so a variable does not survive to the next call. Start each
call with the three assignments from step 2.

## 1. Record the start

```sh
git rev-parse HEAD
git status --porcelain
```

Save both outputs. Step 8 compares against them.

## 2. Pin the two commits

```sh
HEAD_SHA=$(git rev-parse <head>)   # default: the pull request head
BASE=$(git rev-parse <base>)       # default: the parent of the fix commit
D="${TMPDIR:-/tmp}/verify-fix-$(git rev-parse --short "$HEAD_SHA")"
```

`D` is outside the repository, so nothing this skill creates appears in `git status`.

## 3. Create the worktrees

```sh
git worktree add --detach "$D/base" "$BASE"
git worktree add --detach "$D/head" "$HEAD_SHA"
```

## 4. Provision each worktree

`node_modules`, `src/generated` and `.env` are not in version control. For each worktree `W` at
commit `S`, compare the inputs with the checkout:

```sh
git diff --quiet "$S" HEAD -- package-lock.json prisma/schema.prisma ; echo "exit=$?"
```

When that exits 0, reuse what the checkout has:

```sh
ln -s "$PWD/node_modules" "$W/node_modules"
cp -R src/generated "$W/src/generated"
ln -s "$PWD/.env" "$W/.env"
```

When it exits 1, run `npm ci` inside `W`. Then run `npx prisma generate` inside `W`. Then link
`.env` as above. When a local hook blocks a command, ask the user to run it.

## 5. Put the same test in both

When the regression test is new or changed at the head, copy it into the base:

```sh
git show "$HEAD_SHA:<test file>" > "$D/base/<test file>"
```

Change nothing else in the base. Record each file you copied.

## 6. Run the reproduction in both

Run the identical command from each worktree root. Run the base first and the head second. Never
run the two at once: the end to end suites share one test database (ADR 33). Save each output
with its exit status:

```sh
(cd "$D/base" && <command> > "$D/base.log" 2>&1 ; echo "exit=$?" >> "$D/base.log")
(cd "$D/head" && <command> > "$D/head.log" 2>&1 ; echo "exit=$?" >> "$D/head.log")
```

Decide the result from the two logs:

| Base | Head | Result |
| --- | --- | --- |
| fails on the expected assertion | passes | verified |
| passes | any | not reproduced |
| fails for another reason: missing test, setup error, other assertion | any | not reproduced |
| fails on the expected assertion | fails | not fixed |

When the result is not **verified**, skip step 7.

## 7. Report every job at the head

Run each command from the Checks table in `CLAUDE.md` inside `$D/head`, in the table's order.

Report every job as **passed**, **failed**, **unaffected** or **unavailable**, with a reason:

- **unaffected**: `git diff --name-only "$BASE" "$HEAD_SHA"` touches none of the job's inputs.
- **unavailable**: the job needs a service or credential that this machine does not have. Name it.

When a script is missing at the head, the head is older than the script. Report the job as
unavailable at that commit, and name the commit.

## 8. Clean up

Copy what the output needs out of `base.log` and `head.log`. Then remove everything:

```sh
git worktree remove --force "$D/base"
git worktree remove --force "$D/head"
rm -r "$D"
git rev-parse HEAD
git status --porcelain
git worktree list
```

`HEAD` and the status must match step 1. Neither worktree may remain in the list.

## Output

- **Reproduction**: the base SHA, the head SHA, the files copied into the base, the command, and
  for each commit its `exit=` line and the assertion it printed. Then the result from step 6.
- **Jobs**: one row for each job in step 7, with its status, command, `exit=` line and reason.
- **Cleanup**: the output of step 8.

## Check sensitivity

This is a separate exercise. It proves that a check can fail. It does not prove that a fix works.

1. Create a worktree as in steps 2 to 4.
2. Break the code that the check covers, inside that worktree. Aim the break at the function the
   check names.
3. Run the check. Expect a failure that names the broken behaviour.
4. Remove the worktree as in step 8.

Never break the working checkout.

## Constraints in this repository

- `npm run lint` carries `--fix` and rewrites files. `check:unit` runs `lint:ci`, which only
  checks.
- The shell is zsh, and a pipe reports the status of its last command. Record `exit=` from a
  command without a pipe.
- `check:db` needs the three containers from `npm run docker:up`. Without them it fails for a
  reason that reads like a code defect. Report the job as unavailable.
- `.husky/pre-push` runs the end to end suite, so a red suite blocks `git push`.
