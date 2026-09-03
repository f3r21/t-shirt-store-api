# 6. Three authentication states, not two

Status: accepted
Date: 2026-08-28

## Context

Seven operations are public in the contract, two accept a token without requiring one, and
the rest require it. A public route returns before any token work, so a manager who sends a
token on it is invisible to the handler.

## Options

- `@Public()`, `@OptionalAuth()`, and a global guard for the rest (chosen).
- Two states: the optional case cannot be expressed.
- Guards per controller: a forgotten guard opens a route.

## Decision

The guard is global. An optional route tolerates a missing token and still rejects a broken
one.

## Consequences

**Gives up:** every public operation needs a marker, and a missing one answers 401. That
failure is loud and a test catches it, which is the safe direction.
