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
     * One structured line per failure: the when and the request id are
     * pino's, the where is the method and the path, the what is the status,
     * the type and the reason, the who is the user id and the address. A 401,
     * 403 and 429 are warnings, every other 4xx is info, a 500 carries the
     * error. Nothing is interpolated from the body or a header. ADR 21.
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
