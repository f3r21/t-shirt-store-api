import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * pino's six levels, and `silent`, which the end-to-end suite sets.
 */
const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * How mail leaves the process: a relay the `SMTP_*` variables describe, or
 * Amazon SES with whatever credentials the environment carries.
 */
const MAIL_TRANSPORTS = ['smtp', 'ses'] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];

/**
 * Every numeric property carries an explicit `: number`. Without it
 * `emitDecoratorMetadata` writes `Object`, and `@IsInt` fails on the string
 * dotenv supplies.
 */
export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number = 3000;

  /** The lowest level written to stdout. `silent` is what the e2e suite sets. */
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  @IsString()
  DATABASE_URL!: string;

  /**
   * The certificate bundle the database connection is verified against. Set
   * where RDS forces TLS, blank on a laptop. `database-ssl.ts` reads it.
   */
  @IsOptional()
  @IsString()
  DATABASE_SSL_CA?: string;

  /**
   * The stack's `ImagesBucket` and `ApiUrl` outputs, required so an upload
   * never lacks a destination. The SDK's credentials come from the task role
   * or from `AWS_PROFILE`, never from here.
   */
  @IsString()
  @MinLength(3)
  S3_BUCKET!: string;

  @IsUrl({
    protocols: ['http', 'https'],
    require_tld: false,
    require_protocol: true,
  })
  IMAGES_BASE_URL!: string;

  @IsString()
  AWS_REGION: string = 'us-east-2';

  /**
   * Required: the stock queue opens it at boot. `require_protocol` is what
   * rejects a bare word; without it `protocols` only checks a scheme that is
   * already there.
   */
  @IsUrl({ protocols: ['redis'], require_tld: false, require_protocol: true })
  REDIS_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  /**
   * Seconds, not a duration string: `expiresIn` types the string form as a
   * template literal union a plain `string` cannot satisfy.
   */
  @IsInt()
  @Min(1)
  JWT_ACCESS_TTL: number = 900;

  @IsInt()
  @Min(1)
  JWT_REFRESH_TTL: number = 604800;

  /**
   * The pepper for the refresh and reset token hashes. Separate from
   * `JWT_SECRET`, so rotating the signing key keeps them valid. ADR 1.
   */
  @IsString()
  @MinLength(32)
  REFRESH_TOKEN_PEPPER!: string;

  /**
   * Both required with no default: a store that cannot verify a webhook must
   * not boot.
   */
  @IsString()
  @MinLength(8)
  STRIPE_SECRET_KEY!: string;

  @IsString()
  @MinLength(8)
  STRIPE_WEBHOOK_SECRET!: string;

  /** The absolute session cap; rotation never rewrites `created_at`. ADR 8. */
  @IsInt()
  @Min(1)
  REFRESH_ABSOLUTE_TTL_DAYS: number = 30;

  /**
   * The grace window over rotation, in seconds: the dial that trades a false
   * breach signal against a real one. 0 turns it off. ADR 2.
   */
  @IsInt()
  @Min(0)
  REFRESH_GRACE_SECONDS: number = 10;

  /**
   * The browser origins allowed to call this API, comma separated. Empty
   * refuses every cross-origin call. ADR 19.
   */
  @IsString()
  CORS_ORIGINS: string = '';

  /**
   * Connections each process opens to Postgres. The ceiling is the database's
   * `max_connections` less its reserved three, divided by this times the
   * processes per task; `ARCHITECTURE.md` carries the measured number. ADR 35.
   */
  @IsInt()
  @Min(1)
  DATABASE_POOL_SIZE: number = 10;

  /**
   * Reverse proxies in front of this process. A count and never a boolean:
   * Express reads the nth address from the right, and `true` lets any client
   * forge `X-Forwarded-For`. 0 on a laptop and in the e2e suite, 1 behind
   * CloudFront. ADR 19.
   */
  @IsInt()
  @Min(0)
  TRUST_PROXY_HOPS: number = 0;

  @IsInt()
  @Min(1)
  THROTTLE_TTL: number = 60;

  /**
   * The browse tier. Sign-in and the password operations carry their own
   * tiers, so lowering this tightens neither. ADR 7.
   */
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number = 100;

  /** Where the reset link and the product links point. */
  @IsString()
  APP_URL: string = 'http://localhost:3000';

  /**
   * `smtp` reads the `SMTP_*` variables below, Mailpit on a laptop and in CI.
   * `ses` sends through SES in `AWS_REGION` with the environment's own
   * credentials. ADR 32.
   */
  @IsIn(MAIL_TRANSPORTS)
  MAIL_TRANSPORT: MailTransport = 'smtp';

  @IsString()
  SMTP_HOST: string = 'localhost';

  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number = 1025;

  /**
   * nodemailer's `secure`: TLS from the first byte, which is port 465. A 587
   * relay speaks plaintext first and upgrades with STARTTLS, so leave this
   * false there and set `SMTP_REQUIRE_TLS`. False is right for Mailpit. No
   * `@Type(() => Boolean)` here: `validateEnv` reads booleans as words,
   * because `Boolean('false')` is true.
   */
  @IsBoolean()
  SMTP_SECURE: boolean = false;

  /**
   * Refuse a relay that offers no STARTTLS, or a downgrade on the wire looks
   * like a relay that never offered it. Set it for any 587 relay off the
   * laptop; Mailpit offers none.
   */
  @IsBoolean()
  SMTP_REQUIRE_TLS: boolean = false;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsEmail()
  MAIL_FROM!: string;
}

/** The words a `.env` file may write for a boolean. Any other word stops the boot. */
const BOOLEAN_WORDS: Record<string, boolean> = {
  true: true,
  '1': true,
  false: false,
  '0': false,
};

export function validateEnv(config: Record<string, unknown>) {
  // A present and empty variable is an absent one. `enableImplicitConversion`
  // would turn `''` into 0, which passes `@IsInt` and `@Min(0)`, so the grace
  // window would silently switch off.
  const present = Object.fromEntries(
    Object.entries(config).filter(
      ([, value]) => typeof value !== 'string' || value.trim() !== '',
    ),
  );

  // Booleans are read as words before the coercion, because `Boolean('false')`
  // is true and every string is truthy afterwards. The boolean properties are
  // found through `design:type`, so there is no list to forget.
  const proto = EnvironmentVariables.prototype as object;
  for (const key of Object.getOwnPropertyNames(new EnvironmentVariables())) {
    const declared = Reflect.getMetadata('design:type', proto, key) as unknown;
    const raw = present[key];
    if (declared !== Boolean || typeof raw !== 'string') {
      continue;
    }

    const word = BOOLEAN_WORDS[raw.trim().toLowerCase()];
    if (word === undefined) {
      throw new Error(
        `Invalid environment variables:\n${key} must be true or false, and it is "${raw}"`,
      );
    }
    present[key] = word;
  }

  const validatedConfig = plainToInstance(EnvironmentVariables, present, {
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
