---
name: investigate-task
description: |-
  Find the code and the tests behind a request, and report where a change belongs. Reads only.
  Use for an issue number, a bug report, a proposed change, or a failing test you did not write,
  and use it before anyone edits a file.
argument-hint: <issue-number | "description">
arguments: [issue]
context: fork
agent: investigator
background: false
allowed-tools: Bash(.claude/skills/investigate-task/fetch-issue.sh *)
---

# Investigate a task

Report the code, the decisions and the tests behind the request below. Do not edit a file and do
not run a test.

`CLAUDE.md` defines **control**, **ADR** and **job**, and its Layout and Tests sections describe
where code and tests live. Read those sections first.

## The request

Arguments: `$ARGUMENTS`

The issue, when the first argument is an issue number:

!`.claude/skills/investigate-task/fetch-issue.sh "$issue"`

If the line above reads `NO INPUT`, reply with one line that asks for an issue number or a
description, and stop.

## 1. State the request

Read the issue body and every comment, or the arguments when no issue was fetched. State the
request in one sentence.

## 2. Find the code

Search with Grep. Rules for scope:

- Hidden directories (`.claude/`, `.github/`, `.vale/`) hold configuration. When the request can
  touch configuration, search each one by path.
- Grep honours `.git/info/exclude`, which hides `.claude/` from a directory search. List the
  files under `.claude/agents/` and `.claude/skills/` with Glob, and Grep each file by its path.
- `.claude/worktrees/` holds other checkouts of this repository. Leave its matches out of the
  report.
- When you count source matches, exclude prose with the glob `!*.md`. A document that quotes a
  pattern is a match for it.
- For every empty search, run a control in the same scope, and report both results.

Record each file you will report with its line number.

## 3. Resolve the decisions

Grep the files from step 2 for `ADR [0-9]+|DECISIONS [0-9]+`. Find each cited file under
`docs/decisions/` with Glob. Read only the sections that bear on your finding or on the proposed
change. When the change breaks a rule an ADR states, report the ADR as part of the change.

## 4. Find the consumers

For each name the proposal would change (a log event, a response field, an exported symbol),
Grep the literal across the repository, hidden directories included. List every reader. Mark each
reader that is an alert, a metric filter, a contract file or a test.

## 5. Plan the tests

Find the unit spec beside each source file and the end to end specs in `test/`. For each
behaviour you report, name the test file, the command that runs it, and the services it needs.
Mark each behaviour that no test covers, and name the file that would hold its test.

Read the comment beside each line you report. Name each comment that the change would make
false.

## 6. Report

Read `${CLAUDE_SKILL_DIR}/report-template.md` and fill it. Every file entry carries a line
number. Every empty result carries its control.
