# Coding standards

A reviewer reads this file for each diff. Each rule is a judgement that no tool makes, and each
one carries its reason.

## A participant is an id

Refer to an interview participant by id alone, such as P3: no name and no pronoun. This
repository holds only de-identified results, and a pronoun alone can narrow down who a person is
("Privacy" in `docs/research/friction-log.md`).

## A decision is cited as ADR n

Where code or docs restate the reason for a decision, cite it as `ADR n`, where n is the number
of its file in `docs/decisions/`. Resolve the citation to that file before you change the code
beside it. A comment carries the gist, and the record carries the context and the options it
weighed, so a change made from the comment alone can undo the decision without anyone seeing it.
Older comments write `DECISIONS n` for the same file.

## An issue number marks a kept defect

Put an issue number in a `src/` or `test/` comment only for a tracked defect that the code keeps on
purpose. Write it as `(#n)`, so `rg -n '\(#[0-9]+\)' src test` lists every one. The number tells a
reader the odd behaviour is known and where its fix is tracked, and the comment goes when the fix
lands. Any other link between code and an issue belongs in the commit message or the pull request.

## The contract is right

Where the code and `contract/openapi.yaml` disagree, the contract is right and the code is the
defect. An issue tracks the defect, and until the fix lands the docs show what the code sends, as
`src/openapi/operation-problems.ts` does for `#43`. Clients build against the contract, so the
code moves to meet it. A reader of the docs calls the code that runs today, so the docs describe
that code.

## Docs use short, plain sentences

Write docs in plain English and short sentences, one idea to a sentence. The readers are
non-native speakers.

## An empty result has a control

Give every check that can come back empty a control, as the "Words this file uses" section of
`CLAUDE.md` defines it. An empty result looks the same when nothing is there and when the check
read nothing. `scripts/check-quoted-tests.mjs` shows the pattern: it fails when a doc yields fewer
quoted titles than its floor.
