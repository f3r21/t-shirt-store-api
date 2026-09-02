import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body of POST /auth/refresh.
 *
 * The token is opaque, so the contract states two rules only: it is present and
 * it is bounded. See `openapi.yaml:259-266`.
 */
export class RefreshSessionDto {
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must not be empty' })
  @MaxLength(512, { message: 'must be at most 512 characters' })
  refreshToken!: string;
}
