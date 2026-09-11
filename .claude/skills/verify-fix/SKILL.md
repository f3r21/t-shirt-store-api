---
name: verify-fix
description: |-
  Prove a change works. Run this repository's checks, report each CI job separately, and show the
  same check red before the change and green after it.
  Use to confirm a fix, to reproduce a reported failure, to prove a check has teeth, or to prepare
  a pull request.
---

# Verify a fix

Move the change from red to green. Report a result for every CI job.

**Input:** a bug report, a diff or pull request, or a check you want to prove has teeth.

**Output:** one row for each job, with a red column and a green column. Each cell carries the
command that produced it and its exit status.

`CLAUDE.md` defines **control**, **ADR** and **job**. This skill adds four words:

- **red**: the check fails, and the failure is the one you expect.
- **green**: the check passes.
- **teeth**: the check goes red when the code it covers is wrong. A check that stays green in
  both states proves nothing.
- **sabotage**: a deliberate break, applied to make a check go red on purpose.

## 1. Record the state you start in

```sh
git status --porcelain
git log --oneline -1
```

Step 5 restores a file by name, and a restore discards every uncommitted change in that file.

**Done when** the files you will touch are committed. When a file holds uncommitted work, name
that file and stop.

## 2. Read the jobs from CI

No command in this repository runs every check. CI is the list, and CI holds more than one job.

```sh
ls .github/workflows/                                              # one file today
node .claude/skills/verify-fix/jobs.js .github/workflows/ci.yml
```

List the directory first. A second workflow file carries checks this step would otherwise miss.

The script ships beside this file and reads the workflow with node alone. `js-yaml` resolves in
this repository only because a dependency hoists it, so a parser built on it would break at the
next dependency bump and take this step with it.

It reports `uses` steps as well as `run` steps. A check can arrive as an action: the Prose job
runs Vale that way, and a list of `run` steps alone misses the check that job exists for. For
each such step, find the local command in `package.json` that does the same work.

Classify each job before you run anything, and give every job a row. A step that calls `aws`,
pushes an image, or reads `${{ secrets`, does not run on this machine. A job whose inputs the
change does not touch is unaffected rather than passing. Write the reason in the row. A job with
no row reads as a job that passed.

Keep the order CI uses. A type error causes later failures that are not defects of their own.

**Done when** every job in the file appears in your plan, and each one is marked as runnable here
or not runnable here, with the reason.

## 3. Go red

Reproduce the failure before you fix it. A fix for a failure you did not see is a guess.

**Route A, a reported failure.** Run the steps in the report. Record the command, the output and
the exit status.

**Route B, a sabotage.** Break the code the check covers. Aim the sabotage at the function the
check names: a break in `createPaymentIntent` does not fail a check about `createPaymentLink`,
the check stays green, and you get no proof.

**Done when** you have a red result, and the failure message names the behaviour you expected to
break.

## 4. Go green

Apply or confirm the fix. Run the same commands from step 2 again.

The assertion must be identical in the red run and the green run:

```sh
git diff -- <the test file>    # empty, so the assertion is the one that failed
```

**Done when** every job has a green result, and the command above prints nothing.

When the assertion differs between the two runs, the result proves nothing. Report that and stop.

## 5. Restore

Prove the restore. Do not assume the command ran: a restore that was refused looks exactly like
one that succeeded until something else reads the file.

```sh
git checkout -- <the file you broke>
git diff --exit-code -- <the file you broke>   # exit 0, so the file is back
git status --porcelain                         # matches what step 1 recorded
```

Name the file. `git checkout -- .` discards every other change in the tree as well.

A machine can refuse the first line. This repository's local settings carry a hook that blocks
`checkout`, `restore`, `reset` and `stash` because they change state, and that file is per clone
and gitignored, so another clone may not have it. Write the committed blob back instead, and
prove it the same way:

```sh
git show <sha>:<path> > <path>
git diff --exit-code -- <path>                 # exit 0
```

**Done when** `git diff --exit-code` on each file you touched exits 0, and `git status
--porcelain` prints what step 1 printed.

## Read the exit status, not the tail

The shell here is zsh, and a pipe reports the status of its last command. The first line below
prints 0 for a passing check and for a failing one:

```sh
npm run lint:ci 2>&1 | tail -6
npm run lint:ci 2>&1 | tail -6 ; echo "exit=$pipestatus[1]"   # zsh
npm run lint:ci > /tmp/out.log 2>&1 ; echo "exit=$?"          # no pipe, so no trap
```

Report the `exit=` line beside every figure.

## Three more traps in this repository

- `npm run lint` carries `--fix` and rewrites files. Run `npm run lint:ci` to check.
- Three steps of the Verify job need the containers, and step 2 names them:
  `npx prisma migrate deploy`, `npx prisma migrate diff`, and `npm run test:e2e`. Count them
  rather than trusting this line, because a new step can join them:
  `node .claude/skills/verify-fix/jobs.js .github/workflows/ci.yml`. Start the containers with
  `npm run docker:up`. Without them these steps fail for a reason that reads like a code defect.
- A push runs the end to end suite through `.husky/pre-push`. A red end to end suite blocks
  `git push`, so verify before you push, not after.

## Done when

Every job carries a result in the red state and in the green state, or a stated reason it does
not run here. Each result carries its command and its `exit=` line. `git status --porcelain`
matches step 1.
