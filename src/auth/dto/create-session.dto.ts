import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Request body of POST /auth/sessions.
 *
 * Bounds from the contract, at `openapi.yaml:101-128`. The password carries the
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
   * `@ValidateIf` on undefined rather than `@IsOptional()`. `@IsOptional()`
   * treats null as missing and skips every decorator after it, so an explicit
   * `"deviceName": null` would reach the service unchecked, against a contract
   * whose optional values are absent and never null.
   */
  @ValidateIf((body: CreateSessionDto) => body.deviceName !== undefined)
  @IsString({ message: 'must be a string' })
  @MaxLength(64, { message: 'must be at most 64 characters' })
  deviceName?: string;
}
