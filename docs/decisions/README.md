# Decisions

One record per decision, numbered once and never renumbered. A reversed decision keeps its
number and names what replaced it. Number 12 was a list of gaps, not a decision; the gaps are
in the README. The long form of every record is in git: `git show b64d622:DECISIONS.md`. The
contract's and the data model's records live in the Week 2 repository.

## Sessions and passwords

- [1. The refresh token is opaque, and its hash is not argon2](0001-opaque-refresh-token-hashed-with-a-pepper.md)
- [2. A device is a family of refresh tokens, with a grace window over rotation](0002-a-device-is-a-family-of-refresh-tokens.md)
- [3. Reuse detection covers every generation](0003-reuse-detection-covers-every-generation.md)
- [4. The access token carries a session id](0004-the-access-token-carries-a-session-id.md)
- [5. No Passport](0005-no-passport.md)
- [6. Three authentication states, not two](0006-three-authentication-states.md)
- [8. Sessions expire absolutely, after 30 days](0008-sessions-expire-after-30-days.md)
- [9. The reset token lives for 30 minutes](0009-the-reset-token-lives-30-minutes.md)
- [10. Email is folded to lower case, in full](0010-email-is-folded-to-lower-case.md)

## Request handling

- [7. Rate limiting is per source address, in three tiers](0007-rate-limiting-per-address-in-three-tiers.md)
- [11. Problem titles come from a table, never from the exception message](0011-problem-titles-come-from-a-table.md)
- [19. CORS is a list from the environment, and the proxy is a count](0019-cors-is-a-list-and-the-proxy-is-a-count.md)
- [21. Logs are pino JSON with a request id, and the events are the OWASP list](0021-logs-are-pino-json-with-a-request-id.md)

## Catalog

- [13. Money is an integer column named for what it holds](0013-money-is-an-integer-column.md)
- [14. A variant's size and colour are NOT NULL with an empty-string default](0014-variant-size-and-colour-are-not-null.md)
- [15. Deleting a product is soft, disabling it is not the same thing](0015-deleting-a-product-is-soft.md)
- [16. `includeInactive` is a three-way answer, not a boolean](0016-include-inactive-is-a-three-way-answer.md)
- [17. `priceFrom` comes from one query for the whole page](0017-price-from-comes-from-one-query.md)
- [18. Roles are enforced by a guard today and by CASL tomorrow](0018-roles-guard-superseded.md), superseded by 25

## Authorization

- [25. CASL decides at the controller, and the where clause comes from the ability](0025-casl-decides-at-the-controller.md)

## Cart, orders and payments

- [22. The cart shows what can be bought, and checks stock as a courtesy](0022-the-cart-checks-stock-as-a-courtesy.md)
- [23. Checkout empties the cart first, and a status move is a conditional write](0023-checkout-empties-the-cart-first.md)
- [24. The webhook is the only writer of `paid`, and a retry is a unique violation](0024-the-webhook-is-the-only-writer-of-paid.md)

## Concurrent writes

- [34. A write that depends on a value it read carries that value, or adds to it](0034-a-write-carries-the-value-it-assumed.md)

## Likes and stock mail

- [26. A like needs a product on sale, an unlike needs only a variant, and the list is the product page](0026-a-like-needs-a-product-on-sale.md)
- [27. Low stock is a crossing, the producer decides after the commit, and it is one job per person](0027-low-stock-is-a-crossing.md)
- [28. The worker writes the row before the mail, and a failed send takes the row back](0028-the-worker-writes-the-row-before-the-mail.md)

## Infrastructure and delivery

- [29. One CloudFormation stack: ECS on one instance behind CloudFront, with the managed parts managed](0029-one-cloudformation-stack.md)
- [30. Every push to main releases through a role GitHub assumes, and the stack changes through a role of its own](0030-every-push-releases-through-an-assumed-role.md)
- [31. Images live in a closed bucket, are served through the distribution, and are what their bytes say](0031-images-live-in-a-closed-bucket.md)
- [32. Mail leaves through SES from the task role, Stripe delivers to the distribution, and main is the release](0032-mail-through-ses-and-main-is-the-release.md)

## Tooling and tests

- [20. Two transitive advisories are overridden, not accepted](0020-two-transitive-advisories-are-overridden.md)
- [33. The end-to-end suite truncates and reseeds on the real Postgres and Valkey](0033-the-e2e-suite-truncates-and-reseeds.md)
