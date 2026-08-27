/**
 * Scaffolding for the seven /auth operations.
 *
 * Every entry is a behaviour the contract states, with the line that states it
 * where the line is not obvious. No entry is an assertion.
 *
 * Wire it the way `src/users/users.service.spec.ts` describes, with
 * `createPrismaMock`, `prismaMockProvider` and `aRefreshToken`. Add a `JwtService`
 * mock, or register the real `JwtModule` with a fixed secret, and say in the
 * decision ledger which you chose and why.
 */

describe('AuthService', () => {
  describe('createSession, POST /auth/sessions', () => {
    it.todo('returns an access token and a refresh token');

    it.todo('creates one refresh row for this device');

    it.todo('stores a hash of the refresh token and never the token itself');

    it.todo('stores the device name when the body sends one');

    it.todo(
      'returns the same invalid-credentials problem for a wrong address and for a wrong password (openapi.yaml:91)',
    );

    it.todo('reports the new session id, so the controller can set Location');
  });

  describe('refreshSession, POST /auth/refresh', () => {
    it.todo('returns a new access token and a new refresh token');

    it.todo(
      'keeps the session id, because rotation updates the row in place (openapi.yaml:230)',
    );

    it.todo('stops the presented token from working a second time');

    it.todo('moves the presented hash into previous_token_hash');

    it.todo(
      'deletes every refresh row for the user when a token is presented twice (openapi.yaml:234)',
    );

    it.todo(
      'rejects an unknown token with the refresh-token-unknown problem type',
    );

    it.todo(
      'rejects an expired token with the refresh-token-unknown problem type',
    );
  });

  describe('listSessions, GET /auth/sessions', () => {
    it.todo('returns a data and meta envelope, and never a bare array');

    it.todo('returns the rows of the calling user only');

    it.todo('leaves the deviceName key absent when the row holds none');

    it.todo('reports the total before limit and offset apply');

    it.todo('applies limit 20 and offset 0 when the query carries neither');
  });

  describe('deleteCurrentSession, DELETE /auth/sessions/current', () => {
    it.todo('deletes the refresh row of the calling device only');

    it.todo('leaves the other devices signed in');
  });

  describe('deleteSession, DELETE /auth/sessions/{id}', () => {
    it.todo('deletes one row of the calling user');

    it.todo(
      'returns 404 for a session id that belongs to another user, because a 403 would confirm it exists (openapi.yaml:202)',
    );

    it.todo('returns 404 for a session id that does not exist');
  });

  describe('requestPasswordReset, POST /auth/forgot-password', () => {
    it.todo('accepts a registered address and sends the reset mail');

    it.todo('accepts an unknown address and sends no mail (openapi.yaml:279)');

    it.todo('answers both the same way, so the caller cannot tell them apart');

    it.todo('stores a hash of the reset token and never the token itself');

    it.todo('sets the reset token expiry');
  });

  describe('resetPassword, POST /auth/reset-password', () => {
    it.todo('replaces the stored password hash');

    it.todo(
      'rejects an unknown token with 422 and not 400, because the body is well formed (openapi.yaml:322)',
    );

    it.todo('rejects an expired token with 422');

    it.todo(
      'clears the reset token, so it works one time only (openapi.yaml:341)',
    );

    it.todo('deletes every refresh row for this user (openapi.yaml:326)');

    it.todo('sends mail to the account address');
  });
});
