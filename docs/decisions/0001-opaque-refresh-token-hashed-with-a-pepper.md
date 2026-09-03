# 1. The refresh token is opaque, and its hash is not argon2

Status: accepted
Date: 2026-08-28

## Context

Both tokens are 32 random bytes, found by the hash of the token. argon2 salts every call, so
its digest cannot be a lookup key, and it costs about 40 ms per call against 0.005 ms for
the fast hash, measured here.

## Options

- `HMAC-SHA-256` with a pepper, `REFRESH_TOKEN_PEPPER` (chosen).
- Argon2id: no `where` clause can match a salted digest.
- Bare SHA-256: a read-only copy of the database yields tokens the server accepts.

## Decision

Tokens are stored as `HMAC-SHA-256(token, REFRESH_TOKEN_PEPPER)`. Passwords stay on Argon2id,
because a password is short, reused and verified against a row already located by email.
`JWT_SECRET` is not the pepper, so rotating the signing key keeps every stored hash valid.

## Consequences

**Gives up:** a second secret, and rotating it signs everyone out. At 256 bits of token
entropy the pepper buys a small margin.

**Switch:** when the runtime cannot build the native module, Node's own `scrypt` for
passwords. Not `bcrypt`, which truncates at 72 bytes and has no memory cost.
