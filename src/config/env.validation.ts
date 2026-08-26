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

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT = 3000;

  @IsInt()
  @Min(1)
  THROTTLE_TTL = 60;

  @IsString()
  DATABASE_URL!: string;

  @IsUrl({ protocols: ['redis'], require_tld: false })
  REDIS_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  JWT_REFRESH_TTL = '7d';

  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 5;

  @IsString()
  SMTP_HOST = 'localhost';

  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT = 1025;

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
