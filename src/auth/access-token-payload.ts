/**
 * What the access token carries, and why each claim is there.
 *
 * `sub` is the user id, which is the registered JWT claim for the subject.
 *
 * `sid` is the id of this device's refresh row. It is not decoration:
 * `DELETE /auth/sessions/current` deletes the row for the device that sent the
 * request, and that request carries an access token and nothing else, so
 * without this claim the server cannot name the row. The contract keeps the
 * session id stable across rotation, so the claim stays true for the life of
 * the session.
 *
 * `role` is here because the contract has no operation that reads the current
 * user, so nothing else would tell a guard what the caller is. The cost is that
 * a role change lags by one access token lifetime, which is the same lag the
 * contract already accepts for revocation.
 */
export interface AccessTokenPayload {
  sub: number;
  sid: number;
  role: string;
}
