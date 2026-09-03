# 19. CORS is a list from the environment, and the proxy is a count

Status: accepted
Date: 2026-09-01

## Context

`app.enableCors()` with no argument answers `Access-Control-Allow-Origin: *` to any origin,
measured against the package. It stood one line below `helmet()`, and no test asserted
either. Behind a load balancer `req.ip` is the address of the balancer, so every caller shares one
rate-limit counter, and `trust proxy: true` lets any client forge `X-Forwarded-For`.

## Options

- `CORS_ORIGINS` as a list, empty by default, and `TRUST_PROXY_HOPS` as a count (chosen).
- The permissive default: every route open to every origin.
- `trust proxy: true`: the forgery above.

## Decision

An empty list refuses every cross-origin browser call, and a deployment with a front end
names it. Express reads the nth address from the right, so the count matches the deployment:
1 behind CloudFront.

## Consequences

**Gives up:** the default of 0 is wrong the moment a proxy stands in front, and no end-to-end
test can see it, because the suite talks to the process directly.
