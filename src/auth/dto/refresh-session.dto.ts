import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body of `refreshSession`. The token is opaque, so it is present and
 * bounded, nothing more.
 */
export class RefreshSessionDto {
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must not be empty' })
  @MaxLength(512, { message: 'must be at most 512 characters' })
  refreshToken!: string;
}
