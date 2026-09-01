import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ProblemFilter } from './problem.filter';
import { nthArg } from '../mock-args';

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
 * 4. a 500 logs at error and a 4xx does not, so a caller cannot fill the log by
 *    sending bad requests.
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
    debug: jest.SpyInstance;
  }

  function harness(
    url = '/v1/products/7',
    method = 'GET',
    headersSent = false,
    type_ = 'http',
  ): Harness {
    const json = jest.fn();
    const type = jest.fn(() => ({ json }));
    const status = jest.fn(() => ({ type }));
    const setHeader = jest.fn();
    const res = { status, setHeader, headersSent };
    const req = { url, method };

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
      debug: jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {}),
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
    it('logs a 500 at error, with the method, path and status', () => {
      const h = harness('/v1/products', 'POST');

      h.filter.catch(new Error('connection reset'), h.host);

      expect(h.error).toHaveBeenCalled();
      expect(nthArg(h.error as unknown as jest.Mock)).toBe(
        'POST /v1/products 500',
      );
      expect(h.debug).not.toHaveBeenCalled();
    });

    it('logs a 4xx at debug and not at error', () => {
      // The half that matters for a public route: before the oversized-body fix
      // a 413 was a 500, so one caller could fill the log with stack traces by
      // posting a large body with no token.
      const h = harness('/v1/users', 'POST');

      h.filter.catch(new ForbiddenException(), h.host);

      expect(h.error).not.toHaveBeenCalled();
      expect(h.debug).toHaveBeenCalled();
      expect(nthArg(h.debug as unknown as jest.Mock)).toBe(
        'POST /v1/users 403',
      );
    });

    it('logs a thrown string without calling into it as an Error', () => {
      // `err.stack` on a string is undefined, so the branch has to ask first.
      const h = harness();

      expect(() => h.filter.catch('a bare string', h.host)).not.toThrow();
      expect(h.error).toHaveBeenCalledWith(
        'GET /v1/products/7 500',
        'a bare string',
      );
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
      const { filter, host, debug, json } = harness(
        '/v1/products?secret=leaked&big=' + 'x'.repeat(200),
      );

      filter.catch(new BadRequestException('nope'), host);

      const [where] = debug.mock.calls[0] as [string, string];
      expect(where).toBe('GET /v1/products 400');
      expect(where).not.toContain('secret');

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
      const { filter, host, status, debug } = harness(
        '/v1/products',
        'GET',
        true,
      );

      expect(() =>
        filter.catch(new BadRequestException('too late'), host),
      ).not.toThrow();

      expect(status).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalled();
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
