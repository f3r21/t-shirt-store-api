# 5. No Passport

Status: accepted
Date: 2026-08-28

## Context

The contract's 401 carries three problem types. A client that cannot tell
`access-token-expired` from `invalid-credentials` loops between refreshing and the sign-in
screen. The assigned NestJS chapter builds its JWT flow without Passport.

## Options

- A plain `CanActivate` over `JwtService` (chosen).
- `@nestjs/passport` with `passport-jwt`: `AuthGuard('jwt')` throws one generic exception and
  needs a subclass anyway.

## Decision

`AccessTokenGuard` extracts the bearer and branches on `TokenExpiredError` in one line.

## Consequences

**Gives up:** about forty lines of extraction and error branching a library would own.
