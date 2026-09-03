# 9. The reset token lives for 30 minutes

Status: accepted
Date: 2026-08-28

## Context

The contract sets no window for a password reset link.

## Options

- 30 minutes as a module constant (chosen).
- An environment variable: nothing else depends on the number.

## Decision

Thirty minutes is long enough to reach a laptop and short enough that a link left in an inbox
stops working within the hour.

## Consequences

**Gives up:** changing the window is a code change.
