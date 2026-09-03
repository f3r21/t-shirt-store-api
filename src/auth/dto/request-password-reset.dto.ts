import { IsEmail, MaxLength } from 'class-validator';

/**
 * Request body of `requestPasswordReset`. The operation answers 202 either
 * way, so this body is the only place it returns 400.
 */
export class RequestPasswordResetDto {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(254, { message: 'must be at most 254 characters' })
  email!: string;
}
