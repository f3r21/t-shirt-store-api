/**
 * The claims: `sub` the user id, `sid` the session family, and `role` because
 * no operation reads the current user. ADR 4.
 */
export interface AccessTokenPayload {
  sub: number;
  sid: number;
  role: string;
}
