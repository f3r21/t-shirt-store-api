import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { toProblem } from './problem';

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
     * The method, the path and the status, beside the error.
     *
     * The OWASP logging cheat sheet asks each entry for the when, the where, the
     * who and the what. The timestamp is Nest's. This line is the where and the
     * what, and it costs nothing: both values are already bound above, so it
     * needs no dependency, no middleware and no request-scoped storage.
     *
     * The who is absent rather than half done. It needs an id carried from the
     * guard through the service and into the background job, and that job is not
     * built yet. `ARCHITECTURE.md` records the decision and the alternative that
     * was rejected.
     *
     * Nothing here is interpolated from the body or from a header, so no token,
     * password or address can reach a log line through this call.
     */
    const where = `${req.method} ${path} ${status}`;

    if (status >= 500) {
      // The stack, because a 500 is the server's fault and the stack is the only
      // way to find where. A 4xx gets the message instead: the cause is what the
      // caller sent, and a stack through the framework says nothing about it.
      this.logger.error(where, err instanceof Error ? err.stack : String(err));
    } else {
      // `toProblem` never puts a message in the body, because Nest fills one with
      // request-derived text. The message is still worth having, so it is logged
      // here rather than returned.
      //
      // No `instanceof` guard on this side. Every status below 500 comes from a
      // branch of `toProblem` that matched an `Error`: a `ProblemException`, an
      // `HttpException`, an exposed http-error, or a mapped Prisma code.
      // Anything else falls to the 500 above, so a non-Error cannot reach here
      // and a guard would be a branch no test could turn red.
      this.logger.debug(where, (err as Error).message);
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
