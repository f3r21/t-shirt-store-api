# 8. Sessions expire absolutely, after 30 days

Status: accepted
Date: 2026-08-28

## Context

A rotating token could live forever. `created_at` is never rewritten on rotation.

## Options

- Refuse a rotation when the founding row is older than `REFRESH_ABSOLUTE_TTL_DAYS` (chosen).
- An inactivity expiry: a second timestamp to maintain.
- No cap.

## Decision

The cap needs no column. The refusal answers the same `refresh-token-unknown` 401 the contract
admits for an expired token. RFC 10017 makes a maximum lifetime a MUST for browser-based
applications, which is persuasive here and not binding.

## Consequences

**Gives up:** a session in daily use still ends after 30 days, and the user signs in again.
