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

/** Named once, because a test does arithmetic with it. */
const ABSOLUTE_CAP_DAYS = 30;

const CONFIG: Record<string, string | number> = {
  REFRESH_TOKEN_PEPPER: PEPPER,
  JWT_ACCESS_TTL: 900,
  JWT_REFRESH_TTL: 604800,
  REFRESH_ABSOLUTE_TTL_DAYS: ABSOLUTE_CAP_DAYS,
  REFRESH_GRACE_SECONDS: 10,
};

/** The password `aUser()` carries a real argon2id digest for. */
const PASSWORD = 'correct horse battery';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaMock;
  let mailer: MailerMock;
  let jwt: JwtService;
  let digest: string;

  /**
   * Counters, not stubs.
   *
   * The real Argon2id still runs, because a sign-in test that stubbed it would
   * stop proving that a correct password verifies. These only let a test ask
   * how many times the KDF ran, which is how the wrong-address and
   * wrong-password paths are compared for cost.
   */
  let hashSpy: jest.SpyInstance;
  let verifySpy: jest.SpyInstance;

  beforeAll(async () => {
    digest = await argon2.hash(PASSWORD);
  });

  beforeEach(async () => {
    prisma = createPrismaMock();
    mailer = createMailerMock();
    hashSpy = jest.spyOn(argon2, 'hash');
    verifySpy = jest.spyOn(argon2, 'verify');

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

    /**
     * The address is folded before it is looked up.
     *
     * `normalizeEmail` at `auth.service.ts:101` was unasserted, and deleting it
     * left all 245 tests green. Nothing in the suite ever sent an address that
     * was not already lower case, so the whole rule was invisible: every
     * existing test would pass against a server where signing up as
     * `Ana@Example.com` and signing in as `ana@example.com` are two accounts.
     *
     * The assertion reads the `where` handed to Prisma rather than the result,
     * because the mock returns a user whatever it is asked for. Asserting the
     * return value here would pass with the fold deleted, which is exactly the
     * failure this replaces.
     */
    it('folds the address before it looks the user up', async () => {
      await service.createSession({
        email: '  Ana@EXAMPLE.com  ',
        password: PASSWORD,
      });

      const call = nthArg(prisma.user.findUnique) as {
        where: { email: string };
      };
      expect(call.where.email).toBe('ana@example.com');
    });

    it('leaves an already folded address alone, which is the control', async () => {
      await service.createSession({
        email: 'ana@example.com',
        password: PASSWORD,
      });

      const call = nthArg(prisma.user.findUnique) as {
        where: { email: string };
      };
      expect(call.where.email).toBe('ana@example.com');
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

    it('returns the same invalid-credentials problem for a wrong address and for a wrong password (openapi.yaml:100)', async () => {
      // The fifth dimension, and the one this test used to be blind to: the two
      // paths must also cost the same. Counting Argon2id calls rather than
      // milliseconds, because a clock assertion in CI is flaky by construction
      // and the cost is the KDF. Deleting the `argon2.hash` on the null-user
      // path turns this red; nothing else here notices.
      const kdfCalls = (): number =>
        hashSpy.mock.calls.length + verifySpy.mock.calls.length;

      prisma.user.findUnique.mockResolvedValue(null);
      const before = kdfCalls();
      const wrongAddress = await rejection(
        service.createSession({
          email: 'nobody@example.com',
          password: PASSWORD,
        }),
      );
      const addressCost = kdfCalls() - before;

      prisma.user.findUnique.mockResolvedValue({
        ...signedInUser(),
        role: { id: 2, name: 'client' },
      });
      const beforePassword = kdfCalls();
      const wrongPassword = await rejection(
        service.createSession({
          email: 'ana@example.com',
          password: 'not the one',
        }),
      );
      const passwordCost = kdfCalls() - beforePassword;

      expect(addressCost).toBe(passwordCost);
      // Non-zero, or two paths that both do nothing would satisfy the line
      // above and prove nothing.
      expect(addressCost).toBe(1);

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

    it('returns the account that just signed in, so a client needs no second request', async () => {
      const result = await service.createSession({
        email: 'ana@example.com',
        password: PASSWORD,
      });

      // Review round 5, 2026-08-25. The same six fields POST /users returns, so a
      // client parses one schema and not two, and no more than six: the sign-in
      // path must not become a way to read a field the User schema excludes.
      expect(Object.keys(result.user).sort()).toEqual(
        ['createdAt', 'email', 'firstName', 'id', 'lastName', 'role'].sort(),
      );
      expect(result.user.role).toBe('client');
      expect(result.user).not.toHaveProperty('passwordHash');
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

    /**
     * The absolute cap, which is the only bound a rotating session cannot slip.
     *
     * `expiresAt` moves forward on every rotation, so a token refreshed every
     * fourteen minutes never expires. `createdAt` does not move, and this is the
     * clause that ends the session anyway. Delete it and a stolen refresh token
     * rotates forever with nothing to notice.
     *
     * The bound is asserted against the clock for the same reason the
     * `expiresAt` assertion is: `toBeInstanceOf(Date)` is satisfied by
     * `new Date(0)`, which is a cap that never fires.
     */
    it('refuses to rotate a session older than the absolute cap', async () => {
      rotates();
      const before = Date.now();
      const cap = ABSOLUTE_CAP_DAYS * 86400 * 1000;

      await service.refreshSession({ refreshToken: PRESENTED });

      const call = nthArg(prisma.refreshToken.updateManyAndReturn, 0, 0) as {
        where: { createdAt: { gt: Date } };
      };
      expect(call.where.createdAt.gt.getTime()).toBeGreaterThanOrEqual(
        before - cap,
      );
      expect(call.where.createdAt.gt.getTime()).toBeLessThanOrEqual(
        Date.now() - cap,
      );
    });

    /**
     * The sliding window, which is the other half of the pair above.
     *
     * The cap test asserts the bound that ends a session. This asserts the one
     * that keeps it alive: every rotation writes a new `expiresAt`, which is
     * what `openapi.yaml:1724` promises and what makes a refresh token useful
     * at all. `expiresAt` at `auth.service.ts:171` was unasserted, and deleting
     * it left the suite green. The column has no `@updatedAt` and no default
     * (`schema.prisma:52`), so without that line the expiry keeps whatever the
     * row was created with and every session dies seven days after sign-in
     * however often it is refreshed.
     *
     * Asserted against the clock, not against `toBeInstanceOf(Date)`, which
     * `new Date(0)` satisfies while expiring the session in 1970.
     */
    it('moves the expiry forward on every rotation', async () => {
      rotates();
      const before = Date.now();

      await service.refreshSession({ refreshToken: PRESENTED });

      const call = nthArg(prisma.refreshToken.updateManyAndReturn, 0, 0) as {
        data: { expiresAt: Date };
      };
      expect(call.data.expiresAt.getTime()).toBeGreaterThan(before);
      expect(call.data.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 604800 * 1000,
      );
    });

    it('keeps the session id, because rotation updates the row in place (openapi.yaml:241)', async () => {
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

    /**
     * The spent token is written down, and that is what makes a replay
     * detectable later.
     *
     * It used to go into `previous_token_hash`, one column that had to answer
     * two questions at once: which token is still acceptable during the grace
     * window, and which tokens have been spent. Holding both in one slot is
     * what made an honest second tab look like a thief.
     */
    it('records the presented hash as consumed, with its family and owner', async () => {
      rotates();

      await service.refreshSession({ refreshToken: PRESENTED });

      const call = nthArg(prisma.consumedRefreshToken.create, 0, 0) as {
        data: { tokenHash: string; familyId: number; userId: number };
      };
      expect(call.data.tokenHash).toBe(hashToken(PRESENTED, PEPPER));
      expect(call.data.userId).toBe(128);
      // The fixture row founds its own family, so the family is its own id.
      expect(call.data.familyId).toBe(42);
    });

    it('deletes every refresh row for the user when a token is presented twice (openapi.yaml:245)', async () => {
      // The conditional update matches nothing, because the row no longer
      // answers to this hash, and the hash is on record as spent, long enough
      // ago that the grace window has closed.
      prisma.refreshToken.updateManyAndReturn.mockResolvedValue([]);
      prisma.consumedRefreshToken.findFirst.mockResolvedValue({
        tokenHash: hashToken(PRESENTED, PEPPER),
        familyId: 42,
        userId: 128,
        consumedAt: new Date(Date.now() - 3600_000),
      });

      const err = await rejection(
        service.refreshSession({ refreshToken: PRESENTED }),
      );

      // Both halves matter. Rejecting without deleting leaves the thief signed
      // in, and deleting without rejecting hands the thief a fresh token.
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 128 },
      });
      // And the consumed rows go with the refresh rows, or the same token
      // wipes the owner's next sign-in too, for the life of the cap.
      expect(prisma.consumedRefreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 128 },
      });
      expect(err).toBeInstanceOf(ProblemException);
      expect(err.type).toBe(ProblemType.RefreshTokenUnknown);
      expect(err.getStatus()).toBe(401);
    });

    /**
     * A token the server has no record of is a string, not a replay.
     *
     * The `not.toHaveBeenCalled` is the whole test. The previous version looked
     * the presented hash up in `previous_token_hash` with no liveness filter
     * and no time bound, so a hash left behind by a session that expired weeks
     * ago deleted every live row the user had.
     */
    it('rejects an unknown token with the refresh-token-unknown problem type', async () => {
      prisma.refreshToken.updateManyAndReturn.mockResolvedValue([]);
      prisma.consumedRefreshToken.findFirst.mockResolvedValue(null);

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
      prisma.consumedRefreshToken.findFirst.mockResolvedValue(null);

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
      expect(call.where.userId).toBe(128);
    });

    /**
     * A dead row is not a device that is signed in.
     *
     * The contract calls this list "each device that is signed in", and the
     * filter was `{ userId }` alone. Nothing deletes a refresh row when its
     * window closes, so the list returned tokens that no longer work: expired
     * ones, and ones whose session had run past the thirty day cap. The list
     * grew for the life of the account, and `meta.total` counted sessions the
     * user could neither use nor recognise.
     *
     * Asserted against the clock rather than with `toBeInstanceOf(Date)`, which
     * `new Date(0)` satisfies while filtering nothing. Same reason the rotation
     * assertions above do it.
     */
    it('excludes the rows that are expired or past the absolute cap', async () => {
      prisma.refreshToken.findMany.mockResolvedValue([]);
      prisma.refreshToken.count.mockResolvedValue(0);
      const before = Date.now();
      const cap = ABSOLUTE_CAP_DAYS * 86400 * 1000;

      await service.listSessions(128, new PageQueryDto());

      const call = nthArg(prisma.refreshToken.findMany, 0, 0) as {
        where: { expiresAt: { gt: Date }; createdAt: { gt: Date } };
      };
      expect(call.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
      expect(call.where.expiresAt.gt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(call.where.createdAt.gt.getTime()).toBeGreaterThanOrEqual(
        before - cap,
      );
      expect(call.where.createdAt.gt.getTime()).toBeLessThanOrEqual(
        Date.now() - cap,
      );
    });

    /**
     * A device is a family, so two rows of one family are one entry.
     *
     * This is the assertion the whole family design exists for. The grace path
     * adds a row to an existing family, so counting rows would tell a user with
     * two tabs open that they are signed in on two devices, and offer them two
     * things to sign out of that are the same thing.
     *
     * `meta.total` counting the same way is no longer a separate risk: there is
     * one query and one grouped list, so the count and the page cannot drift.
     * The previous version issued a `findMany` and a `count` and needed a test
     * to hold their two `where` clauses together.
     */
    it('reports one entry per family, not one per row', async () => {
      const founder = aRefreshToken({ id: 42, familyId: null });
      prisma.refreshToken.findMany.mockResolvedValue([
        founder,
        aRefreshToken({ id: 77, familyId: 42 }),
        aRefreshToken({ id: 91, familyId: null }),
      ]);

      const result = await service.listSessions(128, new PageQueryDto());

      expect(result.meta.total).toBe(2);
      expect(result.data.map((s) => s.id).sort()).toEqual([42, 91]);
    });

    /**
     * The id a caller reads is the family, and the contract promises it is
     * stable: `openapi.yaml:244`, "The session id does not change, so an id
     * from `GET /auth/sessions` stays valid for the life of the device
     * session." A second tab must not rename the device.
     */
    it('names a family by its founder, whichever row is newest', async () => {
      prisma.refreshToken.findMany.mockResolvedValue([
        aRefreshToken({ id: 77, familyId: 42 }),
        aRefreshToken({ id: 42, familyId: null }),
      ]);

      const result = await service.listSessions(128, new PageQueryDto());

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(42);
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
      // Three families, a page of one. `total` answers "how many devices",
      // never "how many fitted on this page".
      prisma.refreshToken.findMany.mockResolvedValue([
        aRefreshToken({ id: 1, familyId: null }),
        aRefreshToken({ id: 2, familyId: null }),
        aRefreshToken({ id: 3, familyId: null }),
      ]);
      const query = new PageQueryDto();
      query.limit = 1;

      const result = await service.listSessions(128, query);

      expect(result.meta.total).toBe(3);
      expect(result.data).toHaveLength(1);
    });

    it('applies limit 20 and offset 0 when the query carries neither', async () => {
      // 25 families and a default query, so the page is the first 20 of them.
      // The query itself no longer carries `take` or `skip`: the group is not a
      // column, so the whole live set comes back and the page is cut after the
      // grouping. This asserts the page a caller receives rather than the SQL
      // that produced it, which is the only thing the contract promises.
      prisma.refreshToken.findMany.mockResolvedValue(
        Array.from({ length: 25 }, (_v, i) =>
          aRefreshToken({ id: i + 1, familyId: null }),
        ),
      );

      // Built from the DTO, so the assertion is about the contract's default
      // rather than about a literal written twice.
      const result = await service.listSessions(128, new PageQueryDto());

      const call = nthArg(prisma.refreshToken.findMany, 0, 0) as {
        orderBy: { createdAt?: string; id?: string }[];
      };
      expect(result.data).toHaveLength(20);
      expect(result.data[0].id).toBe(1);
      expect(result.meta.total).toBe(25);
      expect(result.meta.limit).toBe(20);
      expect(result.meta.offset).toBe(0);

      // The order has to pin the rows uniquely, or a page under LIMIT is an
      // unpredictable subset.
      expect(call.orderBy[call.orderBy.length - 1]).toEqual({ id: 'desc' });
    });
  });

  describe('deleteCurrentSession, DELETE /auth/sessions/current', () => {
    it('deletes every row of the calling device, and no other device', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteCurrentSession(128, 42);

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 128,
          OR: [{ familyId: 42 }, { id: 42, familyId: null }],
        },
      });
    });

    it('leaves the other devices signed in', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteCurrentSession(128, 42);

      const call = nthArg(prisma.refreshToken.deleteMany, 0, 0) as {
        where: { userId: number; OR: { familyId: number | null }[] };
      };
      // The filter names one family and the owner. A filter that named only the
      // user would sign every device out, which is what changePassword does and
      // this does not. It names the family rather than the row because a device
      // with two tabs open has two live rows, and deleting one of them would
      // leave the device signed in.
      expect(call.where.userId).toBe(128);
      expect(call.where.OR).toEqual([
        { familyId: 42 },
        { id: 42, familyId: null },
      ]);
      expect(Object.keys(call.where).sort()).toEqual(['OR', 'userId']);
    });
  });

  describe('deleteSession, DELETE /auth/sessions/{id}', () => {
    it('deletes one row of the calling user', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteSession(128, 42);

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 128,
          OR: [{ familyId: 42 }, { id: 42, familyId: null }],
        },
      });
    });

    it('returns 404 for a session id that belongs to another user, because a 403 would confirm it exists (openapi.yaml:213)', async () => {
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

    /**
     * The same fold, on the route where losing it is worse.
     *
     * A sign-in that fails tells the user to try again. A reset that silently
     * finds nobody answers 204 either way, by design, so a user whose address
     * was stored in one case and typed in another gets no mail and no reason.
     */
    it('folds the address before it looks the user up', async () => {
      prisma.user.findUnique.mockResolvedValue(signedInUser());
      prisma.user.update.mockResolvedValue(signedInUser());

      await service.requestPasswordReset({ email: 'Ana@EXAMPLE.com' });

      const call = nthArg(prisma.user.findUnique) as {
        where: { email: string };
      };
      expect(call.where.email).toBe('ana@example.com');
    });

    it('accepts an unknown address and sends no mail (openapi.yaml:290)', async () => {
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

    it('rejects an unknown token with 422 and not 400, because the body is well formed (openapi.yaml:333)', async () => {
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

    it('clears the reset token, so it works one time only (openapi.yaml:352)', async () => {
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

    it('deletes every refresh row for this user (openapi.yaml:337)', async () => {
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
