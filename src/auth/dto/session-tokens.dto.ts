/**
 * Response shape of POST /auth/sessions and POST /auth/refresh.
 *
 * The two operations return the same shape, because refresh replaces both
 * tokens. A client stores them the same way. See `openapi.yaml:1718-1730`.
 */
import { UserDto } from '../../users/dto/user.dto';

export class SessionTokensDto {
  /**
   * The account that just signed in.
   *
   * Review round 5, 2026-08-25: the mentor asked that sign-in carry the user as
   * well as the tokens, so a client does not need a second request to learn who
   * it just signed in as. Required rather than optional, because the server
   * holds the row at that moment and an optional member would only invite a
   * client to handle an absence that never happens.
   */
  user!: UserDto;

  /** A bearer token. It is valid for 15 minutes. */
  accessToken!: string;

  /** It is valid for 7 days. It rotates on every use. */
  refreshToken!: string;
}
