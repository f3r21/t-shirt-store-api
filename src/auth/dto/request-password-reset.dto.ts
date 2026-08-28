import { IsEmail, MaxLength } from 'class-validator';

/**
 * Request body of POST /auth/forgot-password.
 *
 * See `openapi.yaml:302-308`. The operation answers 202 whether or not the
 * address has an account, so this body is the only place it can return a 400.
 */
export class RequestPasswordResetDto {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(254, { message: 'must be at most 254 characters' })
  email!: string;
}
