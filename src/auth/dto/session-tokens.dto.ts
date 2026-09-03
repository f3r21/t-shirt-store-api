import { ApiSchema } from '@nestjs/swagger';
import { UserDto } from '../../users/dto/user.dto';

/** The contract's `SessionTokens`, returned by `createSession` and `refreshSession`. */
@ApiSchema({ name: 'SessionTokens' })
export class SessionTokensDto {
  /** The account that signed in, so a client needs no second request. */
  user!: UserDto;

  /** A bearer token. It is valid for 15 minutes. */
  accessToken!: string;

  /** It is valid for 7 days. It rotates on every use. */
  refreshToken!: string;
}
