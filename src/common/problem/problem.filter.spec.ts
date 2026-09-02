import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ProblemFilter } from './problem.filter';
import { nthArg } from '../mock-args';
import { AccessTokenPayload } from '../../auth/access-token-payload';

/** The object a log spy was handed, typed by the caller. */
function line(spy: jest.SpyInstance, call = 0): Record<string, unknown> {
  return nthArg(spy as unknown as jest.Mock, 0, call) as Record<
    string,
    unknown
  >;
}

/**
 * The filter, which is the half of the mapper that touches the response.
 *
 * `problem.spec.ts` covers what document each throwable becomes. This file
 * covers the four things only the filter decides, and each one is invisible to
 * a test of `toProblem`:
 *
 * 1. the media type on the wire is `application/problem+json`, which RFC 9457
 *    requires and which a plain `res.json()` would not set,
 * 2. `WWW-Authenticate` goes out on a 401 and on nothing else, which RFC 9110
 *    requires of every 401,
 * 3. `instance` is the request path, taken from the request rather than guessed,
 * 4. what reaches the log: a 500 at error with the error itself, a 401, a 403
 *    and a 429 at warn under their security events, every other 4xx at info,
 *    each line carrying the event, the status, the method and the path, and
 *    the user id once a token verified.
 */
describe('ProblemFilter', () => {
  interface Harness {
    filter: ProblemFilter;
    host: ArgumentsHost;
    status: jest.Mock;
    type: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
    error: jest.SpyInstance;
    warn: jest.SpyInstance;
    log: jest.SpyInstance;
  }

  function harness(
    url = '/v1/products/7',
    method = 'GET',
    headersSent = false,
    type_ = 'http',
    user?: AccessTokenPayload,
  ): Harness {
    const json = jest.fn();
    const type = jest.fn(() => ({ json }));
    const status = jest.fn(() => ({ type }));
    const setHeader = jest.fn();
    const res = { status, setHeader, headersSent };
    // `ip` is what Express derives from the socket, or from the forwarded
    // header once `trust proxy` is set. A fixed value here, so the assertion
    // that it reaches the line is about the filter and not about Express.
    const req = { url, method, user, ip: '203.0.113.9' };

    const host = {
      getType: () => type_,
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => req,
      }),
    } as unknown as ArgumentsHost;

    return {
      filter: new ProblemFilter(),
      host,
      status,
      type,
      json,
      setHeader,
      // Silenced as well as observed. Without this the suite prints a stack for
      // every 500 case and the real output gets lost in it.
      error: jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}),
      log: jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {}),
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers with the problem media type and the mapped status', () => {
    const h = harness();

    h.filter.catch(new ForbiddenException(), h.host);

    expect(h.status).toHaveBeenCalledWith(403);
    expect(h.type).toHaveBeenCalledWith('application/problem+json');
    expect(nthArg(h.json)).toEqual({
      title: 'Forbidden',
      status: 403,
      detail: 'This operation is available to a manager only.',
      instance: '/v1/products/7',
    });
  });

  it('takes instance from the request url rather than from the error', () => {
    const h = harness('/v1/auth/sessions');

    h.filter.catch(new ForbiddenException(), h.host);

    expect((nthArg(h.json) as { instance: string }).instance).toBe(
      '/v1/auth/sessions',
    );
  });

  it('sets WWW-Authenticate on a 401, which RFC 9110 requires', () => {
    const h = harness();

    h.filter.catch(new UnauthorizedException(), h.host);

    expect(h.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });

  it('sets no WWW-Authenticate on a 403, which is the control', () => {
    // 401 and 403 are the pair that gets confused. Without this case the header
    // could go out on every failure and the test above would still pass.
    const h = harness();

    h.filter.catch(new ForbiddenException(), h.host);

    expect(h.setHeader).not.toHaveBeenCalled();
  });

  describe('what reaches the log', () => {
    it('logs a 500 at error, with the error itself and the where', () => {
      const h = harness('/v1/products', 'POST');
      const boom = new Error('connection reset');

      h.filter.catch(boom, h.host);

      expect(h.error).toHaveBeenCalledTimes(1);
      expect(line(h.error)).toMatchObject({
        msg: 'POST /v1/products 500',
        event: 'request.failed',
        status: 500,
        method: 'POST',
        path: '/v1/products',
        // The Error and not its stack string, so pino's serializer prints the
        // stack and a text logger prints the message.
        err: boom,
      });
      expect(h.warn).not.toHaveBeenCalled();
      expect(h.log).not.toHaveBeenCalled();
    });

    it('logs a 401, a 403 and a 429 at warn, each under its security event', () => {
      const h = harness('/v1/users', 'POST');

      h.filter.catch(new UnauthorizedException(), h.host);
      h.filter.catch(new ForbiddenException(), h.host);
      h.filter.catch(new ThrottlerException('Too many requests'), h.host);

      expect(h.warn).toHaveBeenCalledTimes(3);
      expect(line(h.warn, 0)).toMatchObject({
        event: 'auth.rejected',
        status: 401,
        msg: 'POST /v1/users 401',
      });
      expect(line(h.warn, 1)).toMatchObject({
        event: 'authz.rejected',
        status: 403,
      });
      expect(line(h.warn, 2)).toMatchObject({
        event: 'rate.limited',
        status: 429,
      });
      expect(h.error).not.toHaveBeenCalled();
      expect(h.log).not.toHaveBeenCalled();
    });

    it('logs every other 4xx at info, with the reason and never at error', () => {
      // The half that matters for a public route: before the oversized-body fix
      // a 413 was a 500, so one caller could fill the log with stack traces by
      // posting a large body with no token.
      const h = harness('/v1/users', 'POST');

      h.filter.catch(new BadRequestException('nope'), h.host);

      expect(h.log).toHaveBeenCalledTimes(1);
      expect(line(h.log)).toMatchObject({
        msg: 'POST /v1/users 400',
        event: 'request.rejected',
        status: 400,
        reason: 'nope',
      });
      expect(h.error).not.toHaveBeenCalled();
      expect(h.warn).not.toHaveBeenCalled();
    });

    it('names the caller once a token verified, and the address always', () => {
      const signedIn = harness('/v1/products', 'POST', false, 'http', {
        sub: 42,
        sid: 7,
        role: 'client',
      });
      const anonymous = harness('/v1/products', 'POST');

      signedIn.filter.catch(new ForbiddenException(), signedIn.host);
      anonymous.filter.catch(new UnauthorizedException(), anonymous.host);

      expect(line(signedIn.warn)).toMatchObject({
        userId: 42,
        ip: '203.0.113.9',
      });
      expect(line(anonymous.warn, 1).userId).toBeUndefined();
      expect(line(anonymous.warn, 1).ip).toBe('203.0.113.9');
    });

    it('logs a thrown string as text, without calling into it as an Error', () => {
      // `err.stack` on a string is undefined, so the branch has to ask first.
      const h = harness();

      expect(() => h.filter.catch('a bare string', h.host)).not.toThrow();
      expect(line(h.error)).toMatchObject({
        msg: 'GET /v1/products/7 500',
        err: 'a bare string',
      });
    });
  });

  describe('what it refuses to carry, and where it refuses to run', () => {
    /**
     * **The query string reaches a log line and a response body, and it is the
     * caller's to fill.**
     *
     * `req.url` is the path plus everything after the `?`. It went into the
     * debug log, which is on by default, and into the `instance` member of the
     * problem document. An anonymous caller can send eight kilobytes of
     * anything in a query string, collect a 400 from `forbidNonWhitelisted`,
     * and have it written down. A path names the operation, which is all either
     * use needs.
     *
     * The second half is the control: the path still arrives, so this is not
     * passing because the filter stopped logging anything.
     */
    it('logs the path and never the query string', () => {
      const h = harness('/v1/products?secret=leaked&big=' + 'x'.repeat(200));

      h.filter.catch(new BadRequestException('nope'), h.host);

      const logged = line(h.log);
      expect(logged.msg).toBe('GET /v1/products 400');
      expect(logged.path).toBe('/v1/products');
      expect(JSON.stringify(logged)).not.toContain('secret');
      const { json } = h;

      const body = (json.mock.calls[0] as [{ instance: string }])[0];
      expect(body.instance).toBe('/v1/products');
    });

    /**
     * A failure after the response has started cannot be answered.
     *
     * `res.status()` throws `ERR_HTTP_HEADERS_SENT` once headers are gone, which
     * replaces the original error with a second one and writes nothing at all.
     * The log line is then the only record of what happened, so it still has to
     * be written: that is the second assertion.
     */
    it('writes nothing when the headers have already gone, and still logs', () => {
      const { filter, host, status, log } = harness(
        '/v1/products',
        'GET',
        true,
      );

      expect(() =>
        filter.catch(new BadRequestException('too late'), host),
      ).not.toThrow();

      expect(status).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalled();
    });

    /**
     * `@Catch()` with no argument is terminal in every context, and this filter
     * reads a request in its first three lines. Outside HTTP there is none, so
     * it hands the error back to Nest rather than throwing while handling a
     * throw.
     */
    it('rethrows outside an HTTP context rather than reading a request', () => {
      const boom = new Error('from a scheduled task');
      const { filter, host, status } = harness('/v1', 'GET', false, 'rpc');

      expect(() => filter.catch(boom, host)).toThrow(boom);
      expect(status).not.toHaveBeenCalled();
    });
  });
});
