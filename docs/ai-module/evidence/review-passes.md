# Review passes before #16

Five reviews ran over the branch and the write-up before `736e54e`. The checks passed on every
pass. Every finding was in the evidence or the prose, none in the code. The `jobs.js` scanner and
the skill wording mentioned below were replaced under #16.

## Pass 1: `code-review`, Spec axis, against `main`

- Ticket 9 was closed against a different probe from the one its criterion names. The criterion
  is `rg -c 'docker compose' CLAUDE.md`, which returned nothing at the time. The closing comment
  reported `docker:up 1`, and did not say that the probe had changed.
- Fix: `CLAUDE.md` gained the missing fact, that `docker:up` runs `docker compose` over
  `docker-compose.yml`. The ticket was reopened with the substitution recorded. The criterion
  now returns `1`.

## Pass 2: `code-review`, Standards axis

- `jobs.js` matched indentation instead of parsing YAML. A workflow indented differently produced
  no lines for a job, which looked the same as a job with no steps.
- Fix: every run ended on a count. A missing file exited 2. A `jobs:` key with no job matched
  exited 1 and named the expected indentation. A file with no `jobs:` key exited 1.

## Pass 3: figures only, after the push

- `verify-fix` said four `Verify` steps need the containers and named three. There are three,
  and the line gained the command that counts them.
- The write-up quoted the CI run in [baseline.md](baseline.md) as four rows. The command prints
  five.
- One sentence began in lower case.

## Pass 4: the write-up against the brief and the template

Nine findings, eight of them omissions. Five came from the first reading:

- The Improvement field did not say that this improvement was chosen here, when the brief offers
  a mentor's suggestion or an agreed alternative.
- The Evidence field did not separate mocks from real services.
- Three field names had drifted from the template.
- There was no note that neither skill needs setup.
- One paragraph argued for `verify-fix` in general without saying what it did for this fix.

Four came from a second reading after those repairs:

- Two came from the repairs themselves. The mentor sentence named a rule with two routes and
  answered neither. The paragraph that tied `verify-fix` to this fix described the fresh-session
  run again, so one run read as two.
- A pre-commit command was quoted as `npm test --bail` for `npm test -- --bail --silent`.
- Nothing said that both skills are new files, which the brief asks for.

## Pass 5: a reviewer with no history of the branch

The reviewer re-derived every figure, path, line number and command on the page. Seven findings:

- The Notes field said `CLAUDE.md` lists no npm scripts. At the time,
  `rg -c 'npm run [a-z:]+' CLAUDE.md` returned 5.
- The proof that no test was weakened read `git diff --numstat` from the working tree. It printed
  `40 0` before the commit and nothing after it. It now reads the commit.
- The ticket 9 criterion was quoted as returning nothing, but it returned `1` after the repair
  from pass 1.
- In the `investigate-task` transcript: two line numbers were off by one, a private method was
  counted as a call site, and one probe quoted three of its four hits.
- A measurement in the skill file was wrong when written, because writing the pattern made the
  file a match for it.
