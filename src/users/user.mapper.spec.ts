import { toUserDto } from './user.mapper';
import { aUser } from './users.fixtures';

/**
 * Scaffolding only. Every `it.todo` below names a behaviour the contract or the
 * mapper promises. Convert one to an `it` and write the assertion yourself.
 *
 * `toUserDto` and `aUser` are imported and unused on purpose, so the file goes
 * red the moment either name moves.
 */
void toUserDto;
void aUser;

describe('toUserDto', () => {
  it.todo('returns the six fields the User schema names at openapi.yaml:1751');

  it.todo('omits passwordHash');

  it.todo('omits the reset token and its expiry');

  it.todo('returns createdAt as an ISO 8601 string and not a Date');

  it.todo('returns the role name from the loaded roles row');

  it.todo(
    'throws when the roles row holds a name the contract does not declare',
  );
});
