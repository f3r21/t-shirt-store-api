import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body of PATCH /users/me/password.
 *
 * See `openapi.yaml:468-479`. The contract does not ask that the new password
 * differ from the current one, so this class does not check it.
 */
export class ChangePasswordDto {
  @IsString({ message: 'must be a string' })
  @MinLength(8, { message: 'must be at least 8 characters' })
  @MaxLength(128, { message: 'must be at most 128 characters' })
  currentPassword!: string;

  @IsString({ message: 'must be a string' })
  @MinLength(8, { message: 'must be at least 8 characters' })
  @MaxLength(128, { message: 'must be at most 128 characters' })
  newPassword!: string;
}
