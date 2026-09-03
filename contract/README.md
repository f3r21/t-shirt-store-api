# The contract

`openapi.yaml` is the contract this service implements. Where the code and this document
disagree, this document is right and the code is wrong.

It was authored as the Week 2 deliverable in `f3r21/BE-Nerdery-Challenges`, under
`5-api-design/`, and copied here at `aedfe45`. That repository keeps its copy as submitted.
This one is the living contract: every amendment the implementation forces, such as the
sign-in 429 added on 2026-08-28, is made here.

It lives in this repository because a test that reaches outside its own repository passes on
the machine that has both checked out and fails everywhere else, which is what happened.
`test/openapi-contract.e2e-spec.ts` reads this file and fails when the generated document
drifts from it.

The design record behind the contract, its own `DECISIONS.md` and `REVIEW.md`, stays in the
Week 2 repository. This service does not read them.

Lint it with the command in its header.
