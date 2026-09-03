# 30. Every push to main releases through a role GitHub assumes, and the stack changes through a role of its own

Status: accepted, revised 2026-09-03
Date: 2026-09-02

## Context

ADR 29 released by hand once and pushed a stale image. A run needs credentials, with no key
stored in GitHub.

## Options

- OIDC: the run exchanges GitHub's token for `tshirt-deploy`, and the change set executes as
  `tshirt-cloudformation` (chosen).
- An access key in a repository secret: something to rotate, and to leak from a fork.
- One wide role for the job: an instance, a database or a role reachable from a run.
- Git-flow's `develop` and `release` branches: nothing to stabilise in one environment and
  no version to support; its author's 2020 note points a continuously delivered web app at
  GitHub flow, which a short-lived branch per block and a merge to `main` is.

## Decision

The trust names one repository by GitHub's numeric ids, because STS refused the names and
CloudTrail showed the ids. `tshirt-deploy` may push one registry, request a change set on one
stack, run one task definition and read one log group. `MigrateImageTag` rolls before
`ImageTag`, so migrations run before the service rolls. The last step fails unless the
running task carries the tag of the commit. A run on `main` is never cancelled, and the AMI
is a fixed id.

## Consequences

**Gives up:** no environment protection rule, because the tests are the gate. The service
role is wider than the stack needs.

**Revised 2026-09-03:** the rollback is the deploy command with the previous tag, in the
Deploy section of the README, rehearsed once to `ba49a7a` and back in about three minutes
each way; before that it was a sentence and the circuit breaker.

**Switch:** release branches when a versioned cadence or a second supported version exists;
an environment protection rule when a second environment exists.
