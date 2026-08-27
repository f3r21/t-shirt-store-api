/**
 * Response shape of POST /auth/sessions and POST /auth/refresh.
 *
 * The two operations return the same shape, because refresh replaces both
 * tokens. A client stores them the same way. See `openapi.yaml:1707-1719`.
 */
export class SessionTokensDto {
  /** A bearer token. It is valid for 15 minutes. */
  accessToken!: string;

  /** It is valid for 7 days. It rotates on every use. */
  refreshToken!: string;
}
