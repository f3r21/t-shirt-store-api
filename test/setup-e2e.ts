/**
 * The environment the end-to-end suite runs against.
 *
 * Set here rather than in a `.env.test` file for two reasons. `.gitignore`
 * covers `.env` and `.env.test.local` but not `.env.test`, so that file would be
 * committed. And `@nestjs/config` reads `.env` when a key is absent from
 * `process.env`, so a file alone would not reliably win: assigning here does,
 * because process.env takes precedence over the file.
 *
 * The database is a separate one. The suite truncates between tests, and doing
 * that to the development database would delete the seed on every run.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/tshirt_store_test';
process.env.JWT_SECRET = 'e2e-jwt-secret-at-least-32-characters-long';
process.env.REFRESH_TOKEN_PEPPER = 'e2e-pepper-at-least-32-characters-long';
process.env.MAIL_FROM = 'no-reply@tshirt.store';
// Throwaway Stripe values. The stub in `app-factory.ts` answers the API calls,
// and the webhook signature is verified for real against this secret.
process.env.STRIPE_SECRET_KEY = 'sk_test_e2e';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_e2e_secret';
// One allowed origin, so the suite can assert both halves: the echo for this
// one and the silence for any other. An empty list would only prove the
// refusal, and a permissive default is what this suite exists to catch.
process.env.CORS_ORIGINS = 'https://shop.example';
// Database 1 on the same container as development, so the suite's queue keys
// never share the development queue's. `TEST_REDIS_URL` overrides it, the way
// `TEST_DATABASE_URL` does above.
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

// Short, so an expiry test does not have to wait fifteen minutes.
process.env.JWT_ACCESS_TTL = '900';
process.env.JWT_REFRESH_TTL = '604800';

// Silent, so a failing assertion is not buried under the request line pino
// writes for every call the suite makes. Only when unset, so
// `LOG_LEVEL=info npm run test:e2e` shows the lines when they are the point.
process.env.LOG_LEVEL ??= 'silent';
