import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { AuthService } from './auth.service';
import {
  createPrismaMock,
  prismaMockProvider,
  PrismaMock,
} from '../prisma/prisma.service.mock';
import {
  createMailerMock,
  mailerMockProvider,
  MailerMock,
} from '../mail/mailer.mock';
import { aRefreshToken } from './auth.fixtures';
import { aUser } from '../users/users.fixtures';
import { hashToken } from './token-hash';
import { nthArg } from '../common/mock-args';
import { HttpException } from '@nestjs/common';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { AccessTokenPayload } from './access-token-payload';

/**
 * The seven /auth operations.
 *
 * Every entry names a behaviour the contract states, with the line that states it
 * where the line is not obvious.
 *
 * The module registers the real `JwtModule` with a fixed secret rather than a
 * `JwtService` mock. Rotation is the one operation where signing is the behaviour
 * under test, and a mock would assert that the service called a method rather
 * than that a rotated token verifies.
 */
const PEPPER = 'test-pepper-at-least-32-characters-long';
const SECRET = 'test-secret-at-least-32-characters-long';

const CONFIG: Record<string, string | number> = {
  REFRESH_TOKEN_PEPPER: PEPPER,
  JWT_ACCESS_TTL: 900,
  JWT_REFRESH_TTL: 604800,
  REFRESH_ABSOLUTE_TTL_DAYS: 30,
};

