import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toProblem } from './problem';

/**
 * The three statuses the OWASP logging cheat sheet names as security events:
 * an authentication failure, an authorization failure, and a caller the rate
 * limit refused. Each logs at warn under its own event name, so a log query
 * can count one kind without parsing the message.
 */
const SECURITY_EVENTS: Record<number, string> = {
  401: 'auth.rejected',
  403: 'authz.rejected',
  429: 'rate.limited',
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(err: unknown, host: ArgumentsHost) {
    // **`@Catch()` with no argument is terminal in every context, not just
    // HTTP.** A throw from a scheduled task or a queue consumer arrives here
    // too, and the two lines below would then read `url` off something that is
    // not a request. Rethrowing hands it back to Nest, which has somewhere to
    // put it. Nothing raises outside HTTP today, and the day something does the
    // failure would be this filter throwing while handling a throw.
    if (host.getType() !== 'http') {
      throw err;
    }

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // **The path without its query string.** `req.url` carries whatever the
    // caller sent after the `?`, and this value goes into a log line and into
    // the `instance` of the response body. An anonymous caller could put eight
    // kilobytes of anything in a query string, get a 400 from
    // `forbidNonWhitelisted`, and have it written to a debug log that is on by
    // default. A path identifies the operation, which is all either use needs.
    const path = req.url.split('?')[0];

    const { status, body } = toProblem(err, path);

    /**
     * One structured line per failure, at the level that says what it is.
     *
     * The OWASP logging cheat sheet asks each entry for the when, the where, the
     * who and the what. The timestamp and the request id are pino's: the id is
     * bound to every line written inside the request, so it is on this one
     * without being named here. The where is the method and the path. The what
     * is the status, the problem type and the reason. The who is the user id
     * once the guard has verified a token, and the source address always.
     *
     * The levels are that list read against a public API. A 401, a 403 and a
     * 429 are the entries it calls security events, so they are warnings. Every
     * other 4xx is what the caller sent, a validation failure or a 404: worth a
     * line at info, because the same list asks for validation failures, and not
     * worth an alert, because an anonymous caller can produce as many as the
     * rate limit allows. A 500 is the server's fault and carries the error
     * itself, so pino prints the stack.
     *
     * Nothing here is interpolated from the body or from a header, so no token,
     * password or address can reach a log line through this call. `reason` is
     * the exception's message, which for a validation failure is
     * class-validator's sentence about the field and never the value sent.
     *
     * No `instanceof` guard below 500. Every status there comes from a branch of
     * `toProblem` that matched an `Error`: a `ProblemException`, an
     * `HttpException`, an exposed http-error, or a mapped Prisma code. Anything
     * else is a 500, so a non-Error cannot reach those branches and a guard
     * would be a branch no test could turn red.
     */
    const line = {
      msg: `${req.method} ${path} ${status}`,
      status,
      type: body.type,
      method: req.method,
      path,
      userId: req.user?.sub,
      ip: req.ip,
    };
    const security = SECURITY_EVENTS[status];

    if (status >= 500) {
      this.logger.error({
        ...line,
        event: 'request.failed',
        err: err instanceof Error ? err : String(err),
      });
    } else if (security !== undefined) {
      this.logger.warn({
        ...line,
        event: security,
        reason: (err as Error).message,
      });
    } else {
      this.logger.log({
        ...line,
        event: 'request.rejected',
        reason: (err as Error).message,
      });
    }
    // **Nothing can be written once the headers are gone.** A failure after the
    // response has started, in a stream or an interceptor, reaches here with
    // `headersSent` already true, and `res.status()` then throws
    // `ERR_HTTP_HEADERS_SENT`. That replaces the original error with a second
    // one and writes no response at all, so the log line above is the only
    // record left of what actually happened. Nest's own base filter guards the
    // same way.
    if (res.headersSent) {
      return;
    }

    if (status === 401) {
      res.setHeader('WWW-Authenticate', 'Bearer');
    }
    res.status(status).type('application/problem+json').json(body);
  }
}
