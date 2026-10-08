# 38. The served Swagger lists each operation's own problems, narrower than the contract's per-status examples

Status: accepted
Date: 2026-10-07

## Context

A front-end developer builds against the Swagger page this service serves at `/docs`. Before
this record, every failure there pointed at one generic `Problem` schema, so the page did not
say which problems an operation returns. The contract lists examples, but per status: each status has one shared
response. So every 409 shows `email-taken`, `insufficient-stock` and `order-not-cancellable`,
and POST /promo-codes shows "Email already registered" even though only sign-up returns it.

The evidence is one back interview, with P3, so it is low data (spec #34). P3 integrated the
API from the served page alone. A precise title was the one thing that told him what had
happened. His wish for specific errors came after a question about his team, so it is a stated
wish, not seen behaviour.

The contract does not change (spec #34). So the list for each operation has to live in the
served document, and the open question is where its source sits.

## Options

- **Copy the contract's shared examples** into the served document. Little code, and every
  example is the contract's own text. It repeats the lists per status, so POST /promo-codes
  still shows `email-taken`, which is the fault spec #34 names.
- **Decorators in each controller**: an `@ApiResponse` with `examples` beside each handler. The
  list sits next to the code, but the shared problems repeat at every handler. The expired
  access token alone is on 34 operations. A decorator that sets the body also stops the
  builder from attaching the `Problem` schema, so each one restates the schema too.
- **One map in the builder** (chosen). `src/openapi/operation-problems.ts` lists, by
  `operationId` and then by status, the problems each operation returns.
  `describeFailuresAsProblems` in `src/openapi/document.ts` reads it where it already attaches
  the `Problem` schema. The controllers do not change.

## Decision

**The served document lists, for each operation and status, the problems that operation
returns.** Each entry carries the problem type when it has one, the title and an example
detail. The served document is narrower than the contract by design: it is per operation, and
the contract stays per status.

**Every entry is traced to the code that throws it.** A problem with no traced throw site is
not listed. A typed problem carries the title its throw site sets. A problem with no type
carries its status's title from the table in ADR 11, and its detail tells it apart. Where the
code differs from the table or from the contract, the map lists what the code sends. For
example, the image upload sends a 400 titled "Bad request" for a request with no file. Every
other 400 carries "Validation failed" from the table.

## Consequences

**The contract does not change.** `contract/openapi.yaml` keeps one set of examples per status.
A reader of the contract still sees `email-taken` on every 409. The served `/docs` is the view
per operation.

**A guard keeps the two in step.** `test/openapi-contract.e2e-spec.ts` reads `/docs-json`. It
fails when an operation lists, at a status, a problem type that the contract does not list for
that status. The check is a subset, not an equality, because the contract shares its examples
across every operation with that status.

**A new throw site has one place to be documented:** the map, not each controller whose
operation reaches it.

**Gives up:** the map can drift from the code at a throw site the guard cannot see. The guard
checks types only. A wrong title, a stale detail, any problem with no type, and a throw site
the map does not list all pass it. The map also sits far from the services it describes, so a
change to a throw site gives no hint that the map needs the same change. **The switch:** when
an entry is found stale, an e2e test for each entry that triggers its throw site and compares
the body with the entry.
