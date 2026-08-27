import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body of POST /auth/reset-password.
 *
 * See `openapi.yaml:335-348`. A malformed body returns 400 from this class. A
 * token that is unknown or expired returns 422 from the service, because the body
 * is well formed and the server rejects it on its content.
 */
export class ResetPasswordDto {
  @IsString({ message: 'must be a string' })
  @MinLength(1, { message: 'must not be empty' })
  @MaxLength(512, { message: 'must be at most 512 characters' })
  token!: string;

  @IsString({ message: 'must be a string' })
  @MinLength(8, { message: 'must be at least 8 characters' })
  @MaxLength(128, { message: 'must be at most 128 characters' })
  password!: string;
}
