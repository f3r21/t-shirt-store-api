import { Test } from '@nestjs/testing';
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

/**
 * Scaffolding for the two /users operations.
 *
 * Every entry below is a behaviour the contract states, with the line that states
 * it. No entry is an assertion. Convert an `it.todo` to an `it` as you implement,
 * and write the assertion yourself.
 *
 * `prismaMockProvider` and `mailerMockProvider` hold the only casts, so this file
 * needs none. Both mocks are rebuilt in `beforeEach`, so no state crosses a test.
 *
 * `aUser()` returns a fixed row whose `passwordHash` is a real argon2id string,
 * so an assertion on a replaced hash compares against a value of the right shape.
 */
describe('UsersService', () => {
  // The `!` says these are assigned in `beforeEach`. The `void` statements below
  // keep the linter quiet until the first assertion reads them. Both go away as
  // the ten `it.todo` entries become real tests.
  let service!: UsersService;
  let prisma!: PrismaMock;
  let mailer!: MailerMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    mailer = createMailerMock();

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        prismaMockProvider(prisma),
        mailerMockProvider(mailer),
      ],
    }).compile();

    service = module.get(UsersService);
  });

  void service;
  void prisma;
  void mailer;
  void aUser;

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
