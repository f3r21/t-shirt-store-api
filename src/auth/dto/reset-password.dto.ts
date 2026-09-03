import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body of `resetPassword`. A malformed body is 400 here; an unknown or
 * expired token is 422 from the service.
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
