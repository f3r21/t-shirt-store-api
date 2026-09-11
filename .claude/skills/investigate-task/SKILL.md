---
name: investigate-task
description: |-
  Find the code and the tests behind a request, and report where a change belongs. Reads only.
  Use for an issue number, a bug report, a proposed change, or a failing test you did not write,
  and use it before anyone edits a file.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Investigate a task

Find the code. Find its tests. Report both, and report how to prove a change works.

This skill reads. The person who receives the report decides what to change.

**Input:** an issue number, a bug report, or a proposed change.

**Output:** three sections. Files, Findings, Test plan.

`CLAUDE.md` defines **control**, **ADR** and **job**, and this skill uses those words with those
meanings. Give every empty result a control, in every step below.

## 1. Read the whole request

```sh
gh issue view <n> --json body,comments
```

One command returns both parts. `gh issue view <n>` prints the body and drops the comments.
Measured here: issue 8 carries three comments and the plain view shows none of them.

**Done when** you can state the request in one sentence, and you have read every comment on it.

## 2. Find the code

```sh
rg -n --hidden -g '!.git/' '<pattern>' .
```

`--hidden` reaches `.claude/`, `.github/` and `.vale/`. Plain `rg` skips them and reports zero.

Start from the layout:

- One directory for each NestJS module under `src/`. A module holds its controller, its service,
  its DTOs and its specs together.
- Prisma is the data layer. `prisma/schema.prisma` names every column, and the comments beside
  the columns carry the reasons.
- `test/` holds the end to end suite. `contract/openapi.yaml` holds the published API.

**Done when** every file you will report carries a line number.

## 3. Resolve the decisions

```sh
rg -o --hidden 'ADR [0-9]+|DECISIONS [0-9]+' <the files you found>
ls docs/decisions/
```

Read each ADR that the code beside your finding cites. An ADR states a rule the code follows, so
a change that breaks the rule needs the ADR changed first. Report that as part of the finding.

**Done when** every citation in the code you report resolves to a file, and you have read each
one.

## 4. Find the tests

A unit spec sits beside its source as `*.spec.ts` and mocks Prisma, so it needs no database. Run
one file, or one test by name:

```sh
npx jest src/auth/auth.service.spec.ts
npx jest -t 'the name of the test'
```

An end to end spec sits in `test/` as `*.e2e-spec.ts`. It uses `test/jest-e2e.json` and it needs
the three containers.

Read the comment beside every line you report. Comments here carry the reason for the code. A
comment that describes behaviour your change alters is part of the change, so name that comment.

**Done when** each behaviour you report is marked covered or uncovered, and each uncovered one
names the file that would hold its test.

## 5. Report

**Files.** Each entry is `path:line`, with one sentence on what that line does.

**Findings.** Each finding cites a `path:line` from Files, or the command that produced it. State
what is true of the code now.

**Test plan.** Each entry names the file that holds the test, the behaviour it asserts, and the
command that runs it. Mark every entry that needs the containers.

**Done when** every file carries a line number, every finding carries a citation, every zero
carries the command that proves the pattern fires, and every test names its file and its command.
