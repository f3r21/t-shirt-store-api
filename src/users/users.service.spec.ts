import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import argon2 from 'argon2';
import { UsersService } from './users.service';
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
import { aUser } from './users.fixtures';
import { nthArg } from '../common/mock-args';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { CreateUserDto } from './dto/create-user.dto';
import { Prisma } from '../generated/prisma/client';

/**
 * The two /users operations.
 *
 * Every entry below is a behaviour the contract states, with the line that states
 * it.
 *
 * `prismaMockProvider` and `mailerMockProvider` hold the only casts, so this file
 * needs none. Both mocks are rebuilt in `beforeEach`, so no state crosses a test.
 *
 * `aUser()` returns a fixed row whose `passwordHash` is a real argon2id string,
 * so an assertion on a replaced hash compares against a value of the right shape.
 */
const PASSWORD = 'correct horse battery';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaMock;
  let mailer: MailerMock;
  let digest: string;
  let logSpy: jest.SpyInstance;

  beforeAll(async () => {
    digest = await argon2.hash(PASSWORD);
  });

  beforeEach(async () => {
    prisma = createPrismaMock();
    mailer = createMailerMock();
    // Silenced as well as observed, for the password change line.
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        prismaMockProvider(prisma),
        mailerMockProvider(mailer),
      ],
    }).compile();

    service = module.get(UsersService);
    // Cleared after the compile, because Nest's loader writes its own
    // "dependencies initialized" line through the same prototype, and
    // `spyOn` hands back the same spy, calls included, on every test.
    logSpy.mockClear();
  });

  const validBody = (): CreateUserDto => ({
    email: 'ana@example.com',
    password: PASSWORD,
    firstName: 'Ana',
    lastName: 'Ramirez',
  });

  describe('createUser, POST /users', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 2, name: 'client' });
      prisma.user.create.mockResolvedValue(aUser());
    });

    it('returns the six fields the User schema names, and no seventh', async () => {
      const result = await service.createUser(validBody());

      expect(Object.keys(result).sort()).toEqual(
        ['id', 'email', 'firstName', 'lastName', 'role', 'createdAt'].sort(),
      );
    });

    it('stores an argon2id hash and never the password itself', async () => {
      await service.createUser(validBody());

      const call = nthArg(prisma.user.create) as {
        data: { passwordHash: string };
      };

      // Both halves. A hash of the wrong algorithm passes the second alone, and
      // storing the password under another key would pass the first alone.
      expect(call.data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(call.data.passwordHash).not.toBe(PASSWORD);
      expect(JSON.stringify(call)).not.toContain(PASSWORD);
      await expect(
        argon2.verify(call.data.passwordHash, PASSWORD),
      ).resolves.toBe(true);
    });

    it('gives the account the client role, whatever the request body says', async () => {
      // The DTO would have stripped a role, so the cast is what lets this test
      // prove the service reads the roles table rather than the body.
      await service.createUser({
        ...validBody(),
        role: 'manager',
      } as CreateUserDto & { role: string });

      expect(prisma.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'client' },
      });

      const call = nthArg(prisma.user.create) as { data: { roleId: number } };
      expect(call.data.roleId).toBe(2);
    });

    it('rejects an address that is already registered with the email-taken problem type and a 409', async () => {
      prisma.user.findUnique.mockResolvedValue(aUser());

      const err = await service
        .createUser(validBody())
        .then(() => null)
        .catch((e: unknown) => e as ProblemException);

      expect(err).toBeInstanceOf(ProblemException);
      expect(err?.type).toBe(ProblemType.EmailTaken);
      expect(err?.getStatus()).toBe(409);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('answers the same problem when two sign-ups race and the index rejects the loser', async () => {
      // Both requests pass the pre-check, then one loses on the unique index.
      // Without the catch this falls through to the generic P2002 branch, which
      // answers a bare 409 with no type, and the contract says a client
      // branches on the type and on nothing else.
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.0',
        }),
      );

      const err = await service
        .createUser(validBody())
        .then(() => null)
        .catch((e: unknown) => e as ProblemException);

      expect(err).toBeInstanceOf(ProblemException);
      expect(err?.type).toBe(ProblemType.EmailTaken);
      expect(err?.getStatus()).toBe(409);
    });

    it('reports the new id, so the controller can set the Location header', async () => {
      const result = await service.createUser(validBody());

      expect(result.id).toBe(128);
    });

    it('matches and stores the address in one case, so two capitalisations are one account', async () => {
      await service.createUser({ ...validBody(), email: 'Ana@EXAMPLE.com' });

      // The lookup and the insert must use the same form, or the uniqueness
      // check passes for an address that then collides on the index.
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'ana@example.com' },
      });
      const call = nthArg(prisma.user.create) as { data: { email: string } };
      expect(call.data.email).toBe('ana@example.com');
    });
  });

  describe('changePassword, PATCH /users/me/password', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(aUser({ passwordHash: digest }));
      prisma.user.update.mockResolvedValue(aUser());
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });
    });

    it('replaces the stored hash when the current password matches', async () => {
      await service.changePassword(128, {
        currentPassword: PASSWORD,
        newPassword: 'a brand new password',
      });

      const call = nthArg(prisma.user.update) as {
        where: { id: number };
        data: { passwordHash: string };
      };
      expect(call.where).toEqual({ id: 128 });
      expect(call.data.passwordHash).not.toBe(digest);
      await expect(
        argon2.verify(call.data.passwordHash, 'a brand new password'),
      ).resolves.toBe(true);
    });

    it('logs the change with the user id, and never the address', async () => {
      await service.changePassword(128, {
        currentPassword: PASSWORD,
        newPassword: 'a brand new password',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const logged = nthArg(logSpy as unknown as jest.Mock);
      expect(logged).toMatchObject({
        event: 'users.password-changed',
        userId: 128,
      });
      expect(JSON.stringify(logged)).not.toContain('ana@example.com');
    });

    it('rejects a wrong current password with a 401, because it is an authentication failure and not a permissions failure (openapi.yaml:452)', async () => {
      const err = await service
        .changePassword(128, {
          currentPassword: 'not the current one',
          newPassword: 'a brand new password',
        })
        .then(() => null)
        .catch((e: unknown) => e as ProblemException);

      expect(err).toBeInstanceOf(ProblemException);
      expect(err?.getStatus()).toBe(401);
      expect(err?.type).toBe(ProblemType.InvalidCredentials);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('deletes every refresh row for this user, including the row of the calling device (openapi.yaml:455)', async () => {
      await service.changePassword(128, {
        currentPassword: PASSWORD,
        newPassword: 'a brand new password',
      });

      // Argument equality rather than a call count, because the behaviour is
      // that nothing is excluded. A filter naming an id to keep would still be
      // one call.
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 128 },
      });
      // Every family ended, so every consumed row of the user goes with them,
      // or the next sign-in can be wiped by a token spent before the change.
      expect(prisma.consumedRefreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 128 },
      });
    });

    it('sends mail to the account address (openapi.yaml:457)', async () => {
      await service.changePassword(128, {
        currentPassword: PASSWORD,
        newPassword: 'a brand new password',
      });

      expect(mailer.sendPasswordChanged).toHaveBeenCalledWith(
        'ana@example.com',
      );
    });

    it('never reads the new password back out of the database', async () => {
      await service.changePassword(128, {
        currentPassword: PASSWORD,
        newPassword: 'a brand new password',
      });

      // There is no observable result here, which is why this is a call
      // assertion. A select or include on the update would put the fresh hash
      // into a value the caller could return by accident.
      const call = nthArg(prisma.user.update) as Record<string, unknown>;
      expect(call).not.toHaveProperty('select');
      expect(call).not.toHaveProperty('include');
    });

    it('clears any live reset token, so an unexpected reset mail cannot still be used', async () => {
      await service.changePassword(128, {
        currentPassword: PASSWORD,
        newPassword: 'a brand new password',
      });

      const call = nthArg(prisma.user.update) as {
        data: {
          resetTokenHash: string | null;
          resetTokenExpiresAt: Date | null;
        };
      };
      expect(call.data.resetTokenHash).toBeNull();
      expect(call.data.resetTokenExpiresAt).toBeNull();
    });
  });
});
