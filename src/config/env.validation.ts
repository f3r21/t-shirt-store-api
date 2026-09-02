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
export const LOG_LEVELS = [
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
export const MAIL_TRANSPORTS = ['smtp', 'ses'] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];

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

  /**
   * The lowest level that reaches stdout.
   *
   * Every line is JSON and nothing here opens a file: the process writes to
   * stdout and whatever runs it routes the stream. `info` carries the
   * completion line of every request and the events the OWASP logging cheat
   * sheet names. `silent` is what the end-to-end suite sets, so a failing
   * assertion is not buried under the request lines of every call it makes.
   */
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  @IsString()
  DATABASE_URL!: string;

  /**
   * The path of a certificate bundle the database connection is verified
   * against. Set in the deployed environment, where RDS refuses plaintext and
   * the image carries the RDS bundle; absent on a laptop, where the compose
   * container speaks no TLS. `database-ssl.ts` reads it.
   */
  @IsOptional()
  @IsString()
  DATABASE_SSL_CA?: string;

  /**
   * Where product images are stored and where they are served from. Both
   * required, the way the Stripe keys are: an upload that silently had
   * nowhere to go would be worse than a boot that refuses. The values are
   * the stack's outputs, `ImagesBucket` and `ApiUrl`; the SDK reads its
   * credentials from the task role in the container and from `AWS_PROFILE`
   * exported in the shell on a laptop, never from this file.
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
   * Required, because the stock notification queue opens it.
   *
   * It was optional for a while: nothing in `src` read it, so every deployment
   * and the CI job invented a value for a service the process never dialled,
   * and this comment said it would become required again the day something
   * opened the connection. `stock-notifications/stock-queue.ts` is that
   * something. The queue is built from this value alone: BullMQ hands the URL
   * to ioredis, which reads the host, the port, the password and the database
   * index out of it. The `@IsUrl` still fails a present and wrong value at boot
   * rather than at the first job.
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
  @IsUrl({ protocols: ['redis'], require_tld: false, require_protocol: true })
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
   * The Stripe secret key and the webhook signing secret. Both required and
   * neither defaulted: a store that cannot verify a webhook must not boot,
   * because an unverified event could mark an order paid. The e2e suite sets
   * throwaway values, and the signature check runs for real against them.
   */
  @IsString()
  @MinLength(8)
  STRIPE_SECRET_KEY!: string;

  @IsString()
  @MinLength(8)
  STRIPE_WEBHOOK_SECRET!: string;

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
   * sized for reading the catalog, so it is deliberately too loose for the
   * credential routes. Sign-in, sign-up and refresh carry `SIGN_IN_THROTTLE`,
   * the three password operations carry `PASSWORD_THROTTLE`, and lowering this
   * number is not a way to tighten either.
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

  /**
   * How mail leaves the process. `smtp` reads the `SMTP_*` variables below,
   * which is Mailpit on a laptop and in CI. `ses` sends through Amazon SES in
   * `AWS_REGION` with the credentials of the environment, the task role in the
   * container, so no relay password exists anywhere. The sender is `MAIL_FROM`
   * either way, and SES accepts only an address it has verified.
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
   * Whether the connection to the relay is TLS from the first byte.
   *
   * **This is nodemailer's `secure`, and it means implicit TLS, not "require
   * encryption".** True is right for a relay on port 465. A relay on 587 or 25
   * speaks plaintext first and upgrades with STARTTLS, and `secure: true`
   * against one of those fails the handshake on every send. The mailer logs
   * and swallows a failed send, so `POST /auth/forgot-password` answers 202
   * and nobody receives the link. The previous docstring said to set this
   * true anywhere that is not a laptop, and most relays are on 587.
   *
   * False, the default, is right for Mailpit, which speaks no TLS and is what
   * `docker-compose.yml` runs, and for every STARTTLS relay. On that path
   * nodemailer upgrades when the relay offers STARTTLS and stays in the clear
   * when it does not. `SMTP_REQUIRE_TLS` below is what refuses the second
   * case.
   *
   * **The transport was hard coded to `secure: false` with `ignoreTLS: true`,
   * and that is the production binding.** `ignoreTLS` does not merely allow a
   * plaintext connection: it refuses STARTTLS **even when the server offers
   * it**, so a relay willing to encrypt was talked to in the clear anyway. The
   * password reset message carries the raw token, which is a bearer credential
   * for the account. `SMTP_USER` and `SMTP_PASS` below exist for the same
   * reason: without them there was no configuration path to an authenticated
   * relay at all, so the only reachable deployment was an open one.
   *
   * **There is no `@Type(() => Boolean)` here, and that is the point.** Under
   * `enableImplicitConversion` that decorator is `Boolean(value)`, so every
   * non-empty string is true and `SMTP_SECURE=false` in a `.env` file means
   * true. Measured against the version of this file that carried it:
   *
   *     'false'     -> true        '0'   -> true
   *     'nonsense'  -> true        ''    -> false
   *     omitted     -> false
   *
   * Only the last two rows are right. `validateEnv` reads the word instead, and
   * refuses a word it does not know.
   */
  @IsBoolean()
  SMTP_SECURE: boolean = false;

  /**
   * Whether a relay that offers no STARTTLS is refused.
   *
   * With `SMTP_SECURE` false, nodemailer upgrades when the relay advertises
   * STARTTLS and otherwise sends in the clear, and a connection that was
   * downgraded on the wire looks exactly like a relay that never offered it.
   * This is nodemailer's `requireTLS`: the client sends STARTTLS whether or
   * not the relay advertised it, and fails the send if the relay declines.
   * Set it true for any 587 relay that is not on the laptop. It changes
   * nothing when `SMTP_SECURE` is true, because that connection is TLS
   * already.
   *
   * False by default, because Mailpit offers no STARTTLS at all.
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

/**
 * The words a `.env` file may write for a boolean.
 *
 * Deliberately four and not a dialect. A value outside this set stops the boot,
 * which is the same answer this file gives to a malformed `REDIS_URL`.
 */
const BOOLEAN_WORDS: Record<string, boolean> = {
  true: true,
  '1': true,
  false: false,
  '0': false,
};

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

  // **A boolean read from a file is a word, and `Boolean('false')` is true.**
  //
  // Same shape as the empty string above, one type over. `SMTP_SECURE` carried
  // `@Type(() => Boolean)`, which under `enableImplicitConversion` is exactly
  // that call, so an operator writing `SMTP_SECURE=false` got a mailer that
  // demanded TLS from a Mailpit that speaks none, `SMTP_SECURE=0` got the same,
  // and `nonsense` was accepted as true. Only an omitted variable read false.
  //
  // Discovered through `design:type` rather than listed, for the reason the
  // numeric gate in `app.module.spec.ts` gives: a list is one more place to
  // forget. The throw happens here because there is no later chance. Every
  // string is truthy, so a validator that runs after the coercion has nothing
  // left to reject.
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
