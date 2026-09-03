# 3. Reuse detection covers every generation

Status: accepted
Date: 2026-08-28

## Context

`previous_token_hash` held only the preceding hash, so a stolen token replayed after two
rotations went unnoticed. The contract's `refreshSession` grants no carve-out for the age of a
spent token. A used-token table was named here and rejected for its growth.

## Options

- A table of every spent hash (chosen, built by ADR 2 for the grace window).
- The last hash only: catches one generation.

## Decision

`consumed_refresh_tokens` answers "was this ever spent" for every generation. A token replayed
ten rotations later ends every session, as the contract states.

## Consequences

**Gives up:** one row per rotation per device, and nothing prunes them. Rows older than the
absolute cap are dead by construction, so a sweep is safe and is the first thing to add before
real traffic. The cost rejected here became real when another problem forced the same design.
