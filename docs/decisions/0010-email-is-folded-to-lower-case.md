# 10. Email is folded to lower case, in full

Status: accepted
Date: 2026-08-28

## Context

The column was plain text behind a case-sensitive unique index, so `ana@example.com` and
`ana@EXAMPLE.com` registered as two accounts. RFC 5321 leaves the local part case-sensitive,
and no mail provider a customer uses treats `Ana@` and `ana@` as two people.

## Options

- A `citext` column plus a normaliser (chosen).
- A `lower(email)` expression index: the schema cannot state it, and `migrate dev` has dropped
  hand-written indexes it meets in the shadow database (`prisma/prisma#29289`).
- Normalise in code only: any other writer can still store a second capitalisation.

## Decision

Migration `20260902013632_email_citext` makes the column `citext` and installs the extension
with one line. `migrate diff --exit-code`, which CI runs, sees the native type. The normaliser
stays, because `citext` does not trim, and one stored form keeps the mailed address and every
lookup the same string.

## Consequences

**Gives up:** every comparison on the column is case-insensitive, `ORDER BY` included. Nothing
else is `citext`.
