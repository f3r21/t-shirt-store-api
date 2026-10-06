# Measurements and rationale removed from the skills

Issue #16 asked for the historical measurements and the implementation rationale to leave the
skill files and live with the evidence. The text below is quoted unchanged from `736e54e`.

## Issue 8 and the full issue view

From `.claude/skills/investigate-task/SKILL.md`, step 1:

> One command returns both parts. `gh issue view <n>` prints the body and drops the comments.
> Measured here: issue 8 carries three comments and the plain view shows none of them.

The skill now receives the issue from `fetch-issue.sh`, which asks `gh issue view --json` for
the comments by name.

## Search counts at `15ab926`

From `.claude/skills/investigate-task/SKILL.md`, step 2:

> It does not switch off `.gitignore`, so `node_modules`, `dist` and `coverage` stay out without
> naming them, and naming them changes nothing. `--no-ignore` is what floods a search. Measure it
> with prose excluded, because a document that quotes a pattern becomes a match for it and moves the
> count you are reading:
> 
> ```sh
> rg -l --hidden -g '!.git/' -g '!*.md' '<pattern>' . | wc -l
> ```
> 
> Measured that way on `15ab926`, `module.exports` matches 1 file, and 12507 with `--no-ignore`
> added. Re-run both before you quote either. The second moves with every dependency change.

The skill now searches with Grep, and keeps two rules from this text: prose is excluded from
source counts, and ignore files are honoured.

## Why `jobs.js` avoided `js-yaml`

From the write-up's Reused tooling note:

> _Reused tooling._ Neither skill adds a dependency. `verify-fix` ships one supporting file,
> `jobs.js`, which parses `.github/workflows/ci.yml` with node alone. The first draft used
> `require('js-yaml')` and worked on the first run, which is exactly the problem: `js-yaml` is not
> declared in `package.json` and resolves only because `@nestjs/swagger` and `eslint` hoist it, so
> the single executable step of the skill would have disappeared at the next dependency bump. The
> dependency-free scan was checked against the `js-yaml` parse and agrees on all four jobs.

`jobs.js` is deleted. `verify-fix` now runs the `check:*` scripts that CI runs, so it parses no
workflow file.
