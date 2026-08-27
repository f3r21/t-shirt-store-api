/**
 * Scaffolding for the two /users operations.
 *
 * Every entry below is a behaviour the contract states, with the line that states
 * it. No entry is an assertion. Convert an `it.todo` to an `it` as you implement,
 * and write the assertion yourself.
 *
 * When `UsersService` exists, wire it like this:
 *
 *     import { Test } from '@nestjs/testing';
 *     import { UsersService } from './users.service';
 *     import { PrismaService } from '../prisma/prisma.service';
 *     import {
 *       createPrismaMock,
 *       prismaMockProvider,
 *       PrismaMock,
 *     } from '../prisma/prisma.service.mock';
 *     import { aUser } from './users.fixtures';
 *
 *     let service: UsersService;
 *     let prisma: PrismaMock;
 *
 *     beforeEach(async () => {
 *       prisma = createPrismaMock();
 *       const module = await Test.createTestingModule({
 *         providers: [UsersService, prismaMockProvider(prisma)],
 *       }).compile();
 *       service = module.get(UsersService);
 *     });
 *
 * `prismaMockProvider` holds the only cast, so this file needs none.
 */

describe('UsersService', () => {
  describe('createUser, POST /users', () => {
    it.todo('returns the six fields the User schema names, and no seventh');

    it.todo('stores an argon2id hash and never the password itself');

    it.todo(
      'gives the account the client role, whatever the request body says',
    );

    it.todo(
      'rejects an address that is already registered with the email-taken problem type and a 409',
    );

    it.todo(
      'reports the new id, so the controller can set the Location header',
    );
  });

  describe('changePassword, PATCH /users/me/password', () => {
    it.todo('replaces the stored hash when the current password matches');

    it.todo(
      'rejects a wrong current password with a 401, because it is an authentication failure and not a permissions failure (openapi.yaml:441)',
    );

    it.todo(
      'deletes every refresh row for this user, including the row of the calling device (openapi.yaml:444)',
    );

    it.todo('sends mail to the account address (openapi.yaml:446)');

    it.todo('never reads the new password back out of the database');
  });
});
