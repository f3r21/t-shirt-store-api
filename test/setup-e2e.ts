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
// `REDIS_URL` is deliberately absent. Nothing in `src` opens a Redis
// connection, so the whole end-to-end suite booting without it is the proof
// that the variable is optional, and it is a better proof than any assertion.

// Short, so an expiry test does not have to wait fifteen minutes.
process.env.JWT_ACCESS_TTL = '900';
process.env.JWT_REFRESH_TTL = '604800';
