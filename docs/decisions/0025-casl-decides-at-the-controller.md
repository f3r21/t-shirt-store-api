# 25. CASL decides at the controller, and the where clause comes from the ability

Status: accepted, revised 2026-09-04
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

**Gives up:** no field-level rules, and `casl-prisma.ts` knows where the generated client
lives.

**Revised 2026-09-02, from a test written by hand:** a manager may create a payment intent
for any client's order. The contract is silent, the amount comes from the order, and an
intent charges whoever confirms it. The three-line alternative was the sabotage that turned
the case red.

**Revised 2026-09-04, by Optional Features 11 and 12:** the delivery role now has rules of its
own, so "no rule of its own for the delivery role" comes out of the list above. A
`delivery_person` reads every shipped order, reads the delivered orders it delivered, and holds
the verb `deliver` on a shipped order. The verb is the fourth outside CASL's five, added for the
reason `cancel` was: a role that may make exactly one move cannot be given `update`. Nothing
about the shape changes, and the new rules are conditions the same `accessibleBy` turns into the
same kind of where clause. ADR 36 records the column and the route.
