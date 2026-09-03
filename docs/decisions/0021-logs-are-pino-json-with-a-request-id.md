# 21. Logs are pino JSON with a request id, and the events are the OWASP list

Status: accepted
Date: 2026-09-01

## Context

The filter logged a 500 with its stack and every 4xx at debug, and nothing else logged. The
OWASP logging cheat sheet asks for authentication and authorization failures, validation
failures, application errors and privileged account actions.

## Options

- pino through `nestjs-pino`, with `app.useLogger` so every Nest `Logger` stays (chosen).
- `PinoLogger` injected everywhere: the same lines plus a provider in every test module.
- Winston: slower, and JSON is a configuration there, not the default.

## Decision

`X-Request-Id` is accepted when it matches `^[A-Za-z0-9._-]{1,64}$`, else replaced with a
UUID, and the response carries it. The request is logged as its id, method, path and address,
never its headers, so the bearer token reaches no line. A 401, 403 and 429 are warnings under
`auth.rejected`, `authz.rejected` and `rate.limited`; every other 4xx logs at info as
`request.rejected`.

## Consequences

**Gives up:** no end-to-end test reads a log line, because the suite runs at `silent`. The id
stops at the queue, so a job carries it by hand or not at all. No metric exists.
