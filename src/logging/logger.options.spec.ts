import type { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import type { EnvironmentVariables } from '../config/env.validation';
import {
  buildLoggerOptions,
  completionLevel,
  requestProps,
  serializeRequest,
  serializeResponse,
  skipCompletionLine,
} from './logger.options';
import { REQUEST_ID_HEADER, requestId } from './request-id';

/**
 * The shape of every log line, decided in these functions and nowhere else.
 *
 * pino-http and nestjs-pino are configured, not tested: what this file proves
 * is that the configuration hands them the right pieces. The wiring itself is
 * proven by `test/app.e2e-spec.ts`, where the request id comes back on a real
 * response.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fakeRequest(headers: Record<string, string> = {}): IncomingMessage {
  return { headers, url: '/v1' } as unknown as IncomingMessage;
}

/** A response and, beside it, the mock its `setHeader` is. */
function fakeResponse(statusCode = 200): {
  res: ServerResponse;
  setHeader: jest.Mock;
} {
  const setHeader = jest.fn();
  return {
    res: { statusCode, setHeader } as unknown as ServerResponse,
    setHeader,
  };
}

describe('requestId', () => {
  it('keeps a well-formed id from the caller, and echoes it on the response', () => {
    const { res, setHeader } = fakeResponse();

    const id = requestId(
      fakeRequest({ [REQUEST_ID_HEADER]: 'trace-42.a_b' }),
      res,
    );

    expect(id).toBe('trace-42.a_b');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'trace-42.a_b');
  });

  it('accepts the longest id the pattern allows, which is the boundary', () => {
    const longest = 'x'.repeat(64);
    const req = fakeRequest({ [REQUEST_ID_HEADER]: longest });

    expect(requestId(req, fakeResponse().res)).toBe(longest);
  });

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['a space', 'not ok'],
    ['sixty-five characters', 'x'.repeat(65)],
    ['a line break', 'a\nb'],
  ])('replaces %s with a uuid, and echoes the uuid', (_label, offered) => {
    const { res, setHeader } = fakeResponse();
    const req = fakeRequest(
      offered === undefined ? {} : { [REQUEST_ID_HEADER]: offered },
    );

    const id = requestId(req, res);

    expect(id).toMatch(UUID);
    expect(id).not.toBe(offered);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, id);
  });
});

describe('the completion line', () => {
  it('serializes the request as id, method and path, and never the headers or the query', () => {
    const standard = {
      id: 7,
      method: 'GET',
      url: '/v1/products?secret=leaked',
      headers: { authorization: 'Bearer token' },
      remoteAddress: '::1',
      remotePort: 51234,
    };

    expect(serializeRequest(standard)).toEqual({
      id: 7,
      method: 'GET',
      path: '/v1/products',
    });
  });

  it('serializes the response as the status code alone', () => {
    const standard = { statusCode: 201, headers: { 'set-cookie': 'x' } };

    expect(serializeResponse(standard)).toEqual({ statusCode: 201 });
  });

  it('is error when the server failed, and info for every answered request', () => {
    const req = fakeRequest();

    expect(completionLevel(req, fakeResponse(500).res)).toBe('error');
    expect(completionLevel(req, fakeResponse(200).res, new Error('mid'))).toBe(
      'error',
    );
    expect(completionLevel(req, fakeResponse(404).res)).toBe('info');
    expect(completionLevel(req, fakeResponse(429).res)).toBe('info');
  });

  it('names the caller once the guard verified a token, and the address', () => {
    const signedIn = {
      user: { sub: 42, sid: 7, role: 'client' },
      ip: '203.0.113.9',
    } as unknown as IncomingMessage;

    expect(requestProps(signedIn)).toEqual({ userId: 42, ip: '203.0.113.9' });
    expect(requestProps(fakeRequest())).toEqual({});
  });

  it('skips the Swagger routes and nothing else', () => {
    expect(skipCompletionLine({ url: '/docs' } as IncomingMessage)).toBe(true);
    expect(skipCompletionLine({ url: '/docs-json' } as IncomingMessage)).toBe(
      true,
    );
    expect(skipCompletionLine({ url: '/v1/products' } as IncomingMessage)).toBe(
      false,
    );
    expect(skipCompletionLine({ url: '/v1' } as IncomingMessage)).toBe(false);
  });
});

describe('buildLoggerOptions', () => {
  function configFor(
    values: Record<string, string>,
  ): ConfigService<EnvironmentVariables, true> {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService<EnvironmentVariables, true>;
  }

  function optionsFor(values: Record<string, string>): Options {
    return buildLoggerOptions(configFor(values)).pinoHttp as Options;
  }

  it('reads the level from LOG_LEVEL and hands pino-http the pieces above', () => {
    const options = optionsFor({ LOG_LEVEL: 'warn', NODE_ENV: 'production' });

    expect(options.level).toBe('warn');
    expect(options.genReqId).toBe(requestId);
    expect(options.quietReqLogger).toBe(true);
    expect(options.customProps).toBe(requestProps);
    expect(options.customLogLevel).toBe(completionLevel);
    expect(options.serializers).toEqual({
      req: serializeRequest,
      res: serializeResponse,
    });
    expect(options.redact).toEqual(['req.headers.authorization']);
  });

  it('pretty-prints in development and writes JSON everywhere else', () => {
    expect(
      optionsFor({ LOG_LEVEL: 'info', NODE_ENV: 'development' }).transport,
    ).toMatchObject({ target: 'pino-pretty' });
    expect(
      optionsFor({ LOG_LEVEL: 'info', NODE_ENV: 'production' }).transport,
    ).toBeUndefined();
    expect(
      optionsFor({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }).transport,
    ).toBeUndefined();
  });
});
