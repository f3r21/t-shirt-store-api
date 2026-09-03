# 25. CASL decides at the controller, and the where clause comes from the ability

Status: accepted, revised 2026-09-02
Date: 2026-09-01

## Context

The brief requires CASL. ADR 18's `RolesGuard` reached into the services, and "own" cannot
be checked before the row is read.

## Options

- One `AbilityFactory`, `@CheckPolicies` on every handler, `accessibleBy(ability)` as the
  `where` (chosen).
- `RolesGuard` plus an ownership clause restated in each service.
- Field-level rules: nothing in the contract needs them.

## Decision

Anyone reads the catalog under the shopper's visibility condition. A signed-in caller manages
their own cart and likes, creates orders, and reads, cancels and pays their own. A manager
writes the catalog and holds `manage` on every order, which keeps "view all orders" apart
from the client's read rule. A handler with no policy is 403 for everyone, and another
client's order is the same 404 as a missing one.

## Consequences

**Gives up:** no field-level rules, no rule of its own for the delivery role, and
`casl-prisma.ts` knows where the generated client lives.

**Revised 2026-09-02, from a test written by hand:** a manager may create a payment intent
for any client's order. The contract is silent, the amount comes from the order, and an
intent charges whoever confirms it. The three-line alternative was the sabotage that turned
the case red.
