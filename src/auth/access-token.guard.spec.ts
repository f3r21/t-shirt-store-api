import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import type { JwtService } from '@nestjs/jwt';
import { TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { AccessTokenGuard } from './access-token.guard';
import type { AccessTokenPayload } from './access-token-payload';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from './decorators/optional-auth.decorator';

/**
 * The guard, on every route. Three things a status assertion cannot catch:
 * the `@Public` short circuit before any token work, the plain 401 with no
 * type, and an optional route that tolerates no token while refusing a broken
 * one.
 */
describe('AccessTokenGuard', () => {
  const PAYLOAD: AccessTokenPayload = { sub: 7, sid: 12, role: 'client' };

  interface Harness {
    guard: AccessTokenGuard;
    context: ExecutionContext;
    request: Partial<Request>;
    verify: jest.Mock;
    session: jest.Mock;
  }

  /**
   * A context carrying the metadata a handler would have set, plus a header.
   *
   * `verify` is the seam. Passing a resolved payload, a `TokenExpiredError` or
   * any other rejection is how each branch is reached, and counting its calls is
   * how the public short circuit is proven rather than assumed.
   */
  function harness(
    metadata: Record<string, unknown>,
    authorization?: string,
    verify: jest.Mock = jest.fn().mockResolvedValue(PAYLOAD),
    // The session lookup. Defaults to a live session, so every test that is
    // about the header or the signature reads as it did before. A test about
    // revocation passes null.
    session: jest.Mock = jest.fn().mockResolvedValue({ id: 1 }),
  ): Harness {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;

    const jwt = { verifyAsync: verify } as unknown as JwtService;

    // `!== undefined` and not a truthiness check. `authorization ? … : {}`
    // turned `''` into a request with no header at all, so a test for an empty
    // header was really a second test for an absent one and passed without
    // touching the branch it named.
    const request: Partial<Request> = {
      headers: authorization !== undefined ? { authorization } : {},
    };

    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const prisma = {
      refreshToken: { findFirst: session },
    } as unknown as PrismaService;

    const config = {
      getOrThrow: () => 30,
    } as unknown as ConfigService<EnvironmentVariables, true>;

    return {
      guard: new AccessTokenGuard(jwt, reflector, prisma, config),
      context,
      request,
      verify,
      session,
    };
  }

  describe('a session that no longer exists', () => {
    /**
     * A signature is not a session.
     *
     * Verifying the token proves this server issued it and that it has not
     * expired. It says nothing about whether the session it names is still
     * alive, so deleting refresh rows used to remove a device's ability to
     * renew and leave it able to act for the rest of its fifteen minutes. The
     * password-changed mail said "Every device was signed out", which was not
     * true of the token in the thief's hand.
     */
    it('refuses a perfectly valid token whose session was revoked', async () => {
      const { guard, context } = harness(
        {},
        'Bearer good',
        jest.fn().mockResolvedValue(PAYLOAD),
        jest.fn().mockResolvedValue(null),
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    /** The lookup names the family and the owner, never the token. */
    it('looks the session up by family and by owner', async () => {
      const { guard, context, session } = harness({}, 'Bearer good');

      await guard.canActivate(context);

      const call = (session.mock.calls[0] as [Record<string, unknown>])[0];
      const where = call.where as Record<string, unknown>;
      expect(where.userId).toBe(PAYLOAD.sub);
      expect(where.OR).toEqual([
        { familyId: PAYLOAD.sid },
        { id: PAYLOAD.sid, familyId: null },
      ]);
    });

    /**
     * The liveness predicate: a dead row must not authenticate. Asserted as
     * shape, because the two `gt` values come from the clock.
     */
    it('asks only for a session that is still alive', async () => {
      const { guard, context, session } = harness({}, 'Bearer good');

      await guard.canActivate(context);

      const call = (session.mock.calls[0] as [Record<string, unknown>])[0];
      const where = call.where as {
        expiresAt?: { gt: Date };
        createdAt?: { gt: Date };
      };
      expect(where.expiresAt?.gt).toBeInstanceOf(Date);
      expect(where.createdAt?.gt).toBeInstanceOf(Date);
      // The cap reaches back, the expiry does not.
      expect(where.createdAt!.gt.getTime()).toBeLessThan(Date.now());
      expect(where.expiresAt!.gt.getTime()).toBeGreaterThan(
        where.createdAt!.gt.getTime(),
      );
    });

    /**
     * A signature is not a set of claims: an absent `sub` or `sid` reaches
     * Prisma as `undefined`, which it drops from a `where`, and
     * `{ OR: [{}, ...] }` matches every row. The last row is the control.
     */
    it.each([
      ['no claims at all', {}],
      ['no sub', { sid: 12, role: 'client' }],
      ['no sid', { sub: 7, role: 'client' }],
      ['a sub that is not an integer', { sub: 'seven', sid: 12 }],
    ])('refuses a signed token with %s', async (_label, payload) => {
      const { guard, context, session } = harness(
        {},
        'Bearer good',
        jest.fn().mockResolvedValue(payload),
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // And never reaches the database, so no `where` can be built from
      // undefined at all.
      expect(session).not.toHaveBeenCalled();
    });

    /**
     * The control, and it is the one that matters. Four tests above assert a
     * 401, and all four would pass on a guard that refused everything. This
     * says the same token is admitted while its session is alive.
     */
    it('admits the same token while the session is alive', async () => {
      const { guard, context, request } = harness({}, 'Bearer good');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(PAYLOAD);
    });

    /** A public route never reaches the database, the same as it never verifies. */
    it('does not query the session on a public route', async () => {
      const { guard, context, session } = harness(
        { [IS_PUBLIC_KEY]: true },
        'Bearer good',
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(session).not.toHaveBeenCalled();
    });
  });

  describe('a public route', () => {
    it('is admitted without a token', async () => {
      const { guard, context } = harness({ [IS_PUBLIC_KEY]: true });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    /**
     * The short circuit, and the reason `@Public` is wrong for the catalog reads
     * while `@OptionalAuth` is right. A public route returns before any token
     * work, so a caller holding a token the server would reject still reaches
     * the handler. Sign-in needs that. A product read does not, because a
     * manager sending a good token has to be recognised as a manager.
     */
    it('does no token work at all, even when a token is present', async () => {
      const { guard, context, verify, request } = harness(
        { [IS_PUBLIC_KEY]: true },
        'Bearer whatever',
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(verify).not.toHaveBeenCalled();
      expect(request.user).toBeUndefined();
    });
  });

  describe('an optional-auth route', () => {
    it('is admitted with no token, and no caller is attached', async () => {
      const { guard, context, request } = harness({
        [IS_OPTIONAL_AUTH_KEY]: true,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('attaches the caller when the token is good', async () => {
      const { guard, context, request } = harness(
        { [IS_OPTIONAL_AUTH_KEY]: true },
        'Bearer good',
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(PAYLOAD);
    });

    /**
     * The distinction the guard's comment names: optional tolerates the absence
     * of a token, not a broken one. A caller who sent a token meant it to be
     * recognised, so failing it silently would hand a manager the anonymous view
     * of the catalog and tell them nothing.
     */
    it('refuses a broken token rather than falling through as anonymous', async () => {
      const { guard, context } = harness(
        { [IS_OPTIONAL_AUTH_KEY]: true },
        'Bearer broken',
        jest.fn().mockRejectedValue(new Error('invalid signature')),
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    /**
     * A header whose scheme is unusable produces no token, and an optional
     * route must still refuse it.
     */
    it.each([
      ['a scheme that is not Bearer', 'Basic dXNlcjpwYXNz'],
      ['a scheme that merely starts with bearer', 'bearerish good'],
      ['Bearer with an empty token', 'Bearer '],
      ['a bare scheme with no token at all', 'Bearer'],
      ['a scheme followed by only spaces', 'Bearer    '],
    ])('refuses %s instead of serving it as anonymous', async (_l, header) => {
      const { guard, context } = harness(
        { [IS_OPTIONAL_AUTH_KEY]: true },
        header,
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    /**
     * A header that is present and empty is the absence of a credential, not
     * a broken one: a proxy that always injects the header must not turn the
     * anonymous catalog into a 401.
     */
    it.each([
      ['an empty header', ''],
      ['a header of spaces', '   '],
    ])('admits %s on an optional route, as anonymous', async (_l, header) => {
      const { guard, context, request } = harness(
        { [IS_OPTIONAL_AUTH_KEY]: true },
        header,
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    /**
     * The control. Without it the four cases above would pass on a guard that
     * refused every optional request, which is the opposite bug.
     */
    it('still admits a request that sends no header at all', async () => {
      const { guard, context, request } = harness({
        [IS_OPTIONAL_AUTH_KEY]: true,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });
  });

  describe('a protected route', () => {
    /**
     * RFC 7235 section 2.1 allows a run of spaces between the scheme and the
     * credentials. The single-space row is the control.
     */
    it.each([
      ['one space', 'Bearer good'],
      ['two spaces', 'Bearer  good'],
      ['several spaces', 'Bearer     good'],
    ])('accepts %s between the scheme and the token', async (_l, header) => {
      const { guard, context, request } = harness({}, header);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(PAYLOAD);
    });

    it('attaches the payload the roles guard reads', async () => {
      const { guard, context, request } = harness({}, 'Bearer good');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      // The contract between the two guards. `RolesGuard` reads `request.user`
      // and throws 401 when it is absent, so this assignment is what makes the
      // registration order in `auth.module.ts:44-45` mean anything.
      expect(request.user).toEqual(PAYLOAD);
    });

    /**
     * The scheme is case-insensitive, per RFC 7235 section 2.1 and the
     * contract's `bearerAuth` scheme.
     */
    it.each([
      ['Bearer', 'Bearer good'],
      ['bearer', 'bearer good'],
      ['BEARER', 'BEARER good'],
      ['BeArEr', 'BeArEr good'],
    ])('accepts the %s spelling of the scheme', async (_label, header) => {
      const { guard, context, request } = harness({}, header);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(PAYLOAD);
    });

    it.each([
      ['no authorization header', undefined],
      // Empty and blank read as absent, which the optional tier admits and
      // this tier refuses. Without these two rows the `.trim()` at
      // `access-token.guard.ts:87` was tested on one tier only.
      ['an empty authorization header', ''],
      ['an authorization header of spaces', '   '],
      ['a scheme that is not Bearer', 'Basic dXNlcjpwYXNz'],
      ['a scheme that merely starts with bearer', 'bearerish good'],
      ['Bearer with an empty token', 'Bearer '],
    ])('answers 401 to %s', async (_label, authorization) => {
      const { guard, context, verify } = harness({}, authorization);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // None of these reached verification, so none of them can be reported as
      // an expired or otherwise invalid token.
      expect(verify).not.toHaveBeenCalled();
    });

    /**
     * The absent type is the assertion, not an oversight in the test.
     * `access-token.guard.ts:87-101` records why: the contract reserves
     * `invalid-credentials` for an email and password the server rejected, and
     * returning it on a request that carried no credentials at all tells the
     * caller something untrue. RFC 9457 reads an absent type as `about:blank`,
     * meaning the status code is the whole story.
     */
    it('gives the plain 401 no problem type', async () => {
      const { guard, context } = harness({});

      const err = await guard.canActivate(context).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err).not.toBeInstanceOf(ProblemException);
      expect((err as UnauthorizedException).getResponse()).toEqual({
        title: 'Unauthorized',
        detail: 'This operation needs a bearer token.',
      });
    });

    /**
     * The one 401 the contract does type, and the branch an end to end test
     * cannot reach without minting an expired token. A client that cannot tell
     * this apart from the others loops between refreshing and sending the user
     * back to the sign-in screen.
     */
    it('types the expired token so a client knows to refresh', async () => {
      const { guard, context } = harness(
        {},
        'Bearer expired',
        jest
          .fn()
          .mockRejectedValue(new TokenExpiredError('jwt expired', new Date())),
      );

      const err = await guard.canActivate(context).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ProblemException);
      const problem = err as ProblemException;
      expect(problem.type).toBe(ProblemType.AccessTokenExpired);
      expect(problem.getStatus()).toBe(401);
      expect(problem.detail).toBe(
        'Refresh the token and send the request again.',
      );
    });

    it('answers a plain 401 when verification fails for any other reason', async () => {
      const { guard, context } = harness(
        {},
        'Bearer forged',
        jest.fn().mockRejectedValue(new Error('invalid signature')),
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.not.toBeInstanceOf(
        ProblemException,
      );
    });
  });
});
