# 7. Rate limiting is per source address, in three tiers

Status: accepted
Date: 2026-08-28

## Context

One limit cannot serve both browsing and sign-in: 5 per 60 s is a sign-in limit and an
unusable browse limit. Keying the reset throttle on the email would answer 429 for a known
address and 202 for an unknown one, an enumeration oracle, and the body is not yet validated
when guards run.

## Options

- Per address, three tiers, one `ThrottlerGuard` bound globally (chosen).
- Per account: the oracle above.
- One tier: loosening it for browsing loosens sign-in by the same factor.

## Decision

Browsing takes `THROTTLE_LIMIT`, 100 per 60 s. Sign-in takes `SIGN_IN_THROTTLE`, 10 per 60 s.
The three password operations take `PASSWORD_THROTTLE`, 5 per 900 s. Every tier is named
`default`, so the header is a plain `Retry-After`. The contract was amended to declare the 429
on `createSession`. `test/rate-limit.e2e-spec.ts` runs against the real counter, because a
misspelled `@Throttle` key compiles and does nothing.

## Consequences

**Gives up:** a distributed attacker is not slowed. The counter is in process memory, correct
for one process.

**Switch:** when the service runs twice, a Redis storage for the throttler.
