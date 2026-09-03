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

    // An optional route tolerates no token. It does not tolerate a broken one:
    // a caller who sent a token meant to be recognised.
    //
    // **That comment sat one line above code that did the opposite.** The check
    // was `if (token === undefined)`, and `bearerToken` returns `undefined`
    // both for a header that is absent and for one that is present and
    // unusable, so the two cases had already been flattened into one before
    // this branch could tell them apart. `Basic abc`, `Bearer`, `Token xyz` and
    // a bare `Bearer ` all answered 200 on an optional route, as the anonymous
    // view.
    //
    // The cost was not cosmetic. A manager whose client mangles the header got
    // the catalog without their disabled products, with a 200 and nothing
    // saying why, which is the exact failure `@OptionalAuth` exists to prevent.
    // **And `''` counts as absent, which is the same mistake in reverse.** The
    // check above used to be `token === undefined`, which flattened "no header"
    // into "unusable header" and served a broken one as anonymous. Splitting
    // them fixed that and created the opposite: Node hands a present but empty
    // `Authorization:` over as `''`, which is not `undefined`, so a proxy that
    // always injects the header made `GET /products` and `GET /products/{id}`,
    // the two operations the contract marks anonymous, answer 401 to everybody.
    //
    // A header with nothing in it carries no credential, so it is the absence
    // of one. `.trim()` because a header of spaces is the same statement.
    if (header === undefined || header.trim() === '') {
      if (optional) {
        return true;
      }
      throw this.unauthorized();
    }

    // The header is there and `bearerToken` could not use it. Refused on both
    // tiers, because a caller who sent credentials asked to be recognised.
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

    // **A signature is not a session.** Verifying the token proved this server
    // issued it and that it has not expired, and said nothing about whether the
    // session it names is still alive.
    //
    // Without this, deleting refresh rows did not sign anybody out. The
    // password-changed mail told the reader "Every device was signed out, so
    // you must sign in again", and a stolen access token kept working for the
    // rest of its fifteen minutes. That is the sentence somebody reads *after*
    // they suspect their account is compromised. `DELETE /auth/sessions/{id}`
    // had the same hole: it removed the device's ability to refresh and left it
    // able to act.
    //
    // **What it costs, said plainly:** one indexed lookup on every protected
    // request, which is the cost a JWT exists to avoid. It is paid because the
    // alternative is that signing out does not sign out. If it ever becomes the
    // bottleneck, the answer is a short-lived cache of revoked session ids and
    // not removing the check.
    // **The claims are checked before they are used, and that is not paranoia.**
    // `verifyAsync` proves the signature and returns whatever was inside. A
    // payload without `sub` or `sid` casts cleanly to the payload type and both
    // fields arrive here as `undefined`, which **Prisma drops from a `where`**
    // rather than matching against. Measured: the filter below reduces to
    // `{"OR":[{},{"familyId":null}]}`, and an empty object inside an `OR`
    // matches every row, so `findFirst` returns the first refresh row in the
    // table and this guard admits the request. It needs `JWT_SECRET`, so it is
    // a footgun rather than an open door, and a filter that silently means
    // "everything" is not a thing to leave written down.
    const { sub, sid } = request.user;
    if (!Number.isInteger(sub) || !Number.isInteger(sid)) {
      throw this.unauthorized();
    }

    const live = await this.prisma.refreshToken.findFirst({
      where: {
        userId: sub,
        OR: [{ familyId: sid }, { id: sid, familyId: null }],
        // **The same predicate the rotation uses.** Without it a refresh row
        // that has expired, or whose session ran past the absolute cap, still
        // authenticates every protected route: `POST /auth/refresh` answers 401
        // and `GET /auth/sessions` hides the row, while everything else answers
        // 200. Nothing ever deletes a dead row, which `auth.service.ts` says in
        // as many words, so the row is there to be found.
        //
        // `liveSessionWhere` was extracted so two places deciding the same
        // thing could not drift. This was the third place and it drifted.
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
    // Split on a run of spaces, not on one. RFC 7235 section 2.1 spells the gap
    // between the scheme and the credentials as `1*SP`, so two spaces is a
    // header the standard this service cites calls valid. Splitting on a single
    // space gave `['Bearer', '', 'abc']`, an empty token, and a 401 on every
    // protected route for a caller who did nothing wrong.
    const [scheme, token] = request.headers.authorization?.split(/ +/) ?? [];
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
