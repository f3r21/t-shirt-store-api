import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
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
 * Bound globally, because 27 of the contract's 36 operations need a token. The
 * seven public ones carry `@Public()` and the two optional ones carry
 * `@OptionalAuth()`.
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

  private bearerToken(request: Request): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme === 'Bearer' && token !== '' ? token : undefined;
  }

  private unauthorized(): ProblemException {
    return new ProblemException(
      ProblemType.InvalidCredentials,
      'Invalid credentials',
      401,
      'The server did not accept this email and password.',
    );
  }
}
