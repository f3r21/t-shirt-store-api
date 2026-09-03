# 4. The access token carries a session id

Status: accepted
Date: 2026-08-28

## Context

`DELETE /auth/sessions/current` ends the session of the device that sent the request, and the
request carries only an access token. Deleting refresh rows used to leave a device able to act
for the rest of the token's fifteen minutes, while the password-changed mail said every device
was signed out.

## Options

- `{ sub, sid, role }`, and the guard checks that the session is alive (chosen).
- A stateless token: signing out does not sign out.
- The role read from the database per request: one more query for a claim that rarely changes.

## Decision

`sid` names the family of ADR 2, so the id survives rotation as the contract promises.
`AccessTokenGuard` looks it up and refuses a token whose session is gone. `role` is in the
payload because no operation reads the current user.

## Consequences

**Gives up:** one indexed lookup per protected request. A role change lags by one token
lifetime, the only stale claim left.

**Switch:** when the lookup is the bottleneck, cache revoked session ids briefly. Keep the
check.
