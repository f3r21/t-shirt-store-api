# 30. Every push to main releases through a role GitHub assumes, and the stack changes through a role of its own

Status: accepted
Date: 2026-09-02

## Context

ADR 29 released by hand once and pushed a stale image. A run needs credentials, with no key
stored in GitHub.

## Options

- OIDC: the run exchanges GitHub's token for `tshirt-deploy`, and the change set executes as
  `tshirt-cloudformation` (chosen).
- An access key in a repository secret: something to rotate, and to leak from a fork.
- One wide role for the job: an instance, a database or a role reachable from a run.

## Decision

The trust names one repository by GitHub's numeric ids, because STS refused the names and
CloudTrail showed the ids. `tshirt-deploy` may push one registry, request a change set on one
stack, run one task definition and read one log group. `MigrateImageTag` rolls before
`ImageTag`, so migrations run before the service rolls. The last step fails unless the
running task carries the tag of the commit. A run on `main` is never cancelled, and the AMI
is a fixed id.

## Consequences

**Gives up:** no environment protection rule, because the tests are the gate. No rollback
beyond the circuit breaker; the Deploy section of the README states the by-hand command. The
service role is wider than the stack needs.
