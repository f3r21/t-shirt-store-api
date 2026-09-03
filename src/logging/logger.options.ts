import type { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';
import type { EnvironmentVariables, LogLevel } from '../config/env.validation';
import { Environment } from '../config/env.validation';
import { requestId } from './request-id';

/**
 * What pino-http's standard serializers produce, which is what a custom one
 * receives in its place. Only the members read below are named.
 */
interface SerializedRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

interface SerializedResponse {
  statusCode?: number;
}

/** The request as the guard leaves it, once it has verified a token. */
type RequestWithCaller = IncomingMessage & {
  user?: { sub: number };
  ip?: string;
};

/**
 * What the completion line says about the request, and nothing else.
 *
 * The standard serializer writes `headers`, which on every authenticated
 * request is the bearer token, and `url`, which is whatever the caller put
 * after the `?`. This keeps the id, the method and the path. The address is
 * added by `requestProps`, where Express's proxy-aware `ip` is reachable; the
 * socket's address here would be the balancer's.
 */
export function serializeRequest(req: SerializedRequest): {
  id: unknown;
  method?: string;
  path?: string;
} {
  return { id: req.id, method: req.method, path: req.url?.split('?')[0] };
}

export function serializeResponse(res: SerializedResponse): {
  statusCode?: number;
} {
  return { statusCode: res.statusCode };
}

/**
 * The completion line is the access log: `info` for every answered request and
 * `error` only when the server failed. The security events keep their `warn`
 * in the problem filter, so a warning in this log is always one of those.
 */
export function completionLevel(
  _req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): 'error' | 'info' {
  return err !== undefined || res.statusCode >= 500 ? 'error' : 'info';
}

/**
 * The who. pino-http asks for this twice, once when the request arrives and
 * once when the response has gone, and the second answer is the one that
 * lands on the completion line, after the guard has written `user`.
 */
export function requestProps(req: RequestWithCaller): {
  userId?: number;
  ip?: string;
} {
  return { userId: req.user?.sub, ip: req.ip };
}

/**
 * The Swagger page and its assets. Every other route gets a completion line,
 * including the root and every 404.
 */
export function skipCompletionLine(req: IncomingMessage): boolean {
  return (req.url ?? '').startsWith('/docs');
}

/**
 * pino, and how every line is shaped. The reasons are in ADR 21.
 *
 * `quietReqLogger` binds only the request id to lines written inside the
 * request, so a service's line is the event, the id and the context, and not
 * a copy of the request. `redact` names the header the serializer already
 * drops, so a future serializer that brings the headers back finds the token
 * gone. The transport is development only: pino-pretty is a devDependency the
 * image never gets, and a production process writes JSON for the platform.
 */
export function buildLoggerOptions(
  config: ConfigService<EnvironmentVariables, true>,
): Params {
  const pinoHttp: Options = {
    level: config.get<LogLevel>('LOG_LEVEL'),
    genReqId: requestId,
    quietReqLogger: true,
    customProps: requestProps,
    customLogLevel: completionLevel,
    autoLogging: { ignore: skipCompletionLine },
    serializers: { req: serializeRequest, res: serializeResponse },
    redact: ['req.headers.authorization'],
    ...(config.get<Environment>('NODE_ENV') === Environment.Development
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  };
  return { pinoHttp };
}
