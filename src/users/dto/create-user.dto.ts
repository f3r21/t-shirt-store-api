import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body of `createUser`. Every bound comes from the contract, which
 * sets no minimum on the names. Messages omit the field name, because
 * `Problem.errors[].field` carries it.
 */
export class CreateUserDto {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(254, { message: 'must be at most 254 characters' })
  email!: string;

  @IsString({ message: 'must be a string' })
  @MinLength(8, { message: 'must be at least 8 characters' })
  @MaxLength(128, { message: 'must be at most 128 characters' })
  password!: string;

  @IsString({ message: 'must be a string' })
  @MaxLength(100, { message: 'must be at most 100 characters' })
  firstName!: string;

  @IsString({ message: 'must be a string' })
  @MaxLength(100, { message: 'must be at most 100 characters' })
  lastName!: string;
}
