import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { Request } from 'express';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { AccessTokenPayload } from './access-token-payload';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from './decorators/optional-auth.decorator';

/**
 * Verify the bearer token and put its payload on the request.
 *
 * Bound globally, because 28 of the contract's 37 operations need a token. The
 * seven the contract marks `security: []` carry `@Public()`, and the two spelled
 * with `{}` beside `bearerAuth` carry `@OptionalAuth()`.
 *
 * The guard raises problem documents rather than `UnauthorizedException`,
 * because the contract's 401 carries three distinguishable types and a client
 * that cannot separate them loops between refreshing its token and sending the
 * user back to the sign-in screen. `ProblemFilter` puts `WWW-Authenticate` on
 * the response, which every 401 in the contract requires.
 *
 * There is no expiry check here. `@nestjs/jwt` performs it and reports it as
 * `TokenExpiredError`, which is the branch that separates the expired case.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const optional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.bearerToken(request);

    if (token === undefined) {
      // An optional route tolerates no token. It does not tolerate a broken
      // one: a caller who sent a token meant to be recognised.
      if (optional) {
        return true;
      }
      throw this.unauthorized();
    }

    try {
      request.user = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        throw new ProblemException(
          ProblemType.AccessTokenExpired,
          'Access token expired',
          401,
          'Refresh the token and send the request again.',
        );
      }
      throw this.unauthorized();
    }

    return true;
  }

  /**
   * The token out of an `Authorization: Bearer <token>` header.
   *
   * **The scheme is matched without case, and that is the standard rather than a
   * kindness.** RFC 7235 section 2.1 says "the scheme name is case-insensitive",
   * and the contract picks that scheme by name at `openapi.yaml:1697-1699`,
   * `type: http` with `scheme: bearer`. This compared `=== 'Bearer'`, so
   * `Authorization: bearer <jwt>` answered 401 on every protected route, which
   * is the server refusing a request the standard it cites says is valid. A
   * client library that lower-cases its headers, or a developer typing the
   * header by hand, met a 401 that said nothing about why.
   *
   * The token itself is not touched. Only the scheme is case-insensitive, and a
   * scheme that is not bearer at all still returns undefined and still answers
   * 401.
   */
  private bearerToken(request: Request): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme?.toLowerCase() === 'bearer' && token !== ''
      ? token
      : undefined;
  }

  /**
   * A 401 that names no problem type, because none of the six fits.
   *
   * This answers three causes: no `Authorization` header, a scheme that is not
   * Bearer, and a token that fails verification for any reason other than
   * expiry. None of them is `invalid-credentials`, which the contract reserves
   * for an email and password the server rejected. Returning that type on a
   * request that carried no credentials at all tells the caller something
   * untrue, and it is the first thing anyone sees when they call a protected
   * route without a token.
   *
   * RFC 9457 reads an absent `type` as `about:blank`, meaning the status code is
   * the whole story, which is exactly right here. `ProblemFilter` still sets
   * `WWW-Authenticate` on the response.
   */
  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      title: 'Unauthorized',
      detail: 'This operation needs a bearer token.',
    });
  }
}
