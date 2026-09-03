# 2. A device is a family of refresh tokens, with a grace window over rotation

Status: accepted
Date: 2026-08-28

## Context

Rotation is one conditional write on the token hash, so one of two racing refreshes wins.
The loser held a spent hash, reuse detection fired, and every session of the user was
deleted: two honest browser tabs signed the account out everywhere. A first fix kept one row
per device and failed fifteen minutes later, outside the window its own tests never left.

## Options

- A family of rows per device, a spent-token table and a grace window (chosen).
- One row per device: cannot hold the two live tokens two tabs need.
- No grace window: Okta ships 30 s and Supabase 10 s.

## Decision

`refresh_tokens.family_id` names the session by its founding row, and
`consumed_refresh_tokens` records every spent hash with its moment. Rotation asks three
questions: is this the live token; was it ever spent, else 401 and nothing deleted; was it
spent inside `REFRESH_GRACE_SECONDS`, then a new row in the family, else every session goes.
`sid` is the family id.

## Consequences

**Gives up:** inside the window a stolen token is accepted with no alarm, bounded by the window
times the refresh tier. The spent-token table grows, and nothing prunes it. Two complementary
sabotages prove the window closes.
