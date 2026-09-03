import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * What a caller-supplied id may look like.
 *
 * One to sixty-four characters from a set that cannot break a header, a log
 * line or a shell pipeline that greps one. Anything else is replaced, not
 * rejected: the request goes through and only the id is ours.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The id every log line of this request carries, and the response echoes.
 *
 * A caller that sends `X-Request-Id` gets the same id back, so a front end or a
 * proxy can stitch its own trace to ours. A caller that sends nothing, or
 * something outside the pattern, gets a fresh uuid. The header is set on the
 * response here because this runs before any handler and pino-http is the one
 * place that sees every request.
 */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const offered = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof offered === 'string' && REQUEST_ID_PATTERN.test(offered)
      ? offered
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
