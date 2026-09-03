import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsOptionalNotNull } from '../../common/is-optional-not-null';

/**
 * Request body of `createSession`. The password carries the sign-up minimum,
 * so a short attempt is 400 and not 401: that names the policy, not the
 * account.
 */
export class CreateSessionDto {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(254, { message: 'must be at most 254 characters' })
  email!: string;

  @IsString({ message: 'must be a string' })
  @MinLength(8, { message: 'must be at least 8 characters' })
  @MaxLength(128, { message: 'must be at most 128 characters' })
  password!: string;

  /** A label for this device, shown in the device list. */
  @IsOptionalNotNull()
  @IsString({ message: 'must be a string' })
  @MaxLength(64, { message: 'must be at most 64 characters' })
  deviceName?: string;
}