/** The password `aUser()` carries a real argon2id digest for. */
const PASSWORD = 'correct horse battery';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaMock;
  let mailer: MailerMock;
  let jwt: JwtService;
  let digest: string;

  beforeAll(async () => {
    digest = await argon2.hash(PASSWORD);
  });

  beforeEach(async () => {
    prisma = createPrismaMock();
    mailer = createMailerMock();

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: SECRET,
          signOptions: { expiresIn: 900 },
        }),
      ],
      providers: [
        AuthService,
        prismaMockProvider(prisma),
        mailerMockProvider(mailer),
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => CONFIG[key] },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    jwt = module.get(JwtService);
  });

  /** The row `aUser()` describes, with a digest the tests can sign in against. */
  const signedInUser = () => aUser({ passwordHash: digest });

  /**
   * Await a call that must reject, and hand back the error already narrowed.
   *
   * `promise.catch((e) => e)` widens the result to the union of the resolved
   * value and the error, so every assertion after it needs a cast. This keeps
   * the cast in one place and fails loudly when a call that should reject does
   * not, which a bare catch would silently pass.
   */
  const rejection = async <T extends HttpException = ProblemException>(
    promise: Promise<unknown>,
  ): Promise<T> => {
    let caught: unknown;
    let resolved = false;
    try {
      await promise;
      resolved = true;
    } catch (err) {
      caught = err;
    }
    if (resolved) {
      throw new Error('expected the call to reject, and it resolved');
    }
    return caught as T;
  };

  const expectProblem = async (
    promise: Promise<unknown>,
    type: string,
    status: number,
  ) => {
    const err = await rejection(promise);
    expect(err).toBeInstanceOf(ProblemException);
    expect(err.type).toBe(type);
    expect(err.getStatus()).toBe(status);
  };

  describe('createSession, POST /auth/sessions', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        ...signedInUser(),
        role: { id: 2, name: 'client' },
      });
      prisma.refreshToken.create.mockResolvedValue(aRefreshToken());
    });

    it('returns an access token and a refresh token', async () => {
      const result = await service.createSession({
        email: 'ana@example.com',
        password: PASSWORD,
      });

      expect(typeof result.accessToken).toBe('string');
      expect(result.accessToken.length).toBeGreaterThan(0);
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.length).toBeGreaterThan(0);

      // The access token is a JWT and it verifies against the module's secret.
      const payload = jwt.verify<AccessTokenPayload>(result.accessToken);
      expect(payload.sub).toBe(128);
      expect(payload.role).toBe('client');
    });

    it('creates one refresh row for this device, owned by the caller and with an expiry', async () => {
      const before = Date.now();
      await service.createSession({
        email: 'ana@example.com',
        password: PASSWORD,
      });

      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);

      const created = nthArg(prisma.refreshToken.create) as {
        data: { userId: number; expiresAt: Date };
      };
      // Without these two the row could belong to anybody and never expire, and
      // every other assertion in this block would still pass.
      expect(created.data.userId).toBe(128);
      expect(created.data.expiresAt.getTime()).toBeGreaterThan(before);
      expect(created.data.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 604800 * 1000,
      );
    });

    it('stores a hash of the refresh token and never the token itself', async () => {
      const result = await service.createSession({
        email: 'ana@example.com',
        password: PASSWORD,
      });

      const call = nthArg(prisma.refreshToken.create, 0, 0) as {
        data: { tokenHash: string };
      };

      expect(call.data.tokenHash).toBe(hashToken(result.refreshToken, PEPPER));
      expect(call.data.tokenHash).not.toBe(result.refreshToken);

      // The negative is asserted on the whole call, not on one field, so a token
      // copied into some other column would fail this too.
      expect(JSON.stringify(call)).not.toContain(result.refreshToken);
    });

    it('stores the device name when the body sends one', async () => {
      await service.createSession({
        email: 'ana@example.com',
        password: PASSWORD,
        deviceName: 'Ana iPhone',
      });

      const call = nthArg(prisma.refreshToken.create, 0, 0) as {
        data: { deviceName?: string };
      };
      expect(call.data.deviceName).toBe('Ana iPhone');
    });

    it('returns the same invalid-credentials problem for a wrong address and for a wrong password (openapi.yaml:91)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const wrongAddress = await rejection(
        service.createSession({
          email: 'nobody@example.com',
          password: PASSWORD,
        }),
      );

      prisma.user.findUnique.mockResolvedValue({
        ...signedInUser(),
        role: { id: 2, name: 'client' },
      });
      const wrongPassword = await rejection(
        service.createSession({
          email: 'ana@example.com',
          password: 'not the one',
        }),
      );

      // The two must be indistinguishable, so they are compared to each other
      // rather than each being checked for a 401 on its own.
      expect(wrongAddress).toBeInstanceOf(ProblemException);
      expect(wrongPassword).toBeInstanceOf(ProblemException);
      expect(wrongAddress.getStatus()).toBe(wrongPassword.getStatus());
      expect(wrongAddress.type).toBe(wrongPassword.type);
      expect(wrongAddress.message).toBe(wrongPassword.message);
      expect(wrongAddress.detail).toBe(wrongPassword.detail);
      expect(wrongAddress.type).toBe(ProblemType.InvalidCredentials);
      expect(wrongAddress.getStatus()).toBe(401);
    });

    it('reports the new session id, so the controller can set Location', async () => {
      const result = await service.createSession({
        email: 'ana@example.com',
        password: PASSWORD,
      });

      expect(result.sessionId).toBe(42);
    });
  });

  describe('refreshSession, POST /auth/refresh', () => {
    const PRESENTED = 'a'.repeat(64);

    const rotates = () => {
      prisma.refreshToken.updateManyAndReturn.mockResolvedValue([
        aRefreshToken(),
      ]);
      prisma.user.findUnique.mockResolvedValue({
        ...signedInUser(),
        role: { id: 2, name: 'client' },
      });
    };

    it('returns a new access token and a new refresh token', async () => {
      rotates();

      const result = await service.refreshSession({
        refreshToken: PRESENTED,
      });

      expect(typeof result.accessToken).toBe('string');
      expect(result.refreshToken).not.toBe(PRESENTED);
      expect(result.refreshToken).toHaveLength(64);
      expect(jwt.verify<AccessTokenPayload>(result.accessToken).sub).toBe(128);
    });

    it('keeps the session id, because rotation updates the row in place (openapi.yaml:230)', async () => {
      rotates();

      const result = await service.refreshSession({ refreshToken: PRESENTED });

      // The write is an update, never a delete followed by a create, and the
      // session id in the reissued token is the id of the same row.
      expect(prisma.refreshToken.delete).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(jwt.verify<AccessTokenPayload>(result.accessToken).sid).toBe(42);
    });

    it('stops the presented token from working a second time', async () => {
      rotates();

      const result = await service.refreshSession({ refreshToken: PRESENTED });

      const call = nthArg(prisma.refreshToken.updateManyAndReturn, 0, 0) as {
        where: { tokenHash: string };
        data: { tokenHash: string };
      };

      // The row now answers to the new token's hash and no longer to the old.
      expect(call.where.tokenHash).toBe(hashToken(PRESENTED, PEPPER));
      expect(call.data.tokenHash).toBe(hashToken(result.refreshToken, PEPPER));
      expect(call.data.tokenHash).not.toBe(call.where.tokenHash);
    });

    it('moves the presented hash into previous_token_hash', async () => {
      rotates();

      await service.refreshSession({ refreshToken: PRESENTED });

      const call = nthArg(prisma.refreshToken.updateManyAndReturn, 0, 0) as {
        data: { previousTokenHash: string };
      };
      expect(call.data.previousTokenHash).toBe(hashToken(PRESENTED, PEPPER));
    });

    it('deletes every refresh row for the user when a token is presented twice (openapi.yaml:234)', async () => {
      // The conditional update matches nothing, because the row no longer
      // answers to this hash, and the hash is found in previous_token_hash.
      prisma.refreshToken.updateManyAndReturn.mockResolvedValue([]);
      prisma.refreshToken.findFirst.mockResolvedValue(
        aRefreshToken({ previousTokenHash: hashToken(PRESENTED, PEPPER) }),
      );

      const err = await rejection(
        service.refreshSession({ refreshToken: PRESENTED }),
      );

      // Both halves matter. Rejecting without deleting leaves the thief signed
      // in, and deleting without rejecting hands the thief a fresh token.
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 128 },
      });
      expect(err).toBeInstanceOf(ProblemException);
      expect(err.type).toBe(ProblemType.RefreshTokenUnknown);
      expect(err.getStatus()).toBe(401);
    });

    it('rejects an unknown token with the refresh-token-unknown problem type', async () => {
      prisma.refreshToken.updateManyAndReturn.mockResolvedValue([]);
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expectProblem(
        service.refreshSession({ refreshToken: PRESENTED }),
        ProblemType.RefreshTokenUnknown,
        401,
      );
      expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects an expired token with the refresh-token-unknown problem type', async () => {
      // Expiry is part of the conditional update's WHERE clause, so an expired
      // row matches nothing and takes the same path as an unknown token.
      const before = Date.now();
      prisma.refreshToken.updateManyAndReturn.mockResolvedValue([]);
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      const expired = await rejection(
        service.refreshSession({ refreshToken: PRESENTED }),
      );

      prisma.refreshToken.updateManyAndReturn.mockResolvedValue([]);
      const unknown = await rejection(
        service.refreshSession({ refreshToken: 'b'.repeat(64) }),
      );

      expect(expired.type).toBe(unknown.type);
      expect(expired.getStatus()).toBe(unknown.getStatus());
      expect(expired.message).toBe(unknown.message);

      const call = nthArg(prisma.refreshToken.updateManyAndReturn, 0, 0) as {
        where: { expiresAt: { gt: Date } };
      };
      // The bound must be *now*, not merely a Date. `toBeInstanceOf(Date)`
      // alone is satisfied by `new Date(0)`, which would let a row that expired
      // months ago rotate forever while this test stayed green.
      expect(call.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
      expect(call.where.expiresAt.gt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('listSessions, GET /auth/sessions', () => {
    it('returns a data and meta envelope, and never a bare array', async () => {
      prisma.refreshToken.findMany.mockResolvedValue([aRefreshToken()]);
      prisma.refreshToken.count.mockResolvedValue(1);

      const result = await service.listSessions(128, new PageQueryDto());

      expect(Object.keys(result).sort()).toEqual(['data', 'meta']);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('returns the rows of the calling user only', async () => {
      prisma.refreshToken.findMany.mockResolvedValue([]);
      prisma.refreshToken.count.mockResolvedValue(0);

      await service.listSessions(128, new PageQueryDto());

      const call = nthArg(prisma.refreshToken.findMany, 0, 0) as {
        where: { userId: number };
      };
      expect(call.where).toEqual({ userId: 128 });
    });

    it('leaves the deviceName key absent when the row holds none', async () => {
      prisma.refreshToken.findMany.mockResolvedValue([
        aRefreshToken({ deviceName: null }),
      ]);
      prisma.refreshToken.count.mockResolvedValue(1);

      const result = await service.listSessions(128, new PageQueryDto());

      // `not.toHaveProperty` and not `toBeUndefined`, which would pass on a
      // present key holding undefined. The contract says absent, never null.
      expect(result.data[0]).not.toHaveProperty('deviceName');
    });

    it('reports the total before limit and offset apply', async () => {
      prisma.refreshToken.findMany.mockResolvedValue([aRefreshToken()]);
      prisma.refreshToken.count.mockResolvedValue(347);

      const result = await service.listSessions(128, new PageQueryDto());

      expect(result.meta.total).toBe(347);
      expect(result.data).toHaveLength(1);

      const countCall = nthArg(prisma.refreshToken.count, 0, 0) as Record<
        string,
        unknown
      >;
      expect(countCall).toEqual({ where: { userId: 128 } });
      expect(countCall).not.toHaveProperty('take');
      expect(countCall).not.toHaveProperty('skip');
    });

    it('applies limit 20 and offset 0 when the query carries neither', async () => {
      prisma.refreshToken.findMany.mockResolvedValue([]);
      prisma.refreshToken.count.mockResolvedValue(0);

      // Built from the DTO, so the assertion is about the contract's default
      // rather than about a literal written twice.
      const result = await service.listSessions(128, new PageQueryDto());

      const call = nthArg(prisma.refreshToken.findMany, 0, 0) as {
        take: number;
        skip: number;
        orderBy: { createdAt?: string; id?: string }[];
      };
      expect(call.take).toBe(20);
      expect(call.skip).toBe(0);
      expect(result.meta.limit).toBe(20);
      expect(result.meta.offset).toBe(0);

      // The order has to pin the rows uniquely, or a page under LIMIT is an
      // unpredictable subset.
      expect(call.orderBy[call.orderBy.length - 1]).toEqual({ id: 'desc' });
    });
  });

  describe('deleteCurrentSession, DELETE /auth/sessions/current', () => {
    it('deletes the refresh row of the calling device only', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteCurrentSession(128, 42);

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { id: 42, userId: 128 },
      });
    });

    it('leaves the other devices signed in', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteCurrentSession(128, 42);

      const call = nthArg(prisma.refreshToken.deleteMany, 0, 0) as {
        where: Record<string, unknown>;
      };
      // The filter names one id. A filter that named only the user would sign
      // every device out, which is what changePassword does and this does not.
      expect(call.where.id).toBe(42);
      expect(Object.keys(call.where).sort()).toEqual(['id', 'userId']);
    });
  });

  describe('deleteSession, DELETE /auth/sessions/{id}', () => {
    it('deletes one row of the calling user', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteSession(128, 42);

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { id: 42, userId: 128 },
      });
    });

    it('returns 404 for a session id that belongs to another user, because a 403 would confirm it exists (openapi.yaml:202)', async () => {
      // The row exists, but not for this user, so the scoped delete matches
      // nothing and the service cannot tell that case from an absent id.
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.deleteSession(128, 999)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('returns 404 for a session id that does not exist', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      const absent = await rejection(service.deleteSession(128, 1000));

      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      const notYours = await rejection(service.deleteSession(128, 999));

      // The two causes must be indistinguishable to the caller.
      expect(absent.getStatus()).toBe(notYours.getStatus());
      expect(absent.getStatus()).toBe(404);
    });
  });

  describe('requestPasswordReset, POST /auth/forgot-password', () => {
    it('accepts a registered address and sends the reset mail', async () => {
      prisma.user.findUnique.mockResolvedValue(signedInUser());
      prisma.user.update.mockResolvedValue(signedInUser());

      await service.requestPasswordReset({ email: 'ana@example.com' });

      expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
      expect(nthArg(mailer.sendPasswordReset, 0, 0)).toBe('ana@example.com');
    });

    it('accepts an unknown address and sends no mail (openapi.yaml:279)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.requestPasswordReset({ email: 'nobody@example.com' }),
      ).resolves.toBeUndefined();

      expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('answers both the same way, so the caller cannot tell them apart', async () => {
      prisma.user.findUnique.mockResolvedValue(signedInUser());
      prisma.user.update.mockResolvedValue(signedInUser());
      const registered = await service.requestPasswordReset({
        email: 'ana@example.com',
      });

      prisma.user.findUnique.mockResolvedValue(null);
      const unknown = await service.requestPasswordReset({
        email: 'nobody@example.com',
      });

      expect(registered).toBe(unknown);
      expect(registered).toBeUndefined();
    });

    it('stores a hash of the reset token and never the token itself', async () => {
      prisma.user.findUnique.mockResolvedValue(signedInUser());
      prisma.user.update.mockResolvedValue(signedInUser());

      await service.requestPasswordReset({ email: 'ana@example.com' });

      const mailed = nthArg(mailer.sendPasswordReset, 1, 0) as string;
      const call = nthArg(prisma.user.update, 0, 0) as {
        data: { resetTokenHash: string };
      };

      expect(call.data.resetTokenHash).toBe(hashToken(mailed, PEPPER));
      expect(call.data.resetTokenHash).not.toBe(mailed);
      expect(JSON.stringify(call)).not.toContain(mailed);
    });

    it('sets the reset token expiry', async () => {
      prisma.user.findUnique.mockResolvedValue(signedInUser());
      prisma.user.update.mockResolvedValue(signedInUser());

      const before = Date.now();
      await service.requestPasswordReset({ email: 'ana@example.com' });

      const call = nthArg(prisma.user.update, 0, 0) as {
        data: { resetTokenExpiresAt: Date };
      };
      expect(call.data.resetTokenExpiresAt).toBeInstanceOf(Date);
      expect(call.data.resetTokenExpiresAt.getTime()).toBeGreaterThan(before);
    });
  });

  describe('resetPassword, POST /auth/reset-password', () => {
    const TOKEN = 'c'.repeat(64);

    it('replaces the stored password hash', async () => {
      prisma.user.updateManyAndReturn.mockResolvedValue([signedInUser()]);

      await service.resetPassword({ token: TOKEN, password: 'a new password' });

      const call = nthArg(prisma.user.updateManyAndReturn, 0, 0) as {
        data: { passwordHash: string };
      };
      expect(call.data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(call.data.passwordHash).not.toBe(digest);
      await expect(
        argon2.verify(call.data.passwordHash, 'a new password'),
      ).resolves.toBe(true);
    });

    it('rejects an unknown token with 422 and not 400, because the body is well formed (openapi.yaml:322)', async () => {
      prisma.user.updateManyAndReturn.mockResolvedValue([]);

      await expect(
        service.resetPassword({ token: TOKEN, password: 'a new password' }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('rejects an expired token with 422', async () => {
      // Expiry rides in the same WHERE clause, so an expired token matches
      // nothing and answers exactly as an unknown one does.
      const before = Date.now();
      prisma.user.updateManyAndReturn.mockResolvedValue([]);
      const err = await rejection(
        service.resetPassword({ token: TOKEN, password: 'a new password' }),
      );

      expect(err.getStatus()).toBe(422);
      const call = nthArg(prisma.user.updateManyAndReturn, 0, 0) as {
        where: { resetTokenExpiresAt: { gt: Date } };
      };
      // Same reasoning as the refresh bound: a Date is not enough, it has to
      // be now, or a link mailed six months ago still sets a password.
      expect(
        call.where.resetTokenExpiresAt.gt.getTime(),
      ).toBeGreaterThanOrEqual(before);
      expect(call.where.resetTokenExpiresAt.gt.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    });

    it('clears the reset token, so it works one time only (openapi.yaml:341)', async () => {
      prisma.user.updateManyAndReturn.mockResolvedValue([signedInUser()]);

      await service.resetPassword({ token: TOKEN, password: 'a new password' });

      const call = nthArg(prisma.user.updateManyAndReturn, 0, 0) as {
        where: { resetTokenHash: string };
        data: { resetTokenHash: null; resetTokenExpiresAt: null };
      };
      expect(call.where.resetTokenHash).toBe(hashToken(TOKEN, PEPPER));
      expect(call.data.resetTokenHash).toBeNull();
      expect(call.data.resetTokenExpiresAt).toBeNull();
    });

    it('rejects a second submission of an already used token with 422', async () => {
      prisma.user.updateManyAndReturn.mockResolvedValue([signedInUser()]);
      await service.resetPassword({ token: TOKEN, password: 'a new password' });

      // The row's hash was cleared by the first call, so the second matches
      // nothing. Clearing inside the same statement is what makes this true
      // even for two submissions that arrive together.
      prisma.user.updateManyAndReturn.mockResolvedValue([]);
      await expect(
        service.resetPassword({ token: TOKEN, password: 'another password' }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('deletes every refresh row for this user (openapi.yaml:326)', async () => {
      prisma.user.updateManyAndReturn.mockResolvedValue([signedInUser()]);

      await service.resetPassword({ token: TOKEN, password: 'a new password' });

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 128 },
      });
    });

    it('sends mail to the account address', async () => {
      prisma.user.updateManyAndReturn.mockResolvedValue([signedInUser()]);

      await service.resetPassword({ token: TOKEN, password: 'a new password' });

      expect(mailer.sendPasswordChanged).toHaveBeenCalledWith(
        'ana@example.com',
      );
    });
  });
});
