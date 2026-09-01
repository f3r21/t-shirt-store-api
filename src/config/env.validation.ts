import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsEmail,
  IsInt,
  IsOptional,
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

  /**
   * Optional, because nothing reads it yet.
   *
   * It was required, so `validateEnv` refused to boot without it, and
   * `rg -n 'REDIS_URL' src test` finds it only here and in two test setups
   * while `rg -n 'redis|bullmq|ioredis' package.json` finds no client at all.
   * Every deployment and the CI job had to invent a value for a service the
   * process never opens, which teaches a reader that this file's requirements
   * are decorative.
   *
   * **It becomes required again the day something opens the connection**, which
   * is either the throttler's Redis storage adapter or the stock notification
   * queue, whichever lands first. The `@IsUrl` stays, so a value that is present
   * and wrong still fails at boot rather than at the first job.
   *
   * **`require_protocol` is not decoration.** Without it `protocols: ['redis']`
   * only constrains a protocol that is already there, so a bare word passed.
   * Measured against `validator.isURL` directly, with the old options and the
   * new ones:
   *
   *     'not-a-url'               accepted  ->  rejected
   *     'nonsense'                accepted  ->  rejected
   *     'redis://localhost:6379'  accepted  ->  accepted
   *     'http://localhost:6379'   rejected  ->  rejected
   *
   * The first two are the reason this line changed. The last two are the
   * control: the option tightens the check and does not replace it.
   */
  @IsOptional()
  @IsUrl({ protocols: ['redis'], require_tld: false, require_protocol: true })
  REDIS_URL?: string;

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

  /**
   * How long the immediately previous refresh token keeps working after a
   * rotation, so two honest tabs refreshing at once do not sign the account out.
   *
   * Ten seconds is a network round trip and a retry, not a session. It is here
   * rather than a constant because it is the dial that trades a false breach
   * signal against a real one: **every second of this window is a second in
   * which a stolen previous-generation token is accepted without raising the
   * alarm**, so whoever operates this service should be able to shorten it
   * without a deployment.
   *
   * Zero is allowed and turns the window off, which restores the behaviour this
   * replaced and is the cheapest way to test that reuse detection still fires.
   */
  @IsInt()
  @Min(0)
  REFRESH_GRACE_SECONDS: number = 10;

  /**
   * The browser origins allowed to call this API, comma separated.
   *
   * `configure-app.ts` called `app.enableCors()` with no argument, which is
   * Nest's fully permissive default: `Access-Control-Allow-Origin: *` on every
   * route, one line below `helmet()`, whose entire purpose is the opposite.
   * Measured rather than read from the documentation:
   *
   *     node -e "require('cors')(undefined)({method:'GET',headers:{origin:
   *       'https://evil.example'}}, ...)"
   *     -> {"Access-Control-Allow-Origin":"*"}
   *
   * **Empty is the default and it means no cross-origin browser may call this.**
   * Not a wildcard: a service with no configured front end should refuse, and a
   * deployment that wants a front end says so. Both reviews of this branch
   * named the wildcard, which is the argument for the safe default rather than
   * the convenient one.
   */
  @IsString()
  CORS_ORIGINS: string = '';

  /**
   * How many reverse proxies sit in front of this process.
   *
   * **The rate limit is keyed on `req.ip` and `trust proxy` was never set**, so
   * behind a load balancer every caller shares the balancer's address and one
   * abusive client answers 429 to the whole store. `ARCHITECTURE.md` names this
   * as the one regression that would reach production with nothing to catch it,
   * because the end-to-end suite talks to the process directly and sees the
   * real client there.
   *
   * A count and not a boolean, and that is the whole point. `trust proxy: true`
   * would let any client forge `X-Forwarded-For` and evade the limit entirely,
   * turning a shared-counter bug into an open door. Express reads the nth
   * address from the right, so the number has to match the deployment.
   *
   * 0 means no proxy, which is correct for local development and for the
   * end-to-end suite, and it is why the default keeps today's behaviour.
   */
  @IsInt()
  @Min(0)
  TRUST_PROXY_HOPS: number = 0;

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
  // **A variable that is present and empty is a variable nobody set.**
  //
  // `enableImplicitConversion` turns `''` into `0` for every numeric property,
  // and `0` passes `@IsInt` and `@Min(0)`, so the value arrives silently wrong
  // rather than loudly absent. Measured: with the three set to `''`,
  // `REFRESH_GRACE_SECONDS` became 0, which **turns the grace window off and
  // reinstates the account-wide sign-out it was written to remove**, and `PORT`
  // became 0. Positive control: `'abc'` was rejected, so the validator does
  // fire; it just has nothing to fire at.
  //
  // The alphabet of production is strings read from a file, and it contains one
  // value nobody types into a test literal. Dropping the key restores the
  // default, or fails as missing when there is no default, which is what the
  // author of a `.env` line with nothing after the `=` meant.
  const present = Object.fromEntries(
    Object.entries(config).filter(
      ([, value]) => typeof value !== 'string' || value.trim() !== '',
    ),
  );

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
