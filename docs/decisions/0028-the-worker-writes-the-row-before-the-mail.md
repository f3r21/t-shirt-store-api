# 28. The worker writes the row before the mail, and a failed send takes the row back

Status: accepted, revised 2026-09-03
Date: 2026-09-02

## Context

One job, one person, one mail, once. Two workers can hold the same pair, and a retry can
follow a worker that died after sending.

## Options

- Insert the row, send, and on a failed send delete the row and throw again (chosen).
- Mail then row: both workers send inside the window the row exists to close.
- A flag on the API process: the API and the worker could not scale apart.

## Decision

The `stock_notifications` insert meets the primary key first, so only one worker sends, and a
`P2002` means the person was already told. A rejected send deletes the row and throws again,
so the next attempt sends again. `sendLowStock` calls the throwing `deliver`, where the two
password mails swallow. `src/worker.ts` boots `WorkerModule` from the same image: no port, no
controllers, concurrency five. Three attempts with exponential backoff, failed jobs kept, and
the failed set is the alert.

## Consequences

**Gives up:** a crash between the row and the mail loses that one mail. A `P2003` on a
deleted person or variant is a skip. A person clears the failed set by hand.

**Revised 2026-09-03, from a test written by hand:** only a failed send took the row back. A
lookup that rejected between the row and the send left the row, the retry met `P2002` and
read it as already told, and the person was never mailed. Now any rejection after the row
takes the row back and throws again.
