# 11. Problem titles come from a table, never from the exception message

Status: accepted
Date: 2026-08-28

## Context

Nest fills `err.message` with request-derived text: a request for an unknown route would answer
`Cannot GET /v1/nope` as its title, and a malformed body would echo what was posted. RFC 9457
requires a title that does not change between occurrences.

## Options

- A table transcribed from the contract's response examples (chosen).
- The exception message: request text in the title.

## Decision

`toProblem` reads `err.getResponse()` and falls back to the table. The message is logged,
never returned. The validation factory emits one entry per rejected field, as the contract
says, so a caller cannot count decorators from three entries named `password`.

## Consequences

**Gives up:** a new status needs a table row, or its title is generic.
