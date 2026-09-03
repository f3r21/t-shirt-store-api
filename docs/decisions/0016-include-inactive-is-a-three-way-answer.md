# 16. `includeInactive` is a three-way answer, not a boolean

Status: accepted
Date: 2026-08-28

## Context

The server cannot know whether an anonymous caller is a manager until they say who they are.

## Options

- 401 for anonymous, 403 for a client, allowed for a manager (chosen).
- 403 for both: hides the identity step.

## Decision

Refusing for lack of identity comes before refusing for lack of permission. This is why
`@OptionalAuth()` exists beside `@Public()`: a public route would make a manager's token
invisible.

## Consequences

**Gives up:** one more decorator to remember on the catalog reads.
