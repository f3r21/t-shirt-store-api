# 35. The pool size is chosen in the environment, and the ceiling is measured

Status: accepted
Date: 2026-09-03

## Context

The page stated a ceiling of nine replicas from an assumed `max_connections` of 100 and a
pool size the driver chose. Neither number had been read from the database.

## Options

- `DATABASE_POOL_SIZE`, default 10, handed to the driver as `max`, and the ceiling counted
  per task from the measured `max_connections` (chosen).
- The driver's default, unstated: the page keeps a number nobody chose.
- A pooler, RDS Proxy or PgBouncer: a second service for a ceiling of three tasks that one
  instance never reaches.
- One pool size per process role: two variables for one figure.

## Decision

`SHOW max_connections` from a one-off task on the migrate definition answered 79 on
2026-09-03, three of them reserved for the superuser. A task runs two processes at 10
connections each, so three tasks fit in the 76 and a fourth does not, and the migrate task's
one connection sits inside the margin. The variable is an integer of at least 1, documented
in `.env.example`, and `poolConfig` builds the driver's options from it.

## Consequences

**Gives up:** the ceiling is a number on the page, not a limit the platform enforces; a
fourth task would be refused connections at runtime.

**Switch:** a pooler when the shape goes serverless or the task count reaches the ceiling; a
larger instance moves `max_connections`, and the page with it.
