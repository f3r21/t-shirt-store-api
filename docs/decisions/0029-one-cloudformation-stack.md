# 29. One CloudFormation stack: ECS on one instance behind CloudFront, with the managed parts managed

Status: accepted
Date: 2026-09-02

## Context

The brief requires a deploy, and the mentor's scope of 2026-09-01 excludes a cloud rebuild.
The page promised a container image, a managed Postgres, a managed cache and an object
store, on 120 USD of credits.

## Options

- ECS on one `t4g.micro` with an Elastic IP, RDS Postgres 16, ElastiCache Valkey 9, CloudFront
  in front, one CloudFormation template (chosen).
- Fargate: a load balancer and a public address per task outspend the compute.
- App Runner: excluded from the free plan.
- The CDK or Terraform: a build step or a state store for one environment.

## Decision

About 31 USD a month plus gp3 storage, priced with `aws pricing get-products`, which the
credits carry for three and a half months. CloudFront is the HTTPS front, and the instance
admits port 80 from CloudFront only. arm64 throughout, because every builder is. Typed
secrets live in SSM, the composed `DATABASE_URL` in Secrets Manager. The release is registry,
migrate, roll.

## Consequences

**Gives up:** no Auto Scaling group, no SSH, one task at a time, so a deployment is seconds of
504.

**Switch:** the CDK for a second environment, Terraform for a second cloud. Postgres and
Valkey move into containers on the instance when the credits run out: the pair is 21 of the
31 USD.
