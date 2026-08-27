import { toSessionDto } from './session.mapper';
import { aRefreshToken } from './auth.fixtures';

/**
 * Scaffolding only. Convert an `it.todo` to an `it` and write the assertion.
 */
void toSessionDto;
void aRefreshToken;

describe('toSessionDto', () => {
  it.todo('returns id, createdAt and expiresAt');

  it.todo('omits tokenHash and previousTokenHash');

  it.todo('returns deviceName when the row holds one');

  it.todo(
    'leaves the deviceName key absent when the column is null, so the object has no such property',
  );

  it.todo('returns both dates as ISO 8601 strings');
});
