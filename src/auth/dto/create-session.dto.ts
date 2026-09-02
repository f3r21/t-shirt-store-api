import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Request body of POST /auth/sessions.
 *
 * Bounds from the contract, at `openapi.yaml:110-137`. The password carries the
 * same minimum as sign-up, so a five-character attempt returns 400 and not 401.
 * That answer names the password policy. It does not say whether the account
 * exists.
 */
export class CreateSessionDto {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(254, { message: 'must be at most 254 characters' })
  email!: string;

  @IsString({ message: 'must be a string' })
  @MinLength(8, { message: 'must be at least 8 characters' })
  @MaxLength(128, { message: 'must be at most 128 characters' })
  password!: string;

  /**
   * A label for this device. The user sees it in the device list.
   *
   * This property is where the codebase first found that `@IsOptional()` treats
   * null as missing, and it carried the condition inline. The rule now lives in
   * `src/common/is-optional-not-null.ts` and every optional property uses it.
   */
  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MaxLength(64, { message: 'must be at most 64 characters' })
  deviceName?: string;
}
