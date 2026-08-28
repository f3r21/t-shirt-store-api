import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsEmail,
  IsInt,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Every numeric property carries an explicit `: number`.
 *
 * Without the annotation `emitDecoratorMetadata` writes `design:type = Object`,
 * class-transformer has no target to coerce to, and `@IsInt` then fails on the
 * string dotenv supplies. The result is that setting any numeric variable in
 * `.env` stops the boot, while leaving it unset works, which reads as the
 * opposite of a configuration file. Verified against the committed build.
 */
export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsUrl({ protocols: ['redis'], require_tld: false })
  REDIS_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  /**
   * Seconds, not a duration string.
   *
   * `@types/jsonwebtoken` types `expiresIn` as `StringValue | number`, where
   * `StringValue` is a template literal union from `@types/ms`. A plain `string`
   * is not assignable to it, so `'15m'` fails the type check at the module
   * factory. Seconds also let the refresh row compute its own `expires_at`.
   */
  @IsInt()
  @Min(1)
  JWT_ACCESS_TTL: number = 900;

  @IsInt()
  @Min(1)
  JWT_REFRESH_TTL: number = 604800;

  /**
   * The pepper for the refresh and reset token hashes. Separate from
   * `JWT_SECRET` on purpose: rotating the signing key would otherwise
   * invalidate every stored token hash at the same time.
   */
  @IsString()
  @MinLength(32)
  REFRESH_TOKEN_PEPPER!: string;

  /**
   * A rotating session still ends. Rotation never rewrites `created_at`, so the
   * cap needs no column of its own.
   */
  @IsInt()
  @Min(1)
  REFRESH_ABSOLUTE_TTL_DAYS: number = 30;

  @IsInt()
  @Min(1)
  THROTTLE_TTL: number = 60;

  /**
   * The loosest of three tiers, and the one a browsing client lives under. It is
   * sized for reading the catalog, so it is deliberately too loose for sign-in
   * and for the password operations. Those two carry their own `@Throttle`, at
   * `SIGN_IN_THROTTLE` and `PASSWORD_THROTTLE`, and lowering this number is not a
   * way to tighten them.
   */
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number = 100;

  /**
   * Where the reset link points. It carries a default, so a developer who has
   * not set it still gets a working link against a local frontend.
   */
  @IsString()
  APP_URL: string = 'http://localhost:3000';

  @IsString()
  SMTP_HOST: string = 'localhost';

  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number = 1025;

  @IsEmail()
  MAIL_FROM!: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Invalid environment variables:\n${errors.toString()}`);
  }

  return validatedConfig;
}
