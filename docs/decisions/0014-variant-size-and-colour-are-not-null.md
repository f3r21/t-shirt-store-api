# 14. A variant's size and colour are NOT NULL with an empty-string default

Status: accepted
Date: 2026-08-28

## Context

The contract promises 409 for a duplicate size and colour pair on one product, and both
fields are optional. PostgreSQL treats two NULLs in a unique index as distinct, so two
variants with no size and no colour would both insert. `NULLS NOT DISTINCT` exists in
PostgreSQL 16, and Prisma 7.10 cannot express it, so `migrate dev` would drop a hand-written
index.

## Options

- The empty string as the stored form, with the unique index in the schema (chosen).
- Two columns that admit NULL, with a pre-read: two concurrent creates both pass the read.
- A hand-written `NULLS NOT DISTINCT` index: outside the schema language.

## Decision

The unique index is the arbiter. `variant.mapper.ts` turns the empty string back into absence
in the response.

## Consequences

**Gives up:** the storage spelling and the wire spelling differ, in one place.
