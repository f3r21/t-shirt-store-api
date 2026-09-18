# What the review caught

Moved unchanged from the write-up as it stood at `736e54e`. It describes the branch before the issue #16 changes, so the `jobs.js` scanner and the older skill wording it mentions no longer exist.

_What the review caught._ `code-review` ran over the branch diff against `main` on two axes
before the pull request was opened, and the Spec axis found that ticket 9 had been closed against
a probe it did not satisfy. The acceptance criterion reads `rg -c 'docker compose' CLAUDE.md`.
That returned nothing at the time, and returns `1` today, because of the repair described two
paragraphs down. The closing comment reported `docker:up 1` instead, a different probe,
chosen after the fact because it gave the answer the close wanted, with no note that the
substitution had happened.

This is the defect the whole branch is built around, committed by the author while closing the
ticket that verifies the work. Neither skill caught it, because neither was pointed at it: a
check runner proves the code, and nothing here was checking the evidence. What caught it was a
second pass with a different brief and no stake in the first answer.

Both halves were repaired rather than the criterion rewritten to match the file. `CLAUDE.md`
gained the fact it was actually missing, that `docker:up` runs `docker compose` over
`docker-compose.yml`, which is where a service, a port or an image tag changes, and the ticket
was reopened with the substitution recorded rather than quietly re-closed.

The Standards axis found the same shape in `jobs.js`. It matches indentation instead of parsing
YAML, so a workflow written differently produced no lines for a job, which reads exactly like a
job with no steps. A tool built to turn silent failures into loud ones was failing silently. It
now ends every run on a count, and a zero names its own cause: a missing file exits 2, a `jobs:`
key with no job matched exits 1 and names the indentation it expects, and a file with no `jobs:`
key exits 1 and says it is not a workflow.

A third pass, run after the branch was pushed and aimed only at the figures, found three more.
`verify-fix` claimed four steps of `Verify` need the containers and named three; there are three,
and the line now carries the command that counts them. This page quoted the CI run in [baseline.md](baseline.md) as four
rows when the command prints five, the same substitution as ticket 9 and caught the same way, by
running the command rather than reading the sentence. The third was a sentence that began in
lower case.

A fourth pass read this page against the assignment and the supplied template instead of against
the code, and found nine defects, all but one of them an omission. Two matter. The brief offers a
mentor's suggestion or an agreed alternative of the same size and this improvement was chosen
here, which the Improvement field now says. The template's Evidence field asks for mocks to be
told apart from real services, which nothing here did, although that distinction decides what the
fix is actually proved against. Three more were three field names that had drifted from the
template, a missing note that neither skill needs any setup, and a paragraph arguing for
`verify-fix` in general without saying what it did for this fix.

The remaining four came from reading the page a second time after those repairs, and two of them
were made by the repairs. The mentor sentence quoted a rule with two routes and answered neither.
The paragraph written to tie `verify-fix` to this fix described the fresh-session run again with
no pointer to it, so one run read as two. The two the first reading had simply missed were a
pre-commit command quoted without the separator that makes it work, `npm test --bail` for
`npm test -- --bail --silent`, and the fact that both skills are new files, which the brief asks
to be identified and which nothing here stated. A pass that repairs its own findings needs a
second reading for the same reason the first one was needed.

A fifth pass was the first one this author did not perform. An agent with no history of this
branch was given the brief, the template and the repository, told to re-derive every figure, path,
line number and command on this page, and told explicitly not to assume the prior work was
correct. It found seven more, and they are the most useful findings in this section, because they
are the ones a self-review structurally cannot produce.

The worst is a sentence about `CLAUDE.md` that `CLAUDE.md` contradicts. The Notes field argued
that a document earns nothing by restating what one command answers, and offered as proof that
`CLAUDE.md` therefore lists no npm scripts. It lists five: `rg -c 'npm run [a-z:]+' CLAUDE.md`
returns 5. The principle is sound and the file follows it; the evidence offered for it was simply
false, and it had survived four readings by the person who wrote it.

Two more had rotted rather than started wrong. The proof that no test was weakened was
`git diff --numstat -- src/auth/auth.service.spec.ts`, which reported `40 0` from an uncommitted
tree and reports nothing at all now that the work is committed. It is now spelled against the
commit. And the ticket 9 criterion, quoted here as returning nothing, returns `1` today because
this branch repaired the file ten lines further down, so the sentence falsified itself.

The rest were figures inside the `investigate-task` transcript: two line numbers off by one and a
private method counted as a call site, one probe quoting three of its four hits, and a measurement
in the skill file that was wrong the moment it was written down, because writing the pattern down
made the file a match for it.

The pattern across all five passes is one thing: every defect was in the evidence, not in the
code. The checks were green each time. Four of the passes were the author re-reading the author,
and each found real defects, but the fifth found a claim contradicted by a file in the same
commit, which is the class of error a reader who already believes the sentence does not see.
