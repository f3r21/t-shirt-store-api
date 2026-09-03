import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { AccessTokenPayload } from './access-token-payload';
import { liveSessionWhere } from './live-session';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from './decorators/optional-auth.decorator';

/**
 * Verify the bearer token and put its payload on the request. Global: public
 * routes carry `@Public()`, the two optional ones `@OptionalAuth()`. The 401s
 * are problem documents with the contract's three types. ADR 5, ADR 6.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
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
    const header = request.headers.authorization;
    const token = this.bearerToken(request);

    // A header that is absent or blank carries no credential: allowed on an
    // optional route, 401 elsewhere. A header that is present and unusable is
    // 401 on both, because a caller who sent one asked to be recognised.
    if (header === undefined || header.trim() === '') {
      if (optional) {
        return true;
      }
      throw this.unauthorized();
    }

    if (token === undefined) {
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

    // A signature is not a session: the row must still be alive, or signing
    // out would not sign out (ADR 4). The claims are checked first, because
    // Prisma drops an `undefined` from a `where`, and `{ OR: [{}, ...] }`
    // matches every row.
    const { sub, sid } = request.user;
    if (!Number.isInteger(sub) || !Number.isInteger(sid)) {
      throw this.unauthorized();
    }

    const live = await this.prisma.refreshToken.findFirst({
      where: {
        userId: sub,
        OR: [{ familyId: sid }, { id: sid, familyId: null }],
        // The same predicate as the rotation and the device list, so the
        // three cannot drift. Nothing deletes a dead row.
        ...liveSessionWhere(
          this.config.getOrThrow<number>('REFRESH_ABSOLUTE_TTL_DAYS'),
        ),
      },
      select: { id: true },
    });
    if (live === null) {
      throw this.unauthorized();
    }

    return true;
  }

  /**
   * The token out of `Authorization: Bearer <token>`. The scheme is matched
   * without case and the gap may be a run of spaces, both per RFC 7235
   * section 2.1; the contract's `bearerAuth` scheme names it.
   */
  private bearerToken(request: Request): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(/ +/) ?? [];
    return scheme?.toLowerCase() === 'bearer' && token !== ''
      ? token
      : undefined;
  }

  /**
   * A 401 with no problem type: none of the six fits a missing or broken
   * token, and RFC 9457 reads an absent type as the status alone.
   * `ProblemFilter` adds `WWW-Authenticate`.
   */
  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      title: 'Unauthorized',
      detail: 'This operation needs a bearer token.',
    });
  }
}
