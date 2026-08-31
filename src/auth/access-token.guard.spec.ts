import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { Request } from 'express';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenPayload } from './access-token-payload';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from './decorators/optional-auth.decorator';

/**
 * The guard that decides who is authenticated, on every route.
 *
 * `roles.e2e-spec.ts` proves the two guards run in the right order and
 * `catalog-authz.e2e-spec.ts` proves the 401 reaches a caller, but neither can
 * separate the three causes behind that status. The contract gives the 401 a
 * type on one cause and no type on the others, and only this file can tell them
 * apart, because an end to end test would have to mint an expired token to reach
 * the branch that matters most.
 *
 * Three decisions are pinned here that a status code assertion would not catch.
 * The `@Public` short circuit has to happen before any token work, or a manager
 * holding an expired token could not sign in again. The absent type on the plain
 * 401 is deliberate and documented at `access-token.guard.ts:87-101`, so an
 * assertion that it stays absent protects that reasoning. And an optional route
 * tolerates no token while refusing a broken one, which is the distinction the
 * guard's own comment at `:57-58` names and which nothing else tests.
 */
describe('AccessTokenGuard', () => {
  const PAYLOAD: AccessTokenPayload = { sub: 7, sid: 12, role: 'client' };

  interface Harness {
    guard: AccessTokenGuard;
    context: ExecutionContext;
    request: Partial<Request>;
    verify: jest.Mock;
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
  ): Harness {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;

    const jwt = { verifyAsync: verify } as unknown as JwtService;

    const request: Partial<Request> = {
      headers: authorization ? { authorization } : {},
    };

    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return {
      guard: new AccessTokenGuard(jwt, reflector),
      context,
      request,
      verify,
    };
  }

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
  });

  describe('a protected route', () => {
    it('attaches the payload the roles guard reads', async () => {
      const { guard, context, request } = harness({}, 'Bearer good');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      // The contract between the two guards. `RolesGuard` reads `request.user`
      // and throws 401 when it is absent, so this assignment is what makes the
      // registration order in `auth.module.ts:44-45` mean anything.
      expect(request.user).toEqual(PAYLOAD);
    });

    it.each([
      ['no authorization header', undefined],
      ['a scheme that is not Bearer', 'Basic dXNlcjpwYXNz'],
      ['a lower case bearer scheme', 'bearer good'],
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
